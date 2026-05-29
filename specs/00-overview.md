# factorai — Overview

## What we're building

A desktop command center for Claude Code CLI sessions, modeled on
[the prior app](https://github.com/example/repo) but rebuilt on a
modern Rust + TypeScript stack (Tauri 2, React 19, Biome, Turborepo, pnpm).

The product is a unified GUI for everything that lives in
`~/.claude/projects/`: browsing past sessions, searching their content,
resuming them, launching new ones into an embedded terminal, and
previewing files Claude touched.

## Identity

| Field          | Value                          |
| -------------- | ------------------------------ |
| Product name   | `factorai`                     |
| App identifier | `dev.factorai`                 |
| Window title   | `factorai`                     |
| pnpm scope     | `@factorai/*`                  |
| Rust crate     | `factorai` (lib `factorai_lib`)|

We deliberately **do not** brand this as "the prior app" — it is its own product
that happens to start from the same problem space.

## MVP scope (in)

| Capability              | What it means                                                   |
| ----------------------- | --------------------------------------------------------------- |
| Project list            | Folders found under `~/.claude/projects/`, decoded to real paths |
| Session browser         | List sessions per project; metadata (title, last activity, turn count) |
| Full-text search        | Search across all sessions by message content                   |
| Embedded terminal       | xterm.js in webview, PTY in Rust, one tab per session           |
| Launch / resume         | Start `claude` or `claude --resume <id>` in the terminal        |
| File preview side panel | Open a file in CodeMirror with syntax highlighting              |
| Diff viewer             | Inline + side-by-side diff for a file change (read-only initially) |
| Plans / CLAUDE.md       | Browse and edit `CLAUDE.md` and `.claude/plans/*.md` per project|
| SQLite cache            | Session index, search index (FTS5), settings                    |
| Status indicators       | running / stopped / busy per session terminal                   |
| Auto-naming             | Pick up session names produced by Claude's `/rename` command    |

## Explicitly dropped from MVP

These are the "trickiest" pieces from the prior app. Each gets a stub in
`07-open-questions.md` for a possible follow-up.

| Dropped                          | Why                                                          |
| -------------------------------- | ------------------------------------------------------------ |
| MCP / IDE emulator               | Implementing a WebSocket-based MCP server that impersonates an editor for Claude CLI is a project on its own. Defer until v2. |
| Scheduler (`schedule-runner`)    | Cron-style session runs add a lot of surface; not core to the browse/manage loop. |
| Grid overview (live multi-PTY)   | Single-session focus is enough for v1. Multi-PTY rendering is expensive in the webview. |
| Activity heatmap                 | Nice-to-have. Easy to add later from the cached session index. |
| Auto-updates (electron-updater)  | Replace later with `tauri-plugin-updater` once we publish releases. |
| Claude OAuth helper              | Use the user's existing `claude` login. We don't reimplement `claude-auth.js`. |
| Launch-in-external-terminal      | Embedded xterm is the only path for MVP. External terminal action is a deferred feature. |
| Windows support                  | macOS and Linux only for v1. Drops a class of PTY/path-encoding edge cases from the critical path. |

## Source vs rebuild — quick diff

| Layer        | the prior app            | factorai                                                   |
| ------------ | ---------------------- | ---------------------------------------------------------- |
| Shell        | Electron 41            | Tauri 2 (Rust)                                             |
| Renderer     | Vanilla HTML/CSS/JS    | React 19 + TanStack Router (hash) + TanStack Query         |
| Styling      | Hand-rolled CSS        | Tailwind v4 + shadcn-style primitives in `@factorai/ui`    |
| State        | DOM + ad-hoc modules   | Zustand stores                                             |
| Lang         | JavaScript             | TypeScript strict, Biome (lint + format)                   |
| DB           | better-sqlite3         | rusqlite (bundled, with FTS5)                              |
| PTY          | node-pty               | `portable-pty` (Rust) — works on macOS/Linux/Windows       |
| Editor       | CodeMirror 6 (bundled) | CodeMirror 6 via npm in renderer                           |
| IPC          | Electron preload bridge| Tauri commands + events                                    |
| Build        | electron-builder       | `tauri build` via `pnpm` + Turborepo                       |
| Tooling      | npm + esbuild          | pnpm 10 + Turbo 2 + Biome 1.9 + syncpack + knip + mise     |

## Non-goals

- We are **not** trying to maintain feature compatibility with the prior app
  releases. Where the prior app made a UX choice we'd undo, we undo it.
- We are **not** building a Claude alternative or a multi-provider session
  manager. This is specifically for the official `claude` CLI session files.
- We are **not** shipping cloud sync or accounts. Everything is local.
