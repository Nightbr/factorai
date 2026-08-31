# Contributing

factorai is Tauri 2 (Rust) + React 19 + TypeScript in a pnpm/Turborepo
monorepo, with Biome as the single lint/format gate. macOS and Linux only.

This page is the practical half: how to build it and how to check your work.
The rules the project actually runs under live in
**[AGENTS.md](AGENTS.md)** — read that before opening a pull request. It
applies to humans and coding agents alike; `CLAUDE.md` is a symlink to it.

## Prerequisites

- [mise](https://mise.jdx.dev/) for the toolchain — Node 24, pnpm 10, Rust
  stable. `mise install` reads `.mise.toml`.
- The [Tauri 2 system dependencies](https://tauri.app/start/prerequisites/).
  On Linux that is WebKitGTK 4.1 and friends.
- The [Claude Code CLI](https://claude.com/claude-code), authenticated, if you
  want to run sessions rather than just look at them.

## Build and run

```bash
git clone git@github.com:Nightbr/factorai.git
cd factorai
mise install
pnpm install
pnpm dev            # tauri dev — the full app
```

To produce a bundle (`.dmg` on macOS, `.AppImage` on Linux):

```bash
cd apps/desktop && pnpm tauri build
```

## Checks

Run all of these green before calling something done. The order matters —
`--frozen-lockfile` leads because it is what CI runs first and what nothing
local reproduces. `.claude/skills/quality-gate/SKILL.md` explains why each one is in the list; most of
them were added after the thing they catch had already broken `main`.

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
pnpm deps:check
pnpm deps:unused
cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

`pnpm format` (Biome, whole repo) and `cargo fmt` are the two fixers.
CI runs all of the above except `e2e`, on every PR and every push to `main`.

## Testing lanes

Tests live next to the code: `src/lib/foo.test.ts` beside `src/lib/foo.ts`,
`#[cfg(test)] mod tests` in-module on the Rust side, `tests/foo_integration.rs`
for cross-module Rust tests.

**Playwright** (`pnpm e2e`) runs against `pnpm vite:dev` — the renderer in
browser-only mode, no Tauri. The renderer detects that through `isTauri()` in
`lib/tauri.ts` and falls back to `mockInvoke()`, which is what makes the lane
possible without a backend. Tests inject state with
`installMockBridge(page, fixture)` before `page.goto(...)`. `pnpm e2e:ui` opens
the interactive runner.

**`scripts/qa/`** drives the real window for boot-level checks — launch,
screenshot, kill. Read [its README](scripts/qa/README.md) before using it: it
targets the *dev* build specifically, and the safety rules there exist because
a stale window origin once put a synthetic click into an unrelated app.

## Where things are written down

| | |
|---|---|
| [`AGENTS.md`](AGENTS.md) | how work is done here — setup, code style, the checks, commits, scope |
| [`.claude/rules/`](.claude/rules/) | the traps in one area of the tree, loaded by Claude Code when you edit it |
| [`.claude/skills/`](.claude/skills/) | the long form, one file per task — the gate, the spec/ADR workflow, conventions, the test lanes, QA |
| [`specs/`](specs/) | the design source of truth: architecture, the command surface, feature-by-feature behaviour |
| [`specs/roadmap/`](specs/roadmap/) | what is next in priority order, and a dated log of what shipped |
| [`docs/adr/`](docs/adr/) | decisions and why, including superseded ones |
| [`specs/09-branding.md`](specs/09-branding.md) | the mark, the palette, and how the icons are regenerated |

Specs lead and code follows: if the two disagree, fix whichever is wrong before
writing the change. If you change the contract — a new command, a new event, a
renamed field — update the spec in the same commit.
