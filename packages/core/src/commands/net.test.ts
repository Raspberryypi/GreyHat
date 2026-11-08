import { describe, expect, it } from 'vitest';
import { Game } from '../game/game';
import type { MissionDef } from '../missions/types';

const text = (out: { chunks: { text: string }[] }): string => out.chunks.map((c) => c.text).join('');

function makeMission(overrides: Partial<MissionDef> = {}): MissionDef {
  return {
    id: 'TEST',
    title: 'Test',
    track: 'test',
    role: 'offense',
    difficulty: 1,
    xp: 100,
    briefing: ['test'],
    objectives: [{ id: 'login', text: 'login', check: { kind: 'authSuccess', targetUser: 'bob' } }],
    hints: [],
    debrief: [],
    world: {
      startTime: Date.UTC(2026, 0, 1),
      hosts: [
        {
          id: 'attacker',
          hostname: 'attacker',
          ip: '10.0.0.5',
          users: [{ name: 'root', uid: 0, home: '/root' }, { name: 'op', uid: 1000, home: '/home/op' }],
          fs: {},
        },
        {
          id: 'target',
          hostname: 'target',
          ip: '10.0.0.20',
          users: [{ name: 'root', uid: 0, home: '/root' }, { name: 'bob', uid: 1001, home: '/home/bob', password: 'hunter2' }],
          services: [{ port: 22, name: 'ssh' }],
          fs: { '/home/bob/flag.txt': { owner: 'bob', content: 'ok\n' } },
        },
      ],
    },
    start: { hostId: 'attacker', user: 'op' },
    solution: ['nmap -p 22 10.0.0.20', 'ssh bob@10.0.0.20', 'hunter2', 'cat flag.txt'],
    ...overrides,
  };
}

describe('network commands', () => {
  it('ping reports reachable and unreachable hosts differently', async () => {
    const game = new Game(makeMission(), 1);
    const up = text(await game.run('ping -c 1 10.0.0.20'));
    expect(up).toContain('1 received, 0% packet loss');
    const down = text(await game.run('ping -c 1 10.0.0.9'));
    expect(down).toContain('Name or service not known');
  });

  it('nmap shows the open ssh port and nothing else by default', async () => {
    const game = new Game(makeMission(), 1);
    const out = text(await game.run('nmap 10.0.0.20'));
    expect(out).toContain('22/tcp');
    expect(out).toContain('open');
    expect(out).toContain('ssh');
  });

  it('ssh with the right password logs in, changes host/cwd, and exit returns', async () => {
    const game = new Game(makeMission(), 1);
    const prompt = text(await game.run('ssh bob@10.0.0.20'));
    expect(prompt).toContain("bob@10.0.0.20's password");
    const welcome = text(await game.run('hunter2'));
    expect(welcome).toContain('Welcome to target');
    expect(game.session.hostId).toBe('target');
    expect(game.session.user).toBe('bob');
    expect(game.session.cwd).toBe('/home/bob');

    const cat = text(await game.run('cat flag.txt'));
    expect(cat).toBe('ok\n');

    await game.run('exit');
    expect(game.session.hostId).toBe('attacker');
    expect(game.session.user).toBe('op');
  });

  it('ssh with the wrong password fails after 3 attempts and never logs in', async () => {
    const game = new Game(makeMission(), 1);
    await game.run('ssh bob@10.0.0.20');
    await game.run('nope1');
    await game.run('nope2');
    const out = text(await game.run('nope3'));
    expect(out).toContain('Permission denied');
    expect(game.session.hostId).toBe('attacker');
  });

  it('completes the authSuccess objective only on a real login', async () => {
    const game = new Game(makeMission(), 1);
    await game.run('ssh bob@10.0.0.20');
    await game.run('wrongpass');
    expect(game.runtime.isDone('login')).toBe(false);
    await game.run('ssh bob@10.0.0.20');
    await game.run('hunter2');
    expect(game.runtime.isDone('login')).toBe(true);
  });

  it('respects firewall rules: a denied port shows as filtered', async () => {
    const m = makeMission();
    m.world.hosts[1].firewall = [{ port: 22, action: 'deny' }];
    const game = new Game(m, 1);
    const out = text(await game.run('nmap -p 22 10.0.0.20'));
    expect(out).toContain('filtered');
    const sshOut = text(await game.run('ssh bob@10.0.0.20'));
    expect(sshOut).toContain('timed out');
  });
});
