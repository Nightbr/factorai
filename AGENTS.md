# AGENTS.md — factorai

> Single source of truth for any AI agent (Claude Code, Codex, etc.)
> working in this repo. `CLAUDE.md` is a symlink to this file.
> Inspired by [refactoringhq/tolaria](https://github.com/refactoringhq/tolaria),
> stripped to what's load-bearing for a solo / small-team project.

Quick links: [specs/](specs/) · [docs/adr/](docs/adr/)

---

## 1. What this project is

factorai is a desktop command center for **Claude Code CLI sessions**.
Browse `~/.claude/projects/`, search session content, launch / resume /
fork sessions in an embedded terminal, preview files Claude touched.

Tauri 2 (Rust) + React 19 + TypeScript, pnpm monorepo, Biome, Turborepo.
macOS + Linux only for v1. See `specs/00-overview.md` for the
full spec.

---

## 2. Task workflow

### 2a. Before writing code

1. Read the relevant spec under `specs/` end-to-end. They are the
   contract for what the code should do.
2. Check `docs/adr/` for architectural decisions that constrain the
   approach. Don't relitigate a decided ADR — supersede it with a new
   ADR if you disagree.
3. If the spec is wrong or stale, **fix the spec first**, then write
   the code. Specs lead, code follows.

### 2b. While implementing

- Work on `main`. No PR ceremony for solo work. Branches are fine when
  multiple agents are pairing on the same area — coordinate, don't
  collide.
- Commit in small slices (one Red→Green or one feature step). Prefix
  with `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- **⛔ Never use `--no-verify`.** Hooks exist for a reason. If a hook
  blocks the commit, fix the cause, don't suppress it.
- **⛔ Never use `as any`, `#[allow(...)]`, or `// biome-ignore` to
  silence a real warning.** These are escape hatches for genuine edge
  cases, not for "I want to get this committed now."

### 2c. Before declaring a task done

Run, in this order, all green:

```bash
pnpm lint
pnpm typecheck
pnpm test              # once we have tests
cd apps/desktop/src-tauri && cargo check && cargo clippy --all-targets -- -D warnings
```

For UI / behaviour work, also: launch the app (`pnpm dev`) and **use
the feature** in the actual window. Type checking does not validate
UX. Screenshots in a commit are great.

---

## 3. Code quality floor

We use **Biome** (lint + format) + `tsc --noEmit` + `cargo clippy` as
the gate. We do **not** wire CodeScene, Codacy, or any third-party
quality service. The Biome config in `biome.json` is the contract;
keep it that way.

Concrete rules:

- TypeScript: `strict: true`, `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`. Don't disable these.
- Biome `noExplicitAny: error`, `noUnusedImports: error`,
  `noUnusedVariables: error`.
- Rust: `cargo clippy --all-targets -- -D warnings`. `#[allow(...)]`
  needs a comment explaining why.
- No emojis in code or commits unless a user explicitly asks.

---

## 4. Conventions

### IPC and types

- All cross-boundary types live in `packages/types`. Rust structs
  derive `serde::Serialize`/`Deserialize` with `#[serde(rename_all =
  "camelCase")]`. TS types are hand-written to match.
- No code generation (no Specta, no tauri-bindgen). Plain hand-mirrored
  types. If the two sides drift, that's a bug we want to catch in
  review, not at runtime.
- Tauri commands return `Result<T, AppError>`. `AppError` is a
  `thiserror` enum with `serde::Serialize` that becomes a tagged union
  on the TS side. See `specs/03-backend-rust.md` § "Errors".

### Frontend

- shadcn-style primitives live in `@factorai/ui`. Use them. Don't put
  raw `<input>`, `<button>`, `<select>` elements in app code — use
  `Input`, `Button`, `Select` from `@factorai/ui`.
- State: Zustand for client state, TanStack Query for server-state
  caches (Tauri command results). PTY data **never** goes through
  React state — it streams from events directly into xterm.
- Routing: TanStack Router with **hash history** (Tauri is a desktop
  app, no server-side routes).
- Aliases:
  `@/*`, `@components/*`, `@hooks/*`, `@lib/*`, `@store/*`, `@routes/*`
  — defined in both `tsconfig.json` and `vite.config.ts`.

### Backend

- One module per command domain (`commands/sessions.rs`,
  `commands/terminal.rs`, ...). Don't dump everything in `lib.rs`.
- Long-lived state goes in `tauri::State<AppState>`. Hot path locks
  use `parking_lot` or `dashmap`; tokio mutexes only for genuinely
  async code.
- Errors: `anyhow` inside command bodies, `thiserror` `AppError` at
  the command boundary. Never `unwrap()` outside `setup()`.
- PTY output is base64-encoded **bytes**, not UTF-8 strings — Claude's
  ANSI breaks at UTF-8 chunk boundaries.
- **Kill-on-quit is non-optional** and wired through both an explicit
  `kill_all()` and `Drop` on the terminal manager. See
  `specs/05-features.md` § "Quit guard". No orphan zombies, ever.

---

## 5. ADRs (`docs/adr/`)

Create an ADR **in the same commit** as the code that implements the
decision. ADR file naming: `NNNN-kebab-case-title.md`. Format:
context, decision, consequences.

When to write one:

- New dependency that becomes load-bearing.
- New storage strategy (DB schema, file layout).
- Platform-level choice (target OS, build target, runtime).
- Cross-cutting pattern (error handling, eventing, IPC).

When *not* to write one:

- Bug fixes.
- Styling / cosmetic changes.
- Refactors that don't change observable behaviour.

ADRs are immutable. To revise a decision, write a new ADR that
**supersedes** the old one (link both ways) — never edit the original.

---

## 6. Specs (`specs/`)

The `specs/` directory is the design source of truth. Eight files
today; add new ones rather than overflowing existing ones. If the spec
and the code disagree, **fix whichever is wrong** — usually the spec,
since code is exact and prose is loose.

If you change the contract (new command, new event, renamed field),
update the relevant spec **in the same commit** as the code.

---

## 7. Reference

### Useful commands

```bash
pnpm dev                  # tauri dev — full app
pnpm typecheck            # tsc --noEmit across the workspace
pnpm lint                 # biome lint
pnpm format               # biome format --write
pnpm deps:check           # syncpack — workspace version drift
pnpm deps:unused          # knip — dead code / deps

# Inside apps/desktop:
pnpm vite:dev             # renderer only, no Tauri (mock the bridge)
pnpm tauri build          # production build (.app/.dmg/.AppImage/.deb)

# Inside apps/desktop/src-tauri:
cargo check
cargo clippy --all-targets -- -D warnings
cargo test
```

### Tauri gotchas (macOS + Linux)

- GUI-launched processes don't inherit shell PATH on macOS. Use
  `find_claude_binary()` with login-shell fallback (see
  `specs/annex-A-tolaria-patterns.md` § A.1).
- `tauri-plugin-store` writes to `app_data_dir` per platform. Don't
  hardcode paths.
- The DevTools window is enabled via the `devtools` cargo feature on
  Tauri 2; it's already on in our `Cargo.toml`.

### Helpful files when picking up work

- `specs/00-overview.md` — what we're building, MVP scope.
- `specs/03-backend-rust.md` — the full Tauri command surface.
- `specs/04-frontend.md` — routes, components, state shape.
- `specs/05-features.md` — feature-by-feature behaviour.
- `specs/06-milestones.md` — what ships in M0..M5.
- `specs/annex-A-tolaria-patterns.md` — proven patterns lifted from
  tolaria with file:line references.

---

## 8. Things this project does NOT do

State these so we don't argue about them again later:

- No Windows support in v1.
- No telemetry, no analytics, no crash reporting service.
- No localization — English only.
- No code generation for Tauri bindings.
- No CodeScene / Codacy / SonarQube. Biome + tsc + clippy is the floor.
- No Claude OAuth helper — rely on the user's existing `claude login`.
- No mock data baked into the renderer. Mock layer is opt-in via the
  `isTauri()` shim, used only for browser-only dev loops.
