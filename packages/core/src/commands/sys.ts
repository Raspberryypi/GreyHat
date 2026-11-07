import type { CommandFn } from '../shell/types';
import { ok, parseArgs } from './util';

export const whoami: CommandFn = (_a, ctx) => ok(`${ctx.session.user}\n`);

export const idCmd: CommandFn = (_a, ctx) => {
  const spec = ctx.host.users.find((u) => u.name === ctx.session.user);
  const uid = spec?.uid ?? 1000;
  const groups = ctx.session.groups.map((g, i) => `${i === 0 ? uid : 100 + i}(${g})`);
  return ok(`uid=${uid}(${ctx.session.user}) gid=${uid}(${ctx.session.user}) groups=${groups.join(',')}\n`);
};

export const hostname: CommandFn = (_a, ctx) => ok(`${ctx.host.hostname}\n`);

export const uname: CommandFn = (args, ctx) => {
  const { flags } = parseArgs(args);
  const kernel = '5.15.0-91-generic';
  if (flags.has('a')) {
    return ok(`Linux ${ctx.host.hostname} ${kernel} #101-Ubuntu SMP x86_64 GNU/Linux\n`);
  }
  if (flags.has('r')) return ok(`${kernel}\n`);
  if (flags.has('n')) return ok(`${ctx.host.hostname}\n`);
  return ok('Linux\n');
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const date: CommandFn = (_a, ctx) => {
  const d = new Date(ctx.world.now);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return ok(
    `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ` +
      `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} UTC ${d.getUTCFullYear()}\n`,
  );
};

export const clear: CommandFn = () => ({ stdout: '', stderr: '', exitCode: 0, clear: true });

export const trueCmd: CommandFn = () => ok();
export const falseCmd: CommandFn = () => ({ stdout: '', stderr: '', exitCode: 1 });

export const env: CommandFn = (_a, ctx) =>
  ok(
    Object.entries(ctx.session.env)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n',
  );

export const exportCmd: CommandFn = (args, ctx) => {
  if (args.length === 0) {
    return ok(
      Object.entries(ctx.session.env)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `declare -x ${k}="${v}"`)
        .join('\n') + '\n',
    );
  }
  for (const a of args) {
    const eq = a.indexOf('=');
    if (eq > 0) ctx.session.env[a.slice(0, eq)] = a.slice(eq + 1);
  }
  return ok();
};

export const help: CommandFn = (_a, ctx) => {
  const names = Object.keys(ctx.help).sort();
  const w = Math.max(...names.map((n) => n.length)) + 2;
  const rows = names.map((n) => `  ${n.padEnd(w)}${ctx.help[n]}`).join('\n');
  return ok(
    `GreyHat shell: available commands\n\n${rows}\n\n` +
      'Pipes (|), redirects (> >> 2> 2>&1), && || ; and globs (*) all work.\n' +
      'Tab completes commands and paths. Up/Down browse history.\n',
  );
};
