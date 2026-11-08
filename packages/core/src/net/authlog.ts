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
