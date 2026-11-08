import { VirtualFS, type FsSpec } from '../fs/vfs';
import type { Rng } from '../rng';

export interface UserSpec {
  name: string;
  uid: number;
  home: string;
  /** Supplementary groups (the primary group always equals the user name). */
  groups?: string[];
  shell?: string;
  /** Plaintext password for simulated auth (ssh, su). Omit for no-password/unusable accounts. */
  password?: string;
}

export interface ServiceSpec {
  port: number;
  proto?: 'tcp' | 'udp';
  /** Short service name, e.g. "ssh", "http", "ftp". */
  name: string;
  version?: string;
  /** Banner text a client would see from nc/curl against this port. */
  banner?: string;
}

export interface FirewallRule {
  port: number;
  proto?: 'tcp' | 'udp';
  action: 'allow' | 'deny';
  /** Restrict this rule to traffic from one host. Omit to match all sources. */
  fromHostId?: string;
}

/**
 * One line of a host's /etc/sudoers (simplified). This simulation only
 * executes NOPASSWD rules -- a rule with noPasswd unset/false is still
 * listed by `sudo -l` (for realism) but `sudo <cmd>` refuses it with a
 * "password required" message, since there is no separate password-prompt
 * flow for sudo yet (see HANDOFF.txt section 7.2).
 */
export interface SudoRule {
  /** Username this rule applies to, or 'ALL'. */
  user: string;
  /** Command names this rule allows (matched against argv[0] after `sudo`), or 'ALL'. */
  commands: string[] | 'ALL';
  noPasswd?: boolean;
  /** Defaults to 'root'. */
  asUser?: string;
}

/** One row of `ps`. Static -- not a real scheduler, just a recon artifact. */
export interface ProcessSpec {
  pid: number;
  user: string;
  cmd: string;
}

export interface HostSpec {
  id: string;
  hostname: string;
  ip: string;
  users: UserSpec[];
  /** Static filesystem, or a generator so logs/data can be seeded from events. */
  fs: FsSpec | ((rng: Rng) => FsSpec);
  services?: ServiceSpec[];
  firewall?: FirewallRule[];
  /**
   * Host ids this host can reach on the network. Omit for "reaches every
   * host in the world" (default full mesh) -- set it to model subnets.
   */
  reachable?: string[];
  sudoers?: SudoRule[];
  processes?: ProcessSpec[];
  /** Per-user crontab lines, as `crontab -l` would show them to that exact user. */
  crontabs?: Record<string, string[]>;
}

export interface WorldSpec {
  /** Simulated epoch ms at the start of the scenario. */
  startTime: number;
  hosts: HostSpec[];
}

export interface Host {
  id: string;
  hostname: string;
  ip: string;
  users: UserSpec[];
  fs: VirtualFS;
  services: ServiceSpec[];
  firewall: FirewallRule[];
  /** null = full mesh (reaches every host). */
  reachable: Set<string> | null;
  sudoers: SudoRule[];
  processes: ProcessSpec[];
  crontabs: Record<string, string[]>;
}

export type PortState = 'open' | 'closed' | 'filtered';

export class World {
  readonly hosts = new Map<string, Host>();
  private readonly ipIndex = new Map<string, string>();

  constructor(public now: number) {}

  host(id: string): Host {
    const h = this.hosts.get(id);
    if (!h) throw new Error(`Unknown host: ${id}`);
    return h;
  }

  /** Register (or re-register) a host's IP in the lookup index. */
  indexIp(ip: string, hostId: string): void {
    this.ipIndex.set(ip, hostId);
  }

  /** Find a host by exact IP match. */
  hostByIp(ip: string): Host | undefined {
    const id = this.ipIndex.get(ip);
    return id ? this.hosts.get(id) : undefined;
  }

  /** Find a host by IP first, then by hostname. */
  findHost(nameOrIp: string): Host | undefined {
    return this.hostByIp(nameOrIp) ?? [...this.hosts.values()].find((h) => h.hostname === nameOrIp);
  }

  /** Can traffic from `fromId` reach `toId` at the network layer at all? */
  canReach(fromId: string, toId: string): boolean {
    if (fromId === toId) return true;
    const from = this.host(fromId);
    if (from.reachable === null) return true;
    return from.reachable.has(toId);
  }

  /** Is a given port on `toId` open/closed/filtered, as seen from `fromId`? */
  probePort(fromId: string, toId: string, port: number, proto: 'tcp' | 'udp' = 'tcp'): PortState {
    if (!this.canReach(fromId, toId)) return 'filtered';
    const target = this.host(toId);
    let allowed = true;
    for (const r of target.firewall) {
      if (r.port !== port) continue;
      if ((r.proto ?? 'tcp') !== proto) continue;
      if (r.fromHostId && r.fromHostId !== fromId) continue;
      allowed = r.action === 'allow';
    }
    if (!allowed) return 'filtered';
    const svc = target.services.find((s) => s.port === port && (s.proto ?? 'tcp') === proto);
    return svc ? 'open' : 'closed';
  }

  advance(ms: number): void {
    this.now += ms;
  }
}

export function buildWorld(spec: WorldSpec, rng: Rng): World {
  const world = new World(spec.startTime);
  for (const h of spec.hosts) {
    const fsSpec = typeof h.fs === 'function' ? h.fs(rng.fork(`host:${h.id}`)) : h.fs;
    const passwd =
      h.users
        .map((u) => `${u.name}:x:${u.uid}:${u.uid}:${u.name}:${u.home}:${u.shell ?? '/bin/bash'}`)
        .join('\n') + '\n';
    const merged: FsSpec = {
      '/etc/passwd': passwd,
      '/etc/hostname': `${h.hostname}\n`,
      ...fsSpec,
    };
    world.hosts.set(h.id, {
      id: h.id,
      hostname: h.hostname,
      ip: h.ip,
      users: h.users,
      fs: VirtualFS.fromSpec(merged, spec.startTime),
      services: h.services ?? [],
      firewall: h.firewall ?? [],
      reachable: h.reachable ? new Set(h.reachable) : null,
      sudoers: h.sudoers ?? [],
      processes: h.processes ?? [],
      crontabs: h.crontabs ?? {},
    });
    world.indexIp(h.ip, h.id);
  }
  return world;
}
