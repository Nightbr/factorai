# AGENTS.md — factorai

`CLAUDE.md` is a symlink to this file.

Quick links: [specs/](specs/) · [specs/roadmap/](specs/roadmap/) · [docs/adr/](docs/adr/)

---

## 1. What this project is

factorai is an **ADE — an Agentic Development Environment**: one place to
build software with agents, rather than an editor with an agent bolted
into a pane. The unit of work is a **session**, not a file.

**Agents are at the centre; the human supervises, decides, reviews, and
sets the rules agents run under.** Those four verbs are the product, and
they are a usable test when you're weighing a change: which one does this
serve, and does it take any of them away from the human? An ADE where the
agent is central is *not* one where the human is absent — every
irreversible action keeps its confirmation, and "the agent already did
it" is never a reason to skip asking. See `specs/00-overview.md` §
"The operating model".

Concretely today: browse `~/.claude/projects/`, search session content,
launch / resume sessions in an embedded terminal, review what the agent
changed in git, preview files it touched.

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
pnpm test
pnpm e2e
cd apps/desktop/src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
```

For UI / behaviour work, also: launch the app (`pnpm dev`) and **use
the feature** in the actual window. Type checking does not validate
UX. Screenshots in a commit are great.

Tests live next to the code: `src/lib/foo.test.ts` next to
`src/lib/foo.ts` on the TS side; `tests/foo_integration.rs` for cross-
module Rust tests, `#[cfg(test)] mod tests` for in-module unit tests.

### 2d. Playwright smoke tests (`tests/smoke/`)

`pnpm e2e` runs Playwright against `pnpm vite:dev` (the renderer in
browser-only mode — no Tauri). The renderer detects browser-only via
`isTauri()` in `lib/tauri.ts` and falls back to `mockInvoke()`.

Tests inject data by calling `installMockBridge(page, fixture)` before
`page.goto(...)`. The mock layer reads `window.__FACTORAI_TEST__`.
Convention: one fixture factory per "shape" of state
(`fixtureOneProjectOneSession()` etc. in `tests/smoke/fixtures.ts`).

Tag tests with `@smoke` in the title; the suite stays under a few
seconds. Heavier tests go in a future `tests/regression/` lane.

`pnpm e2e:ui` opens the Playwright UI runner — useful for iterating
on a flaky test.

**Driving Playwright from this conversation.** The repo ships
`.mcp.json` configuring `@playwright/mcp@latest`. If `playwright` MCP
tools aren't yet listed in the available tools, restart Claude Code
so the new server config loads.

### 2e. Manual verification loop (agent-friendly)

An agent verifying its own changes runs the loop with `scripts/qa/`:

```bash
scripts/qa/launch.sh                       # boots tauri dev, returns once window appears
scripts/qa/screenshot.sh /tmp/qa-1.png     # captures the active factorai window
scripts/qa/kill.sh                         # tears down factorai + orphan claudes
```

`FACTORAI_DEVTOOLS=1 scripts/qa/launch.sh` keeps DevTools open if you
want the inspector available.

**What this catches.** Boot-time regressions — does the app start,
does the first paint render, do projects appear in the sidebar, did
the indexer scan complete. That's enough to catch the
WebKitGTK / WebGL / PTY-flood class of crashes.

**What this does NOT catch.** Anything past the first paint that
requires clicking or typing into the WebView. `xdotool`'s synthetic
input is filtered by WebKitGTK before it reaches React — known
limitation, see `scripts/qa/README.md`. For deeper interaction tests,
the planned path is **Playwright against `pnpm vite:dev`** (the
renderer already has a mock Tauri bridge via `isTauri()` /
`mockInvoke()` in `lib/tauri.ts`, so browser-only mode boots without
Rust).

Wayland is not supported by these scripts (swap `wmctrl`/`gnome-screenshot`
for `swaymsg`/`grim` — deferred).

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
  `Input`, `Button`, `Select` from `@factorai/ui`. Icon-only controls
  use **`IconButton`**, not `Button variant="ghost" size="icon"`.

- State: Zustand for client state, TanStack Query for server-state
  caches (Tauri command results). PTY data **never** goes through
  React state — it streams from events directly into xterm.
- Routing: TanStack Router with **hash history** (Tauri is a desktop
  app, no server-side routes).
- Aliases:
  `@/*`, `@components/*`, `@hooks/*`, `@lib/*`, `@store/*`, `@routes/*`
  — defined in both `tsconfig.json` and `vite.config.ts`.

### Design rules

- **Anything clickable shows `cursor: pointer`.** Tailwind v4's
  Preflight sets `cursor: default` on buttons, so this does not happen
  by itself. It is one base rule in
  `packages/ui/src/styles/globals.css` covering `button`, `a[href]`,
  `select`, `summary`, `label[for]` and the ARIA interactive roles —
  **not** a `cursor-pointer` class per control, which gets forgotten
  exactly where a control is hand-rolled. Disabled controls are
  excluded: a pointer on something inert is a lie. If you add a new
  interactive role, add it there rather than patching the component.
- **Icon buttons paint no background, ever.** Their hover state is the
  **icon taking colour** (`hover:text-primary`), not a filled block
  behind it: at 14px the block is bigger than the thing it highlights
  and reads as a widget rather than an affordance. That is what
  `IconButton` in `@factorai/ui` is for — use it rather than
  `Button variant="ghost" size="icon"`, and don't add `hover:bg-*` to
  it. It deliberately carries no `cursor-pointer` class either, so the
  base rule above stays in charge of disabled controls.
- **Chevrons colour on hover too** — the sidebar's expand toggle from
  its own hover, the file tree's from its row's (`group-hover`), since
  there the whole row is the click target.
- Rows you act on repeatedly (pinned, selected) keep their hover
  affordances permanently visible; everything else stays quiet until
  hovered.

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

The `specs/` directory is the design source of truth. Nine numbered
files plus two annexes today; add new ones rather than overflowing
existing ones. If the spec and the code disagree, **fix whichever is
wrong** — usually the spec, since code is exact and prose is loose.

`08-inconsistencies.md` is where a contradiction goes when you find one
and can't fix it on the spot — doc against code, doc against doc, or a
process note that isn't true when you run it. Add to it rather than
leaving the disagreement in place, and delete the entry when it's
resolved. It is *not* a decision record; `07-open-questions.md` holds
things already settled.

If you change the contract (new command, new event, renamed field),
update the relevant spec **in the same commit** as the code.

`specs/roadmap/` is the exception to "design source of truth": it holds
**sequencing**, not design. `TODO.md` says what to do next and in what
order, `DONE.md` logs what landed. A feature is never specified there —
if a roadmap item and a spec disagree about behaviour, the spec wins (or
the spec is wrong and gets fixed first, per § 2a). When an item ships,
the same commit updates the spec it changed, *then* the entry moves to
`DONE.md`.

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
- **Turborepo 2.x runs tasks in strict env mode**, so anything not in
  `globalPassThroughEnv` is stripped before the app ever starts. Under
  `pnpm dev` the app saw 15 env vars instead of 74. That broke
  "open in default app" and every external link on Linux: with
  `XDG_DATA_DIRS` unset, `xdg-open` falls back to
  `/usr/local/share:/usr/share`, can't see desktop files exported by
  Flatpak or snap, and drops through to its hardcoded `x-www-browser`
  chain — so links opened whatever `update-alternatives` points at
  rather than your actual default browser. `turbo.json` now passes the
  XDG/desktop-integration vars through. Symptoms of this class ("works
  when I run the binary directly, not under `pnpm dev`") are almost
  always a stripped env — compare `/proc/<pid>/environ` against your
  shell before blaming the app.
- **The AppImage is the mirror image of that bug.** `linuxdeploy`'s
  `AppRun` prepends `$APPDIR/…` to `PATH`, `LD_LIBRARY_PATH`,
  `XDG_DATA_DIRS`, `PYTHONPATH`, `PERLLIB`, `QT_PLUGIN_PATH` and the
  `GST_*` pair, and *replaces* `PYTHONHOME` and the `GTK_*` / `GIO_*` /
  `GDK_*` set outright. Every process the app spawns used to inherit
  that, so a `claude` session started from a release build could not run
  `python3` (`No module named 'encodings'`) or any other GTK binary.
  `services/child_env` now strips it on the way into a PTY — see
  `specs/03-backend-rust.md` § `TerminalManager`. **This also applies to
  you**: an agent session running inside the release app has that env,
  so `pnpm dev` dies with a `WebKitNetworkProcess` spawn error until you
  clear it. `env | grep .mount_` is the tell.

### Helpful files when picking up work

- `specs/00-overview.md` — what we're building, MVP scope.
- `specs/03-backend-rust.md` — the full Tauri command surface.
- `specs/04-frontend.md` — routes, components, state shape.
- `specs/05-features.md` — feature-by-feature behaviour.
- `specs/06-milestones.md` — what ships in M0..M5.
- `specs/roadmap/TODO.md` — the agreed next steps, in priority order.
  Read it before re-deriving a plan; `specs/roadmap/DONE.md` is the
  dated log of what landed and the gotchas found on the way.
- `specs/annex-A-tolaria-patterns.md` — proven Tauri + CLI-agent
  patterns, with file:line references.

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
