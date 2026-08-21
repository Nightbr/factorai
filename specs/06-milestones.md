# Milestones

Each milestone ships a working app at a higher level of capability. Don't
move on until the current milestone passes a manual smoke test on at least
macOS + Linux.

---

## M0 — Skeleton (1 day)

**Goal.** `pnpm dev` opens an empty Tauri window with the factorai-v0
toolchain wired up.

**Deliverables.**
- Workspace files: `package.json`, `pnpm-workspace.yaml`, `turbo.json`,
  `biome.json`, `knip.json`, `.syncpackrc.json`, `.mise.toml`, `Cargo.toml`.
- `apps/desktop` with Tauri 2 + Vite + React 19 + TanStack Router (hash).
- `packages/types` + `packages/ui` (copied from factorai-v0, names and
  components intact).
- Root scripts: dev, build, lint, format, typecheck, deps:check,
  deps:unused.
- `mise install` produces a working dev env.

**Exit criteria.**
- `pnpm dev` boots the Tauri window with "Hello factorai" rendered.
- `pnpm lint`, `pnpm typecheck` pass clean.
- `pnpm deps:check` and `pnpm deps:unused` produce no findings.

---

## M1 — Read-only session browser (2–3 days)

**Goal.** Browse and read every session on disk. No terminal yet.

**Deliverables.**
- SQLite open + migrations (`0001_init.sql`, `0002_fts.sql`).
- IndexerService full scan + watcher.
- Commands: `list_projects`, `list_sessions`, `get_session` (removed
  2026-08-16 with the viewer it served — see 05-features.md F3),
  `resolve_project_path`.
- Sidebar with projects + sessions, project view, session view (JSONL
  rendered, no terminal half yet — viewer takes the whole main pane).
- Events wired: `indexer:progress`, `sessions:changed`.

**Exit criteria.**
- After cold start, every project under `~/.claude/projects/` appears.
- Clicking any session shows its event log within 200ms (cached) and tail
  updates live when the file changes (test by appending a fake line).
- Indexer reports progress and finishes a 100-project / 500-session corpus
  in under 10s on a typical laptop.

---

## M2 — Terminal & session lifecycle (2 days)

**Goal.** Launch, resume, and kill `claude` sessions from inside the app.

**Deliverables.**
- TerminalManager + portable-pty integration.
- Commands: `terminal_spawn`, `terminal_write`, `terminal_resize`,
  `terminal_kill`, `terminal_list`.
- Events: `terminal:data`, `terminal:status`, `terminal:exit`.
- Terminal component using xterm.js + addons (fit, webgl, search,
  web-links, unicode-graphemes).
- Session view becomes split: viewer top, terminal bottom (resizable).
- Status dots in sidebar.

**Exit criteria.**
- New session button launches `claude` with the project cwd, output
  streams into xterm, input goes back. **Met late** — the button needed an
  id to route to, which arrived with ADR-0008 (`start_session` +
  `--session-id`); see 05-features.md F6.
- Resume on an existing session attaches to `claude --resume <id>` and
  re-uses the JSONL.
- Closing the window with live PTYs always shows the kill-confirm
  dialog. After "Quit & kill sessions", no `claude` processes remain
  (verified with `ps`).

---

## M3 — Search (1 day)

**Goal.** Find any session by its content. (Fork was cut — see
05-features.md F6.)

**Deliverables.**
- FTS5 search: `search_sessions(query, project_id?, limit)` command +
  `services/search.rs` query builder over `messages_fts`.
- Search input in the sidebar (debounced).
- `/search` route listing hits grouped by session, each with a `snippet()`
  excerpt; click → open that session.

**Exit criteria.**
- Typing in the search input shows top hits within ~100ms on a 500-session
  corpus.
- A search hit opens the matching session's terminal view.
- A query with FTS metacharacters (`"`, `*`, `:`) returns results or empty,
  never an error.

---

## M4 — File preview, diff, CLAUDE.md (2 days)

**Goal.** Side panel becomes useful.

**Deliverables.**
- Commands: `read_file` ✅, `git_status`, `git_blob`, `read_claude_md`,
  `write_claude_md`, `list_plans`, `read_plan`. (`file_diff` was dropped —
  ADR-0009.)
- Monaco file viewer ✅ (landed early with F12's file tree — modal for now,
  per-project tabs later; ADR-0007 replaces the CodeMirror 6 plan).
- Monaco diff editor (`createDiffEditor`) with a persisted inline/split
  toggle. Needs `editor.worker` wired through Vite's `?worker` import — the
  viewer deliberately ships without any worker.
- Changes tab in the file panel + git decorations on the tree (F13, ADR-0009).
  This is what *opens* the diff editor: the JSONL-event entry point the diff
  was originally specced against died with the viewer (F3).
- CLAUDE.md editor with dirty-state save flow. First place the app is not
  read-only.

**Exit criteria.**
- Click a file in the tree → opens with correct syntax highlighting. ✅
- With the agent mid-edit, the Changes tab lists what it touched within one
  poll, and clicking a row shows the change in the user's preferred mode.
- A partly-staged file appears under both Staged Changes and Changes, and each
  row's `+N −M` matches what `git diff` / `git diff --cached` report.
- CLAUDE.md edits round-trip to disk; on-disk changes prompt a reload.

---

## M5 — Polish & first release (1 week)

**Goal.** Ready to use day-to-day; first tagged release.

**Deliverables.**
- ~~Settings UI~~ **shipped 2026-08-20** (F11, roadmap item 4): the claude path
  override, the diff-mode default, the close confirms and F16's restore switch.
  **Theme and fonts are not in it** — theme is its own roadmap item (nothing sets
  `data-theme` yet, so the light palette has never rendered), and fonts were never
  specced anywhere else. A projects-dir override is still not planned.
- **Custom window titlebar.** Drop the OS decorations
  (`decorations: false`) and reimplement minimise / maximise / close in
  `TopBar`, which is already full-window width for exactly this reason.
  Needs a drag region, per-platform control placement (traffic lights left
  on macOS, buttons right on Linux) and a double-click-to-maximise handler.
- Keyboard shortcuts. Includes a home for the file-tree toggle — note
  `Ctrl+B` is unavailable (readline / tmux collision inside the embedded
  terminal), so this needs a real binding scheme, not one `useEffect`.
- Empty states, error toasts, friendly indexing UI.
- Icons — **done**, see [`09-branding.md`](./09-branding.md). Generated from
  `docs/brand/factorai-icon.svg`, which `tauri icon` takes directly; the
  "feed it a 1024px master" note this file used to carry was wrong, since
  rasterising each size from vector beats downsampling one bitmap.
- README with install instructions.
- GitHub Action: `tauri build` on tag push, attach artifacts to release.
- Manual smoke test pass on macOS arm64 and Ubuntu 24. (Windows is out
  of scope for v1.)

**Exit criteria.**
- A teammate can install the .dmg or the .AppImage and use factorai for an
  hour without hitting a bug that breaks their flow.

---

## Deferred (post-MVP, in priority order)

1. ~~**MCP/IDE emulator.**~~ **Graduated 2026-08-15** into `roadmap/TODO.md`
   item 19, and **designed 2026-08-19** — see `05-features.md` F20 and
   ADR-0017; the code is still to come. Re-implement switchboard's
   WebSocket MCP server so Claude routes
   file opens and diff approvals through factorai instead of an external
   editor, including the "accept / reject hunk" UI we skipped. It moved
   because the ADE operating model (`00-overview.md`) makes it the *push* half
   of review — the agent asks and the human decides in place — rather than a
   post-MVP nicety.
2. **Scheduler.** A small cron-like runner that can launch a session with
   a prompt at a given time / interval.
3. **Grid overview.** Multi-session live xterm rendering with focused-on-
   click. Requires WebGL addon tuning to keep frame budget sane.
4. **Activity heatmap.** GitHub-style contribution graph over session
   timestamps.
5. **Launch in external terminal.** Action that spawns the OS terminal
   (`open -a Terminal …` / xdg-open) with the right `claude` argv,
   bypassing the embedded xterm.
6. **Multi-window.** Detached session windows for power users running
   many parallel agents.
7. ~~**Auto-updates.**~~ **Shipped 2026-08-14** — see F14 and ADR-0010.
   The signing flow it was waiting on is a minisign key held as a repository
   secret, not Apple code-signing, which remains outstanding.
8. **Crash reporting / Sentry.** Wire `tauri-plugin-sentry` if/when
   factorai gets external users. Requires a DSN — either Sentry SaaS or
   a self-hosted instance; the plugin can't run "purely local".
9. **Windows support.** PTY validation, path encoding edge cases,
   build/signing pipeline.
10. **Mobile / iPad.** Tauri 2 supports mobile. Probably never useful
    for this product, but it's on the table.
11. **Keep the machine awake while a session is working.** **Demoted here
    from `roadmap/TODO.md` item 20 on 2026-08-17** — the first item to move
    in this direction rather than out of it. Hold a sleep inhibitor while an
    agent is actually working, release it when it isn't.

    Disqualified as too risky for now, and the risk is the *release* path
    rather than the feature: a leaked inhibitor is invisible. No window, no
    indicator, just a laptop that quietly never sleeps and is flat by
    morning. That is ADR-0005's orphan-PTY problem wearing a different hat,
    and the correct handling — release on the last qualifying session ending,
    plus an explicit release on quit, plus `Drop` as the backstop — is the
    same shape of care, on a platform surface we do not control.

    Two things compound it. **Linux has no single mechanism** — logind's
    `Inhibit` over D-Bus, `org.freedesktop.portal.Inhibit`, and the older
    ScreenSaver interface, varying by desktop — so this is a new load-bearing
    dependency and an ADR (§ 5) before it is a feature. And the design
    question underneath is unsettled: `live_count()` is the wrong signal
    (it counts terminals, not work) — half-answered since, by
    `working_count()` and ADR-0020, which is what the quit guard reads now
    — and **`waiting_input` is genuinely ambiguous** — the agent is blocked on a human who is, by hypothesis, not
    at the machine. That is the case that actually happens overnight.

    Nothing here is wrong, and it may well graduate back. It is parked
    because the failure mode is silent and lands on the user's hardware.
