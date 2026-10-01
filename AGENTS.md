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

Tauri 2 (Rust) + React 19 + TypeScript, pnpm monorepo, oxlint + oxfmt,
Turborepo. macOS and Linux only for v1. Layout: `apps/desktop` (renderer +
`src-tauri`), `apps/docs` (the site: Docusaurus, the hero and later the guide,
ADR-0051), `packages/ui` (shadcn-style primitives), `packages/types`
(cross-boundary types), `tests/smoke` (Playwright).

## Setup

```bash
pnpm install
pnpm dev                  # tauri dev — the full app
```

Inside `apps/desktop`: `pnpm vite:dev` runs the renderer alone with a mocked
Tauri bridge; `pnpm tauri build` produces `.app` / `.dmg` / `.AppImage`.
The site is `mise run docs` (or `pnpm --filter @factorai/docs start`), on port
3210; it is deliberately not part of `pnpm dev`.

## Before you start

1. Read the relevant spec under `specs/` end-to-end. Specs are the contract for
   behaviour; `DESIGN.md` is the contract for the visual system.
2. Check `specs/adr/` for decisions that constrain the approach. Don't relitigate
   a decided ADR — supersede it with a new one.
3. If a spec is wrong or stale, fix the spec first, then write the code.
4. Start from an up-to-date `main`, on a branch in its own worktree:
   `git fetch origin && git worktree add ../factorai-<slug> -b <type>/<slug> origin/main`.
   Several sessions share this checkout, so never switch its branch in place.

## Code style

- oxfmt owns formatting and oxlint owns linting for JS/TS/CSS; `rustfmt` owns
  Rust. Neither is reviewed by hand. Fixers: `pnpm format`, `cargo fmt`.
- TypeScript is `strict`, with `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`. oxlint sets `typescript/no-explicit-any` and
  `no-unused-vars` to error. Clippy runs with `-D warnings`.
- **Never** `as any`, `#[allow(...)]`, or `// oxlint-disable` to silence a real
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
**Data fixtures a test reads from disk go in `tests/fixtures/`**, whichever lane
uses them — binary media, sample documents, anything that is content rather than
code. A new kind of binary asset there also needs its extension named in
`scripts/check-text-bytes.mjs`, which fails closed.

Run all of these green before calling a task done, in this order:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm bytes:check
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

## Branches, commits and PRs

**Every change reaches `main` through a pull request** (ADR-0070). `main` has
rulesets, and a direct push is refused for everyone, the owner included. The
`pull-requests` skill has the commands.

- **One branch per task, in its own worktree.** Name it `<type>/<slug>`, with
  the issue number in the slug when there is one.
- **Small commits on it**, one Red→Green step or one feature step each. Prefix
  them `feat:`, `fix:`, `refactor:`, `test:`, `docs:` or `chore:`.
- **One PR per slice**, opened early (as a draft while unfinished) and citing
  its issue with `Closes #N`. A branch nobody can see is a conflict accruing
  interest.
- **The PR title is the commit on `main`.** PRs are squash-merged, so the title
  carries the prefix, and `feat:` / `fix:` titles become the release notes.
- **The body follows the template**, and **a PR that changes the app carries
  screenshots or a video of it**, from a fabricated workspace.
  `gh pr create --attach` uploads them. A PR with no app change (docs, CI, an
  invisible refactor) says "No app change" instead. Gotchas worth keeping go
  under "Notes for the reviewer".
- **Merging.** The owner's PRs, this repo's own sessions included, arm
  `gh pr merge --auto --squash` and merge once Quality is green. Anyone else's
  PR waits for a maintainer's approval. Red CI is fixed on the branch, never
  merged around.
- **Never `--no-verify`.** If a hook blocks the commit, fix the cause.
- Change the contract (new command, new event, renamed field) and the spec is
  updated in the same PR. Make a decision worth recording and the ADR lands in
  the same PR: `NNNN-kebab-case-title.md`, context / decision / consequences,
  immutable once written.
- Kill-on-quit is non-optional: no orphan zombies, ever.

## What this project does not do

No native Windows port: Windows runs the Linux build inside WSL 2 under WSLg
(ADR-0044), there is no `windows-msvc` target, and anything that must differ
inside WSL is a runtime branch in `services/wsl.rs` rather than a `#[cfg]`. No
ARM64 Windows. No telemetry, analytics or crash reporting in the app — the
site's cookieless page counts are ADR-0063 and stop there. No localization. No
code generation for Tauri bindings. No CodeScene / Codacy / SonarQube — oxlint
plus `tsc` plus clippy is the floor. No Claude OAuth helper. No mock data baked
into the renderer.

## Where the details live

| | |
|---|---|
| [`specs/`](specs/) | behaviour, the command surface, feature by feature |
| [`DESIGN.md`](DESIGN.md) | palette, type scale, density, elevation, named rules |
| [`PRODUCT.md`](PRODUCT.md) | who this is for and what may not change |
| [`specs/adr/`](specs/adr/) | decisions and why, including superseded ones |
| [`assets/`](assets/) | the brand masters (`brand/`) and the README screenshots (`images/`) |
| [the roadmap Project](https://github.com/users/Nightbr/projects/1) | what is next: issues on a kanban, *Todo* in priority order |
| [`specs/roadmap/`](specs/roadmap/) | the old item numbers mapped to issues, and the frozen log of what shipped before 2026-10-01 |
| `.claude/rules/` | the traps in a given area, loaded when you edit it |
| `.claude/skills/` | the long form: PRs, the gate, the test lanes, QA, screenshots |

Spec and code disagree — fix whichever is wrong, usually the spec, before
writing anything.

Immutable ADRs and `DONE.md` entries cite the section numbers this file used to
have: § 1 is now "Project overview", § 2a/2b "Before you start" and "Branches,
commits and PRs",
§ 2c/3 "Testing" and "Code style", § 2d/2e the `smoke-tests` and `manual-qa`
skills, § 4 "Code style" plus `.claude/rules/frontend.md` and `rust.md`, § 5/6
the `spec-and-adr-workflow` skill, § 8 "What this project does not do".
