/**
 * Virtual filesystem with unix-style owners, groups and permission bits.
 * Plain JSON-serialisable data, so saving the world is just JSON.stringify.
 */

interface BaseNode {
  name: string;
  owner: string;
  group: string;
  /** Permission bits, e.g. 0o644. Includes setuid (0o4000) etc. */
  mode: number;
  /** Modified time, epoch ms (simulated clock). */
  mtime: number;
}
export interface FileNode extends BaseNode {
  type: 'file';
  content: string;
}
export interface DirNode extends BaseNode {
  type: 'dir';
  children: Record<string, FsNode>;
}
export type FsNode = FileNode | DirNode;

export interface Identity {
  user: string;
  groups: string[];
}

export type FsErrorCode = 'ENOENT' | 'EACCES' | 'ENOTDIR' | 'EISDIR' | 'EEXIST' | 'EINVAL';

const MESSAGES: Record<FsErrorCode, string> = {
  ENOENT: 'No such file or directory',
  EACCES: 'Permission denied',
  ENOTDIR: 'Not a directory',
  EISDIR: 'Is a directory',
  EEXIST: 'File exists',
  EINVAL: 'Invalid argument',
};

export class FsError extends Error {
  readonly code: FsErrorCode;
  readonly path: string;
  constructor(code: FsErrorCode, path: string) {
    super(MESSAGES[code]);
    this.name = 'FsError';
    this.code = code;
    this.path = path;
  }
}

/* ---------- path helpers ---------- */

export function splitPath(path: string): string[] {
  return path.split('/').filter(Boolean);
}

export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

export function resolvePath(cwd: string, path: string): string {
  return normalizePath(path.startsWith('/') ? path : `${cwd}/${path}`);
}

export function dirname(abs: string): string {
  const parts = splitPath(abs);
  parts.pop();
  return '/' + parts.join('/');
}

export function basename(path: string): string {
  const parts = splitPath(path);
  return parts[parts.length - 1] ?? '/';
}

export function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`;
}

/** "drwxr-xr-x" style string, including setuid/setgid/sticky. */
export function modeString(node: FsNode): string {
  const bits = 'rwxrwxrwx';
  let s = node.type === 'dir' ? 'd' : '-';
  for (let i = 0; i < 9; i++) s += (node.mode & (1 << (8 - i))) !== 0 ? bits[i] : '-';
  if (node.mode & 0o4000) s = s.slice(0, 3) + (s[3] === 'x' ? 's' : 'S') + s.slice(4);
  if (node.mode & 0o2000) s = s.slice(0, 6) + (s[6] === 'x' ? 's' : 'S') + s.slice(7);
  if (node.mode & 0o1000) s = s.slice(0, 9) + (s[9] === 'x' ? 't' : 'T');
  return s;
}

/* ---------- construction helpers ---------- */

const DEFAULT_MTIME = Date.UTC(2026, 0, 12, 9, 30, 0);

function makeDir(name: string, owner: string, group: string, mode: number, mtime: number): DirNode {
  return { type: 'dir', name, owner, group, mode, mtime, children: {} };
}

function makeFile(
  name: string,
  content: string,
  owner: string,
  group: string,
  mode: number,
  mtime: number,
): FileNode {
  return { type: 'file', name, content, owner, group, mode, mtime };
}

export interface FileSpec {
  content?: string;
  owner?: string;
  group?: string;
  mode?: number;
}

/**
 * Declarative filesystem description used by mission content.
 *  - Keys ending in "/" declare a directory (value is a FileSpec or '').
 *  - Other keys declare a file (value is its content or a FileSpec).
 *  - Missing parent directories are created as root:root 0755.
 */
export type FsSpec = Record<string, string | FileSpec>;

export class VirtualFS {
  private root: DirNode;

  constructor(root?: DirNode) {
    this.root = root ?? makeDir('', 'root', 'root', 0o755, DEFAULT_MTIME);
  }

  static fromSpec(spec: FsSpec, mtime: number = DEFAULT_MTIME): VirtualFS {
    const fs = new VirtualFS();
    const entries = Object.entries(spec);
    const dirs = entries
      .filter(([p]) => p.endsWith('/'))
      .sort((a, b) => a[0].length - b[0].length);
    const files = entries.filter(([p]) => !p.endsWith('/'));

    for (const [p, v] of dirs) {
      const o: FileSpec = typeof v === 'string' ? {} : v;
      fs.ensureDir(normalizePath(p), o, mtime);
    }
    for (const [p, v] of files) {
      const o: FileSpec = typeof v === 'string' ? { content: v } : v;
      const abs = normalizePath(p);
      const parent = fs.ensureDir(dirname(abs), {}, mtime);
      const name = basename(abs);
      const owner = o.owner ?? 'root';
      parent.children[name] = makeFile(
        name,
        o.content ?? '',
        owner,
        o.group ?? owner,
        o.mode ?? 0o644,
        mtime,
      );
    }
    return fs;
  }

  static fromJSON(root: DirNode): VirtualFS {
    return new VirtualFS(root);
  }

  toJSON(): DirNode {
    return this.root;
  }

  /** Create (or fetch) a directory path, bypassing permission checks. */
  private ensureDir(abs: string, attrs: FileSpec, mtime: number): DirNode {
    let node: DirNode = this.root;
    for (const part of splitPath(abs)) {
      let next: FsNode | undefined = node.children[part];
      if (!next) {
        next = makeDir(part, 'root', 'root', 0o755, mtime);
        node.children[part] = next;
      }
      if (next.type !== 'dir') throw new FsError('ENOTDIR', abs);
      node = next;
    }
    if (attrs.owner) {
      node.owner = attrs.owner;
      node.group = attrs.group ?? attrs.owner;
    }
    if (attrs.group) node.group = attrs.group;
    if (attrs.mode !== undefined) node.mode = attrs.mode;
    return node;
  }

  /* ---------- permission model ---------- */

  private can(node: FsNode, id: Identity, bit: 1 | 2 | 4): boolean {
    if (id.user === 'root') return true;
    let shift = 0;
    if (node.owner === id.user) shift = 6;
    else if (id.groups.includes(node.group)) shift = 3;
    return ((node.mode >> shift) & bit) !== 0;
  }

  private walk(abs: string, id: Identity): FsNode {
    let node: FsNode = this.root;
    for (const part of splitPath(abs)) {
      if (node.type !== 'dir') throw new FsError('ENOTDIR', abs);
      if (!this.can(node, id, 1)) throw new FsError('EACCES', abs);
      const next: FsNode | undefined = node.children[part];
      if (!next) throw new FsError('ENOENT', abs);
      node = next;
    }
    return node;
  }

  private walkDir(abs: string, id: Identity): DirNode {
    const node = this.walk(abs, id);
    if (node.type !== 'dir') throw new FsError('ENOTDIR', abs);
    return node;
  }

  /* ---------- public API ---------- */

  stat(abs: string, id: Identity): FsNode {
    return this.walk(abs, id);
  }

  exists(abs: string, id: Identity): boolean {
    try {
      this.walk(abs, id);
      return true;
    } catch {
      return false;
    }
  }

  /** Throws EACCES unless `id` has the requested permission bit (4=r, 2=w, 1=x). */
  access(abs: string, id: Identity, bit: 1 | 2 | 4): void {
    const node = this.walk(abs, id);
    if (!this.can(node, id, bit)) throw new FsError('EACCES', abs);
  }

  readFile(abs: string, id: Identity): string {
    const node = this.walk(abs, id);
    if (node.type === 'dir') throw new FsError('EISDIR', abs);
    if (!this.can(node, id, 4)) throw new FsError('EACCES', abs);
    return node.content;
  }

  readDir(abs: string, id: Identity): FsNode[] {
    const node = this.walkDir(abs, id);
    if (!this.can(node, id, 4)) throw new FsError('EACCES', abs);
    return Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name));
  }

  writeFile(
    abs: string,
    content: string,
    id: Identity,
    opts: { append?: boolean; mtime?: number } = {},
  ): void {
    if (abs === '/') throw new FsError('EISDIR', abs);
    const mtime = opts.mtime ?? DEFAULT_MTIME;
    const parent = this.walkDir(dirname(abs), id);
    const name = basename(abs);
    const existing = parent.children[name];
    if (existing) {
      if (existing.type === 'dir') throw new FsError('EISDIR', abs);
      if (!this.can(existing, id, 2)) throw new FsError('EACCES', abs);
      existing.content = opts.append ? existing.content + content : content;
      existing.mtime = mtime;
      return;
    }
    if (!this.can(parent, id, 2)) throw new FsError('EACCES', abs);
    parent.children[name] = makeFile(name, content, id.user, id.groups[0] ?? id.user, 0o644, mtime);
  }

  mkdir(abs: string, id: Identity, opts: { parents?: boolean; mtime?: number } = {}): void {
    const parts = splitPath(abs);
    if (parts.length === 0) throw new FsError('EEXIST', '/');
    const mtime = opts.mtime ?? DEFAULT_MTIME;
    let node: DirNode = this.root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const last = i === parts.length - 1;
      if (!this.can(node, id, 1)) throw new FsError('EACCES', abs);
      const existing: FsNode | undefined = node.children[part];
      if (existing) {
        if (last && !opts.parents) throw new FsError('EEXIST', abs);
        if (existing.type !== 'dir') throw new FsError(last ? 'EEXIST' : 'ENOTDIR', abs);
        node = existing;
        continue;
      }
      if (!last && !opts.parents) throw new FsError('ENOENT', abs);
      if (!this.can(node, id, 2)) throw new FsError('EACCES', abs);
      const dir = makeDir(part, id.user, id.groups[0] ?? id.user, 0o755, mtime);
      node.children[part] = dir;
      node = dir;
    }
  }

  remove(abs: string, id: Identity, opts: { recursive?: boolean } = {}): void {
    if (abs === '/') throw new FsError('EINVAL', abs);
    const parent = this.walkDir(dirname(abs), id);
    const name = basename(abs);
    const node = parent.children[name];
    if (!node) throw new FsError('ENOENT', abs);
    if (!this.can(parent, id, 2)) throw new FsError('EACCES', abs);
    if (node.type === 'dir' && !opts.recursive) throw new FsError('EISDIR', abs);
    delete parent.children[name];
  }

  chmod(abs: string, mode: number, id: Identity): void {
    const node = this.walk(abs, id);
    if (id.user !== 'root' && node.owner !== id.user) throw new FsError('EACCES', abs);
    node.mode = mode;
  }

  /**
   * Change a file's owner and/or group. Only root may do this in this
   * simulation (matches a default, unprivileged Linux system: CAP_CHOWN is
   * not granted to a file's own owner). Pass `group` as undefined to leave
   * the group unchanged (the "chown newowner file" form).
   */
  chown(abs: string, owner: string, group: string | undefined, id: Identity): void {
    const node = this.walk(abs, id);
    if (id.user !== 'root') throw new FsError('EACCES', abs);
    node.owner = owner;
    if (group !== undefined) node.group = group;
  }
}
