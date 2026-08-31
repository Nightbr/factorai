# AGENTS.md — factorai

Instructions for anyone working in this repo, human or agent. `CLAUDE.md` is a
symlink to this file.

## Project overview

factorai is an **ADE — an Agentic Development Environment**: one place to build
software with agents, rather than an editor with an agent bolted into a pane.
The unit of work is a **session**, not a file.

**Agents are at the centre; the human supervises, decides, reviews, and sets the
rules agents run under.** Those four verbs are the product, and they are a usable
test when weighing a change: which one does this serve, and does it take any of
them away from the human? An ADE where the agent is central is *not* one where
the human is absent — every irreversible action keeps its confirmation, and "the
agent already did it" is never a reason to skip asking.

Tauri 2 (Rust) + React 19 + TypeScript, pnpm monorepo, Biome, Turborepo. macOS
and Linux only for v1. Layout: `apps/desktop` (renderer + `src-tauri`),
`packages/ui` (shadcn-style primitives), `packages/types` (cross-boundary types),
`tests/smoke` (Playwright).

## Setup

```bash
pnpm install
pnpm dev                  # tauri dev — the full app
```

Inside `apps/desktop`: `pnpm vite:dev` runs the renderer alone with a mocked
Tauri bridge; `pnpm tauri build` produces `.app` / `.dmg` / `.AppImage`.

## Before you start

1. Read the relevant spec under `specs/` end-to-end. Specs are the contract for
   behaviour; `DESIGN.md` is the contract for the visual system.
2. Check `docs/adr/` for decisions that constrain the approach. Don't relitigate
   a decided ADR — supersede it with a new one.
3. If a spec is wrong or stale, fix the spec first, then write the code.
4. Start from an up-to-date `main`: `git fetch origin && git status`, and pull if
   you are behind.

## Code style

- Biome owns formatting and linting for JS/TS/CSS; `rustfmt` owns Rust. Neither
  is reviewed by hand. Fixers: `pnpm format`, `cargo fmt`.
- TypeScript is `strict`, with `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`. Biome sets `noExplicitAny`, `noUnusedImports`,
  `noUnusedVariables` to error. Clippy runs with `-D warnings`.
- **Never** `as any`, `#[allow(...)]`, or `// biome-ignore` to silence a real
  warning. A genuinely warranted `#[allow(...)]` carries a comment saying why.
- **Never** `unwrap()` outside `setup()`. `anyhow` inside command bodies,
  `thiserror` `AppError` at the command boundary.
- Cross-boundary types live in `packages/types`, hand-mirrored between Rust
  (`#[serde(rename_all = "camelCase")]`) and TypeScript. No code generation.
- Use the primitives in `@factorai/ui` (`Input`, `Button`, `Select`); icon-only
  controls use `IconButton`. No raw `<input>` / `<button>` / `<select>` in app
  code.
- **No HTML5 drag-and-drop** — it cannot work in this shell. Use dnd-kit
  (ADR-0016), and ship a keyboard path beside the drag.
- Zustand for client state, TanStack Query for command results. PTY data never
  goes through React state — it streams from events into xterm.
- No emojis in code or commits unless a user asks.
- Code comments cite `specs/`, an ADR or `DESIGN.md` — never this file,
  `.claude/rules/` or `.claude/skills/`. Those are instructions for whoever is
  working, not contracts the code is written against, and a comment pointing at
  one is a dangling reference the next reorganisation creates silently.

## Testing

Tests live next to the code: `src/lib/foo.test.ts` beside `src/lib/foo.ts`;
`tests/foo_integration.rs` for cross-module Rust tests, `#[cfg(test)] mod tests`
in-module. Playwright smoke tests are in `tests/smoke/`, tagged `@smoke`.

Run all of these green before calling a task done, in this order:

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

Every one of them was added after the thing it catches had already broken
`main`; `.claude/skills/quality-gate/SKILL.md` records which and why.
`.github/workflows/quality.yml` runs all of it except `pnpm e2e` on every PR and
push to `main`.

For UI or behaviour work, also launch the app and use the feature in the real
window. Type checking does not validate UX.

## Commits

- Work on `main`. No PR ceremony for solo work. Branch when several agents are
  pairing on one area, and say so in the roadmap entry you are working from.
- Small slices — one Red→Green step or one feature step. Prefix `feat:`, `fix:`,
  `refactor:`, `test:`, `docs:`, `chore:`.
- **Never `--no-verify`.** If a hook blocks the commit, fix the cause.
- Push small and often; a commit sitting unpushed is a conflict accruing
  interest.
- Change the contract (new command, new event, renamed field) and the spec is
  updated in the same commit. Make a decision worth recording and the ADR lands
  in the same commit — `NNNN-kebab-case-title.md`, context / decision /
  consequences, immutable once written.
- Kill-on-quit is non-optional: no orphan zombies, ever.

## What this project does not do

No Windows in v1. No telemetry, analytics or crash reporting. No localization.
No code generation for Tauri bindings. No CodeScene / Codacy / SonarQube — Biome
plus `tsc` plus clippy is the floor. No Claude OAuth helper. No mock data baked
into the renderer.

## Where the details live

| | |
|---|---|
| [`specs/`](specs/) | behaviour, the command surface, feature by feature |
| [`DESIGN.md`](DESIGN.md) | palette, type scale, density, elevation, named rules |
| [`PRODUCT.md`](PRODUCT.md) | who this is for and what may not change |
| [`docs/adr/`](docs/adr/) | decisions and why, including superseded ones |
| [`specs/roadmap/`](specs/roadmap/) | what is next, and a dated log of what shipped |
| `.claude/rules/` | the traps in a given area, loaded when you edit it |
| `.claude/skills/` | the long form: the gate, the test lanes, QA, screenshots |

Spec and code disagree — fix whichever is wrong, usually the spec, before
writing anything.

Immutable ADRs and `DONE.md` entries cite the section numbers this file used to
have: § 1 is now "Project overview", § 2a/2b "Before you start" and "Commits",
§ 2c/3 "Testing" and "Code style", § 2d/2e the `smoke-tests` and `manual-qa`
skills, § 4 "Code style" plus `.claude/rules/frontend.md` and `rust.md`, § 5/6
the `spec-and-adr-workflow` skill, § 8 "What this project does not do".
