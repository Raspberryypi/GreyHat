import type { World } from '../world/world';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function stamp(ms: number): string {
  const d = new Date(ms);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}

/**
 * Append one OpenSSH-style line to a target host's /var/log/auth.log, the
 * way a real sshd would on every auth attempt. Silently does nothing if the
 * host has no such file (not every mission wires one up) -- this should
 * never crash a live `ssh` attempt.
 */
export function appendSshAuthLine(
  world: World,
  targetHostId: string,
  opts: { sourceIp: string; user: string; success: boolean; pid?: number },
): void {
  let target;
  try {
    target = world.host(targetHostId);
  } catch {
    return;
  }
  const pid = opts.pid ?? 10000 + Math.floor(world.now % 20000);
  const port = 40000 + Math.floor(world.now % 20000);
  const msg = opts.success
    ? `Accepted password for ${opts.user} from ${opts.sourceIp} port ${port} ssh2`
    : `Failed password for ${opts.user} from ${opts.sourceIp} port ${port} ssh2`;
  const line = `${stamp(world.now)} ${target.hostname} sshd[${pid}]: ${msg}\n`;
  try {
    target.fs.writeFile(
      '/var/log/auth.log',
      line,
      { user: 'root', groups: ['root'] },
      { append: true, mtime: world.now },
    );
  } catch {
    /* host has no /var/log/auth.log wired up -- fine, this is best-effort realism */
  }
}

/**
 * Append one `su`-style line to a target host's /var/log/auth.log on every
 * local user-switch attempt. Best-effort, like appendSshAuthLine.
 */
export function appendSuAuthLine(
  world: World,
  hostId: string,
  opts: { fromUser: string; toUser: string; success: boolean; pid?: number },
): void {
  let host;
  try {
    host = world.host(hostId);
  } catch {
    return;
  }
  const pid = opts.pid ?? 10000 + Math.floor(world.now % 20000);
  const msg = opts.success
    ? `pam_unix(su:session): session opened for user ${opts.toUser} by ${opts.fromUser}(uid=0)`
    : `pam_unix(su:auth): authentication failure; logname= uid=0 euid=0 tty=pts/0 ruser=${opts.fromUser} rhost=  user=${opts.toUser}`;
  const line = `${stamp(world.now)} ${host.hostname} su[${pid}]: ${msg}\n`;
  try {
    host.fs.writeFile(
      '/var/log/auth.log',
      line,
      { user: 'root', groups: ['root'] },
      { append: true, mtime: world.now },
    );
  } catch {
    /* best-effort, see appendSshAuthLine */
  }
}

/**
 * Append one `sudo`-style line to a target host's /var/log/auth.log on every
 * `sudo <command>` invocation, whether allowed or refused -- real sudo logs
 * both, which is exactly what makes sudo misuse detectable after the fact.
 */
export function appendSudoLine(
  world: World,
  hostId: string,
  opts: { user: string; asUser: string; command: string; args: string[]; cwd: string; allowed: boolean },
): void {
  let host;
  try {
    host = world.host(hostId);
  } catch {
    return;
  }
  const argv = [opts.command, ...opts.args].join(' ');
  const msg = opts.allowed
    ? `${opts.user} : TTY=pts/0 ; PWD=${opts.cwd} ; USER=${opts.asUser} ; COMMAND=${argv}`
    : `${opts.user} : command not allowed ; TTY=pts/0 ; PWD=${opts.cwd} ; USER=${opts.asUser} ; COMMAND=${argv}`;
  const line = `${stamp(world.now)} ${host.hostname} sudo: ${msg}\n`;
  try {
    host.fs.writeFile(
      '/var/log/auth.log',
      line,
      { user: 'root', groups: ['root'] },
      { append: true, mtime: world.now },
    );
  } catch {
    /* best-effort, see appendSshAuthLine */
  }
}
