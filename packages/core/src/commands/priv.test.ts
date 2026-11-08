import { describe, expect, it } from 'vitest';
import { Game } from '../game/game';
import type { MissionDef } from '../missions/types';

const text = (out: { chunks: { text: string }[] }): string => out.chunks.map((c) => c.text).join('');

function makeMission(): MissionDef {
  return {
    id: 'TEST',
    title: 'Test',
    track: 'test',
    role: 'offense',
    difficulty: 1,
    xp: 100,
    briefing: ['test'],
    objectives: [
      { id: 'flag', text: 'read secret', check: { kind: 'fileRead', path: '/root/secret.txt', hostId: 'app01' } },
    ],
    hints: [],
    debrief: [],
    world: {
      startTime: Date.UTC(2026, 0, 1),
      hosts: [
        {
          id: 'app01',
          hostname: 'app01',
          ip: '10.0.0.5',
          users: [
            { name: 'root', uid: 0, home: '/root', password: 'toor' },
            { name: 'jr', uid: 1000, home: '/home/jr' },
          ],
          sudoers: [
            { user: 'jr', commands: ['cat', 'crontab'], noPasswd: true },
            { user: 'jr', commands: ['ls'], noPasswd: false },
          ],
          crontabs: { root: ['# root job'], jr: ['# jr job'] },
          fs: {
            '/home/jr/': { owner: 'jr' },
            '/home/jr/file.txt': { owner: 'jr', content: 'hello\n' },
            '/root/secret.txt': { owner: 'root', mode: 0o600, content: 'root-secret\n' },
          },
        },
      ],
    },
    start: { hostId: 'app01', user: 'jr' },
    solution: ['sudo -l', 'sudo cat /root/secret.txt'],
  };
}

describe('sudo', () => {
  it('-l lists the matching rules for the current user', async () => {
    const game = new Game(makeMission(), 1);
    const out = text(await game.run('sudo -l'));
    expect(out).toContain('NOPASSWD: cat');
    expect(out).toContain('ls');
  });

  it('refuses a command with no matching rule', async () => {
    const game = new Game(makeMission(), 1);
    const out = text(await game.run('sudo rm -rf /'));
    expect(out).toContain('may not run sudo');
  });

  it('refuses a matching rule that is not NOPASSWD', async () => {
    const game = new Game(makeMission(), 1);
    const out = text(await game.run('sudo ls /root'));
    expect(out).toContain('password is required');
  });

  it('runs a NOPASSWD rule as root, bypassing normal permissions', async () => {
    const game = new Game(makeMission(), 1);
    const cantRead = text(await game.run('cat /root/secret.txt'));
    expect(cantRead).toContain('Permission denied');
    const out = text(await game.run('sudo cat /root/secret.txt'));
    // This call also satisfies the mission's own 'flag' fileRead objective
    // (same event, same run()), so the output is the command's stdout
    // followed by Game.run()'s own "[+] Objective complete" / "[*] MISSION
    // COMPLETE" notices -- toContain, not toBe, is the correct check here.
    expect(out).toContain('root-secret\n');
  });

  it('completes the fileRead objective when the elevated read happens', async () => {
    const game = new Game(makeMission(), 1);
    await game.run('sudo cat /root/secret.txt');
    expect(game.runtime.isDone('flag')).toBe(true);
  });

  it('does not leave the session itself elevated after sudo', async () => {
    const game = new Game(makeMission(), 1);
    await game.run('sudo cat /root/secret.txt');
    expect(game.session.user).toBe('jr');
    const stillCantRead = text(await game.run('cat /root/secret.txt'));
    expect(stillCantRead).toContain('Permission denied');
  });
});

describe('crontab', () => {
  it('-l shows the invoking (effective) user\'s own crontab', async () => {
    const game = new Game(makeMission(), 1);
    expect(text(await game.run('crontab -l'))).toBe('# jr job\n');
  });

  it('sudo crontab -l shows the elevated (root) crontab, not the real user\'s', async () => {
    const game = new Game(makeMission(), 1);
    expect(text(await game.run('sudo crontab -l'))).toBe('# root job\n');
  });
});

describe('su', () => {
  it('switches to root with the right password and exit restores jr', async () => {
    const game = new Game(makeMission(), 1);
    const prompt = text(await game.run('su root'));
    expect(prompt).toContain('Password:');
    await game.run('toor');
    expect(game.session.user).toBe('root');
    await game.run('exit');
    expect(game.session.user).toBe('jr');
  });

  it('fails with the wrong password after 3 attempts and does not switch', async () => {
    const game = new Game(makeMission(), 1);
    await game.run('su root');
    await game.run('wrong1');
    await game.run('wrong2');
    const out = text(await game.run('wrong3'));
    expect(out).toContain('Authentication failure');
    expect(game.session.user).toBe('jr');
  });
});

describe('chmod / cp / mv', () => {
  it('chmod changes a file\'s mode as its owner', async () => {
    const game = new Game(makeMission(), 1);
    await game.run('chmod 600 file.txt');
    const ls = text(await game.run('ls -l file.txt'));
    expect(ls).toContain('rw-------');
  });

  it('cp duplicates a file without removing the source', async () => {
    const game = new Game(makeMission(), 1);
    await game.run('cp file.txt copy.txt');
    expect(text(await game.run('cat copy.txt'))).toBe('hello\n');
    expect(text(await game.run('cat file.txt'))).toBe('hello\n');
  });

  it('mv renames a file and removes the source', async () => {
    const game = new Game(makeMission(), 1);
    await game.run('mv file.txt renamed.txt');
    expect(text(await game.run('cat renamed.txt'))).toBe('hello\n');
    const err = text(await game.run('cat file.txt'));
    expect(err).toContain('No such file or directory');
  });
});

function makeChownMission(startUser: 'root' | 'jr'): MissionDef {
  return {
    id: 'TEST-CHOWN',
    title: 'Test',
    track: 'test',
    role: 'offense',
    difficulty: 1,
    xp: 100,
    briefing: ['test'],
    // One harmless, never-satisfied objective rather than an empty array --
    // an empty objectives list makes MissionRuntime.isComplete() vacuously
    // true from the very first event, which these tests don't need.
    objectives: [{ id: 'noop', text: 'noop', check: { kind: 'commandRun', name: '__never__' } }],
    hints: [],
    debrief: [],
    world: {
      startTime: Date.UTC(2026, 0, 1),
      hosts: [
        {
          id: 'h',
          hostname: 'h',
          ip: '10.0.0.1',
          users: [
            { name: 'root', uid: 0, home: '/root' },
            { name: 'jr', uid: 1000, home: '/home/jr' },
          ],
          fs: {
            '/home/jr/': { owner: 'jr' },
            '/home/jr/file.txt': { owner: 'jr', group: 'jr', content: 'x\n' },
          },
        },
      ],
    },
    start: { hostId: 'h', user: startUser },
    solution: [],
  };
}

describe('chown', () => {
  it('root can change both owner and group with owner:group', async () => {
    const game = new Game(makeChownMission('root'), 1);
    await game.run('chown root:root /home/jr/file.txt');
    const ls = text(await game.run('ls -l /home/jr/file.txt'));
    expect(ls).toContain(' root root ');
  });

  it(':group alone changes only the group, leaving the owner as-is', async () => {
    const game = new Game(makeChownMission('root'), 1);
    await game.run('chown :adm /home/jr/file.txt');
    const ls = text(await game.run('ls -l /home/jr/file.txt'));
    expect(ls).toContain(' jr adm ');
  });

  it('a non-root user cannot chown, even their own file', async () => {
    const game = new Game(makeChownMission('jr'), 1);
    const out = text(await game.run('chown root file.txt'));
    expect(out).toContain('Permission denied');
    const ls = text(await game.run('ls -l file.txt'));
    expect(ls).toContain(' jr jr ');
  });
});
