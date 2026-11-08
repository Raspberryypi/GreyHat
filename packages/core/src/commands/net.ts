import type { FirewallRule, World } from '../world/world';
import type { CommandFn } from '../shell/types';
import { appendSshAuthLine, appendSuAuthLine } from '../net/authlog';
import { fail, ok, parseArgs } from './util';

function resolveTarget(world: World, nameOrIp: string) {
  return world.findHost(nameOrIp);
}

/** Parse an nmap-style port list: "22,80,1000-1010". */
function parsePorts(spec: string): number[] {
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const lo = Number(m[1]);
    const hi = m[2] ? Number(m[2]) : lo;
    for (let p = lo; p <= hi && out.size < 1024; p++) out.add(p);
  }
  return [...out].sort((a, b) => a - b);
}

export const ping: CommandFn = (args, ctx) => {
  const { values, positional } = parseArgs(args, ['c']);
  const target = positional[0];
  if (!target) return fail('usage: ping [-c count] <host>');
  const count = values.c ? Math.max(1, Math.min(20, parseInt(values.c, 10) || 4)) : 4;

  const targetHost = resolveTarget(ctx.world, target);
  ctx.emit({ type: 'net.scan', hostId: ctx.host.id, targetIp: targetHost?.ip ?? target, user: ctx.session.user });

  if (!targetHost) {
    return fail(`ping: ${target}: Name or service not known`, 2);
  }
  const reachable = ctx.world.canReach(ctx.host.id, targetHost.id);
  const lines = [`PING ${target} (${targetHost.ip}) 56(84) bytes of data.`];
  let received = 0;
  for (let seq = 1; seq <= count; seq++) {
    if (reachable) {
      received++;
      const ms = (8 + ((seq * 7919) % 40) / 10).toFixed(1);
      lines.push(`64 bytes from ${targetHost.ip}: icmp_seq=${seq} ttl=63 time=${ms} ms`);
    } else {
      lines.push(`Request timeout for icmp_seq ${seq}`);
    }
  }
  const loss = Math.round(((count - received) / count) * 100);
  lines.push('');
  lines.push(`--- ${target} ping statistics ---`);
  lines.push(`${count} packets transmitted, ${received} received, ${loss}% packet loss, time ${count * 10}ms`);
  return ok(lines.join('\n') + '\n');
};

export const nmap: CommandFn = (args, ctx) => {
  // This shell's getopt clusters single-dash short flags character-by-character,
  // so multi-letter nmap flags (-sV, -sn, -sS) have to be peeled off first.
  const rest: string[] = [];
  let sn = false;
  let sV = false;
  for (const a of args) {
    if (a === '-sn' || a === '--sn') sn = true;
    else if (a === '-sV' || a === '--sV' || a === '-V') sV = true;
    else rest.push(a);
  }
  const { values, positional } = parseArgs(rest, ['p']);
  const target = positional[0];
  if (!target) return fail('usage: nmap [-p ports] [-sV] [-sn] <host>');

  const targetHost = resolveTarget(ctx.world, target);
  ctx.emit({ type: 'net.scan', hostId: ctx.host.id, targetIp: targetHost?.ip ?? target, user: ctx.session.user });

  if (!targetHost) return fail(`nmap: Failed to resolve "${target}".`);

  const header = `Starting Nmap scan report for ${target} (${targetHost.ip})`;
  if (!ctx.world.canReach(ctx.host.id, targetHost.id)) {
    return ok(`${header}\nNote: Host seems down. If it is really up, but blocking ping probes, try -Pn\n`);
  }
  if (sn) {
    return ok(`${header}\nHost is up.\n`);
  }

  const ports = values.p ? parsePorts(values.p) : targetHost.services.map((s) => s.port).sort((a, b) => a - b);
  const showVersion = sV;
  const rows = ports.map((p) => {
    const state = ctx.world.probePort(ctx.host.id, targetHost.id, p);
    const svc = targetHost.services.find((s) => s.port === p && (s.proto ?? 'tcp') === 'tcp');
    const name = svc?.name ?? 'unknown';
    const version = showVersion && svc?.version ? `  ${svc.version}` : '';
    const portCol = `${p}/tcp`.padEnd(9);
    return `${portCol}${state.padEnd(9)}${name.padEnd(10)}${version}`;
  });

  const colHeader = `PORT     STATE    SERVICE${showVersion ? '    VERSION' : ''}`;
  return ok(
    `${header}\nHost is up.\n${ports.length > 0 ? `${colHeader}\n${rows.join('\n')}\n` : 'No ports scanned.\n'}\nNmap done: 1 IP address (1 host up) scanned\n`,
  );
};

export const ssh: CommandFn = (args, ctx) => {
  const { values, positional } = parseArgs(args, ['l', 'p']);
  let target = positional[0];
  if (!target) return fail('usage: ssh [-l user] [-p port] [user@]<host>');
  let user = values.l;
  if (target.includes('@')) {
    const [u, h] = target.split('@');
    user = u;
    target = h;
  }
  if (!user) user = ctx.session.user;
  const port = values.p ? parseInt(values.p, 10) : 22;

  const targetHost = resolveTarget(ctx.world, target);
  if (!targetHost) {
    return fail(`ssh: Could not resolve hostname ${target}: Name or service not known`);
  }
  if (targetHost.id === ctx.host.id) {
    return fail(`ssh: connect to host ${target} port ${port}: Connection refused`);
  }

  ctx.emit({
    type: 'net.connect',
    hostId: ctx.host.id,
    targetIp: targetHost.ip,
    port,
    user: ctx.session.user,
    success: ctx.world.canReach(ctx.host.id, targetHost.id),
  });

  if (!ctx.world.canReach(ctx.host.id, targetHost.id)) {
    return fail(`ssh: connect to host ${target} port ${port}: No route to host`);
  }
  const state = ctx.world.probePort(ctx.host.id, targetHost.id, port);
  if (state !== 'open') {
    return fail(
      `ssh: connect to host ${target} port ${port}: Connection ${state === 'filtered' ? 'timed out' : 'refused'}`,
    );
  }

  ctx.session.pendingAuth = {
    targetHostId: targetHost.id,
    targetUser: user,
    attemptsLeft: 3,
    method: 'ssh',
    fromFrame: {
      hostId: ctx.session.hostId,
      user: ctx.session.user,
      groups: [...ctx.session.groups],
      cwd: ctx.session.cwd,
      env: { ...ctx.session.env },
    },
  };
  return ok(`${user}@${target}'s password: `);
};

export const su: CommandFn = (args, ctx) => {
  const target = args[0] ?? 'root';
  if (target === ctx.session.user) {
    return fail(`su: warning: cannot change directory to current user\n`, 0);
  }
  if (!ctx.host.users.some((u) => u.name === target)) {
    return fail(`su: user ${target} does not exist`);
  }
  ctx.session.pendingAuth = {
    targetHostId: ctx.host.id,
    targetUser: target,
    attemptsLeft: 3,
    method: 'su',
    fromFrame: {
      hostId: ctx.session.hostId,
      user: ctx.session.user,
      groups: [...ctx.session.groups],
      cwd: ctx.session.cwd,
      env: { ...ctx.session.env },
    },
  };
  return ok('Password: ');
};

export const ss: CommandFn = (_args, ctx) => {
  const rows = ctx.host.services.map(
    (s) =>
      `${(s.proto ?? 'tcp').toUpperCase().padEnd(6)}LISTEN     0      128    0.0.0.0:${s.port}        0.0.0.0:*     ${s.name}`,
  );
  return ok(
    `Netid  State      Recv-Q Send-Q Local Address:Port    Peer Address:Port Process\n${rows.join('\n')}${
      rows.length ? '\n' : ''
    }`,
  );
};

export const netstat: CommandFn = (_args, ctx) => {
  const rows = ctx.host.services.map(
    (s) =>
      `${(s.proto ?? 'tcp')}        0      0 0.0.0.0:${s.port}            0.0.0.0:*               LISTEN      ${s.name}`,
  );
  return ok(
    `Active Internet connections (only servers)\nProto Recv-Q Send-Q Local Address           Foreign Address         State       Program\n${rows.join('\n')}${
      rows.length ? '\n' : ''
    }`,
  );
};

/**
 * ufw-lite: shows and edits the current host's firewall rules at runtime.
 * Rules pushed here mutate the SAME Host.firewall array World.probePort
 * reads, so a rule added here immediately changes what ping/nmap/ssh see
 * on subsequent calls -- this is what makes containment a real, checkable
 * action rather than a one-line flavor command.
 *
 *   ufw status                               list current rules
 *   ufw deny from <ip> to any port <port>    block one source on one port
 *   ufw allow <port>[/proto]                 open a port for everyone
 *   ufw deny <port>[/proto]                  close a port for everyone
 */
export const ufw: CommandFn = (args, ctx) => {
  if (args.length === 0 || args[0] === 'status') {
    if (ctx.host.firewall.length === 0) {
      return ok('Status: active\n\nNo rules defined.\n');
    }
    const rows = ctx.host.firewall.map((r) => {
      const to = `${r.port}/${r.proto ?? 'tcp'}`.padEnd(27);
      const action = (r.action === 'allow' ? 'ALLOW' : 'DENY').padEnd(12);
      const from = r.fromHostId ? (ctx.world.hosts.get(r.fromHostId)?.ip ?? r.fromHostId) : 'Anywhere';
      return `${to}${action}${from}`;
    });
    return ok(
      `Status: active\n\nTo                         Action      From\n` +
        `--                         ------      ----\n${rows.join('\n')}\n`,
    );
  }

  const action = args[0];
  if (action !== 'deny' && action !== 'allow') {
    return fail(`ufw: unknown command: '${action}' (try: status, allow, deny)`);
  }

  let rule: FirewallRule;
  if (args[1] === 'from') {
    // ufw deny from <ip> to any port <port>
    const ip = args[2];
    const portIdx = args.indexOf('port');
    const portArg = portIdx !== -1 ? args[portIdx + 1] : undefined;
    if (!ip || !portArg) {
      return fail(`ufw: usage: ufw ${action} from <ip> to any port <port>`);
    }
    const port = parseInt(portArg, 10);
    if (Number.isNaN(port)) return fail(`ufw: invalid port: '${portArg}'`);
    const srcHost = ctx.world.findHost(ip);
    if (!srcHost) return fail(`ufw: could not resolve address: '${ip}'`);
    rule = { port, proto: 'tcp', action, fromHostId: srcHost.id };
  } else {
    // ufw deny <port>[/proto]   /   ufw allow <port>[/proto]
    const spec = args[1];
    if (!spec) return fail(`ufw: usage: ufw ${action} <port>[/proto]`);
    const [portStr, protoStr] = spec.split('/');
    const port = parseInt(portStr, 10);
    if (Number.isNaN(port)) return fail(`ufw: invalid port: '${spec}'`);
    if (protoStr && protoStr !== 'tcp' && protoStr !== 'udp') {
      return fail(`ufw: invalid protocol: '${protoStr}'`);
    }
    rule = { port, proto: (protoStr as 'tcp' | 'udp' | undefined) ?? 'tcp', action };
  }

  ctx.host.firewall.push(rule);
  ctx.emit({ type: 'firewall.rule', hostId: ctx.host.id, rule, op: 'add' });
  const scope = rule.fromHostId ? ` from ${args[2]}` : '';
  return ok(`Rule added: ${rule.action} ${rule.port}/${rule.proto}${scope}\n`);
};

/** Shared by Shell.exec: called once the player types a line while `pendingAuth` is set. */
export function attemptAuth(
  world: World,
  sourceIp: string,
  pending: { targetHostId: string; targetUser: string; method: 'ssh' | 'su' },
  candidate: string,
  fromUser: string,
): boolean {
  const target = world.host(pending.targetHostId);
  const spec = target.users.find((u) => u.name === pending.targetUser);
  const success = !!spec && spec.password !== undefined && spec.password === candidate;
  if (pending.method === 'su') {
    appendSuAuthLine(world, pending.targetHostId, { fromUser, toUser: pending.targetUser, success });
  } else {
    appendSshAuthLine(world, pending.targetHostId, { sourceIp, user: pending.targetUser, success });
  }
  return success;
}
