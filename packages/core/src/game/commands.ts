import { HINT_COST } from '../missions/runtime';
import { fail, ok } from '../commands/util';
import type { CommandRegistry } from '../shell/types';
import type { Game } from './game';

/** Commands that exist only inside the game layer (not real unix tools). */
export function createGameCommands(game: Game): {
  commands: CommandRegistry;
  help: Record<string, string>;
} {
  const commands: CommandRegistry = {
    mission: () => {
      const s = game.computeSnapshot();
      const lines = [
        `== ${s.title} ==  [${s.role}, difficulty ${s.difficulty}/5]`,
        '',
        ...s.briefing,
        '',
        'Objectives:',
        ...s.objectives.map((o) => `  [${o.done ? 'x' : ' '}] ${o.text}`),
        '',
        `Hints used: ${s.hintsUsed}/${s.hintsTotal}   (each hint costs ${HINT_COST} XP)`,
      ];
      return ok(lines.join('\n') + '\n');
    },

    hint: () => {
      const rt = game.runtime;
      const hints = game.mission.hints;
      if (rt.hintsUsed >= hints.length) return ok('No more hints for this mission.\n');
      const text = hints[rt.hintsUsed];
      rt.hintsUsed++;
      return ok(`[hint ${rt.hintsUsed}/${hints.length}] (-${HINT_COST} XP)\n${text}\n`);
    },

    submit: (args, ctx) => {
      const value = args.join(' ').trim();
      if (!value) return fail('usage: submit <answer>');
      const target = game.runtime.findAnswerObjective(value);
      if (target && game.runtime.isDone(target.id)) return ok('You already submitted that answer.\n');
      const before = game.runtime.completedCount;
      ctx.emit({ type: 'answer.submitted', value });
      if (game.runtime.completedCount > before) return ok('Answer accepted.\n');
      return fail('Incorrect answer. Keep investigating.');
    },
  };

  const help: Record<string, string> = {
    mission: 'show the briefing and objectives',
    hint: `reveal the next hint (-${HINT_COST} XP)`,
    submit: 'submit an answer: submit <answer>',
  };
  return { commands, help };
}
