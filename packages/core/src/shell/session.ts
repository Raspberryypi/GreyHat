import type { Identity } from '../fs/vfs';
import type { World } from '../world/world';
import type { Session } from './types';

export function createSession(world: World, hostId: string, user: string, cwd?: string): Session {
  const host = world.host(hostId);
  const spec = host.users.find((u) => u.name === user);
  if (!spec) throw new Error(`Unknown user "${user}" on host "${hostId}"`);
  const start = cwd ?? spec.home;
  return {
    hostId,
    user,
    groups: [user, ...(spec.groups ?? [])],
    cwd: start,
    lastExit: 0,
    env: {
      HOME: spec.home,
      USER: user,
      LOGNAME: user,
      SHELL: '/bin/bash',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOSTNAME: host.hostname,
      PWD: start,
      LANG: 'en_US.UTF-8',
    },
  };
}

export function identityOf(session: Session): Identity {
  return { user: session.user, groups: session.groups };
}
