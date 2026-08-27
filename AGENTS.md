# AGENTS.md — factorai

`CLAUDE.md` is a symlink to this file.

Quick links: [specs/](specs/) · [specs/roadmap/](specs/roadmap/) · [docs/adr/](docs/adr/) · [DESIGN.md](DESIGN.md) · [PRODUCT.md](PRODUCT.md)

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

- **Start from an up-to-date `main`.** `git fetch origin && git status`
  before the first edit, and pull if you are behind — someone else's
  branch may have merged while you were reading specs. This is not
  hygiene, it is the cheapest version of a conflict you will otherwise
  resolve later with both features half-built: on 2026-08-16 two agents
  spent a weekend on `sessions` from different schemas and both shipped
  a migration numbered `0004`, which is keyed by name and so cannot
  simply be renumbered once it has run anywhere. Push small slices for
  the same reason — a commit sitting unpushed is a conflict accruing
  interest.
- Work on `main`. No PR ceremony for solo work. Branches are fine when
  multiple agents are pairing on the same area — coordinate, don't
  collide. If you *do* branch, say so in the roadmap entry you are
  working from, so the next agent sees the collision coming.
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

**CI runs all of this except `e2e`** — `.github/workflows/quality.yml`, on every
PR and every push to `main`. It is the net under the local gate, not a
replacement for it: `release.yml` is tag-driven and runs no tests at all, so
tag a commit this workflow has passed. In place of e2e's incidental coverage it
builds the renderer (`vite:build`), which catches a bundler-visible break that
`tsc` doesn't. If you add a check here, add it there.

`deps:unused` (knip) is in the list too, as of 2026-08-15. It had drifted to 76
findings — 68 of them false, from a config whose ignores had outlived their
reasons — which is how a gate becomes decoration. `knip.jsonc` now states the
why beside every ignore, and colocated tests are **entry points rather than
ignored**: with tests invisible, anything exported solely so a test can reach it
reads as dead, and following that advice deletes the export and breaks the test.

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

**`pnpm e2e` and `pnpm dev` both want port 1420**, and `webServer.reuseExistingServer`
is on outside CI — so running the suite while the app is open makes Playwright
attach to the *app's* vite, and every test times out at 30s. Twenty-four unrelated
specs "failing" is the tell. Set `PLAYWRIGHT_PORT=1421` to run alongside a dev
app; the config reads it and starts its own server.

**dnd-kit reports `over` one move behind** — it collides against rects measured on
the previous frame. A real drag never notices, but a test that jumps once per aim
names the row the pointer just *left*. Move twice, a pixel apart, per aim. The
helpers in `tests/smoke/sidebar.spec.ts` do this and say why.

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

**Clicking and typing into the WebView does work** — corrected
2026-08-15. This used to say `xdotool`'s synthetic input was filtered by
WebKitGTK. It isn't: buttons, the file tree, the viewer's controls and a
GTK file chooser have all been driven that way. The real rule is
narrower — `xdotool key --window <id>` uses XSendEvent and *is* ignored,
plain `xdotool key` after focusing uses XTest and isn't. See
`scripts/qa/README.md`.

**Prefer Playwright anyway when you have the choice.** Not because
synthetic input fails, but because it can't miss: a stale window origin
once put a click into the user's Slack. `pnpm e2e` runs against
`pnpm vite:dev`, where the renderer boots browser-only through
`isTauri()` / `mockInvoke()`, and it cannot touch anything outside its
own browser. Reach for `xdotool` when the thing under test is native —
a real PTY, a file dialog, the clipboard — and follow the safety rules
in `scripts/qa/README.md` when you do.

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
- Formatting is not a matter of taste and not reviewed by hand: `biome`
  owns every JS/TS/CSS file and `rustfmt` owns every Rust one, both
  checked in the gate (§ 2c).
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

- **No HTML5 drag-and-drop. It cannot work in this shell.** `draggable` +
  `dragstart` / `dragover` / `drop` is dead on macOS: Tauri's own
  drag-drop handler reports every drag session on the window as handled
  and wry then never forwards it to WKWebView, so the page gets
  `dragstart` and nothing after it. It *does* work on Linux, which is how
  the tab strip shipped with a reorder that only worked on one of our two
  platforms. Drag with **dnd-kit** (pointer events, ADR-0016) —
  `SessionTabs` is the worked example, including the 4px activation
  constraint that keeps a click a click. Ship a keyboard path beside the
  drag; a gesture only a mouse can reach is half a feature.
- State: Zustand for client state, TanStack Query for server-state
  caches (Tauri command results). PTY data **never** goes through
  React state — it streams from events directly into xterm.
- Routing: TanStack Router with **hash history** (Tauri is a desktop
  app, no server-side routes).
- Aliases:
  `@/*`, `@components/*`, `@hooks/*`, `@lib/*`, `@store/*`, `@routes/*`
  — defined in both `tsconfig.json` and `vite.config.ts`.

### Design rules

**`DESIGN.md` at the repo root is the design contract**, the way `specs/` is the
behaviour contract: the palette, the two type sizes, the density metrics, the
flat elevation model and the named rules all live there, with
`.impeccable/design.json` as its machine-readable sidecar. Read it before
touching UI, and fix it in the same commit when a rule changes. The dated user
feedback each rule came from is logged in `specs/roadmap/DONE.md`.

What stays here is only *where a rule lives in this repo*, which `DESIGN.md`
does not carry:

- The pointer-cursor base rule is one block in
  `packages/ui/src/styles/globals.css`. A new interactive role is added there,
  not patched onto the component.
- Icon-only controls use **`IconButton`** from `@factorai/ui` — never
  `Button variant="ghost" size="icon"`, and never with a `hover:bg-*` added.
- Menu metrics (`py-1`, `pl-7`, `text-xs` uppercase label) live on
  `DropdownMenu` and `ContextMenu` in `@factorai/ui`, so every menu inherits
  them rather than the one whose padding somebody noticed.
- Chrome heights are literal: top bar `h-10.5`, file panel header and sidebar
  footer `h-9`, session tab `h-7.5`.
- The refresh spinner clears on `animationiteration` and is deliberately **not**
  behind `motion-safe:` — with the animation suppressed the event never fires,
  so the state latches on forever.

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

The `specs/` directory is the source of truth for **behaviour**. Nine
numbered files plus two annexes today; add new ones rather than
overflowing existing ones. If the spec and the code disagree, **fix
whichever is wrong** — usually the spec, since code is exact and prose is
loose.

Two root files hold the other halves, and they are contracts on the same
terms: **`DESIGN.md`** is the visual system — tokens, type scale, density,
elevation, component behaviour — with `.impeccable/design.json` as its
sidecar, and **`PRODUCT.md`** is durable product truth: users, purpose,
positioning, constraints, brand commitments. `specs/09-branding.md` keeps
the mark itself, since a logo's construction is not a UI rule. A visual
change updates `DESIGN.md` in the same commit, exactly as a contract change
updates its spec.

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

### Tauri gotchas (macOS + Linux)

- GUI-launched processes don't inherit shell PATH on macOS. Use
  `find_claude_binary(override)` with login-shell fallback (see
  `specs/annex-A-cli-agent-patterns.md` § A.1). The override is the user's
  setting and every caller passes it — a probe that ignores it is how the
  settings page comes to report "not installed" for the binary sessions are
  spawning from (F11).
- **Preferences go in one of three places, and "who reads this?" decides**
  (ADR-0013): layout you dragged in `panelStore`/`sidebarStore`/`zoomStore`,
  preferences the renderer alone reads in `prefsStore`, anything **Rust** reads
  in the SQLite `settings` table. All three localStorage stores are synchronous
  on purpose. `tauri-plugin-store` was the documented answer and is **removed** —
  it is async, so every persisted value flashed its default for a frame.
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
  `services/child_env` strips it on the way into a PTY — see
  `specs/03-backend-rust.md` § `TerminalManager`. **This also applies to
  you**: an agent session running inside the release app has that env,
  so `pnpm dev` dies with a `WebKitNetworkProcess` spawn error until you
  clear it. `env | grep -c .mount_` is the tell, and **expect zero**.
- **If it is not zero, note which mounts** before working around it.
  Until 2026-08-20 the strip matched only `$APPDIR` — the mount the app
  itself runs from — so a factorai launched from inside an older factorai
  passed the *older* mounts straight through to every session. Three
  mounts existed on the machine, one was stripped, two leaked, and
  `pnpm dev` died from a build that already had the module. The rule now
  also matches any `.mount_*` path component, so a leak is a new bug
  rather than that one; the workaround is `env -u` the poisoned vars and
  filter `.mount_` out of `PATH` / `XDG_DATA_DIRS` rather than unsetting
  those wholesale.

### Helpful files when picking up work

- `DESIGN.md` — the visual system: palette, two type sizes, density
  metrics, named rules. Read before touching UI.
- `PRODUCT.md` — who this is for, what it promises, what may not change.
- `specs/00-overview.md` — what we're building, MVP scope.
- `specs/03-backend-rust.md` — the full Tauri command surface.
- `specs/04-frontend.md` — routes, components, state shape.
- `specs/05-features.md` — feature-by-feature behaviour.
- `specs/06-milestones.md` — what ships in M0..M5.
- `specs/roadmap/TODO.md` — the agreed next steps, in priority order.
  Read it before re-deriving a plan; `specs/roadmap/DONE.md` is the
  dated log of what landed and the gotchas found on the way.
- `specs/annex-A-cli-agent-patterns.md` — Tauri + CLI-agent plumbing
  patterns: binary discovery, streaming events, file watching, mock bridge.

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
