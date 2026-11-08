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

describe('ufw', () => {
  it('status reports no rules on a clean host', async () => {
    const game = new Game(makeMission(), 1);
    const out = text(await game.run('ufw status'));
    expect(out).toContain('No rules defined');
  });

  it('deny from <ip> to any port <port> actually blocks that source and only that source', async () => {
    // Run everything FROM 'target' so ufw edits target's own firewall, and so
    // a second, uninvolved host ('attacker') can be used as the control case
    // proving the rule is scoped to the IP, not blanket.
    const game = new Game(makeMission({ start: { hostId: 'target', user: 'root' } }), 1);
    expect(game.world.probePort('attacker', 'target', 22)).toBe('open');

    const out = text(await game.run('ufw deny from 10.0.0.5 to any port 22'));
    expect(out).toContain('Rule added');

    // Blocked for the source we named...
    expect(game.world.probePort('attacker', 'target', 22)).toBe('filtered');
    // ...but NOT for the host itself: the rule is scoped to fromHostId
    // 'attacker', and that scoping check (`r.fromHostId !== fromId`) simply
    // doesn't match when fromId is 'target' -- probePort always evaluates
    // the firewall regardless of who's asking, there's no separate loopback
    // shortcut, so this is really testing that fromHostId-scoping works at
    // all, not a special self-traffic case.
    expect(game.world.probePort('target', 'target', 22)).toBe('open');

    const status = text(await game.run('ufw status'));
    expect(status).toContain('22/tcp');
    expect(status).toContain('DENY');
    expect(status).toContain('10.0.0.5');
  });

  it('allow/deny <port> (no "from") applies globally, with later rules winning', async () => {
    const game = new Game(makeMission({ start: { hostId: 'target', user: 'root' } }), 1);
    await game.run('ufw deny 22');
    expect(game.world.probePort('attacker', 'target', 22)).toBe('filtered');
    await game.run('ufw allow 22');
    expect(game.world.probePort('attacker', 'target', 22)).toBe('open');
  });

  it('rejects an unresolvable address and an invalid port', async () => {
    const game = new Game(makeMission({ start: { hostId: 'target', user: 'root' } }), 1);
    const badIp = text(await game.run('ufw deny from 9.9.9.9 to any port 22'));
    expect(badIp).toContain('could not resolve');
    const badPort = text(await game.run('ufw allow notaport'));
    expect(badPort).toContain('invalid port');
  });

  it('emits a firewall.rule event, which completes a firewallBlocks objective', async () => {
    const m = makeMission({
      start: { hostId: 'target', user: 'root' },
      objectives: [
        {
          id: 'contain',
          text: 'block the attacker on port 22',
          check: { kind: 'firewallBlocks', hostId: 'target', port: 22, fromHostId: 'attacker' },
        },
      ],
    });
    const game = new Game(m, 1);
    expect(game.runtime.isDone('contain')).toBe(false);
    await game.run('ufw deny from 10.0.0.5 to any port 22');
    expect(game.runtime.isDone('contain')).toBe(true);
  });
});
