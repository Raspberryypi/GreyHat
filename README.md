# GreyHat

A browser-based cybersecurity practice game. You work missions inside a **fully simulated**
environment (fake hosts, filesystems, logs). Nothing ever touches a real system or network.

## Run it

```bash
npm install
npm test          # engine + mission tests (runs every mission's reference solution)
npm run dev       # http://localhost:5173
```

Requires Node 20+.

## Layout

```
packages/
  core/      headless simulation engine (no DOM): VFS, shell, world, missions, game
  content/   missions + log generators (data, no engine code)
apps/
  web/       React + Vite + xterm.js UI
```

### Core (`@greyhat/core`)

| Module | Purpose |
|---|---|
| `fs/vfs.ts` | Virtual filesystem with owners, groups, permission bits (incl. setuid), JSON-serialisable |
| `shell/parser.ts` | Tokenizer + parser: quotes, pipes, `&& \|\| ;`, `> >> 2> 2>&1` |
| `shell/expand.ts` | `~`, `$VAR`, `$?`, globbing |
| `shell/shell.ts` | Executor, redirects, tab completion |
| `commands/*` | ls cd cat find grep awk sort uniq cut wc head tail ... |
| `world/world.ts` | Hosts, users, simulated clock; builds worlds from specs |
| `missions/*` | Objective checks driven by simulation events |
| `game/game.ts` | One playthrough: world + session + shell + objectives |
| `save.ts` | `StorageAdapter` interface so a backend can replace localStorage later |

Everything the player does emits a `GameEvent` (`command`, `file.read`, `cwd`, `answer.submitted`).
Objectives are pure checks over those events. The future live adversary will use the same bus.

## Adding a mission

Create `packages/content/src/missions/mXXX-name.ts` exporting a `MissionDef`, then add it to
`packages/content/src/index.ts`. A mission declares:

- `world`: hosts, users, and a filesystem (static, or a function of the seeded RNG so logs can be generated)
- `objectives`: `fileRead`, `commandRun`, `cwdIs`, or `answer` checks
- `hints`, `debrief` (always include the defensive takeaway)
- `solution`: shell lines CI replays to prove the mission is solvable

`missions.test.ts` automatically tests every mission you add.

## Shell limitations (v1)

No `$(...)`, background jobs, or heredocs. Globs work in the last path component only.
`grep` uses JS regex syntax (BRE `\|` is translated). `awk` supports only
`/regex/ { print $1, $NF, "text" }` with `-F`.

## Roadmap

1. Network model: `nmap`, `ping`, `ssh` between hosts
2. Offense tools and a vulnerability model (preconditions -> effects)
3. Defense tools: `iptables`-lite, service hardening, `journalctl`
4. Web Worker scripting layer with an `ns`-style API
5. Live NPC adversary driven by the same vulnerability model
6. Persistent home network, progression, unlockable tools
