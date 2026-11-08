import type { Identity } from '../fs/vfs';
import type { CommandFn } from '../shell/types';
import { appendSudoLine } from '../net/authlog';
import { fail, ok, parseArgs } from './util';

/**
 * sudo deliberately does NOT use parseArgs on the full arg list: everything
 * after the target command name belongs to that command, not to sudo, and
 * must be passed through untouched (so `sudo crontab -l` hands crontab its
 * own `-l`, rather than sudo swallowing it as a flag of its own).
 */
export const sudo: CommandFn = (args, ctx) => {
  if (args.length === 0 || args[0] === '-l') {
    const rules = ctx.host.sudoers.filter((r) => r.user === ctx.session.user || r.user === 'ALL');
    if (rules.length === 0) {
      return ok(`User ${ctx.session.user} is not allowed to run sudo on ${ctx.host.hostname}.\n`);
    }
    const lines = rules.map(
      (r) =>
        `    (${r.asUser ?? 'root'}) ${r.noPasswd ? 'NOPASSWD: ' : ''}${
          r.commands === 'ALL' ? 'ALL' : r.commands.join(', ')
        }`,
    );
    return ok(
      `Matching Defaults entries for ${ctx.session.user} on ${ctx.host.hostname}:\n    env_reset\n\n` +
        `User ${ctx.session.user} may run the following commands on ${ctx.host.hostname}:\n${lines.join('\n')}\n`,
    );
  }

  const [cmd, ...rest] = args;
  const rule = ctx.host.sudoers.find(
    (r) => (r.user === ctx.session.user || r.user === 'ALL') && (r.commands === 'ALL' || r.commands.includes(cmd)),
  );
  const asUser = rule?.asUser ?? 'root';
  const allowed = !!rule && !!rule.noPasswd;
  appendSudoLine(ctx.world, ctx.host.id, {
    user: ctx.session.user,
    asUser,
    command: cmd,
    args: rest,
    cwd: ctx.session.cwd,
    allowed,
  });

  if (!rule) {
    return fail(`Sorry, user ${ctx.session.user} may not run sudo on ${ctx.host.hostname}.\n`);
  }
  if (!rule.noPasswd) {
    return fail('sudo: a password is required for this action (not supported in this simulation yet)\n');
  }

  const spec = ctx.host.users.find((u) => u.name === asUser);
  const id: Identity = { user: asUser, groups: [asUser, ...(spec?.groups ?? [])] };
  return ctx.runAs(id, cmd, rest);
};

/**
 * Only `-l` is supported, and it shows the EFFECTIVE user's (ctx.id, not
 * ctx.session.user) own crontab -- real crontab only ever shows the
 * invoking user's own schedule, which is exactly why `sudo crontab -l` is a
 * meaningful escalation: it's not a new feature, it's `crontab -l` running
 * as root instead of as you.
 */
export const crontab: CommandFn = (args, ctx) => {
  const { flags } = parseArgs(args);
  if (!flags.has('l')) return fail('crontab: usage: crontab -l (only -l is supported in this simulation)');
  const lines = ctx.host.crontabs[ctx.id.user] ?? [];
  if (lines.length === 0) return fail(`no crontab for ${ctx.id.user}`);
  return ok(lines.join('\n') + '\n');
};
