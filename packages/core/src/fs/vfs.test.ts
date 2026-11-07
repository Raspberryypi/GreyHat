import { describe, expect, it } from 'vitest';
import { FsError, VirtualFS, modeString, normalizePath, resolvePath } from './vfs';

const root = { user: 'root', groups: ['root'] };
const alice = { user: 'alice', groups: ['alice', 'adm'] };
const bob = { user: 'bob', groups: ['bob'] };

function makeFs(): VirtualFS {
  return VirtualFS.fromSpec({
    '/home/alice/': { owner: 'alice' },
    '/home/alice/note.txt': { content: 'hello\n', owner: 'alice', mode: 0o600 },
    '/var/log/auth.log': { content: 'log\n', owner: 'root', group: 'adm', mode: 0o640 },
    '/root/': { mode: 0o700 },
    '/root/secret': { content: 'x', mode: 0o600 },
  });
}

describe('paths', () => {
  it('normalises dots and double slashes', () => {
    expect(normalizePath('/a/./b/../c//d')).toBe('/a/c/d');
    expect(normalizePath('/..')).toBe('/');
    expect(resolvePath('/home/alice', '../bob/x')).toBe('/home/bob/x');
    expect(resolvePath('/home/alice', '/etc')).toBe('/etc');
  });
});

describe('permissions', () => {
  it('lets owners read their own files', () => {
    expect(makeFs().readFile('/home/alice/note.txt', alice)).toBe('hello\n');
  });

  it('denies other users', () => {
    expect(() => makeFs().readFile('/home/alice/note.txt', bob)).toThrow(FsError);
  });

  it('grants access through group membership', () => {
    const fs = makeFs();
    expect(fs.readFile('/var/log/auth.log', alice)).toBe('log\n');
    expect(() => fs.readFile('/var/log/auth.log', bob)).toThrow(/Permission denied/);
  });

  it('blocks traversal into directories without x', () => {
    expect(() => makeFs().readFile('/root/secret', alice)).toThrow(/Permission denied/);
  });

  it('root bypasses permissions', () => {
    expect(makeFs().readFile('/root/secret', root)).toBe('x');
  });

  it('reports ENOENT and EISDIR', () => {
    const fs = makeFs();
    expect(() => fs.readFile('/nope', root)).toThrow(/No such file/);
    expect(() => fs.readFile('/home', root)).toThrow(/Is a directory/);
  });
});

describe('mutation', () => {
  it('creates, appends and removes files', () => {
    const fs = makeFs();
    fs.writeFile('/home/alice/new.txt', 'a', alice);
    fs.writeFile('/home/alice/new.txt', 'b', alice, { append: true });
    expect(fs.readFile('/home/alice/new.txt', alice)).toBe('ab');
    fs.remove('/home/alice/new.txt', alice);
    expect(fs.exists('/home/alice/new.txt', alice)).toBe(false);
  });

  it('refuses writes into directories the user cannot write', () => {
    expect(() => makeFs().writeFile('/var/log/x', 'a', alice)).toThrow(/Permission denied/);
  });

  it('mkdir -p builds nested directories', () => {
    const fs = makeFs();
    fs.mkdir('/home/alice/a/b/c', alice, { parents: true });
    expect(fs.stat('/home/alice/a/b/c', alice).type).toBe('dir');
  });

  it('survives a JSON round-trip (save games)', () => {
    const fs = makeFs();
    const copy = VirtualFS.fromJSON(JSON.parse(JSON.stringify(fs.toJSON())));
    expect(copy.readFile('/home/alice/note.txt', alice)).toBe('hello\n');
  });
});

describe('modeString', () => {
  it('formats permissions and setuid', () => {
    const fs = VirtualFS.fromSpec({
      '/bin/su': { content: '', mode: 0o4755 },
      '/bin/ls': { content: '', mode: 0o755 },
    });
    expect(modeString(fs.stat('/bin/ls', root))).toBe('-rwxr-xr-x');
    expect(modeString(fs.stat('/bin/su', root))).toBe('-rwsr-xr-x');
    expect(modeString(fs.stat('/bin', root))).toBe('drwxr-xr-x');
  });
});
