import { describe, expect, it } from 'vitest';
import { Game } from '@greyhat/core';
import { missions } from './index';
import { ATTACKER_IP, COMPROMISED_USER } from './missions/m002-brute-force';

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
