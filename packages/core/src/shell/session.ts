import type { Identity } from '../fs/vfs';
import type { World } from '../world/world';
import type { Session, SessionFrame } from './types';

function buildEnv(world: World, hostId: string, user: string, home: string): Record<string, string> {
  const host = world.host(hostId);
  return {
    HOME: home,
    USER: user,
    LOGNAME: user,
    SHELL: '/bin/bash',
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOSTNAME: host.hostname,
    PWD: home,
    LANG: 'en_US.UTF-8',
  };
}

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
    stack: [],
    env: { ...buildEnv(world, hostId, user, spec.home), PWD: start },
  };
}

export function identityOf(session: Session): Identity {
  return { user: session.user, groups: session.groups };
}

/**
 * Switch an existing session in place to a different host/user, the way a
 * successful `ssh` login does. Does not touch `stack` -- callers push/pop it.
 */
export function enterSession(session: Session, world: World, hostId: string, user: string): void {
  const host = world.host(hostId);
  const spec = host.users.find((u) => u.name === user);
  const home = spec?.home ?? '/';
  session.hostId = hostId;
  session.user = user;
  session.groups = [user, ...(spec?.groups ?? [])];
  session.cwd = home;
  session.env = buildEnv(world, hostId, user, home);
}

/** Restore a session in place from a previously-saved frame (an `exit`). */
export function restoreSession(session: Session, frame: SessionFrame): void {
  session.hostId = frame.hostId;
  session.user = frame.user;
  session.groups = [...frame.groups];
  session.cwd = frame.cwd;
  session.env = { ...frame.env };
}
