import type { Rng } from '@greyhat/core';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function stamp(ms: number): string {
  const d = new Date(ms);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}

export interface PrivilegeLogOptions {
  hostname: string;
  /** Log window, epoch ms. */
  start: number;
  end: number;
  legit: { user: string; ip: string; uid: number }[];
  legitSessions: number;
  /** Ordinary, authorized sudo usage by real admin accounts -- pure noise. */
  routineSudo: { users: string[]; commands: string[]; count: number };
  /** The one illegitimate privilege escalation the player has to find. */
  incident: { user: string; at: number; method: 'su' | 'sudo'; command?: string };
}

/**
 * Generates a /var/log/auth.log mixing normal SSH sessions and normal sudo
 * use with exactly one illegitimate `su`/`sudo` escalation to root. Mirrors
 * the line formats core's appendSuAuthLine/appendSudoLine actually write at
 * runtime (duplicated here on purpose -- core cannot depend on content, the
 * same reason generateAuthLog's sshd format is duplicated in
 * core/src/net/authlog.ts rather than imported).
 */
export function generatePrivilegeLog(rng: Rng, o: PrivilegeLogOptions): string {
  const events: { t: number; text: string }[] = [];
  const pid = (): number => rng.int(1200, 31000);
  const port = (): number => rng.int(32768, 60999);
  const span = o.end - o.start;

  const sshLine = (t: number, p: number, msg: string): void => {
    events.push({ t, text: `${stamp(t)} ${o.hostname} sshd[${p}]: ${msg}` });
  };
  const sudoLine = (t: number, user: string, command: string): void => {
    events.push({
      t,
      text: `${stamp(t)} ${o.hostname} sudo: ${user} : TTY=pts/0 ; PWD=/home/${user} ; USER=root ; COMMAND=${command}`,
    });
    // Real sudo, like su, also opens a PAM session when it actually execs the
    // target command -- this is the line that makes "session opened for user
    // root" noisy to grep through instead of landing only on the one incident.
    events.push({
      t: t + 1,
      text: `${stamp(t + 1)} ${o.hostname} sudo: pam_unix(sudo:session): session opened for user root by ${user}(uid=0)`,
    });
  };
  const suLine = (t: number, p: number, fromUser: string): void => {
    events.push({
      t,
      text: `${stamp(t)} ${o.hostname} su[${p}]: pam_unix(su:session): session opened for user root by ${fromUser}(uid=0)`,
    });
  };

  for (let i = 0; i < o.legitSessions; i++) {
    const u = rng.pick(o.legit);
    const t = o.start + Math.floor(rng.next() * span);
    const p = pid();
    sshLine(t, p, `Accepted password for ${u.user} from ${u.ip} port ${port()} ssh2`);
    sshLine(t, p, `pam_unix(sshd:session): session opened for user ${u.user}(uid=${u.uid}) by (uid=0)`);
  }

  for (let i = 0; i < o.routineSudo.count; i++) {
    const t = o.start + Math.floor(rng.next() * span);
    sudoLine(t, rng.pick(o.routineSudo.users), rng.pick(o.routineSudo.commands));
  }

  if (o.incident.method === 'su') {
    suLine(o.incident.at, pid(), o.incident.user);
  } else {
    sudoLine(o.incident.at, o.incident.user, o.incident.command ?? 'ALL');
  }

  events.sort((a, b) => a.t - b.t);
  return events.map((e) => e.text).join('\n') + '\n';
}
