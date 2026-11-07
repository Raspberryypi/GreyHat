/**
 * Everything that happens in the simulation is an event. Missions, the
 * (future) live adversary and (future) detection scripts all consume these.
 */
export type GameEvent =
  | { type: 'command'; hostId: string; user: string; name: string; args: string[]; exitCode: number }
  | { type: 'file.read'; hostId: string; path: string; user: string }
  | { type: 'cwd'; hostId: string; path: string }
  | { type: 'answer.submitted'; value: string };
