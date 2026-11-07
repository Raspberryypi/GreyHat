import { describe, expect, it } from 'vitest';
import type { FsSpec } from '../fs/vfs';
import type { GameEvent } from '../events';
import { createRng } from '../rng';
import { buildWorld } from '../world/world';
import { createSession } from './session';
import { Shell } from './shell';

function setup(files: FsSpec = {}) {
  const world = buildWorld(
    {
      startTime: Date.UTC(2026, 0, 12, 10, 0, 0),
      hosts: [
        {
          id: 'h',
          hostname: 'box',
          ip: '10.0.0.1',
          users: [
            { name: 'root', uid: 0, home: '/root' },
            { name: 'alice', uid: 1000, home: '/home/alice' },
          ],
          fs: {
            '/home/alice/': { owner: 'alice' },
            '/root/': { mode: 0o700 },
            '/root/secret': { content: 'top secret\n', mode: 0o600 },
            ...files,
          },
        },
      ],
    },
    createRng(1),
  );
  const session = createSession(world, 'h', 'alice');
  const events: GameEvent[] = [];
  const shell = new Shell({ world, session, emit: (e) => events.push(e) });
  const run = async (line: string): Promise<string> => {
    const out = await shell.exec(line);
    return out.chunks.map((c) => c.text).join('');
  };
  return { shell, run, session, events, world };
}

const LOG = { content: 'a\nb\na\nc\na\nb\n', owner: 'alice' };

describe('shell basics', () => {
  it('echo, pwd, cd', async () => {
    const { run, session } = setup({ '/home/alice/docs/': { owner: 'alice' } });
    expect(await run('echo hello world')).toBe('hello world\n');
    expect(await run('pwd')).toBe('/home/alice\n');
    await run('cd docs');
    expect(session.cwd).toBe('/home/alice/docs');
    await run('cd ..');
    expect(await run('pwd')).toBe('/home/alice\n');
  });

  it('reports unknown commands', async () => {
    const { run } = setup();
    expect(await run('nope')).toBe('bash: nope: command not found\n');
  });

  it('expands variables and quotes correctly', async () => {
    const { run } = setup();
    expect(await run('echo $USER')).toBe('alice\n');
    expect(await run("echo '$USER'")).toBe('$USER\n');
    expect(await run('echo "hi $USER"')).toBe('hi alice\n');
    expect(await run('FOO=bar')).toBe('');
    expect(await run('echo $FOO')).toBe('bar\n');
  });

  it('expands ~ and globs', async () => {
    const { run } = setup({
      '/home/alice/a.txt': { content: 'A\n', owner: 'alice' },
      '/home/alice/b.txt': { content: 'B\n', owner: 'alice' },
      '/home/alice/c.log': { content: 'C\n', owner: 'alice' },
    });
    expect(await run('echo ~')).toBe('/home/alice\n');
    expect(await run('echo *.txt')).toBe('a.txt b.txt\n');
    expect(await run('cat *.txt')).toBe('A\nB\n');
    expect(await run('echo *.zip')).toBe('*.zip\n');
  });
});

describe('permissions in the shell', () => {
  it('prints realistic errors', async () => {
    const { run } = setup();
    expect(await run('cat /root/secret')).toBe('cat: /root/secret: Permission denied\n');
    expect(await run('cat /nope')).toBe('cat: /nope: No such file or directory\n');
    expect(await run('cd /root')).toContain('Permission denied');
  });

  it('find reports denied directories on stderr and 2>/dev/null hides them', async () => {
    const { run } = setup({ '/srv/x/target.txt': 'hi\n' });
    const noisy = await run('find / -name target.txt');
    expect(noisy).toContain('/srv/x/target.txt');
    expect(noisy).toContain("find: '/root': Permission denied");
    expect(await run('find / -name target.txt 2>/dev/null')).toBe('/srv/x/target.txt\n');
  });
});

describe('pipes and text tools', () => {
  it('sort | uniq -c | sort -rn | head', async () => {
    const { run } = setup({ '/home/alice/log.txt': LOG });
    expect(await run('sort log.txt | uniq -c | sort -rn | head -1')).toBe('      3 a\n');
  });

  it('grep variants', async () => {
    const { run } = setup({ '/home/alice/log.txt': LOG });
    expect(await run('grep -c a log.txt')).toBe('3\n');
    expect(await run('grep -v a log.txt | wc -l')).toBe('3\n');
    expect(await run('grep -n c log.txt')).toBe('4:c\n');
    expect(await run('grep -E "a|c" log.txt | wc -l')).toBe('4\n');
    expect(await run('grep "a\\|c" log.txt | wc -l')).toBe('4\n');
  });

  it('grep -oE extracts IP addresses', async () => {
    const { run } = setup({
      '/home/alice/l.txt': { content: 'from 1.2.3.4 port 22\nfrom 5.6.7.8 port 80\n', owner: 'alice' },
    });
    expect(await run("grep -oE '[0-9]{1,3}(\\.[0-9]{1,3}){3}' l.txt")).toBe('1.2.3.4\n5.6.7.8\n');
  });

  it('awk, cut, head, tail', async () => {
    const { run } = setup({
      '/home/alice/t.txt': { content: 'one two three\nfour five six\n', owner: 'alice' },
    });
    expect(await run("awk '{print $2}' t.txt")).toBe('two\nfive\n');
    expect(await run("awk '{print $(NF-1), $NF}' t.txt")).toBe('two three\nfive six\n');
    expect(await run("awk '/four/ {print $1}' t.txt")).toBe('four\n');
    expect(await run("cut -d ' ' -f 1,3 t.txt")).toBe('one three\nfour six\n');
    expect(await run('head -1 t.txt')).toBe('one two three\n');
    expect(await run('tail -n 1 t.txt')).toBe('four five six\n');
  });

  it('wc counts', async () => {
    const { run } = setup({ '/home/alice/log.txt': LOG });
    expect(await run('wc -l log.txt')).toBe('6 log.txt\n');
    expect(await run('cat log.txt | wc -l')).toBe('6\n');
  });
});

describe('redirects and control flow', () => {
  it('> and >> write files', async () => {
    const { run } = setup();
    await run('echo hi > out.txt');
    await run('echo more >> out.txt');
    expect(await run('cat out.txt')).toBe('hi\nmore\n');
  });

  it('refuses to redirect somewhere unwritable', async () => {
    const { run } = setup();
    expect(await run('echo x > /etc/passwd')).toContain('Permission denied');
  });

  it('2>&1 merges stderr into the pipe', async () => {
    const { run } = setup();
    expect(await run('cat /nope 2>&1 | wc -l')).toBe('1\n');
  });

  it('&&, || and ;', async () => {
    const { run } = setup();
    expect(await run('true && echo yes')).toBe('yes\n');
    expect(await run('false && echo no')).toBe('');
    expect(await run('false || echo fallback')).toBe('fallback\n');
    expect(await run('echo a; echo b')).toBe('a\nb\n');
    expect(await run('false; echo $?')).toBe('1\n');
  });

  it('reports syntax errors without throwing', async () => {
    const { run, session } = setup();
    expect(await run('echo "oops')).toContain('syntax error');
    expect(session.lastExit).toBe(2);
  });
});

describe('events and completion', () => {
  it('emits file.read and command events', async () => {
    const { run, events } = setup({ '/home/alice/n.txt': { content: 'x\n', owner: 'alice' } });
    await run('cat n.txt');
    expect(events).toContainEqual({ type: 'file.read', hostId: 'h', path: '/home/alice/n.txt', user: 'alice' });
    expect(events.some((e) => e.type === 'command' && e.name === 'cat' && e.exitCode === 0)).toBe(true);
  });

  it('tab-completes commands and paths', async () => {
    const { shell } = setup({ '/home/alice/notes/': { owner: 'alice' }, '/home/alice/readme.txt': 'x' });
    expect(shell.complete('gre').completed).toBe('grep ');
    expect(shell.complete('cat rea').completed).toBe('cat readme.txt ');
    expect(shell.complete('cd no').completed).toBe('cd notes/');
    expect(shell.complete('c').options.length).toBeGreaterThan(1);
  });
});
