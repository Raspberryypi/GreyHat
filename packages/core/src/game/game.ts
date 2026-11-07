import { Emitter } from '../emitter';
import type { GameEvent } from '../events';
import { MissionRuntime } from '../missions/runtime';
import type { MissionDef, MissionRole } from '../missions/types';
import { createRng } from '../rng';
import { createSession } from '../shell/session';
import { Shell } from '../shell/shell';
import type { Chunk, Session, ShellOutput } from '../shell/types';
import { buildWorld, type World } from '../world/world';
import { createGameCommands } from './commands';

export interface ObjectiveView {
  id: string;
  text: string;
  done: boolean;
}

export interface GameSnapshot {
  missionId: string;
  title: string;
  role: MissionRole;
  difficulty: number;
  briefing: string[];
  objectives: ObjectiveView[];
  hintsUsed: number;
  hintsTotal: number;
  completed: boolean;
  /** XP earned (0 until completed). */
  xp: number;
  potentialXp: number;
  debrief: string[];
}

export interface PromptParts {
  user: string;
  host: string;
  cwd: string;
  symbol: string;
}

/** One playthrough of one mission: world + session + shell + objective tracking. */
export class Game {
  readonly world: World;
  readonly session: Session;
  readonly shell: Shell;
  readonly runtime: MissionRuntime;
  readonly onChange = new Emitter<GameSnapshot>();

  private notices: string[] = [];
  private announced = false;
  private snap: GameSnapshot;

  constructor(
    readonly mission: MissionDef,
    readonly seed: number = Date.now() % 2147483647,
  ) {
    const rng = createRng(seed);
    this.world = buildWorld(mission.world, rng);
    this.session = createSession(this.world, mission.start.hostId, mission.start.user, mission.start.cwd);
    this.runtime = new MissionRuntime(mission);
    const { commands, help } = createGameCommands(this);
    this.shell = new Shell({
      world: this.world,
      session: this.session,
      emit: (e) => this.dispatch(e),
      extraCommands: commands,
      extraHelp: help,
    });
    this.snap = this.computeSnapshot();
  }

  /** Cached snapshot (stable reference; safe for useSyncExternalStore). */
  getSnapshot(): GameSnapshot {
    return this.snap;
  }

  computeSnapshot(): GameSnapshot {
    const r = this.runtime;
    const m = this.mission;
    const complete = r.isComplete();
    return {
      missionId: m.id,
      title: m.title,
      role: m.role,
      difficulty: m.difficulty,
      briefing: m.briefing,
      objectives: m.objectives.map((o) => ({ id: o.id, text: o.text, done: r.isDone(o.id) })),
      hintsUsed: r.hintsUsed,
      hintsTotal: m.hints.length,
      completed: complete,
      xp: complete ? r.earnedXp() : 0,
      potentialXp: m.xp,
      debrief: complete ? m.debrief : [],
    };
  }

  promptParts(): PromptParts {
    const s = this.session;
    const host = this.world.host(s.hostId);
    const home = s.env.HOME;
    let cwd = s.cwd;
    if (home && home !== '/' && (cwd === home || cwd.startsWith(home + '/'))) {
      cwd = '~' + cwd.slice(home.length);
    }
    return { user: s.user, host: host.hostname, cwd, symbol: s.user === 'root' ? '#' : '$' };
  }

  banner(): Chunk[] {
    const m = this.mission;
    return [
      { stream: 'sys', text: 'GREYHAT // simulated security training environment\n' },
      { stream: 'sys', text: `Mission ${m.id}: ${m.title}\n\n` },
      { stream: 'out', text: m.briefing.join('\n') + '\n\n' },
      {
        stream: 'out',
        text: "Type 'help' for commands, 'mission' for objectives, 'hint' if you are stuck.\n\n",
      },
    ];
  }

  async run(line: string): Promise<ShellOutput> {
    if (!line.trim()) return { chunks: [] };
    this.world.advance(1000);
    const out = await this.shell.exec(line);
    const notices = this.notices.splice(0);
    this.refresh();
    return {
      ...out,
      chunks: [...out.chunks, ...notices.map((text): Chunk => ({ stream: 'sys', text: text + '\n' }))],
    };
  }

  private refresh(): void {
    this.snap = this.computeSnapshot();
    this.onChange.emit(this.snap);
  }

  private dispatch(e: GameEvent): void {
    const newly = this.runtime.handle(e);
    for (const o of newly) this.notices.push(`[+] Objective complete: ${o.text}`);
    if (!this.announced && this.runtime.isComplete()) {
      this.announced = true;
      this.notices.push('');
      this.notices.push(`[*] MISSION COMPLETE: ${this.mission.title}  (+${this.runtime.earnedXp()} XP)`);
      this.notices.push('');
      for (const line of this.mission.debrief) this.notices.push(line);
    }
  }
}
