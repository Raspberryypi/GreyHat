import type { FsNode } from '../fs/vfs';
import type { CommandFn } from '../shell/types';
import {
  byteLength,
  fail,
  gatherInputs,
  joinLines,
  ok,
  parseArgs,
  splitLines,
  errText,
  type Input,
} from './util';

/* ------------------------------------------------------------------ echo */

export const echo: CommandFn = (args) => {
  let newline = true;
  let escapes = false;
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (!/^-[neE]+$/.test(a)) break;
    if (a.includes('n')) newline = false;
    if (a.includes('e')) escapes = true;
    if (a.includes('E')) escapes = false;
  }
  let text = args.slice(i).join(' ');
  if (escapes) text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
  return ok(text + (newline ? '\n' : ''));
};

/* ------------------------------------------------------------ head / tail */

const normalizeCountArgs = (args: string[]): string[] =>
  args.flatMap((a) => (/^-\d+$/.test(a) ? ['-n', a.slice(1)] : [a]));

function headTail(kind: 'head' | 'tail'): CommandFn {
  return (rawArgs, ctx) => {
    const p = parseArgs(normalizeCountArgs(rawArgs), ['n']);
    const n = p.values.n !== undefined ? parseInt(p.values.n, 10) : 10;
    if (Number.isNaN(n) || n < 0) return fail(`${kind}: invalid number of lines: '${p.values.n}'`);
    const { inputs, errors } = gatherInputs(kind, p.positional, ctx);
    let out = '';
    inputs.forEach((inp, idx) => {
      if (inputs.length > 1) out += `${idx > 0 ? '\n' : ''}==> ${inp.name} <==\n`;
      const lines = splitLines(inp.text);
      const sel = kind === 'head' ? lines.slice(0, n) : n === 0 ? [] : lines.slice(-n);
      out += joinLines(sel);
    });
    return { stdout: out, stderr: errors.join(''), exitCode: errors.length > 0 ? 1 : 0 };
  };
}
export const head = headTail('head');
export const tail = headTail('tail');

/* ------------------------------------------------------------------ grep */

/** Translate a POSIX basic regex (grep default) to a JS regex source. */
function breToJs(p: string): string {
  const special = '|(){}+?';
  let out = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '\\' && i + 1 < p.length) {
      const nx = p[i + 1];
      out += special.includes(nx) ? nx : c + nx; // \| \( \) \+ \? are operators in BRE
      i++;
    } else if (special.includes(c)) {
      out += '\\' + c; // bare | ( ) + ? are literals in BRE
    } else {
      out += c;
    }
  }
  return out;
}

export const grep: CommandFn = (args, ctx) => {
  const p = parseArgs(args, ['e', 'm']);
  const files = [...p.positional];
  let pattern: string | undefined = p.values.e;
  if (pattern === undefined) pattern = files.shift();
  if (pattern === undefined) return fail('Usage: grep [OPTION]... PATTERN [FILE]...', 2);

  let source: string;
  if (p.flags.has('F')) source = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  else if (p.flags.has('E') || p.flags.has('P')) source = pattern;
  else source = breToJs(pattern);
  if (p.flags.has('w')) source = `\\b(?:${source})\\b`;

  const ci = p.flags.has('i');
  let reTest: RegExp;
  let reAll: RegExp;
  try {
    reTest = new RegExp(source, ci ? 'i' : '');
    reAll = new RegExp(source, ci ? 'gi' : 'g');
  } catch {
    return fail(`grep: Invalid regular expression: ${pattern}`, 2);
  }

  const invert = p.flags.has('v');
  const countOnly = p.flags.has('c');
  const listFiles = p.flags.has('l');
  const lineNum = p.flags.has('n');
  const onlyMatch = p.flags.has('o');
  const quiet = p.flags.has('q');
  const recursive = p.flags.has('r') || p.flags.has('R');
  const max = p.values.m !== undefined ? parseInt(p.values.m, 10) : Infinity;

  let inputs: Input[] = [];
  let errors: string[] = [];

  if (recursive) {
    const roots = files.length > 0 ? files : [''];
    const join = (d: string, n: string): string => (d === '' ? n : `${d.replace(/\/$/, '')}/${n}`);
    const walk = (display: string): void => {
      const abs = ctx.resolve(display === '' ? '.' : display);
      let node: FsNode;
      try {
        node = ctx.fs.stat(abs, ctx.id);
      } catch (e) {
        errors.push(`grep: ${display}: ${errText(e)}\n`);
        return;
      }
      if (node.type === 'file') {
        try {
          inputs.push({ name: display, text: ctx.readFile(display) });
        } catch (e) {
          errors.push(`grep: ${display}: ${errText(e)}\n`);
        }
        return;
      }
      let kids: FsNode[];
      try {
        kids = ctx.fs.readDir(abs, ctx.id);
      } catch (e) {
        errors.push(`grep: ${display}: ${errText(e)}\n`);
        return;
      }
      for (const k of kids) walk(join(display, k.name));
    };
    for (const r of roots) walk(r);
  } else {
    ({ inputs, errors } = gatherInputs('grep', files, ctx));
  }

  const withName = (inputs.length > 1 || recursive) && !p.flags.has('h');
  let out = '';
  let anyMatch = false;

  for (const inp of inputs) {
    const label = inp.name === '-' ? '(standard input)' : inp.name;
    let count = 0;
    splitLines(inp.text).forEach((line, idx) => {
      if (count >= max) return;
      if (reTest.test(line) === invert) return;
      count++;
      if (quiet || countOnly || listFiles) return;
      const prefix = (withName ? `${label}:` : '') + (lineNum ? `${idx + 1}:` : '');
      if (onlyMatch && !invert) {
        for (const m of line.matchAll(reAll)) if (m[0] !== '') out += `${prefix}${m[0]}\n`;
      } else {
        out += `${prefix}${line}\n`;
      }
    });
    if (countOnly && !quiet) out += `${withName ? `${label}:` : ''}${count}\n`;
    if (listFiles && count > 0 && !quiet) out += `${label}\n`;
    if (count > 0) anyMatch = true;
  }

  const exitCode = errors.length > 0 && !anyMatch ? 2 : anyMatch ? 0 : 1;
  return { stdout: out, stderr: errors.join(''), exitCode };
};

/* -------------------------------------------------------------------- wc */

export const wc: CommandFn = (args, ctx) => {
  const p = parseArgs(args);
  const showL = p.flags.has('l');
  const showW = p.flags.has('w');
  const showC = p.flags.has('c') || p.flags.has('m');
  const all = !showL && !showW && !showC;
  const { inputs, errors } = gatherInputs('wc', p.positional, ctx);

  const rows = inputs.map((i) => ({
    name: p.positional.length > 0 ? i.name : '',
    l: (i.text.match(/\n/g) ?? []).length,
    w: i.text.split(/\s+/).filter(Boolean).length,
    c: byteLength(i.text),
  }));
  if (rows.length > 1) {
    rows.push({
      name: 'total',
      l: rows.reduce((s, r) => s + r.l, 0),
      w: rows.reduce((s, r) => s + r.w, 0),
      c: rows.reduce((s, r) => s + r.c, 0),
    });
  }
  const cols = (r: (typeof rows)[number]): number[] => {
    const c: number[] = [];
    if (all || showL) c.push(r.l);
    if (all || showW) c.push(r.w);
    if (all || showC) c.push(r.c);
    return c;
  };
  const single = rows.length === 1 && cols(rows[0] ?? { name: '', l: 0, w: 0, c: 0 }).length === 1;
  const width = Math.max(1, ...rows.flatMap(cols).map((n) => String(n).length));
  const out = rows
    .map(
      (r) =>
        cols(r)
          .map((n) => (single ? String(n) : String(n).padStart(width)))
          .join(' ') + (r.name ? ` ${r.name}` : ''),
    )
    .join('\n');
  return { stdout: out ? out + '\n' : '', stderr: errors.join(''), exitCode: errors.length > 0 ? 1 : 0 };
};

/* ------------------------------------------------------------------ sort */

export const sort: CommandFn = (args, ctx) => {
  const p = parseArgs(args, ['k', 't']);
  const { inputs, errors } = gatherInputs('sort', p.positional, ctx);
  let lines = inputs.flatMap((i) => splitLines(i.text));

  const keyIdx = p.values.k !== undefined ? parseInt(p.values.k, 10) : 0;
  const sep = p.values.t;
  const numeric = p.flags.has('n');

  const keyOf = (line: string): string => {
    if (!keyIdx) return line;
    const fields = sep ? line.split(sep) : line.trim().split(/\s+/);
    return fields[keyIdx - 1] ?? '';
  };
  const cmpKey = (a: string, b: string): number => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (numeric) return (parseFloat(ka) || 0) - (parseFloat(kb) || 0);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
  const cmp = (a: string, b: string): number => {
    const d = cmpKey(a, b);
    if (d !== 0) return d;
    return a < b ? -1 : a > b ? 1 : 0; // last-resort whole-line comparison
  };

  lines.sort(cmp);
  if (p.flags.has('r')) lines.reverse();
  if (p.flags.has('u')) lines = lines.filter((l, i) => i === 0 || cmpKey(lines[i - 1], l) !== 0);
  return { stdout: joinLines(lines), stderr: errors.join(''), exitCode: errors.length > 0 ? 2 : 0 };
};

/* ------------------------------------------------------------------ uniq */

export const uniq: CommandFn = (args, ctx) => {
  const p = parseArgs(args);
  const { inputs, errors } = gatherInputs('uniq', p.positional.slice(0, 1), ctx);
  const ci = p.flags.has('i');
  const groups: { line: string; n: number }[] = [];
  for (const l of splitLines(inputs[0]?.text ?? '')) {
    const last = groups[groups.length - 1];
    if (last && (ci ? last.line.toLowerCase() === l.toLowerCase() : last.line === l)) last.n++;
    else groups.push({ line: l, n: 1 });
  }
  const shown = groups.filter((g) => (p.flags.has('d') ? g.n > 1 : p.flags.has('u') ? g.n === 1 : true));
  const out = shown
    .map((g) => (p.flags.has('c') ? `${String(g.n).padStart(7)} ${g.line}` : g.line))
    .join('\n');
  return { stdout: out ? out + '\n' : '', stderr: errors.join(''), exitCode: errors.length > 0 ? 1 : 0 };
};

/* ------------------------------------------------------------------- cut */

function parseRanges(spec: string): { from: number; to: number }[] | null {
  const ranges: { from: number; to: number }[] = [];
  for (const part of spec.split(',')) {
    const m = /^(\d*)-(\d*)$/.exec(part);
    if (m) {
      if (m[1] === '' && m[2] === '') return null;
      ranges.push({ from: m[1] === '' ? 1 : parseInt(m[1], 10), to: m[2] === '' ? Infinity : parseInt(m[2], 10) });
    } else if (/^\d+$/.test(part)) {
      ranges.push({ from: parseInt(part, 10), to: parseInt(part, 10) });
    } else {
      return null;
    }
  }
  return ranges;
}

export const cut: CommandFn = (args, ctx) => {
  const p = parseArgs(args, ['d', 'f', 'c']);
  const delim = p.values.d ?? '\t';
  const spec = p.values.f ?? p.values.c;
  if (spec === undefined) return fail('cut: you must specify a list of bytes, characters, or fields');
  const ranges = parseRanges(spec);
  if (!ranges) return fail('cut: invalid field range');
  const hit = (i: number): boolean => ranges.some((r) => i >= r.from && i <= r.to);

  const { inputs, errors } = gatherInputs('cut', p.positional, ctx);
  const out: string[] = [];
  for (const inp of inputs) {
    for (const line of splitLines(inp.text)) {
      if (p.values.c !== undefined) {
        out.push([...line].filter((_, i) => hit(i + 1)).join(''));
      } else if (!line.includes(delim)) {
        if (!p.flags.has('s')) out.push(line);
      } else {
        out.push(line.split(delim).filter((_, i) => hit(i + 1)).join(delim));
      }
    }
  }
  return { stdout: joinLines(out), stderr: errors.join(''), exitCode: errors.length > 0 ? 1 : 0 };
};

/* ------------------------------------------------------------------- awk */

type Expr = (fields: string[], line: string, nr: number) => string;

function splitPrintArgs(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (const ch of s) {
    if (ch === '"') {
      inQuote = !inQuote;
      cur += ch;
    } else if (ch === ',' && !inQuote) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== '' || out.length > 0) out.push(cur.trim());
  return out;
}

function compileExpr(a: string): Expr | null {
  let m: RegExpExecArray | null;
  if ((m = /^"(.*)"$/.exec(a))) {
    const s = m[1];
    return () => s;
  }
  if (a === '$0') return (_f, line) => line;
  if (a === '$NF') return (f) => f[f.length - 1] ?? '';
  if ((m = /^\$\(NF-(\d+)\)$/.exec(a))) {
    const k = parseInt(m[1], 10);
    return (f) => f[f.length - 1 - k] ?? '';
  }
  if ((m = /^\$(\d+)$/.exec(a))) {
    const n = parseInt(m[1], 10);
    return (f) => f[n - 1] ?? '';
  }
  if (a === 'NR') return (_f, _l, nr) => String(nr);
  if (a === 'NF') return (f) => String(f.length);
  return null;
}

/** A deliberately small awk: `[/regex/] { print expr, expr, ... }` with -F. */
export const awk: CommandFn = (args, ctx) => {
  const p = parseArgs(args, ['F']);
  const program = p.positional[0];
  if (program === undefined) return fail('awk: no program given', 2);

  const m = /^\s*(?:\/(.*?)\/\s*)?\{\s*print(?:\s+(.*?))?\s*\}\s*$/s.exec(program);
  if (!m) {
    return fail(
      `awk: unsupported program (GreyHat awk supports: '/regex/ { print $1, $NF, "text" }')`,
      2,
    );
  }

  let filter: RegExp | null = null;
  if (m[1] !== undefined) {
    try {
      filter = new RegExp(m[1]);
    } catch {
      return fail('awk: invalid regular expression', 2);
    }
  }
  const exprs: Expr[] = [];
  for (const a of m[2] ? splitPrintArgs(m[2]) : ['$0']) {
    const e = compileExpr(a);
    if (!e) return fail(`awk: unsupported expression: ${a}`, 2);
    exprs.push(e);
  }

  const sep = p.values.F;
  const splitFields = (line: string): string[] => {
    if (sep === undefined || sep === ' ') return line.trim().split(/\s+/).filter(Boolean);
    if (sep.length > 1) {
      try {
        return line.split(new RegExp(sep));
      } catch {
        return line.split(sep);
      }
    }
    return line.split(sep);
  };

  const { inputs, errors } = gatherInputs('awk', p.positional.slice(1), ctx);
  let out = '';
  let nr = 0;
  for (const inp of inputs) {
    for (const line of splitLines(inp.text)) {
      nr++;
      if (filter && !filter.test(line)) continue;
      const fields = splitFields(line);
      out += exprs.map((e) => e(fields, line, nr)).join(' ') + '\n';
    }
  }
  return { stdout: out, stderr: errors.join(''), exitCode: errors.length > 0 ? 2 : 0 };
};
