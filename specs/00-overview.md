# factorai — Overview

## What we're building

**An ADE — an Agentic Development Environment.** One place to build software
with agents, rather than an editor with an agent bolted into a pane.

An IDE is arranged around a cursor: it opens files one at a time, and the
process running your agent is a rectangle at the bottom of the screen. That
arrangement assumes the human is the one typing. When the agent writes most of
the code, the assumption is wrong and everything built on top of it is subtly
in the way.

So the unit of work here is a **session**, not a file. Agents are long-lived
processes you launch, watch, resume and kill. Reading code is something you do
to *check on* the work, which is why it sits beside the terminal instead of in
place of it.

## The operating model

**Agents are at the centre. The human supervises, decides, reviews, and sets
the rules agents run under.** That sentence is the product, and it is meant to
be load-bearing rather than a slogan — each of those four verbs is a surface,
and how well each is served is a fair way to judge any proposed feature.

| The human… | Served today by |
| ---------- | --------------- |
| **Supervises** | Per-session status — running / idle / waiting-for-input / stopped — surfaced in the sidebar, tabs and project rows (F16, F5). Nothing important happens off-screen. |
| **Decides** | The app refuses to make irreversible calls on your behalf: closing a tab kills a session and asks first, quitting with live sessions asks (ADR-0005), restarting to update asks (F14). |
| **Reviews** | The `Changes` panel, diff viewer and tree decorations (F13, F12). Read-only **on purpose** — ADR-0009 — because the agent writes and the human checks. |
| **Sets the rules** | `CLAUDE.md` and `.claude/plans/` per project (F9). |

The fourth row is the thin one, and saying so is the point of the table: **F9
is the only place the human edits the rules an agent runs under, and it is the
one thing in this list that isn't built yet** (roadmap item 2). Under the old
"session browser" framing it read as a nice-to-have file editor. Under this
one it is the human's only lever on agent behaviour, which is a different
priority argument entirely.

**A tension worth naming rather than resolving here.** "A unified platform to
build software with agents" and "specifically the official `claude` CLI's
session files" (see Non-goals) are not obviously the same product. Everything
built so far reads `~/.claude/`, and nothing about the ADE framing on its own
justifies widening that — but the two will have to be reconciled eventually,
and pretending they already agree would hide the decision.

## Where this started

Modeled originally on [doctly/switchboard](https://github.com/doctly/switchboard),
rebuilt on a modern Rust + TypeScript stack (Tauri 2, React 19, Biome,
Turborepo, pnpm). That lineage explains the shape of the session browser and
little else; the comparison table below is kept as history, not as a target.

## Identity

| Field          | Value                          |
| -------------- | ------------------------------ |
| Product name   | `factorai`                     |
| App identifier | `dev.factorai`                 |
| Window title   | `factorai` (`factorai DEV` in a debug build) |
| pnpm scope     | `@factorai/*`                  |
| Rust crate     | `factorai` (lib `factorai_lib`)|

We deliberately **do not** brand this as "switchboard" — it is its own product
that happens to start from the same problem space.

**The version fields in the repo all say `0.1.0` and that is not drift.** The
git tag is the single source of truth: `release.yml` rewrites
`apps/desktop/package.json`, `tauri.conf.json` and `src-tauri/Cargo.toml` from
`$GITHUB_REF_NAME` at build time and commits nothing back. There is no bump
commit to forget and no way for a tag to disagree with a file. Read the version
off the tags — `git tag --sort=-v:refname | head -1` — not off the tree.

## MVP scope (in)

| Capability              | What it means                                                   |
| ----------------------- | --------------------------------------------------------------- |
| Project list            | Folders found under `~/.claude/projects/`, decoded to real paths |
| Session browser         | List sessions per project; metadata (title, last activity, turn count) |
| Full-text search        | Search across all sessions by message content                   |
| Embedded terminal       | xterm.js in webview, PTY in Rust, one tab per session           |
| Launch / resume         | `claude --session-id <id>` for a new session, `--resume <id>` for an existing one (ADR-0008) |
| File preview side panel | Open a file in Monaco with syntax highlighting (ADR-0007)        |
| Diff viewer             | Inline + side-by-side diff for a file change (read-only initially) |
| Plans / CLAUDE.md       | Browse and edit `CLAUDE.md` and `.claude/plans/*.md` per project|
| SQLite cache            | Session index, search index (FTS5), settings                    |
| Status indicators       | running / idle / waiting-for-input / stopped per session terminal |
| Auto-naming             | Pick up session names produced by Claude's `/rename` command    |

## Explicitly dropped from MVP

These are the "trickiest" pieces from switchboard. Each gets a stub in
`07-open-questions.md` for a possible follow-up.

| Dropped                          | Why                                                          |
| -------------------------------- | ------------------------------------------------------------ |
| MCP / IDE emulator               | Implementing a WebSocket-based MCP server that impersonates an editor for Claude CLI is a project on its own. Dropped from the MVP, but **no longer deferred** — it graduated into `roadmap/TODO.md` item 19 on 2026-08-15, because the operating model above makes it the *push* half of review. |
| Scheduler (`schedule-runner`)    | Cron-style session runs add a lot of surface; not core to the browse/manage loop. |
| Grid overview (live multi-PTY)   | Single-session focus is enough for v1. Multi-PTY rendering is expensive in the webview. |
| Activity heatmap                 | Nice-to-have. Easy to add later from the cached session index. |
| ~~Auto-updates~~ **shipped**     | Was deferred; landed 2026-08-14 on `tauri-plugin-updater` (F14, ADR-0010). |
| Claude OAuth helper              | Use the user's existing `claude` login. We don't reimplement `claude-auth.js`. |
| Launch-in-external-terminal      | Embedded xterm is the only path for MVP. External terminal action is a deferred feature. |
| Windows support                  | macOS and Linux only for v1. Drops a class of PTY/path-encoding edge cases from the critical path. |

## Source vs rebuild — quick diff

| Layer        | switchboard            | factorai                                                   |
| ------------ | ---------------------- | ---------------------------------------------------------- |
| Shell        | Electron 41            | Tauri 2 (Rust)                                             |
| Renderer     | Vanilla HTML/CSS/JS    | React 19 + TanStack Router (hash) + TanStack Query         |
| Styling      | Hand-rolled CSS        | Tailwind v4 + shadcn-style primitives in `@factorai/ui`    |
| State        | DOM + ad-hoc modules   | Zustand stores                                             |
| Lang         | JavaScript             | TypeScript strict, Biome (lint + format)                   |
| DB           | better-sqlite3         | rusqlite (bundled, with FTS5)                              |
| PTY          | node-pty               | `portable-pty` (Rust) — works on macOS/Linux/Windows       |
| Editor       | CodeMirror 6 (bundled) | Monaco via npm in renderer (ADR-0007)                      |
| IPC          | Electron preload bridge| Tauri commands + events                                    |
| Build        | electron-builder       | `tauri build` via `pnpm` + Turborepo                       |
| Tooling      | npm + esbuild          | pnpm 10 + Turbo 2 + Biome 1.9 + syncpack + knip + mise     |

## Non-goals

- We are **not** trying to maintain feature compatibility with switchboard
  releases. Where switchboard made a UX choice we'd undo, we undo it.
- We are **not** building a Claude alternative or a multi-provider session
  manager. This is specifically for the official `claude` CLI session files.
  (See the tension named under "The operating model" — this holds until it is
  deliberately revisited, not by drift.)
- We are **not** shipping cloud sync or accounts. Everything is local.
- We are **not** taking decisions away from the human to look autonomous. An
  ADE where the agent is central is not one where the human is absent: every
  irreversible action keeps its confirmation, and "the agent already did it"
  is never a reason to skip asking.
