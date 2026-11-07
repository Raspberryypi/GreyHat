import type { Identity, VirtualFS } from '../fs/vfs';
import type { GameEvent } from '../events';
import type { Host, World } from '../world/world';

export interface Session {
  hostId: string;
  user: string;
  groups: string[];
  cwd: string;
  env: Record<string, string>;
  lastExit: number;
}

/** One piece of terminal output. `sys` is game/system messaging (objectives, hints). */
export interface Chunk {
  stream: 'out' | 'err' | 'sys';
  text: string;
}

export interface ShellOutput {
  chunks: Chunk[];
  /** True when the terminal screen should be cleared. */
  clear?: boolean;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  clear?: boolean;
}

export interface CommandContext {
  session: Session;
  world: World;
  host: Host;
  fs: VirtualFS;
  id: Identity;
  stdin: string;
  /** Resolve a user-supplied path against the current directory. */
  resolve(path: string): string;
  /** Read a file as the current user. Emits a `file.read` event. Throws FsError. */
  readFile(path: string): string;
  emit(event: GameEvent): void;
  /** Command name -> one-line description (for `help`). */
  help: Record<string, string>;
}

export type CommandFn = (args: string[], ctx: CommandContext) => CommandResult | Promise<CommandResult>;
export type CommandRegistry = Record<string, CommandFn>;
