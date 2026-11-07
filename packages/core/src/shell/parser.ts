/**
 * Shell grammar (subset of POSIX sh):
 *   list      := pipeline ( ('&&' | '||' | ';') pipeline )*
 *   pipeline  := command ( '|' command )*
 *   command   := word* with redirects  >  >>  2>  2>>  2>&1
 * Quoting: 'single', "double", backslash escapes. Comments start with #.
 * Not supported yet: $(...) substitution, background jobs (&), heredocs.
 */

export type Quote = 'none' | 'single' | 'double';
export interface Segment {
  text: string;
  quote: Quote;
}
/** A shell word is a list of segments so we remember what was quoted. */
export type Word = Segment[];
export type Connector = '&&' | '||' | ';';

export type Token =
  | { type: 'word'; word: Word }
  | { type: 'op'; op: '|' | '&&' | '||' | ';' }
  | { type: 'redir'; fd: 1 | 2; op: '>' | '>>' | 'dup' };

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const cur = { segs: [] as Segment[], has: false };

  const addSeg = (text: string, quote: Quote): void => {
    cur.has = true;
    const last = cur.segs[cur.segs.length - 1];
    if (last && last.quote === quote) last.text += text;
    else cur.segs.push({ text, quote });
  };
  const flush = (): void => {
    if (cur.has) {
      tokens.push({ type: 'word', word: cur.segs });
      cur.segs = [];
      cur.has = false;
    }
  };

  const n = input.length;
  let i = 0;
  while (i < n) {
    const c = input[i];

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      flush();
      i++;
      continue;
    }
    if (c === '#' && !cur.has) break;

    if (c === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) throw new ParseError("syntax error: unexpected EOF while looking for matching `''");
      addSeg(input.slice(i + 1, end), 'single');
      i = end + 1;
      continue;
    }

    if (c === '"') {
      let j = i + 1;
      let buf = '';
      let closed = false;
      while (j < n) {
        const d = input[j];
        if (d === '"') {
          closed = true;
          break;
        }
        if (d === '\\' && j + 1 < n && '"\\$`'.includes(input[j + 1])) {
          const e = input[j + 1];
          if (e === '$') {
            addSeg(buf, 'double');
            buf = '';
            addSeg('$', 'single'); // escaped dollar must never expand
          } else {
            buf += e;
          }
          j += 2;
          continue;
        }
        buf += d;
        j++;
      }
      if (!closed) throw new ParseError('syntax error: unexpected EOF while looking for matching `"\'');
      addSeg(buf, 'double');
      i = j + 1;
      continue;
    }

    if (c === '\\') {
      if (i + 1 < n) {
        addSeg(input[i + 1], 'single');
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    if (c === '|') {
      flush();
      if (input[i + 1] === '|') {
        tokens.push({ type: 'op', op: '||' });
        i += 2;
      } else {
        tokens.push({ type: 'op', op: '|' });
        i++;
      }
      continue;
    }

    if (c === '&') {
      if (input[i + 1] === '&') {
        flush();
        tokens.push({ type: 'op', op: '&&' });
        i += 2;
        continue;
      }
      throw new ParseError('background jobs (&) are not supported');
    }

    if (c === ';') {
      flush();
      tokens.push({ type: 'op', op: ';' });
      i++;
      continue;
    }

    if (c === '>') {
      let fd: 1 | 2 = 1;
      const isFd2 =
        cur.has && cur.segs.length === 1 && cur.segs[0].quote === 'none' && cur.segs[0].text === '2';
      if (isFd2) {
        fd = 2;
        cur.segs = [];
        cur.has = false;
      } else {
        flush();
      }
      if (fd === 2 && input.startsWith('>&1', i)) {
        tokens.push({ type: 'redir', fd: 2, op: 'dup' });
        i += 3;
        continue;
      }
      if (input[i + 1] === '>') {
        tokens.push({ type: 'redir', fd, op: '>>' });
        i += 2;
      } else {
        tokens.push({ type: 'redir', fd, op: '>' });
        i++;
      }
      continue;
    }

    addSeg(c, 'none');
    i++;
  }
  flush();
  return tokens;
}

export type Redirect =
  | { fd: 1 | 2; op: '>' | '>>'; target: Word }
  | { fd: 2; op: 'dup' };

export interface SimpleCommand {
  words: Word[];
  redirects: Redirect[];
}
export interface Pipeline {
  commands: SimpleCommand[];
}
export interface ListItem {
  pipeline: Pipeline;
  /** Operator that follows this pipeline (null for the last one). */
  connector: Connector | null;
}

export function parse(input: string): ListItem[] {
  const tokens = tokenize(input);
  const items: ListItem[] = [];
  let cmds: SimpleCommand[] = [];
  let cur: SimpleCommand = { words: [], redirects: [] };
  let pending = false; // an operator is waiting for its right-hand side

  const endCommand = (): void => {
    if (cur.words.length === 0 && cur.redirects.length === 0) {
      throw new ParseError("syntax error: unexpected token (missing command)");
    }
    cmds.push(cur);
    cur = { words: [], redirects: [] };
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    if (t.type === 'word') {
      cur.words.push(t.word);
      pending = false;
      continue;
    }

    if (t.type === 'redir') {
      pending = false;
      if (t.op === 'dup') {
        cur.redirects.push({ fd: 2, op: 'dup' });
        continue;
      }
      const next = tokens[i + 1];
      if (!next || next.type !== 'word') {
        throw new ParseError("syntax error near unexpected token `newline'");
      }
      cur.redirects.push({ fd: t.fd, op: t.op, target: next.word });
      i++;
      continue;
    }

    // operator
    endCommand();
    if (t.op === '|') {
      pending = true;
      continue;
    }
    items.push({ pipeline: { commands: cmds }, connector: t.op });
    cmds = [];
    pending = t.op !== ';';
  }

  if (cur.words.length > 0 || cur.redirects.length > 0) endCommand();
  if (pending) throw new ParseError('syntax error: unexpected end of input');
  if (cmds.length > 0) items.push({ pipeline: { commands: cmds }, connector: null });
  return items;
}
