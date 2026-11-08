import type { WorldSpec } from '../world/world';

export type ObjectiveCheck =
  /** Player read this file (via cat, grep, head ...). */
  | { kind: 'fileRead'; path: string; hostId?: string }
  /** Player ran a command. `argsPattern` is a regex tested against the joined args. */
  | { kind: 'commandRun'; name: string; argsPattern?: string; mustSucceed?: boolean }
  /** Player cd'd into this directory. */
  | { kind: 'cwdIs'; path: string }
  /** Player submitted this answer with `submit <answer>`. */
  | { kind: 'answer'; value: string }
  /** Player successfully authenticated (e.g. via ssh) as this user on a target host. */
  | { kind: 'authSuccess'; targetUser: string; targetHostId?: string };

export interface ObjectiveDef {
  id: string;
  text: string;
  check: ObjectiveCheck;
}

export type MissionRole = 'fundamentals' | 'offense' | 'defense';

export interface MissionDef {
  id: string;
  title: string;
  track: string;
  role: MissionRole;
  difficulty: 1 | 2 | 3 | 4 | 5;
  briefing: string[];
  objectives: ObjectiveDef[];
  /** Revealed one at a time by `hint`; each costs XP. */
  hints: string[];
  /** Shown on completion: the "why" and the defensive takeaway. */
  debrief: string[];
  xp: number;
  world: WorldSpec;
  start: { hostId: string; user: string; cwd?: string };
  /**
   * Reference solution (shell lines). CI replays it against the engine so a
   * mission can never silently become unsolvable.
   */
  solution: string[];
}
