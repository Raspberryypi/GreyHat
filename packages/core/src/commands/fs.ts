import { FsError, basename, joinPath, modeString } from '../fs/vfs';
import type { FsNode } from '../fs/vfs';
import type { CommandFn } from '../shell/types';
import {
  byteLength,
  errText,
  fail,
  formatLsDate,
  gatherInputs,
  globToRegExp,
  ok,
  parseArgs,
  splitLines,
} from './util';

export const pwd: CommandFn = (_args, ctx) => ok(`${ctx.session.cwd}\n`);

export const cd: CommandFn = (args, ctx) => {
  const s = ctx.session;
  const arg = args[0];
  let target = arg ?? s.env.HOME ?? '/';
  let printNew = false;
  if (target === '-') {
    target = s.env.OLDPWD ?? s.cwd;
    printNew = true;
  }
  if (target.startsWith('~')) target = (s.env.HOME ?? '/') + target.slice(1);
  const abs = ctx.resolve(target);
  try {
    const node = ctx.fs.stat(abs, ctx.id);
    if (node.type !== 'dir') return fail(`bash: cd: ${arg}: Not a directory`);
    ctx.fs.access(abs, ctx.id, 1);
  } catch (e) {
    return fail(`bash: cd: ${arg ?? target}: ${errText(e)}`);
  }
  s.env.OLDPWD = s.cwd;
  s.cwd = abs;
  s.env.PWD = abs;
  ctx.emit({ type: 'cwd', hostId: ctx.host.id, path: abs });
  return ok(printNew ? `${abs}\n` : '');
};

interface Entry {
  name: string;
  node: FsNode;
}

const sizeOf = (n: FsNode): number => (n.type === 'dir' ? 4096 : byteLength(n.content));

function formatEntries(entries: Entry[], long: boolean, onePerLine: boolean): string {
  if (entries.length === 0) return '';
  if (long) {
    const w = {
      owner: Math.max(...entries.map((e) => e.node.owner.length)),
      group: Math.max(...entries.map((e) => e.node.group.length)),
      size: Math.max(...entries.map((e) => String(sizeOf(e.node)).length)),
    };
    return (
      entries
        .map((e) =>
          [
            modeString(e.node),
            String(e.node.type === 'dir' ? 2 : 1).padStart(2),
            e.node.owner.padEnd(w.owner),
            e.node.group.padEnd(w.group),
            String(sizeOf(e.node)).padStart(w.size),
            formatLsDate(e.node.mtime),
            e.name,
          ].join(' '),
        )
        .join('\n') + '\n'
    );
  }
  const names = entries.map((e) => e.name);
  const oneLine = names.join('  ');
  return (onePerLine || oneLine.length > 78 ? names.join('\n') : oneLine) + '\n';
}

export const ls: CommandFn = (args, ctx) => {
  const { flags, positional } = parseArgs(args);
  const long = flags.has('l');
  const all = flags.has('a');
  const onePer = flags.has('1');
  const targets = positional.length > 0 ? positional : ['.'];

  let out = '';
  let err = '';
  let code = 0;
  const fileEntries: Entry[] = [];
  const dirs: { label: string; abs: string; node: FsNode }[] = [];

  for (const t of targets) {
    const abs = ctx.resolve(t);
    let node: FsNode;
    try {
      node = ctx.fs.stat(abs, ctx.id);
    } catch (e) {
      err += `ls: cannot access '${t}': ${errText(e)}\n`;
      code = 2;
      continue;
    }
    if (node.type === 'dir') dirs.push({ label: t, abs, node });
    else fileEntries.push({ name: t, node });
  }

  out += formatEntries(fileEntries, long, onePer);

  for (const [i, d] of dirs.entries()) {
    if (targets.length > 1) out += `${out ? '\n' : ''}${d.label}:\n`;
    let kids: FsNode[];
    try {
      kids = ctx.fs.readDir(d.abs, ctx.id);
    } catch (e) {
      err += `ls: cannot open directory '${d.label}': ${errText(e)}\n`;
      code = 2;
      continue;
    }
    const entries: Entry[] = kids
      .filter((k) => all || !k.name.startsWith('.'))
      .map((k) => ({ name: k.name, node: k }));
    if (all) {
      let parent: FsNode = d.node;
      try {
        parent = ctx.fs.stat(d.abs === '/' ? '/' : d.abs.slice(0, d.abs.lastIndexOf('/')) || '/', ctx.id);
      } catch {
        /* keep d.node */
      }
      entries.unshift({ name: '.', node: d.node }, { name: '..', node: parent });
    }
    if (long) {
      const blocks = entries.reduce((s, e) => s + Math.max(4, Math.ceil(sizeOf(e.node) / 1024)), 0);
      out += `total ${blocks}\n`;
    }
    out += formatEntries(entries, long, onePer);
    void i;
  }
  return { stdout: out, stderr: err, exitCode: code };
};

export const cat: CommandFn = (args, ctx) => {
  const { flags, positional } = parseArgs(args);
  const { inputs, errors } = gatherInputs('cat', positional, ctx);
  let text = inputs.map((i) => i.text).join('');
  if (flags.has('n')) {
    text = splitLines(text)
      .map((l, i) => `${String(i + 1).padStart(6)}\t${l}`)
      .join('\n');
    if (text) text += '\n';
  }
  return { stdout: text, stderr: errors.join(''), exitCode: errors.length > 0 ? 1 : 0 };
};

export const touch: CommandFn = (args, ctx) => {
  const { positional } = parseArgs(args);
  if (positional.length === 0) return fail('touch: missing file operand');
  let err = '';
  for (const p of positional) {
    try {
      ctx.fs.writeFile(ctx.resolve(p), '', ctx.id, { append: true, mtime: ctx.world.now });
    } catch (e) {
      err += `touch: cannot touch '${p}': ${errText(e)}\n`;
    }
  }
  return { stdout: '', stderr: err, exitCode: err ? 1 : 0 };
};

export const mkdir: CommandFn = (args, ctx) => {
  const p = parseArgs(args);
  if (p.positional.length === 0) return fail('mkdir: missing operand');
  let err = '';
  for (const d of p.positional) {
    try {
      ctx.fs.mkdir(ctx.resolve(d), ctx.id, { parents: p.flags.has('p'), mtime: ctx.world.now });
    } catch (e) {
      err += `mkdir: cannot create directory '${d}': ${errText(e)}\n`;
    }
  }
  return { stdout: '', stderr: err, exitCode: err ? 1 : 0 };
};

export const rm: CommandFn = (args, ctx) => {
  const p = parseArgs(args);
  const recursive = p.flags.has('r') || p.flags.has('R');
  const force = p.flags.has('f');
  if (p.positional.length === 0) return force ? ok() : fail('rm: missing operand');
  let err = '';
  for (const f of p.positional) {
    const abs = ctx.resolve(f);
    try {
      const node = ctx.fs.stat(abs, ctx.id);
      if (node.type === 'dir' && !recursive) {
        err += `rm: cannot remove '${f}': Is a directory\n`;
        continue;
      }
      ctx.fs.remove(abs, ctx.id, { recursive });
    } catch (e) {
      if (e instanceof FsError && e.code === 'ENOENT' && force) continue;
      err += `rm: cannot remove '${f}': ${errText(e)}\n`;
    }
  }
  return { stdout: '', stderr: err, exitCode: err ? 1 : 0 };
};

export const chmod: CommandFn = (args, ctx) => {
  const { positional } = parseArgs(args, []);
  if (positional.length < 2) return fail('chmod: missing operand');
  const modeStr = positional[0];
  const mode = parseInt(modeStr, 8);
  if (Number.isNaN(mode) || !/^[0-7]{3,4}$/.test(modeStr)) {
    return fail(`chmod: invalid mode: '${modeStr}' (only octal modes like 755 or 0644 are supported)`);
  }
  let err = '';
  for (const p of positional.slice(1)) {
    try {
      ctx.fs.chmod(ctx.resolve(p), mode, ctx.id);
    } catch (e) {
      err += `chmod: changing permissions of '${p}': ${errText(e)}\n`;
    }
  }
  return { stdout: '', stderr: err, exitCode: err ? 1 : 0 };
};

/**
 * chown [owner][:[group]] file...  Only root can actually change ownership
 * (enforced by VirtualFS.chown); a non-root attempt reports "Permission
 * denied", same as a real unprivileged Linux box.
 */
export const chown: CommandFn = (args, ctx) => {
  const { positional } = parseArgs(args, []);
  if (positional.length < 2) return fail('chown: missing operand');
  const spec = positional[0];
  let owner: string | undefined;
  let group: string | undefined;
  if (spec.includes(':')) {
    const [o, g] = spec.split(':');
    owner = o || undefined;
    group = g || undefined;
  } else {
    owner = spec;
  }
  let err = '';
  for (const p of positional.slice(1)) {
    try {
      const abs = ctx.resolve(p);
      const node = ctx.fs.stat(abs, ctx.id);
      ctx.fs.chown(abs, owner ?? node.owner, group, ctx.id);
    } catch (e) {
      err += `chown: changing ownership of '${p}': ${errText(e)}\n`;
    }
  }
  return { stdout: '', stderr: err, exitCode: err ? 1 : 0 };
};

export const cp: CommandFn = (args, ctx) => {
  const { positional } = parseArgs(args, []);
  if (positional.length < 2) return fail('cp: missing destination file operand');
  const dest = positional[positional.length - 1];
  const sources = positional.slice(0, -1);
  const destAbs = ctx.resolve(dest);
  let destIsDir = false;
  try {
    destIsDir = ctx.fs.stat(destAbs, ctx.id).type === 'dir';
  } catch {
    /* dest need not exist yet */
  }
  if (sources.length > 1 && !destIsDir) return fail(`cp: target '${dest}' is not a directory`);
  let err = '';
  for (const s of sources) {
    try {
      const srcAbs = ctx.resolve(s);
      const node = ctx.fs.stat(srcAbs, ctx.id);
      if (node.type === 'dir') {
        err += `cp: -r not specified; omitting directory '${s}'\n`;
        continue;
      }
      const content = ctx.readFile(s);
      const targetAbs = destIsDir ? joinPath(destAbs, basename(srcAbs)) : destAbs;
      ctx.fs.writeFile(targetAbs, content, ctx.id, { mtime: ctx.world.now });
    } catch (e) {
      err += `cp: cannot copy '${s}': ${errText(e)}\n`;
    }
  }
  return { stdout: '', stderr: err, exitCode: err ? 1 : 0 };
};

export const mv: CommandFn = (args, ctx) => {
  const { positional } = parseArgs(args, []);
  if (positional.length < 2) return fail('mv: missing destination file operand');
  const dest = positional[positional.length - 1];
  const sources = positional.slice(0, -1);
  const destAbs = ctx.resolve(dest);
  let destIsDir = false;
  try {
    destIsDir = ctx.fs.stat(destAbs, ctx.id).type === 'dir';
  } catch {
    /* dest need not exist yet */
  }
  if (sources.length > 1 && !destIsDir) return fail(`mv: target '${dest}' is not a directory`);
  let err = '';
  for (const s of sources) {
    try {
      const srcAbs = ctx.resolve(s);
      const node = ctx.fs.stat(srcAbs, ctx.id);
      if (node.type === 'dir') {
        err += `mv: moving directories is not supported yet: '${s}'\n`;
        continue;
      }
      const content = ctx.readFile(s);
      const targetAbs = destIsDir ? joinPath(destAbs, basename(srcAbs)) : destAbs;
      ctx.fs.writeFile(targetAbs, content, ctx.id, { mtime: ctx.world.now });
      ctx.fs.remove(srcAbs, ctx.id);
    } catch (e) {
      err += `mv: cannot move '${s}': ${errText(e)}\n`;
    }
  }
  return { stdout: '', stderr: err, exitCode: err ? 1 : 0 };
};

export const find: CommandFn = (args, ctx) => {
  let i = 0;
  const paths: string[] = [];
  while (i < args.length && !args[i].startsWith('-')) paths.push(args[i++]);
  if (paths.length === 0) paths.push('.');

  let nameRe: RegExp | null = null;
  let type: 'f' | 'd' | null = null;
  let maxDepth = Infinity;
  let user: string | null = null;
  let perm: { mode: number; kind: 'exact' | 'all' | 'any' } | null = null;

  for (; i < args.length; i++) {
    const a = args[i];
    const v = args[i + 1];
    switch (a) {
      case '-name':
      case '-iname':
        if (v === undefined) return fail(`find: missing argument to '${a}'`);
        nameRe = globToRegExp(v, { ci: a === '-iname' });
        i++;
        break;
      case '-type':
        if (v !== 'f' && v !== 'd') return fail(`find: Unknown argument to -type: ${v ?? ''}`);
        type = v;
        i++;
        break;
      case '-maxdepth': {
        const n = parseInt(v ?? '', 10);
        if (Number.isNaN(n)) return fail(`find: Expected a positive decimal integer argument to '-maxdepth'`);
        maxDepth = n;
        i++;
        break;
      }
      case '-user':
        user = v ?? null;
        i++;
        break;
      case '-perm': {
        const raw = v ?? '';
        const kind = raw.startsWith('-') ? 'all' : raw.startsWith('/') ? 'any' : 'exact';
        const mode = parseInt(kind === 'exact' ? raw : raw.slice(1), 8);
        if (Number.isNaN(mode)) return fail(`find: Invalid mode '${raw}'`);
        perm = { mode, kind };
        i++;
        break;
      }
      case '-print':
        break;
      default:
        return fail(`find: unknown predicate '${a}'`);
    }
  }

  let out = '';
  let err = '';

  const matches = (path: string, node: FsNode): boolean => {
    if (type === 'f' && node.type !== 'file') return false;
    if (type === 'd' && node.type !== 'dir') return false;
    if (nameRe && !nameRe.test(basename(path))) return false;
    if (user && node.owner !== user) return false;
    if (perm) {
      if (perm.kind === 'exact' && (node.mode & 0o7777) !== perm.mode) return false;
      if (perm.kind === 'all' && (node.mode & perm.mode) !== perm.mode) return false;
      if (perm.kind === 'any' && (node.mode & perm.mode) === 0) return false;
    }
    return true;
  };

  const walk = (display: string, abs: string, depth: number): void => {
    let node: FsNode;
    try {
      node = ctx.fs.stat(abs, ctx.id);
    } catch (e) {
      err += `find: '${display}': ${errText(e)}\n`;
      return;
    }
    if (matches(display, node)) out += `${display}\n`;
    if (node.type !== 'dir' || depth >= maxDepth) return;
    let kids: FsNode[];
    try {
      kids = ctx.fs.readDir(abs, ctx.id);
    } catch (e) {
      err += `find: '${display}': ${errText(e)}\n`;
      return;
    }
    for (const k of kids) {
      walk(display.endsWith('/') ? display + k.name : `${display}/${k.name}`, joinPath(abs, k.name), depth + 1);
    }
  };

  for (const p of paths) walk(p, ctx.resolve(p), 0);
  return { stdout: out, stderr: err, exitCode: err ? 1 : 0 };
};
