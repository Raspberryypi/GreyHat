import type { GameEvent } from '../events';
import type { MissionDef, ObjectiveCheck, ObjectiveDef } from './types';

export const HINT_COST = 5;

const norm = (s: string): string => s.trim().toLowerCase();

export function matchesCheck(check: ObjectiveCheck, e: GameEvent): boolean {
  switch (check.kind) {
    case 'fileRead':
      return (
        e.type === 'file.read' && e.path === check.path && (!check.hostId || e.hostId === check.hostId)
      );
    case 'commandRun': {
      if (e.type !== 'command' || e.name !== check.name) return false;
      if (check.mustSucceed !== false && e.exitCode !== 0) return false;
      if (check.argsPattern && !new RegExp(check.argsPattern).test(e.args.join(' '))) return false;
      return true;
    }
    case 'cwdIs':
      return e.type === 'cwd' && e.path === check.path;
    case 'answer':
      return e.type === 'answer.submitted' && norm(e.value) === norm(check.value);
    case 'authSuccess':
      return (
        e.type === 'auth.attempt' &&
        e.success &&
        e.targetUser === check.targetUser &&
        (!check.targetHostId || e.targetHostId === check.targetHostId)
      );
  }
}

/** Tracks objective progress for one mission attempt. */
export class MissionRuntime {
  private done = new Set<string>();
  hintsUsed = 0;

  constructor(readonly def: MissionDef) {}

  get completedCount(): number {
    return this.done.size;
  }

  isDone(id: string): boolean {
    return this.done.has(id);
  }

  isComplete(): boolean {
    return this.def.objectives.every((o) => this.done.has(o.id));
  }

  earnedXp(): number {
    return Math.max(0, this.def.xp - this.hintsUsed * HINT_COST);
  }

  /** Feed an event; returns objectives that just completed. */
  handle(e: GameEvent): ObjectiveDef[] {
    const newly: ObjectiveDef[] = [];
    for (const o of this.def.objectives) {
      if (this.done.has(o.id)) continue;
      if (matchesCheck(o.check, e)) {
        this.done.add(o.id);
        newly.push(o);
      }
    }
    return newly;
  }

  /** Find the answer objective a submitted value corresponds to (done or not). */
  findAnswerObjective(value: string): ObjectiveDef | undefined {
    return this.def.objectives.find((o) => o.check.kind === 'answer' && norm(o.check.value) === norm(value));
  }
}
