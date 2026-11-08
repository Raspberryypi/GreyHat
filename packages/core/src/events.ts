/**
 * Everything that happens in the simulation is an event. Missions, the
 * (future) live adversary and (future) detection scripts all consume these.
 */
export type GameEvent =
  | { type: 'command'; hostId: string; user: string; name: string; args: string[]; exitCode: number }
  | { type: 'file.read'; hostId: string; path: string; user: string }
  | { type: 'cwd'; hostId: string; path: string }
  | { type: 'answer.submitted'; value: string }
  /** A scan/probe of a target IP was attempted from hostId (ping, nmap). */
  | { type: 'net.scan'; hostId: string; targetIp: string; user: string }
  /** A connection attempt to targetIp:port was attempted from hostId (ssh, nc, curl). */
  | { type: 'net.connect'; hostId: string; targetIp: string; port: number; user: string; success: boolean }
  /** An authentication attempt against a service on targetHostId. */
  | {
      type: 'auth.attempt';
      hostId: string;
      targetHostId: string;
      targetUser: string;
      user: string;
      success: boolean;
    };
