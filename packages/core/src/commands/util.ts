import { FsError } from '../fs/vfs';
import type { CommandContext, CommandResult } from '../shell/types';

export const ok = (stdout = ''): CommandResult => ({ stdout, stderr: '', exitCode: 0 });

export const fail = (message: string, exitCode = 1): CommandResult => ({
  stdout: '',
  stderr: message.endsWith('\n') ? message : `${message}\n`,
  exitCode,
});

/** Human message for a filesystem error. Rethrows anything that is not an FsError. */
export function errText(e: unknown): string {
  if (e instanceof FsError) return e.message;
  throw e;
}

export interface ParsedArgs {
  flags: Set<string>;
  values: Record<string, string>;
  positional: string[];
}

/**
 * Minimal getopt: short flags can be clustered (-la). Flags listed in
 * `valueFlags` consume a value (-n 5, -n5). "--" ends option parsing.
 * Long options (--foo) are collected as flags named "foo".
 */
export function parseArgs(args: string[], valueFlags: string[] = []): ParsedArgs {
  const flags = new Set<string>();
  const values: Record<string, string> = {};
  const positional: string[] = [];
  let done = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (done || a === '-' || !a.startsWith('-')) {
      positional.push(a);
      continue;
    }
    if (a === '--') {
      done = true;
      continue;
    }
    if (a.startsWith('--')) {
      flags.add(a.slice(2));
      continue;
    }
    const cluster = a.slice(1);
    for (let j = 0; j < cluster.length; j++) {
      const ch = cluster[j];
      if (valueFlags.includes(ch)) {
        const rest = cluster.slice(j + 1);
        values[ch] = rest !== '' ? rest : (args[++i] ?? '');
        break;
      }
      flags.add(ch);
    }
  }
  return { flags, values, positional };
}

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export const joinLines = (lines: string[]): string => (lines.length > 0 ? lines.join('\n') + '\n' : '');

/** UTF-8 byte length without needing TextEncoder. */
export function byteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

export interface Input {
  name: string;
  text: string;
}

/** Read named files, or stdin when no files are given ("-" also means stdin). */
export function gatherInputs(
  cmd: string,
  files: string[],
  ctx: CommandContext,
): { inputs: Input[]; errors: string[] } {
  if (files.length === 0) return { inputs: [{ name: '-', text: ctx.stdin }], errors: [] };
  const inputs: Input[] = [];
  const errors: string[] = [];
  for (const f of files) {
    if (f === '-') {
      inputs.push({ name: '-', text: ctx.stdin });
      continue;
    }
    try {
      inputs.push({ name: f, text: ctx.readFile(f) });
    } catch (e) {
      errors.push(`${cmd}: ${f}: ${errText(e)}\n`);
    }
  }
  return { inputs, errors };
}

/**
 * Convert a shell glob to a RegExp. `mask[i] === false` marks characters that
 * were quoted and must be matched literally.
 */
export function globToRegExp(pattern: string, opts: { mask?: boolean[]; ci?: boolean } = {}): RegExp {
  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    const live = opts.mask ? opts.mask[i] : true;
    if (live && ch === '*') {
      re += '.*';
    } else if (live && ch === '?') {
      re += '.';
    } else if (live && ch === '[') {
      const end = pattern.indexOf(']', i + 2);
      if (end === -1) {
        re += '\\[';
      } else {
        let body = pattern.slice(i + 1, end);
        if (body[0] === '!') body = '^' + body.slice(1);
        re += '[' + body.replace(/\\/g, '\\\\') + ']';
        i = end;
      }
    } else {
      re += ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    }
  }
  return new RegExp(re + '$', opts.ci ? 'i' : '');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jan 12 09:30" style date used by ls -l. */
export function formatLsDate(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${hh}:${mm}`;
}
