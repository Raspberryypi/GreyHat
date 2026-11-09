import { describe, expect, it } from 'vitest';
import { Game } from '@greyhat/core';
import { missions } from './index';
import { ATTACKER_IP, COMPROMISED_USER } from './missions/m002-brute-force';
import { INCIDENT_USER, INCIDENT_METHOD } from './missions/m005-after-the-fact';
import { ATTACKER_IP as WEB_ATTACKER_IP, TECHNIQUE as WEB_TECHNIQUE } from './missions/m007-web-logs-dont-lie';
import { PASSWORD as M008_PASSWORD, FLAG as M008_FLAG } from './missions/m008-three-strikes';

const text = (out: { chunks: { text: string }[] }): string => out.chunks.map((c) => c.text).join('');

describe('every mission', () => {
  it('has unique ids and at least one objective', () => {
    const ids = missions.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of missions) expect(m.objectives.length).toBeGreaterThan(0);
  });

  for (const m of missions) {
    it(`${m.id} is solvable with its reference solution`, async () => {
      const game = new Game(m, 12345);
      expect(game.runtime.isComplete()).toBe(false);
      for (const line of m.solution) await game.run(line);
      expect(game.runtime.isComplete()).toBe(true);
      expect(game.getSnapshot().completed).toBe(true);
    });

    it(`${m.id} is not completed by doing nothing useful`, async () => {
      const game = new Game(m, 1);
      await game.run('echo hello');
      await game.run('pwd');
      expect(game.runtime.isComplete()).toBe(false);
    });

    it(`${m.id} costs XP for hints`, async () => {
      const game = new Game(m, 7);
      await game.run('hint');
      for (const line of m.solution) await game.run(line);
      expect(game.getSnapshot().xp).toBe(m.xp - 5);
    });
  }
});

describe('M002 brute force', () => {
  const m002 = missions.find((m) => m.id === 'M002')!;

  it('is deterministic for a given seed and varies between seeds', () => {
    const read = (seed: number): string => {
      const g = new Game(m002, seed);
      const host = g.world.host('srv01');
      return host.fs.readFile('/var/log/auth.log', { user: 'root', groups: ['root'] });
    };
    expect(read(42)).toBe(read(42));
    expect(read(42)).not.toBe(read(43));
  });

  it('the attacker really is the top source of failures, ahead of the decoy', async () => {
    for (const seed of [1, 2, 3, 99, 2024]) {
      const game = new Game(m002, seed);
      const out = text(
        await game.run(
          "grep 'Failed password' /var/log/auth.log | grep -oE '[0-9]{1,3}(\\.[0-9]{1,3}){3}' | sort | uniq -c | sort -rn | head -2",
        ),
      );
      const lines = out.trim().split('\n');
      expect(lines[0]).toContain(ATTACKER_IP);
      expect(lines[1]).not.toContain(ATTACKER_IP);
    }
  });

  it('shows the compromised login from the attacker IP', async () => {
    const game = new Game(m002, 5);
    const out = text(await game.run(`grep Accepted /var/log/auth.log | grep ${ATTACKER_IP}`));
    expect(out).toContain(`Accepted password for ${COMPROMISED_USER}`);
  });

  it('rejects wrong answers and accepts right ones', async () => {
    const game = new Game(m002, 5);
    expect(text(await game.run('submit 1.2.3.4'))).toContain('Incorrect');
    const ok = text(await game.run(`submit ${ATTACKER_IP}`));
    expect(ok).toContain('Answer accepted');
    expect(ok).toContain('Objective complete');
  });

  it('the log is readable via group membership but not by other users', () => {
    const game = new Game(m002, 5);
    const fs = game.world.host('srv01').fs;
    expect(() => fs.readFile('/var/log/auth.log', { user: 'alice', groups: ['alice'] })).toThrow();
    expect(fs.readFile('/var/log/auth.log', { user: 'analyst', groups: ['analyst', 'adm'] })).toContain('sshd');
  });
});

describe('M005 after the fact', () => {
  const m005 = missions.find((m) => m.id === 'M005')!;
  const root = { user: 'root', groups: ['root'] };

  it('is deterministic for a given seed and varies between seeds', () => {
    const read = (seed: number): string => new Game(m005, seed).world.host('finance01').fs.readFile('/var/log/auth.log', root);
    expect(read(42)).toBe(read(42));
    expect(read(42)).not.toBe(read(43));
  });

  it('has exactly one su-based root escalation, and it is the incident account', () => {
    for (const seed of [1, 2, 3, 99, 2024]) {
      const log = new Game(m005, seed).world.host('finance01').fs.readFile('/var/log/auth.log', root);
      const suLines = log.split('\n').filter((l) => l.includes(' su['));
      expect(suLines).toHaveLength(1);
      expect(suLines[0]).toContain(`by ${INCIDENT_USER}(uid=0)`);
    }
  });

  it('buries the incident in genuine sudo noise, not as the only hit', () => {
    const log = new Game(m005, 5).world.host('finance01').fs.readFile('/var/log/auth.log', root);
    const rootSessions = log.split('\n').filter((l) => l.includes('session opened for user root'));
    // 34 routine sudo PAM lines + 1 su PAM line.
    expect(rootSessions.length).toBe(35);
    expect(rootSessions.filter((l) => l.includes(' su[')).length).toBe(1);
  });

  it('rejects wrong answers and accepts the right username and mechanism', async () => {
    const game = new Game(m005, 5);
    expect(text(await game.run('submit sre-priya'))).toContain('Incorrect');
    expect(text(await game.run('submit sudo'))).toContain('Incorrect');
    const whoOk = text(await game.run(`submit ${INCIDENT_USER}`));
    expect(whoOk).toContain('Answer accepted');
    const howOk = text(await game.run(`submit ${INCIDENT_METHOD}`));
    expect(howOk).toContain('Answer accepted');
    expect(game.runtime.isDone('who')).toBe(true);
    expect(game.runtime.isDone('how')).toBe(true);
  });

  it('the log is readable via the adm group but not by an unrelated user', () => {
    const fs = new Game(m005, 5).world.host('finance01').fs;
    expect(() => fs.readFile('/var/log/auth.log', { user: 'nobody', groups: ['nobody'] })).toThrow();
    expect(fs.readFile('/var/log/auth.log', { user: 'analyst', groups: ['analyst', 'adm'] })).toContain('sudo:');
  });
});

describe('M006 lockdown', () => {
  const m006 = missions.find((m) => m.id === 'M006')!;
  const ATTACKER_IP6 = '198.51.100.90';

  it('is deterministic for a given seed and varies between seeds', () => {
    const read = (seed: number): string =>
      new Game(m006, seed).world.host('edge01').fs.readFile('/var/log/auth.log', { user: 'root', groups: ['root'] });
    expect(read(42)).toBe(read(42));
    expect(read(42)).not.toBe(read(43));
  });

  it('the attacker really is the top source of failures, ahead of the decoy', async () => {
    for (const seed of [1, 2, 3, 99, 2024]) {
      const game = new Game(m006, seed);
      const out = text(
        await game.run(
          "grep 'Failed password' /var/log/auth.log | grep -oE '[0-9]{1,3}(\\.[0-9]{1,3}){3}' | sort | uniq -c | sort -rn | head -2",
        ),
      );
      const lines = out.trim().split('\n');
      expect(lines[0]).toContain(ATTACKER_IP6);
      expect(lines[1]).not.toContain(ATTACKER_IP6);
    }
  });

  it('naming the attacker is not enough by itself -- the port stays reachable until ufw runs', async () => {
    const game = new Game(m006, 5);
    expect(game.world.probePort('threat-host', 'edge01', 22)).toBe('open');
    await game.run(`submit ${ATTACKER_IP6}`);
    expect(game.runtime.isDone('attacker')).toBe(true);
    expect(game.runtime.isDone('contain')).toBe(false);
    expect(game.world.probePort('threat-host', 'edge01', 22)).toBe('open');
  });

  it('ufw deny actually closes the port for the attacker without affecting legitimate hosts', async () => {
    const game = new Game(m006, 5);
    await game.run(`ufw deny from ${ATTACKER_IP6} to any port 22`);
    expect(game.world.probePort('threat-host', 'edge01', 22)).toBe('filtered');
    expect(game.runtime.isDone('contain')).toBe(true);
    // A host that was never named in the rule is unaffected.
    expect(game.world.probePort('edge01', 'edge01', 22)).toBe('open');
  });

  it('runs end to end via its own reference solution and completes all three objectives', async () => {
    const game = new Game(m006, 12345);
    for (const line of m006.solution) await game.run(line);
    expect(game.runtime.isDone('read-log')).toBe(true);
    expect(game.runtime.isDone('attacker')).toBe(true);
    expect(game.runtime.isDone('contain')).toBe(true);
  });
});

describe('M007 web logs', () => {
  const m007 = missions.find((m) => m.id === 'M007')!;
  const root = { user: 'root', groups: ['root'] };

  it('is deterministic for a given seed and varies between seeds', () => {
    const read = (seed: number): string =>
      new Game(m007, seed).world.host('www01').fs.readFile('/var/log/nginx/access.log', root);
    expect(read(42)).toBe(read(42));
    expect(read(42)).not.toBe(read(43));
  });

  it('every attack line contains SELECT regardless of which SQLi payload was randomly picked', () => {
    // Regression test for a real bug caught before shipping: the first draft
    // only put "SELECT" in one of three randomly-chosen payload variants, so
    // `grep SELECT` (what the hints and solution both tell the player to run)
    // could come back empty on an unlucky seed. All variants now guarantee it.
    for (const seed of [1, 2, 3, 17, 99, 2024, 777]) {
      const log = new Game(m007, seed).world.host('www01').fs.readFile('/var/log/nginx/access.log', root);
      const attackLines = log.split('\n').filter((l) => l.includes(WEB_ATTACKER_IP));
      expect(attackLines.length).toBe(6);
      for (const l of attackLines) expect(l).toContain('SELECT');
    }
  });

  it('legitimate traffic never contains SELECT or the attacker IP (no false positives for grep)', () => {
    const log = new Game(m007, 5).world.host('www01').fs.readFile('/var/log/nginx/access.log', root);
    const legitLines = log.split('\n').filter((l) => l && !l.includes(WEB_ATTACKER_IP));
    for (const l of legitLines) expect(l).not.toContain('SELECT');
    expect(legitLines.length).toBe(60);
  });

  it('attack requests return 200 (the alarming signal), not a blocked status', () => {
    const log = new Game(m007, 5).world.host('www01').fs.readFile('/var/log/nginx/access.log', root);
    const attackLines = log.split('\n').filter((l) => l.includes(WEB_ATTACKER_IP));
    for (const l of attackLines) expect(l).toMatch(/" 200 /);
  });

  it('naming the attacker and technique is not containment -- port 80 stays open until ufw runs', async () => {
    const game = new Game(m007, 5);
    expect(game.world.probePort('web-threat-host', 'www01', 80)).toBe('open');
    await game.run(`submit ${WEB_ATTACKER_IP}`);
    await game.run(`submit ${WEB_TECHNIQUE}`);
    expect(game.runtime.isDone('attacker')).toBe(true);
    expect(game.runtime.isDone('technique')).toBe(true);
    expect(game.runtime.isDone('contain')).toBe(false);
    expect(game.world.probePort('web-threat-host', 'www01', 80)).toBe('open');
  });

  it('ufw deny closes port 80 for the attacker without affecting the site itself', async () => {
    const game = new Game(m007, 5);
    await game.run(`ufw deny from ${WEB_ATTACKER_IP} to any port 80`);
    expect(game.world.probePort('web-threat-host', 'www01', 80)).toBe('filtered');
    expect(game.runtime.isDone('contain')).toBe(true);
    expect(game.world.probePort('www01', 'www01', 80)).toBe('open');
  });

  it('the log is readable via the adm group but not by an unrelated user', () => {
    const fs = new Game(m007, 5).world.host('www01').fs;
    expect(() => fs.readFile('/var/log/nginx/access.log', { user: 'nobody', groups: ['nobody'] })).toThrow();
    expect(fs.readFile('/var/log/nginx/access.log', { user: 'analyst', groups: ['analyst', 'adm'] })).toContain(
      'HTTP/1.1',
    );
  });
});

describe('M008 three strikes', () => {
  const m008 = missions.find((m) => m.id === 'M008')!;

  it('the correct password on the first try logs in cleanly, no ban ever triggers', async () => {
    const game = new Game(m008, 1);
    await game.run('cat handover-notes.txt');
    await game.run('ssh svc-reports@203.0.113.133');
    const welcome = text(await game.run(M008_PASSWORD));
    expect(welcome).toContain('Welcome to app02');
    expect(game.session.hostId).toBe('app02');
    expect(game.world.probePort('pentest-box', 'app02', 22)).toBe('open');
    expect(text(await game.run('cat flag.txt'))).toBe(`${M008_FLAG}\n`);
    expect(text(await game.run(`submit ${M008_FLAG}`))).toContain('Answer accepted');
    expect(game.runtime.isComplete()).toBe(true);
  });

  it('blind-guessing three wrong passwords in one connection permanently locks the mission', async () => {
    // This is the trap the briefing warns about: fail2ban's threshold (3) and
    // ssh's own per-connection attempt budget (3) are configured to match in
    // this mission, so three wrong guesses in a row bans the source host --
    // and there is no `ufw delete` to undo it. The real password would have
    // worked on attempt 1; guessing blind instead makes the objective
    // permanently unreachable for the rest of this Game.
    const game = new Game(m008, 1);
    await game.run('ssh svc-reports@203.0.113.133');
    await game.run('wrong-guess-1');
    await game.run('wrong-guess-2');
    const locked = text(await game.run('wrong-guess-3'));
    expect(locked).toContain('Permission denied');
    expect(game.world.probePort('pentest-box', 'app02', 22)).toBe('filtered');

    // Even the REAL password can't save it now -- the port itself is gone.
    const tooLate = text(await game.run('ssh svc-reports@203.0.113.133'));
    expect(tooLate).toContain('timed out');
    expect(game.runtime.isDone('login')).toBe(false);
    expect(game.runtime.isComplete()).toBe(false);
  });

  it("fail2ban's cumulative counter survives a cancelled connection, exactly as the hint warns", async () => {
    // Simulates what Ctrl+C does in the browser (TerminalView.tsx deletes
    // session.pendingAuth directly) -- the per-CONNECTION attempt budget
    // resets on a fresh `ssh`, but the per-HOST cumulative failure count
    // World.recordAuthFailure tracks does not, because it isn't stored on
    // the connection at all.
    const game = new Game(m008, 1);
    await game.run('ssh svc-reports@203.0.113.133');
    await game.run('wrong-guess-1'); // 1 cumulative failure
    delete game.session.pendingAuth; // "Ctrl+C" -- bail before the 2nd/3rd attempt
    expect(game.world.probePort('pentest-box', 'app02', 22)).toBe('open');

    await game.run('ssh svc-reports@203.0.113.133'); // a fresh connection
    await game.run('wrong-guess-2'); // 2 cumulative failures -- still open
    expect(game.world.probePort('pentest-box', 'app02', 22)).toBe('open');
    const banned = text(await game.run('wrong-guess-3')); // 3rd cumulative failure
    expect(banned).toContain('password'); // just a reprompt from THIS connection's own counter
    expect(game.world.probePort('pentest-box', 'app02', 22)).toBe('filtered');
  });

  it('a ban on app02 is a real rule in its own firewall array, inspectable directly', async () => {
    // The player never reaches app02 in this scenario (that's the whole
    // point), so there's no session on app02 to run `ufw status` or
    // `fail2ban-client status` FROM -- those read ctx.host, the CURRENT
    // host, which stays pentest-box the whole time. Check the live world
    // state directly instead, the same array World.probePort itself reads.
    const game = new Game(m008, 1);
    await game.run('ssh svc-reports@203.0.113.133');
    await game.run('w1');
    await game.run('w2');
    await game.run('w3');
    const rule = game.world.host('app02').firewall.find((r) => r.fromHostId === 'pentest-box');
    expect(rule).toBeTruthy();
    expect(rule?.action).toBe('deny');
    expect(rule?.port).toBe(22);
  });
});
