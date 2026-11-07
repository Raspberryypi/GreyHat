import type { Rng } from '@greyhat/core';

export interface LegitUser {
  user: string;
  ip: string;
  uid: number;
}

export interface AuthLogOptions {
  hostname: string;
  /** Log window, epoch ms. */
  start: number;
  end: number;
  legit: LegitUser[];
  legitSessions: number;
  attack: {
    ip: string;
    /** When the password spray begins (epoch ms). */
    startAt: number;
    attempts: number;
    /** Account the attacker eventually breaks into. */
    compromisedUser: string;
    compromisedUid: number;
  };
  /** A noisy-but-harmless scanner, to make "just count the failures" a trap. */
  decoy: { ip: string; attempts: number };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function stamp(ms: number): string {
  const d = new Date(ms);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}

/**
 * Generates an OpenSSH-style /var/log/auth.log from simulated events.
 * Output is deterministic for a given RNG state.
 */
export function generateAuthLog(rng: Rng, o: AuthLogOptions): string {
  const events: { t: number; text: string }[] = [];
  const line = (t: number, pid: number, msg: string): void => {
    events.push({ t, text: `${stamp(t)} ${o.hostname} sshd[${pid}]: ${msg}` });
  };
  const pid = (): number => rng.int(1200, 31000);
  const port = (): number => rng.int(32768, 60999);
  const span = o.end - o.start;

  // Legitimate sessions (some with a typo first).
  for (let i = 0; i < o.legitSessions; i++) {
    const u = rng.pick(o.legit);
    let t = o.start + Math.floor(rng.next() * span);
    const p = pid();
    if (rng.chance(0.2)) {
      line(t, p, `Failed password for ${u.user} from ${u.ip} port ${port()} ssh2`);
      t += rng.int(3000, 9000);
    }
    const method = rng.chance(0.7) ? 'publickey' : 'password';
    line(t, p, `Accepted ${method} for ${u.user} from ${u.ip} port ${port()} ssh2`);
    line(t, p, `pam_unix(sshd:session): session opened for user ${u.user}(uid=${u.uid}) by (uid=0)`);
    const closeAt = Math.min(t + rng.int(60_000, 3_600_000), o.end);
    line(closeAt, p, `pam_unix(sshd:session): session closed for user ${u.user}`);
  }

  // Decoy scanner: a few failed root/admin guesses spread over the window.
  for (let i = 0; i < o.decoy.attempts; i++) {
    const t = o.start + Math.floor(rng.next() * span);
    const name = rng.pick(['root', 'admin']);
    const invalid = name === 'admin' ? 'invalid user ' : '';
    line(t, pid(), `Failed password for ${invalid}${name} from ${o.decoy.ip} port ${port()} ssh2`);
  }

  // Password spray against several accounts, then a successful login.
  const names = ['root', 'root', 'admin', 'test', 'oracle', 'ubuntu', 'postgres', 'git', 'user', o.attack.compromisedUser, o.attack.compromisedUser, o.attack.compromisedUser];
  const sprayMs = 12 * 60_000;
  for (let i = 0; i < o.attack.attempts; i++) {
    const t = o.attack.startAt + Math.floor((i / o.attack.attempts) * sprayMs) + rng.int(0, 2000);
    const name = rng.pick(names);
    const exists = name === 'root' || name === o.attack.compromisedUser;
    line(t, pid(), `Failed password for ${exists ? '' : 'invalid user '}${name} from ${o.attack.ip} port ${port()} ssh2`);
  }
  const winAt = o.attack.startAt + sprayMs + 8000;
  const p = pid();
  line(winAt, p, `Accepted password for ${o.attack.compromisedUser} from ${o.attack.ip} port ${port()} ssh2`);
  line(
    winAt,
    p,
    `pam_unix(sshd:session): session opened for user ${o.attack.compromisedUser}(uid=${o.attack.compromisedUid}) by (uid=0)`,
  );

  events.sort((a, b) => a.t - b.t);
  return events.map((e) => e.text).join('\n') + '\n';
}
