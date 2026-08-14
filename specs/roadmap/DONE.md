# Done

Shipped work, newest first. Items move here from [`TODO.md`](./TODO.md) when they land; see
[`README.md`](./README.md) for the workflow.

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
