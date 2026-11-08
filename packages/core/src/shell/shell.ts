import { FsError, resolvePath } from '../fs/vfs';
import type { FsNode, Identity } from '../fs/vfs';
import { coreCommands, coreHelp } from '../commands';
import { attemptAuth } from '../commands/net';
import { fail, ok } from '../commands/util';
import type { GameEvent } from '../events';
import type { World } from '../world/world';
import { expandWord, type ExpandEnv } from './expand';
import { ParseError, parse, type Connector, type Pipeline, type SimpleCommand, type Word } from './parser';
import { enterSession, identityOf } from './session';
import type { Chunk, CommandContext, CommandRegistry, CommandResult, Session, ShellOutput } from './types';

export interface ShellDeps {
  world: World;
  session: Session;
  emit: (event: GameEvent) => void;
  extraCommands?: CommandRegistry;
  extraHelp?: Record<string, string>;
}

interface RedirTarget {
  /** null means /dev/null */
  path: string | null;
  append: boolean;
}

const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const isAssignment = (w: Word): boolean => w.length > 0 && w[0].quote === 'none' && ASSIGN.test(w[0].text);

function commonPrefix(items: string[]): string {
  if (items.length === 0) return '';
  let prefix = items[0];
  for (const s of items) {
    while (!s.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
}

export class Shell {
  private readonly commands: CommandRegistry;
  private readonly help: Record<string, string>;

  constructor(private readonly deps: ShellDeps) {
    this.commands = { ...coreCommands, ...(deps.extraCommands ?? {}) };
    this.help = { ...coreHelp, ...(deps.extraHelp ?? {}) };
  }

  commandNames(): string[] {
    return Object.keys(this.commands).sort();
  }

  /** Run one line of input. Never throws for user errors. */
  async exec(line: string): Promise<ShellOutput> {
    const s = this.deps.session;
    if (s.pendingAuth) {
      return this.handlePasswordLine(line);
    }
    const chunks: Chunk[] = [];
    let clear = false;

    let items;
    try {
      items = parse(line);
    } catch (e) {
      if (e instanceof ParseError) {
        s.lastExit = 2;
        return { chunks: [{ stream: 'err', text: `bash: ${e.message}\n` }] };
      }
      throw e;
    }

    let prev: Connector | null = null;
    for (const item of items) {
      const skip = (prev === '&&' && s.lastExit !== 0) || (prev === '||' && s.lastExit === 0);
      if (!skip) {
        const res = await this.runPipeline(item.pipeline);
        chunks.push(...res.chunks);
        clear = clear || res.clear;
        s.lastExit = res.exitCode;
      }
      prev = item.connector;
    }
    return clear ? { chunks, clear: true } : { chunks };
  }

  /** Tab completion for the text before the cursor. */
  complete(line: string): { completed: string; options: string[] } {
    const { session, world } = this.deps;
    const host = world.host(session.hostId);
    const id = identityOf(session);
    const idx = line.lastIndexOf(' ');
    const head = line.slice(0, idx + 1);
    const word = line.slice(idx + 1);
    const commandPosition = head.trim() === '' || /[|;&]\s*$/.test(head);

    let candidates: string[];
    if (commandPosition && !word.includes('/')) {
      candidates = this.commandNames().filter((n) => n.startsWith(word));
    } else {
      const slash = word.lastIndexOf('/');
      const dirPart = slash >= 0 ? word.slice(0, slash + 1) : '';
      const prefix = word.slice(slash + 1);
      const dirExpanded = dirPart.startsWith('~') ? (session.env.HOME ?? '/') + dirPart.slice(1) : dirPart;
      let entries: FsNode[];
      try {
        entries = host.fs.readDir(resolvePath(session.cwd, dirExpanded === '' ? '.' : dirExpanded), id);
      } catch {
        return { completed: line, options: [] };
      }
      candidates = entries
        .filter((e) => e.name.startsWith(prefix) && (prefix.startsWith('.') || !e.name.startsWith('.')))
        .map((e) => dirPart + e.name + (e.type === 'dir' ? '/' : ''));
    }

    if (candidates.length === 0) return { completed: line, options: [] };
    if (candidates.length === 1) {
      const c = candidates[0];
      return { completed: head + c + (c.endsWith('/') ? '' : ' '), options: [] };
    }
    return { completed: head + commonPrefix(candidates), options: candidates };
  }

  /* ---------------------------------------------------------------- internals */

  private handlePasswordLine(line: string): ShellOutput {
    const s = this.deps.session;
    const pending = s.pendingAuth!;
    const { world, emit } = this.deps;
    const targetHost = world.host(pending.targetHostId);
    const sourceIp = world.host(s.hostId).ip;
    const fromUser = s.user;
    const success = attemptAuth(world, sourceIp, pending, line, fromUser);

    emit({
      type: 'auth.attempt',
      hostId: s.hostId,
      targetHostId: pending.targetHostId,
      targetUser: pending.targetUser,
      user: s.user,
      success,
    });

    if (success) {
      s.stack.push(pending.fromFrame);
      delete s.pendingAuth;
      enterSession(s, world, pending.targetHostId, pending.targetUser);
      s.lastExit = 0;
      if (pending.method === 'su') return { chunks: [] };
      return { chunks: [{ stream: 'out', text: `Welcome to ${targetHost.hostname}.\n` }] };
    }

    pending.attemptsLeft -= 1;
    if (pending.attemptsLeft <= 0) {
      delete s.pendingAuth;
      s.lastExit = 1;
      const msg = pending.method === 'su' ? 'su: Authentication failure\n' : 'Permission denied (publickey,password).\n';
      return { chunks: [{ stream: 'err', text: msg }] };
    }
    const prompt = pending.method === 'su' ? 'Password: ' : `${pending.targetUser}@${targetHost.hostname}'s password: `;
    return { chunks: [{ stream: 'out', text: prompt }] };
  }

  private makeContext(stdin: string, idOverride?: Identity): CommandContext {
    const { world, session } = this.deps;
    const host = world.host(session.hostId);
    const id = idOverride ?? identityOf(session);
    const resolve = (p: string): string => resolvePath(session.cwd, p);
    return {
      session,
      world,
      host,
      fs: host.fs,
      id,
      stdin,
      resolve,
      readFile: (p: string): string => {
        const abs = resolve(p);
        const text = host.fs.readFile(abs, id);
        this.deps.emit({ type: 'file.read', hostId: host.id, path: abs, user: session.user });
        return text;
      },
      emit: this.deps.emit,
      help: this.help,
      runAs: async (runId: Identity, name: string, args: string[]): Promise<CommandResult> => {
        if (!Object.hasOwn(this.commands, name)) return fail(`sudo: ${name}: command not found`, 127);
        try {
          return await this.commands[name](args, this.makeContext(stdin, runId));
        } catch (e) {
          if (e instanceof FsError) return fail(`sudo: ${name}: ${e.message}`);
          throw e;
        }
      },
    };
  }

  private async runPipeline(
    p: Pipeline,
  ): Promise<{ chunks: Chunk[]; clear: boolean; exitCode: number }> {
    const chunks: Chunk[] = [];
    let stdin = '';
    let last: CommandResult = ok();
    let clear = false;
    for (const cmd of p.commands) {
      const r = await this.runSimple(cmd, stdin);
      if (r.stderr) chunks.push({ stream: 'err', text: r.stderr });
      if (r.clear) clear = true;
      stdin = r.stdout;
      last = r;
    }
    if (last.stdout) chunks.push({ stream: 'out', text: last.stdout });
    return { chunks, clear, exitCode: last.exitCode };
  }

  private async runSimple(cmd: SimpleCommand, stdin: string): Promise<CommandResult> {
    const { session, world } = this.deps;
    const host = world.host(session.hostId);
    const id = identityOf(session);
    const x: ExpandEnv = {
      env: session.env,
      lastExit: session.lastExit,
      cwd: session.cwd,
      fs: host.fs,
      id,
    };

    // Bare assignments: FOO=bar
    if (cmd.words.length > 0 && cmd.words.every(isAssignment)) {
      for (const w of cmd.words) {
        const text = expandWord(w, x)[0] ?? '';
        const eq = text.indexOf('=');
        session.env[text.slice(0, eq)] = text.slice(eq + 1);
      }
      return ok();
    }

    const args = cmd.words.flatMap((w) => expandWord(w, x));

    // Resolve redirects; files are opened (created/truncated) before the command runs.
    let outTarget: RedirTarget | null = null;
    let errTarget: RedirTarget | null = null;
    let mergeErr = false;
    for (const r of cmd.redirects) {
      if (r.op === 'dup') {
        mergeErr = true;
        continue;
      }
      const display = expandWord(r.target, x)[0] ?? '';
      if (display === '') return fail('bash: ambiguous redirect');
      const target: RedirTarget = {
        path: display === '/dev/null' ? null : resolvePath(session.cwd, display),
        append: r.op === '>>',
      };
      if (target.path !== null) {
        try {
          host.fs.writeFile(target.path, '', id, { append: target.append, mtime: world.now });
        } catch (e) {
          if (e instanceof FsError) return fail(`bash: ${display}: ${e.message}`);
          throw e;
        }
      }
      if (r.fd === 1) outTarget = target;
      else errTarget = target;
    }

    if (args.length === 0) return ok();

    const name = args[0];
    const rest = args.slice(1);
    let result: CommandResult;

    if (!Object.hasOwn(this.commands, name)) {
      if (name.includes('/')) {
        const exists = host.fs.exists(resolvePath(session.cwd, name), id);
        result = exists
          ? fail(`bash: ${name}: Permission denied`, 126)
          : fail(`bash: ${name}: No such file or directory`, 127);
      } else {
        result = fail(`bash: ${name}: command not found`, 127);
      }
    } else {
      try {
        result = await this.commands[name](rest, this.makeContext(stdin));
      } catch (e) {
        if (e instanceof FsError) result = fail(`bash: ${name}: ${e.message}`);
        else result = fail(`bash: ${name}: internal error: ${(e as Error).message}`, 70);
      }
    }

    this.deps.emit({
      type: 'command',
      hostId: session.hostId,
      user: session.user,
      name,
      args: rest,
      exitCode: result.exitCode,
    });

    let { stdout, stderr } = result;
    if (mergeErr) {
      stdout += stderr;
      stderr = '';
    }
    const writeTo = (t: RedirTarget, text: string): void => {
      if (t.path === null) return;
      try {
        host.fs.writeFile(t.path, text, id, { append: true, mtime: world.now });
      } catch {
        /* target became unwritable mid-command; ignore */
      }
    };
    if (outTarget) {
      writeTo(outTarget, stdout);
      stdout = '';
    }
    if (errTarget) {
      writeTo(errTarget, stderr);
      stderr = '';
    }
    return { ...result, stdout, stderr };
  }
}
