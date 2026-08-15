# Done

Shipped work, newest first. Items move here from [`TODO.md`](./TODO.md) when they land; see
[`README.md`](./README.md) for the workflow.

- **A quality gate that runs, and a dead-code gate that works** — 2026-08-15, shipped in v0.6.0.
  `.github/workflows/quality.yml` runs § 2c minus `e2e` on every PR and every push to main, in two
  parallel jobs. No Playwright: it wants a browser download and a dev server for a ~70s suite, so
  `vite:build` stands in for the one thing e2e checked incidentally — that the renderer still
  bundles, which `tsc` doesn't prove.

  `pnpm deps:unused` joined it only after being made honest. It was reporting 76 findings, **68 of
  them false**, from a config whose ignores had outlived their reasons — which is why nobody ran
  it. `knip.jsonc` now states the why beside every ignore; colocated tests became entry points
  (with tests invisible, anything exported solely for a test reads as dead, and taking that advice
  breaks the test); `unresolved` is off because `tsc` and `vite:build` already resolve imports for
  real and knip is the only one blind to Vite's virtual modules. The eight real findings were
  fixed, and the gate was checked by planting an unused export, an orphan file and an unused
  dependency to confirm it still catches all three.

- **18 of the 22 logged inconsistencies resolved** — 2026-08-15, shipped in v0.6.0. Seventeen were
  stale prose against correct code; one was false. Two of them read as instructions and so were
  worse than stale: a roadmap entry describing the release action as a *prerelease* — which
  `/releases/latest` skips, and the updater resolves through it — and a QA note asserting that
  WebKitGTK filters synthetic input, which had been steering QA away from an approach that works.
  The accurate version of that second one had been sitting in TODO item 10 the whole time, where
  nobody reads. Four remain, each needing a decision rather than an edit.

- **The file viewer renders images, with zoom, pan and copy** — 2026-08-15, shipped in v0.6.0.
  `read_image` returns base64 plus a mime **sniffed from the magic bytes**, so a `.png` that is
  really a PDF is refused and falls back to the binary card rather than drawing a broken image.
  Routing is by extension (reusing the file tree's own classifier, so icon and viewer cannot
  disagree); the verdict is the backend's. Oversized images are refused rather than truncated —
  half a PNG is a decode error, not a smaller PNG.

  Zoom steps multiplicatively (×1.25, 0.25–8), because an additive step is a quarter of the image
  at 1× and three percent of it at 8×. Pan is a pointer drag above fit, on a transform rather than
  a scroll container so native scrollbars can't fight the gesture.

  **Copy needed two attempts and the first one is the finding.** `navigator.clipboard.writeText`
  works in this webview, so `clipboard.write()` with a `ClipboardItem` looks obvious — WebKitGTK
  doesn't implement it, the promise rejects, and nothing reaches the clipboard. Caught by clicking
  copy in the running app and seeing `xclip -t TARGETS` still offer text only. It now goes through
  `tauri-plugin-clipboard-manager` as raw RGBA via `Image.new`, which needs no decoding and so
  works for every format. Verified pixel-identical against the file on disk.

- **Middle-click closes a tab, and SVGs render** — 2026-08-15, shipped in v0.6.0. The close still
  asks first: a shortcut to the action, not a way around the question. SVG gets markdown's
  Preview / View source toggle, rendered through an `<img>` and a data URL rather than inlined —
  SVG loaded as an image runs no scripts, and these files come from whatever repository is open.

- **A project whose folder is gone says so before you click** — 2026-08-15, shipped in v0.6.0.
  Closes TODO item 3. `list_projects` reported the `cwd` recorded in a transcript and never stat'd
  it, so F1's dimmed row was unimplemented and F6's `+` couldn't pre-disable. A `missing` column
  on `projects`, set by the indexer's scan rather than per `list_projects` call — that query polls
  every 2s and stat-ing every project on every poll would put the filesystem in a hot path to
  answer a question that changes when someone deletes a directory. Deliberately distinct from
  `real_path: null`: unknown and gone are different states and only one is worth reporting. It
  clears on a later scan and on `add_project`, so a restored folder needs no wiped database. The
  spawn guard stays — the flag is the affordance, the guard is the invariant.

- **The AppImage env scrub actually applies now** — 2026-08-15, shipped in v0.6.0. The v0.5.0 fix
  below computed the right environment and then changed nothing, because `CommandBuilder::new()`
  pre-seeds the child from `std::env::vars_os()`: `env()` overrides a key, and the variables we
  wanted gone were exactly the ones our clean list *omitted*, so they stayed inherited. Caught by
  starting `pnpm dev` from a session under the freshly-updated release and hitting the identical
  `WebKitNetworkProcess` error. The scrub is now an `EnvChanges { remove, set }` diff applied via
  `env_remove`. The regression test drives a real `CommandBuilder`; with the fault reintroduced it
  is the only one of the ten that fails, which is the whole lesson — nine tests of a rule proved
  nothing about whether the rule was ever applied.

- **A session no longer inherits the AppImage's private environment** — 2026-08-15, shipped in
  v0.5.0 (and **broken there** — see above). `spawn_with_argv` copied `std::env::vars_os()`
  wholesale into every PTY, so a release
  build handed `linuxdeploy`'s runtime to every Claude session and everything it ran: `PYTHONHOME`
  pointing into the squashfs mount killed any `python3` with `No module named 'encodings'`, and
  `LD_LIBRARY_PATH` made other GTK binaries load *our* WebKitGTK. `services/child_env` strips
  it — drop path-list entries under `$APPDIR`, unset what that empties, pass anything with no
  `$APPDIR` entry through byte for byte so a `GTK_THEME=Adwaita:dark` isn't rewritten. Matched
  on path rather than on a list of names, since AppRun's set has grown before. No-op outside an
  AppImage. Verified against this machine's real environment: 17 poisoned vars → 0, `PATH` and
  `XDG_DATA_DIRS` restored to the user's own values (which is separately the `xdg-open`
  default-browser fix).

- **Add a project by picking its folder** — 2026-08-15, shipped in v0.5.0. `add_project(path)`
  plus a `FolderPlus` in the sidebar header. Until now a project could only arrive by the indexer
  finding it under `~/.claude/projects/`, so the folder you had never run Claude in — the one you
  most want to start in — was unreachable from the app. Picking one adds the row and opens it;
  the existing `+` starts the first session.

  The row is keyed by **Claude Code's own directory encoding of the path**, which is the whole
  design: when a session eventually runs there, the indexer's upsert lands on this row instead of
  making a second one for the same folder. So the path is canonicalized first (a symlink or a `..`
  would encode to an id the indexer never produces), re-adding is a no-op that keeps the pin, and
  an integration test runs a real scan over a synthetic `~/.claude` to prove the two meet.

- **A dragged tab travels to where it will land** — 2026-08-15, shipped in v0.5.0. Reordering
  happened on drop, so the gesture was blind. The strip now reorders on `dragover`. Two things had
  to be right: the ghost was a near-invisible sliver, because the browser snapshots the source
  *after* `dragstart` returns and so caught the dimming meant to mark the tab as in flight
  (fixed with a solid clone
  passed to `setDragImage`, parked off-screen — not `display: none`, which snapshots blank); and
  the swap has to wait for the midpoint, or the tab you swapped with lands under the cursor and
  the pair flickers forever. `dropIndex` is that arithmetic, unit-tested in both directions.

- **A dev build says so** — 2026-08-15, shipped in v0.5.0. A violet `DEV` pill next to the
  wordmark (`import.meta.env.DEV`, so a `vite:build` bundle never has it) and `factorai DEV` as
  the window title (`#[cfg(debug_assertions)]` in `setup()`). Both because the release factorai
  runs beside the dev one all day with live Claude sessions in it, and the two were
  indistinguishable in the window switcher.

  **The real hazard was `scripts/qa/kill.sh`.** It swept `pgrep -x factorai` and every
  `claude --resume` by name — and the release build shares that process name, its PTYs that argv.
  Verified on this machine: the agent's own session runs under the release AppImage, so the QA
  teardown could kill the app hosting the agent running it. Both sweeps are now qualified by
  ownership — a factorai counts only if its executable is under this repo's `target/` (`/proc/PID/exe`,
  macOS `ps -o comm=`), and a claude only through such a parent's subtree. `_resolve_wid.sh` and
  `launch.sh` match `factorai DEV` rather than `factorai`, which also fixes screenshots landing on
  the wrong window.

- **Sidebar rebuilt around projects you actually use** — 2026-08-14, shipped in v0.3.0. Sort by
  Recent or Name with Expand/Collapse all; projects expand to their 10 most relevant sessions
  (running first, then most-recently-active); pinning lifts a project into a block above a divider,
  stored in the `projects.pinned` column that had been built in M1 and never wired up. The sidebar
  resizes like the file panel — one `PanelResizer` told which edge it's on — and its header stays
  put while the list scrolls, by living outside the scroll container rather than by
  `position: sticky` inside it.

  **Affordances got a house style.** Icon-only controls became an `IconButton` primitive that never
  paints a background: the hover state is the icon taking colour, because a filled block behind a
  14px glyph is bigger than the thing it highlights. Every clickable element gets `cursor: pointer`
  from **one base rule** — Tailwind v4's Preflight sets `cursor: default` on buttons, so nothing had
  one — and the vendored shadcn menus had to give up their hard-coded `cursor-default`, since a
  class on the element always beats a bare-selector rule. Both rules are in `AGENTS.md § Design
  rules`, and `affordances.spec.ts` asserts the *computed* styles rather than the source.

  **The avatar badge took three goes, and the last one found the real bug.** The status dot moved
  onto the project avatar, but nudging it never quite landed: the wrapper was `inline-block` around
  an inline-level tile, so the tile sat on a line box inside its own wrapper and the inherited
  `line-height` pushed it down a couple of pixels — while the badge, positioned against the wrapper,
  stayed put. Avatar and badge were answering to different rectangles. Fixed by making the wrapper
  `inline-flex` with a block-level child, and the geometry is now asserted in pixels (tile fills
  wrapper, badge centre on the right edge, 40–50% above the top, badged and plain rows the same
  height) because the failure is two pixels — invisible at 1x, obvious at 6x.

  **Two defaults that were quietly wrong.** `WebLinksAddon` calls `window.open`, which a Tauri
  webview ignores, so Ctrl/Cmd-clicking a URL in the terminal did nothing; it now goes through the
  shell plugin, on modifier-click only, since Claude Code is a TUI where a bare click would ambush
  you with a browser. And the updater was running under `pnpm dev`, where the binary's version
  trails every release — so it downloaded ~80MB on each launch and offered to restart the developer
  into a release build of the code they were editing. Its guard sits *after* the browser-only
  branch, because the Playwright lane is a dev build too.

  Zoom controls landed in the sidebar footer (webview zoom, so the terminal reflows and the PTY
  learns its new size, rather than a CSS transform that would blur it and lie).

- **OTA updates, and the repo went public to make them possible** — 2026-08-14. The header shows
  `v0.2.0 ready · Restart` once a new release is downloaded and staged; checking and downloading
  are silent, and nothing ever restarts itself. F14, ADR-0010.

  **The restart needed more care than the update.** `relaunch()` tears the process down and takes
  every live PTY with it, but it never fires `CloseRequested` — so the quit guard (ADR-0005) never
  sees it, and a running Claude session would die without a word. The badge runs the same
  confirmation on the same terms; with nothing live it restarts immediately.

  **Four constraints fell out of the endpoint** (`releases/latest/download/latest.json`), each
  forcing a decision: release assets on a *private* repo 404 for unauthenticated clients, so the
  repository is now **public** (history scanned for secrets — clean; screenshots had their project
  list blurred first). GitHub's `/releases/latest` **skips prereleases**, so releases stopped
  being marked as such — they stay drafts until published by hand, which is the real gate. Linux
  **ships AppImage only**, because the updater can replace an AppImage in place but never a `.deb`
  (apt owns those files). And macOS ships `.app.tar.gz` beside the dmg, reversing the earlier
  `--bundles dmg` that was right only while there was no updater to feed.

  Signing is a minisign keypair in the `TAURI_SIGNING_PRIVATE_KEY` secret, nowhere in the tree.
  Losing it means installed copies stop accepting updates — a new key would need a
  manually-installed build to bridge the gap. Note this is **not** Apple code-signing: a first
  macOS install still needs the Gatekeeper dance; in-place updates don't re-quarantine.

  Gotcha worth keeping: `gh secret set NAME --body ""` hangs forever waiting on stdin, so the
  empty passphrase is an empty literal in the workflow rather than a secret.

  **Verified end to end, not just unit-tested.** Cut and published v0.2.0, installed that
  AppImage, published v0.2.1, then launched the v0.2.0 install: it found the release on startup,
  downloaded and staged it, and showed `v0.2.1 ready · Restart`. The installed file's md5 went
  from `72814c03…` to `69365c39…` — byte-identical to the published v0.2.1 AppImage, so the swap
  is real and not a UI state. Clicking Restart replaced the process (pid 473460 → 474787) and the
  badge was gone afterwards, because the check now finds nothing.

- **Changes tab, git decorations and the diff viewer** — 2026-08-14. The right panel gained a
  `Files | Changes` strip; the tree gained git paint and nothing else. Four slices: specs +
  ADR-0009, the Rust (`git_status` / `git_blob` / `ignored` on `list_dir`), the tab and the Monaco
  diff mode, then the tree decorations. Closes TODO items 1 and 11, which turned out to be one
  piece of work — the Changes list is the only thing that opens a diff now that the JSONL viewer
  is gone (F3), and the diff is what makes the list more than filenames.

  **Decisions worth not relitigating** (Q18–Q20): the index is modelled, so a partly-staged file
  shows in both Staged Changes and Changes with its own counts and the `+N −M` badges add up;
  changes are repo-wide with paths relative to the project, so a monorepo sibling reads
  `../packages/types/index.ts`; freshness is a 3s poll while the **panel** is open, either tab,
  because the tree's dots read the same query; the tab strip is two hardcoded tabs, not a
  registry, which sent F9's Memory tab to the cheaper "it's just a file the tree opens" route.

  **libgit2, not `git` on PATH** (ADR-0009). Shelling out would mean owning a second copy of the
  discovery problem `find_claude_binary()` exists to solve, for a read that runs every 3s. VS Code
  shells out because it also *writes* and already ships a `git.path` setting; we write nothing.
  The payoff is testing: 18 Rust tests build real repositories in tempdirs — staged, partly
  staged, untracked, renamed, deleted, binary, a real merge conflict, an empty repo, no repo — with
  no `git` binary and no network.

  **Shaped by reading VS Code's implementation** rather than guessing: untracked directories
  recurse (`-uall`), so three new files in a new folder are three rows; rows are capped *before*
  line stats are computed, because `Patch::line_stats()` reads both sides of every changed file
  and pricing rows you're about to discard is the one way to make the poll hurt; folder dots come
  from an ancestor map built once per status result instead of a per-row `startsWith` scan (their
  `TernarySearchTree` + `findSuperstr`, minus the tree we don't need). The cap is **500 rows**,
  not their 10 000 — they virtualize, we would mount 10 000 buttons into WebKitGTK, which is
  exactly how the JSONL viewer froze the session view.

  **Three gotchas.** (1) `file_diff` and the `similar` crate were dropped: Monaco's
  `createDiffEditor` diffs two strings itself (ADR-0007), so a Rust hunk list had no consumer.
  (2) libgit2 decides binary-ness *lazily, while producing the patch* — the delta from
  `diff.deltas()` is still unflagged, so the check has to ask `patch.delta()`, or a binary file
  reports a misleading `+0 −0`. Found by probing, not by reading docs. (3) Wiring Monaco's
  `editor.worker` with `monaco-editor/esm/vs/editor/editor.worker?worker` double-resolves against
  the package's `"./*": "./esm/vs/*.js"` exports map and takes the whole lazy viewer chunk down —
  all nine existing file-viewer e2e tests went red. The correct specifier drops the `esm/vs/`.

  Verified in the real window against this repo mid-edit: 16 rows matching `git` exactly, counts
  equal to `git diff --numstat`, `mcp-session-view.png` showing `bin` and no counts, staging two
  files moving them into Staged Changes within one poll, and the tree dotting `apps` while dimming
  `node_modules` / `target`. 80 Rust tests, 61 TS, 26 e2e, clippy clean.

- **Shell chrome: the project page scrolls, and the window's rounded corners are real** —
  2026-08-13. Three small fixes found by using the app rather than by type checking. A project
  with many sessions overflowed instead of scrolling; the shell's bottom corners were square
  against a rounded window; and the rounded corners were invisible until the shell got a border to
  draw them with. Cosmetic, so no ADR (`CLAUDE.md` § 5) — but this is the class of thing the
  "launch it and use the feature" step in § 2c exists to catch.

- **factorai names its own sessions — `start_session` + `--session-id` (ADR-0008)** — 2026-08-13.
  Resume and "new session" collapsed into one act: point a PTY at a session id (F6). The backend
  picks `--resume` vs `--session-id` by probing for a transcript, so a brand-new id is real from
  t=0 — the route is linkable and the status dot works before `claude` prints a byte. Entry
  points: a hover-revealed `+` on each sidebar project row (a **sibling** of the row's `<Link>`,
  never nested inside it) and a `New session` button on the project page, which doubles as the
  empty state. The project view unions `list_sessions` with live terminals that have no index row
  yet, otherwise a session you navigate away from is unreachable until you type in it. This is
  also what finally met M2's "New session button launches `claude`" exit criterion, late.

  **Gotcha, found in QA:** `portable_pty`'s `CommandBuilder::cwd` does **not** fail on a missing
  directory — it silently starts the child in `$HOME`, filing the session under a *different*
  project than the row that was clicked. `spawn_with_argv` now refuses that spawn and says why.
  Pre-disabling the button for that case needs a `missing` flag on `Project` — **TODO item 3**.

- **Persistent xterm pool, session Stop/Restart, live status everywhere** — 2026-08-13. Terminals
  survive navigation: they live in `terminalStore`, not in a component's lifetime, so leaving a
  session and coming back reattaches instead of respawning. Status (running / idle /
  waiting-input / stopped) flows from `TerminalManager` up to the session row and aggregates onto
  the project row (F10).

- **Monaco file viewer, opened from the tree (ADR-0007) + `read_file` + markdown preview** —
  2026-08-13. M4's viewer half, landed early on the back of the file tree. ADR-0007 supersedes the
  CodeMirror 6 plan. `read_file(path, max_bytes?) -> FileContents` carries the binary and
  truncated flags; the viewer is a ~90vw modal but `FileView` itself is written self-contained and
  modal-agnostic, because the end state is a per-project tab system. `.md` opens **rendered**
  (`react-markdown` + `remark-gfm`); raw HTML deliberately stays inert text — no `rehype-raw`.
  Open state lives in the URL as `?file=`, validated on `__root` so it survives reload and HMR and
  browser-back closes it.

  Gotchas: `DialogContent`'s built-in close button is absolutely positioned at `right-4 top-4` and
  can never share a baseline with a dialog's own toolbar, so it took a `hideClose` prop;
  `automaticLayout: true` is mandatory because Monaco measures its container on create and inside
  a mid-open dialog that measures zero; and single-click-to-open cannot coexist with the tree's
  double-click-to-open-externally (the first click opens the modal, the second lands on its
  overlay), so that action moved into the viewer header. **`editor.worker` is still not wired** —
  the viewer ships worker-less on purpose; the diff editor is what forces it (**TODO item 1**).

- **Project file tree in a right panel, app top bar, and a file-type icon pipeline** — 2026-08-13.
  `list_dir(path, root?)` (sorted, `.git`-excluded, entry-capped, symlink-aware) behind
  `FileTreePanel` (F12). Three decisions came out of it, recorded as Q14–Q17: the panel lives in
  the **app shell**, not a route, because a tree that vanishes when you open a session disappears
  exactly when it's most useful — beside a running terminal; that needed somewhere to hang a
  toggle, which is what introduced the full-window `TopBar` (built at that geometry now so the M5
  custom titlebar doesn't mean restructuring the shell later); icons are **vscode-icons via
  unplugin-icons** with static per-type imports (ADR-0006 — Material Icon Theme's 1250 loose SVGs
  globbed out of a pnpm-symlinked `node_modules` is too fragile); and freshness is `staleTime` +
  focus refetch + a refresh button, **no watcher** — a recursive watcher on arbitrary project
  directories needs ignore rules, per-project lifecycle and inotify limit handling, which is its
  own feature.

  Also noted: `Ctrl+B` is unavailable as the toggle shortcut — readline's back-a-char and tmux's
  prefix — so the panel ships mouse-only pending a real binding scheme (**TODO item 5**).

- **M3 — FTS5 search** — 2026-05-29. `search_sessions(query, project_id?, limit)` over
  `messages_fts` with `snippet()` + `bm25()`, a debounced sidebar input and a `/search` route
  grouping hits by session. Queries are passed as a quoted FTS string so a stray `"` or `*` can
  never error the match. **Fork was cut** in the same pass: its only sensible entry point was a
  right-click on an event in the JSONL viewer, and that viewer no longer exists (see the
  terminal-only entry below). Not on the deferred list either — it comes back only if a concrete
  need does.

- **The window close button stopped silently doing nothing** — 2026-05-29. The quit guard (Q10)
  was correct and unreachable, behind **two** unrelated bugs. (1) In `on_window_event` you hold a
  `&Window`, and Tauri v2's `Window::emit` targets *window-level* listeners while the frontend's
  `listen()` is registered on the **webview** — so `app:quit-requested` never arrived. Rule that
  came out of it: always emit Rust→JS via the **`AppHandle`**. (`terminal:data` worked all along
  precisely because it already did.) (2) Tailwind v4's auto source detection roots at
  `apps/desktop`, so utility classes used *only* inside `@factorai/ui` primitives were never
  generated and the confirm Dialog rendered as an invisible, uncentred overlay. Fixed with
  `@source "../**/*.{ts,tsx}"` in the UI package's `globals.css`.

- **Terminal-open freeze fixed — lock-free `ChildKiller`** — 2026-05-29. Opening a terminal froze
  the whole app ("not responding"). It was a **Rust deadlock, not a WebKitGTK GPU bug**: the
  waiter thread held `child.lock()` across the blocking `child.wait()` — i.e. for the child's
  whole life — so any `kill()` needing that lock blocked forever, and because `terminal_kill` is a
  synchronous Tauri command it parked the **GTK main thread** on a futex. Fix: store a lock-free
  `portable_pty::ChildKiller` (`child.clone_killer()`) and move the `Child` into the waiter
  thread; plus `Terminal.tsx` now shares one in-flight spawn and **never kills on effect cleanup**
  (StrictMode's dev double-mount was the trigger).

  **Do not chase these again:** `WEBKIT_DISABLE_DMABUF_RENDERER=1` and
  `WEBKIT_DISABLE_COMPOSITING_MODE=1` made no difference — the freeze sits at 0% CPU on both the
  UI thread and the WebKitWebProcess. Diagnosis shortcut:
  `/proc/<pid>/task/<main-tid>/wchan` → `futex_do_wait` means blocked on a lock,
  `poll_schedule_timeout` means a healthy GTK event loop.

- **QA tooling: `scripts/qa/` + Playwright smoke lane** — 2026-05-28. `launch.sh` /
  `screenshot.sh` / `kill.sh` (plus click / key / type / geometry helpers and a
  `FACTORAI_DEVTOOLS=1` opt-in) give an agent a boot-time verification loop: does the app start,
  does the first paint render, do projects appear, did the indexer finish. Alongside it,
  `tests/smoke/` runs Playwright against `pnpm vite:dev` with the renderer in browser-only mode —
  `isTauri()` falls back to `mockInvoke()`, and fixtures are injected via `installMockBridge()`
  before `page.goto`. `.mcp.json` ships `@playwright/mcp`, pinned to chromium.

  What it does **not** catch is anything past first paint that needs synthetic input, which is why
  the Playwright lane exists at all (**TODO item 10** — note `scripts/qa/README.md`'s blanket
  "XTest input is filtered" is too strong: clicks do land, `--window`-targeted key events are what
  get dropped).

- **Session view became terminal-only; the JSONL viewer was removed** — 2026-05-28 (`c6374d6`).
  M1's `EventLog` / `EventCard` mounted 100+ stateful React components in a single paint and froze
  the WebKitGTK webview on Linux — tail-first loading with show-earlier paging bought time but not
  a fix. The session view is now switchboard-style: terminal filling the pane under a thin header.
  The only surface that renders session *content* is search results, whose `snippet()` excerpts are
  cheap and bounded. In the same performance pass the **WebGL addon was dropped** and PTY output
  batched into ~16ms windows. `get_session` / `get_session_tail` survived the removal and are now
  called by nothing (**TODO item 9**).

- **M2 — embedded PTY terminal and the kill-on-quit guard** — 2026-05-28. `TerminalManager` over
  `portable-pty`, the five `terminal_*` commands, `terminal:data` / `:status` / `:exit` events,
  and xterm.js with the fit / search / web-links / unicode-graphemes addons. PTY output is
  base64-encoded **bytes**, never UTF-8 strings — Claude's ANSI breaks at UTF-8 chunk boundaries.
  Kill-on-quit is non-optional (Q10, ADR-0005): confirm dialog on `CloseRequested`, then
  `kill_all()` (SIGTERM → 500ms → SIGKILL), also wired to `Drop` as a crash backstop. Follow-ups
  in the same window: tolerant JSONL parsing, AI-derived titles, a StrictMode guard, Tauri bump.

- **M1 — read-only session browser** — 2026-05-28. SQLite + migrations, the indexer's full scan
  and `~/.claude/projects` watcher, `list_projects` / `list_sessions` / `get_session` /
  `resolve_project_path`, `indexer:progress` + `sessions:changed`, and the sidebar / project view
  / session viewer on top. Encoded project directory names are resolved **authoritatively** from
  the first event's `cwd` field (Q4) — character-substitution decoding is only a last resort for a
  project with no sessions yet. Shipped with tests: 17 Rust (6 of them integration) + 20
  TypeScript.

- **M0 — scaffold** — 2026-05-28. pnpm monorepo, Turborepo, Biome, `mise`, Tauri 2 + Vite +
  React 19 + TanStack Router (hash history — desktop app, no server routes), `packages/types` and
  `packages/ui`. ADR-0001 through ADR-0005 landed with it: the stack, the embedded PTY, SQLite
  FTS5 for the index, `~/.claude/` is read-only, kill-on-quit is non-optional. Q13 decided this
  went straight onto `main`; branch-based work starts at M1.
