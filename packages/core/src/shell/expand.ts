import { resolvePath, type Identity, type VirtualFS } from '../fs/vfs';
import { globToRegExp } from '../commands/util';
import type { Word } from './parser';

export interface ExpandEnv {
  env: Record<string, string>;
  lastExit: number;
  cwd: string;
  fs: VirtualFS;
  id: Identity;
}

interface Piece {
  text: string;
  /** Came from a variable / tilde: never treated as a glob pattern. */
  fromVar: boolean;
}

const VAR_RE = /\$(?:(\?)|\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;

function expandVars(text: string, x: ExpandEnv): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  VAR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VAR_RE.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), fromVar: false });
    const name = m[2] ?? m[3];
    const value = m[1] ? String(x.lastExit) : (x.env[name as string] ?? '');
    out.push({ text: value, fromVar: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), fromVar: false });
  return out;
}

/**
 * Expand one shell word into zero or more arguments:
 * tilde, $VARS, then globbing (*, ?, [..]) in the last path component.
 */
export function expandWord(word: Word, x: ExpandEnv): string[] {
  let raw = '';
  const mask: boolean[] = []; // mask[i] === true -> raw[i] is an unquoted, literal glob-capable char

  word.forEach((seg, idx) => {
    const pieces: Piece[] = [];
    let rest = seg.text;

    if (seg.quote === 'none' && idx === 0 && rest.startsWith('~') && (rest.length === 1 || rest[1] === '/')) {
      pieces.push({ text: x.env.HOME ?? '/', fromVar: true });
      rest = rest.slice(1);
    }
    if (seg.quote === 'single') pieces.push({ text: rest, fromVar: true });
    else pieces.push(...expandVars(rest, x));

    for (const piece of pieces) {
      const live = seg.quote === 'none' && !piece.fromVar;
      raw += piece.text;
      for (let k = 0; k < piece.text.length; k++) mask.push(live);
    }
  });

  if (raw === '' && word.every((s) => s.quote === 'none')) return [];

  const hasGlob = mask.some((live, i) => live && '*?['.includes(raw[i]));
  if (!hasGlob) return [raw];
  return expandGlob(raw, mask, x) ?? [raw];
}

function expandGlob(raw: string, mask: boolean[], x: ExpandEnv): string[] | null {
  const slash = raw.lastIndexOf('/');
  const dirPart = slash >= 0 ? raw.slice(0, slash + 1) : '';
  const filePat = raw.slice(slash + 1);
  const fileMask = mask.slice(slash + 1);

  // Globs inside directory components are not supported yet.
  for (let i = 0; i < dirPart.length; i++) {
    if (mask[i] && '*?['.includes(dirPart[i])) return null;
  }

  const dirAbs = resolvePath(x.cwd, dirPart === '' ? '.' : dirPart);
  let entries;
  try {
    entries = x.fs.readDir(dirAbs, x.id);
  } catch {
    return null;
  }
  const re = globToRegExp(filePat, { mask: fileMask });
  const showHidden = filePat.startsWith('.');
  const names = entries
    .map((e) => e.name)
    .filter((n) => (showHidden || !n.startsWith('.')) && re.test(n))
    .sort();
  return names.length > 0 ? names.map((n) => dirPart + n) : null;
}
