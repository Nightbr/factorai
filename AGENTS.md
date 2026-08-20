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

- **Two type sizes, and 14px is the floor for anything you read to
  navigate.** `text-sm` covers tab labels — all three strips, the top bar's,
  the file panel's and the commit pane's — the sidebar's project *and* session
  rows, and the commit subject. `text-xs` is for **metadata, status and
  section headers**: a SHA, a count, `missing`, the footer's indexer line, an
  uppercase `PROJECTS`. There is no 13px step and there should not be one: the
  app has two sizes on purpose, so the only question a new string raises is
  which of the two it is. Added 2026-08-18 on user feedback — tab names and
  the sidebar's session rows were `text-xs`, which sized the things you
  navigate by for glancing at. Hand-written sizes (`text-[11px]`) are how the
  scale erodes; the one exception left is a deliberate micro-mark, a 16px
  avatar's initials. The dev badge was the other until 2026-08-19, when it
  stopped hand-rolling a 10px bold mono block and took F18's ref-chip shape
  instead — see `DevBadge`.
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
- **A menu row is 28px, and a menu's section label is a section
  header.** shadcn ships `py-1.5` items, a `pl-8` indicator gutter and a
  `text-sm font-semibold` label — proportions for a 16px-body web app,
  which beside this app's 26px rows read as a chunkier application
  borrowed from elsewhere. The tightened metrics (`py-1`, `pl-7`, and a
  `text-xs` uppercase label in the same voice as `PROJECTS`) live on
  `DropdownMenu` and `ContextMenu` in `@factorai/ui`, so every menu gets
  them rather than the one whose padding somebody happened to notice.
  Item text stays `text-sm` — shrinking a menu means its padding, never
  its labels. Added 2026-08-18 on user feedback about the sidebar's sort
  menu.
- **Chevrons colour on hover too** — the sidebar's expand toggle from
  its own hover, the file tree's from its row's (`group-hover`), since
  there the whole row is the click target.
- Rows you act on repeatedly (pinned, selected) keep their hover
  affordances permanently visible; everything else stays quiet until
  hovered.
- **Full `foreground` is a focus, not a default.** Text repeated down a
  list — a commit subject, a filename — rests at `secondary-foreground`
  and takes `foreground` from its row's hover; a *selected* row keeps
  `foreground` permanently, since selection is a state and not a hover.
  A column where every row is at 96% lightness has no focus at all,
  which is what the graph looked like until 2026-08-18.
- **This rule is about rows in a list, not about chrome.** The top bar's
  icons are **all one colour** — `IconButton`'s default, hovering to
  primary — and a toggled-on control does not brighten. The panel toggle
  did until 2026-08-20, and it was wrong twice: a 288px panel is either on
  screen or it is not, so the colour restated something impossible to
  miss, and it made two neighbouring icons in the same row disagree about
  what a header icon looks like. State that a surface already shows needs
  `aria-pressed`, not a second colour. Added on user feedback.
- **A chrome row gets an explicit height, never one derived from its tallest
  child.** The top bar is `h-10.5`, the file panel header and the sidebar footer
  are `h-9`. A row sized by `py-*` moves the moment a taller child appears in it,
  and the thing that appears is by definition the thing you were already looking
  at: the sidebar footer grew 6px when F14's badge staged an update, shifting the
  whole sidebar to announce something the badge was announcing anyway. Added
  2026-08-20 on user feedback.
- **A manual refresh reports while it works.** The panel's Files and Graph
  buttons spin their icon for as long as `useIsFetching` on the key they
  invalidate says there is work — not on a fixed timer, which reassures rather
  than reports. It stops on a **rotation boundary** (`animationiteration`, not a
  timeout), so a 20ms refetch is one clean turn instead of a one-frame flash
  ending at an arbitrary angle. It is deliberately **not** behind `motion-safe:`,
  which would be the instinct: with the animation suppressed the
  `animationiteration` that clears the state never fires, so the state latches on
  forever.

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
  `specs/annex-A-tolaria-patterns.md` § A.1). The override is the user's
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
