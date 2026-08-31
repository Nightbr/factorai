---
name: quality-gate
description: The full check list a task must pass before it is done — pnpm install/format/lint/typecheck/test/e2e/deps + cargo fmt/clippy/test — and why each check is in it. Use before declaring any task complete, when a gate command fails, or when adding a new check.
---

# The gate

Run, in this order, all green:

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

For UI / behaviour work, also: launch the app (`pnpm dev`) and **use the
feature** in the actual window. Type checking does not validate UX.
Screenshots in a commit are great.

## Why each check is in the list

**`--frozen-lockfile` leads because it is the one CI runs first and the one
nothing local reproduces**, added 2026-08-17 after it broke `main`. `pnpm
deps:fix` rewrites `package.json` to the exact version this repo pins to and
does **not** touch `pnpm-lock.yaml`, so the two disagree and a frozen install
refuses the tree. Neither of the checks below catches it: `deps:check` compares
`package.json` files to each other and is satisfied by the pin, and a developer
who already has `node_modules` never does a frozen install at all. It costs a
second when nothing has changed. If it fails, `pnpm install` is the fix, and the
lockfile it rewrites is part of the commit.

`deps:check` is in that list because it wasn't: a `@tauri-apps/plugin-updater`
caret drifted in with F14 and sat there failing for a day, in a repo that
otherwise pins exact versions. A check nobody runs is a check that doesn't
exist. `pnpm deps:fix` resolves the usual case.

**Formatting is gated as of 2026-08-16, both sides**, and the two fixers are
`pnpm format` (biome, whole repo) and `cargo fmt`. It is in the list for the
same reason `deps:check` is: the repo was *not* format-clean, in 32 JS/TS/CSS
files and 16 Rust ones, and nothing said so. Two consequences of that had
already cost time and are now gone:

- `pnpm format` used to run `biome format --write src` in each of three
  packages, so `tests/`, `knip.js` and every root config file were never
  formatted at all — and running it rewrote all of `packages/ui`, burying
  whatever you were actually changing. It is now one root command over the
  whole tree, and the vendored shadcn files have been formatted into house
  style once so they stop being a landmine.
- Rust has a `rustfmt.toml` (`hard_tabs`, `max_width = 100`,
  `use_small_heuristics = "Max"`) written to match the code that was already
  there — see its own comment for why that third setting is the load-bearing
  one.

Note `biome format` caps output at 20 diagnostics by default, which is how a
32-file backlog can read as a 20-file one; `format:check` raises the cap.

`deps:unused` (knip) is in the list too, as of 2026-08-15. It had drifted to 76
findings — 68 of them false, from a config whose ignores had outlived their
reasons — which is how a gate becomes decoration. `knip.jsonc` now states the
why beside every ignore, and colocated tests are **entry points rather than
ignored**: with tests invisible, anything exported solely so a test can reach it
reads as dead, and following that advice deletes the export and breaks the test.

## CI

**CI runs all of this except `e2e`** — `.github/workflows/quality.yml`, on every
PR and every push to `main`. It is the net under the local gate, not a
replacement for it: `release.yml` is tag-driven and runs no tests at all, so
tag a commit this workflow has passed. In place of e2e's incidental coverage it
builds the renderer (`vite:build`), which catches a bundler-visible break that
`tsc` doesn't. If you add a check here, add it there.

## The quality floor these checks enforce

We use **Biome** (lint + format) + `tsc --noEmit` + `cargo clippy` as the gate.
We do **not** wire CodeScene, Codacy, or any third-party quality service. The
Biome config in `biome.json` is the contract; keep it that way.

- TypeScript: `strict: true`, `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`. Don't disable these.
- Biome `noExplicitAny: error`, `noUnusedImports: error`,
  `noUnusedVariables: error`.
- Rust: `cargo clippy --all-targets -- -D warnings`. `#[allow(...)]` needs a
  comment explaining why.
- Formatting is not a matter of taste and not reviewed by hand: `biome` owns
  every JS/TS/CSS file and `rustfmt` owns every Rust one, both checked here.

AGENTS.md § "Code style" lists the escape hatches that are banned outright.

## Where tests live

Next to the code: `src/lib/foo.test.ts` next to `src/lib/foo.ts` on the TS
side; `tests/foo_integration.rs` for cross-module Rust tests, `#[cfg(test)] mod
tests` for in-module unit tests.

## Useful commands

```bash
pnpm dev                  # tauri dev — full app
pnpm typecheck            # tsc --noEmit across the workspace
pnpm lint                 # biome lint
pnpm format               # biome format --write . — the whole repo, safe to run
pnpm format:check         # the same, read-only. In the gate.
pnpm deps:check           # syncpack — workspace version drift
pnpm deps:unused          # knip — dead code / deps

# Inside apps/desktop:
pnpm vite:dev             # renderer only, no Tauri (mock the bridge)
pnpm tauri build          # production build (.app/.dmg/.AppImage)

# Inside apps/desktop/src-tauri:
cargo fmt                 # rustfmt.toml is written to match the existing style
cargo check
cargo clippy --all-targets -- -D warnings
cargo test
```
