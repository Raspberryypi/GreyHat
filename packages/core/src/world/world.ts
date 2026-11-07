import { VirtualFS, type FsSpec } from '../fs/vfs';
import type { Rng } from '../rng';

export interface UserSpec {
  name: string;
  uid: number;
  home: string;
  /** Supplementary groups (the primary group always equals the user name). */
  groups?: string[];
  shell?: string;
}

export interface HostSpec {
  id: string;
  hostname: string;
  ip: string;
  users: UserSpec[];
  /** Static filesystem, or a generator so logs/data can be seeded from events. */
  fs: FsSpec | ((rng: Rng) => FsSpec);
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
}

export class World {
  readonly hosts = new Map<string, Host>();

  constructor(public now: number) {}

  host(id: string): Host {
    const h = this.hosts.get(id);
    if (!h) throw new Error(`Unknown host: ${id}`);
    return h;
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
    });
  }
  return world;
}
