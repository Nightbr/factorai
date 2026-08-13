# Features

For each feature: behavior, UI, backend touchpoints, edge cases.
"Switchboard ref" points at the file in the source repo this was derived
from, for cross-checking.

---

## F1 — Project list

**Behavior.** On launch, show every project under `~/.claude/projects/`,
ordered by `last_session_at DESC`. Pinned projects float to the top.

**UI.** Sidebar section. Each row: display name, session count, status dot
(any live terminal in this project → green). Click → navigate to project
view. Right-click → Pin / Unpin / Reveal in file manager.

**Backend.** `list_projects()`, `pin_project()`,
`resolve_project_path()`. The list comes from the cached `projects` table;
the indexer keeps it up to date.

**Edge cases.**
- Encoded names that resolve to a path that no longer exists → show the
  decoded name as "(missing) /Users/.../foo" and gray out the row.
- New project folders appearing → watcher triggers a project refresh.
- `~/.claude/projects/` doesn't exist → empty state with a one-line
  explainer and a link to install Claude Code.

**Switchboard ref.** `sidebar.js`, `derive-project-path.js`,
`folder-index-state.js`.

---

## F2 — Session list

**Behavior.** For an active project, list all sessions newest-first. Show
title, relative timestamp, turn count, and a status badge.

**UI.** Sidebar (or full pane when on `/projects/$id`). Click → open
session view. Keyboard: ↑/↓ to navigate, Enter to open.

**Backend.** `list_sessions(project_id)`.

**Edge cases.**
- Title not yet derived → fall back to first 60 chars of first user message,
  or the session ID's first 8 chars.
- Session file is huge (>100MB) → still index, just lazily.

**Switchboard ref.** `sidebar.js`, `session-cache.js`.

---

## F3 — Session view (terminal-only)

**Behavior.** Opening a session shows the embedded terminal (F5) filling
the pane, with a thin header for the project name + session id. There is
**no** chronological JSONL event viewer.

> **History note.** M1 shipped a full JSONL event viewer (`EventLog` /
> `EventCard`). It was removed in `c6374d6`: mounting 100+ stateful React
> components in a single paint froze the WebKitGTK webview on Linux even
> with tail-pagination. The session view is now terminal-first
> (switchboard-style). The only surface that renders session content is
> search results (F4), which show short `snippet()` excerpts — cheap to
> render and bounded in count.

**Backend.** `get_session(session_id, offset, limit)` and
`get_session_tail` remain available for future use (e.g. a search-hit
context preview) but are not wired into the session view.

**Edge cases.**
- Malformed line in JSONL → skip and log during indexing; never fatal.

**Switchboard ref.** `main.js` terminal-first layout. (The old
`jsonl-viewer.js` port is retired.)

---

## F4 — Full-text search

**Behavior.** Search across all indexed sessions by message body. Keep it
simple: one query string, optional filter to a single project, ranked
results. No event-level navigation (the session view is terminal-only — see
F3), so a hit identifies a *session*, not a position within it.

**UI.** Sidebar search input (debounced) plus a dedicated `/search` route
that lists hits grouped by session, each with a `snippet()` excerpt and the
matched role. Click a hit → navigate to that session (opens its terminal).

**Backend.** `search_sessions(query, project_id?, limit)` → FTS5 over
`messages_fts` with `snippet()` + `bm25()` ranking. Returns up to `limit`
(default/cap 200) hits, each `{ sessionId, projectId, title, role, snippet }`
(`title` JOINed from `sessions` for the result label). The FTS index stores
no per-event position, so hits carry no `event_index`.

**Edge cases.**
- Empty / whitespace query → clear results, no command call.
- FTS special characters → the query is passed as a quoted FTS string so a
  stray `"` or `*` can't error the match.
- Index not yet built (cold start) → results are simply empty until the
  initial scan completes; the sidebar already surfaces `indexer:progress`.

**Switchboard ref.** none — switchboard searches in JS over JSON; we
upgrade this to SQL FTS.

---

## F5 — Embedded terminal

**Behavior.** Launch `claude` (or `claude --resume <id>`) inside an
xterm.js terminal, backed by a PTY in Rust.

**UI.** Main pane top half. Toolbar: Resume/Restart, Kill, Copy selection,
Search-in-terminal (`Cmd+F`).

**Backend.** `terminal_spawn`, `terminal_write`, `terminal_resize`,
`terminal_kill`. `terminal:data` events stream output. Status heuristics
detect waiting-for-input.

**Edge cases.**
- `claude` not in PATH → three-tier discovery (PATH → login shell →
  candidate probe) per `03-backend-rust.md`. Only fail if all three miss;
  surface the error with a "Set claude path" override hint.
- Process dies → `terminal:exit` event flips status to Stopped; UI shows
  "Process exited (code 1)".
- Window resize during high output → fit + resize requests are coalesced.
- **Window close with live PTYs** → mandatory confirm dialog. Quitting
  always kills all live children (SIGTERM → 500ms → SIGKILL). No orphan
  zombies, ever. The user can cancel the close.

**Switchboard ref.** `main.js` (PTY spawning), `terminal-manager.js`,
`session-transitions.js`.

---

## F6 — Resume

**Behavior.** Resume = start a new PTY against an existing session id.
Opening a session view spawns `claude --resume <id>` (F5); there is no
separate resume button in the MVP.

> **Fork removed.** Earlier drafts specced a "fork from event N" feature
> (`fork_session`, copy JSONL up to a chosen event uuid). It was cut from
> the MVP: its only sensible entry point was a right-click on an event in
> the JSONL viewer, and that viewer was removed (see F3). Forking is not on
> the post-MVP list either unless a concrete need resurfaces.

**Backend.** None beyond `terminal_spawn({ resumeSessionId })`.

**Switchboard ref.** `main.js` (resume path).

---

## F7 — File preview

**Behavior.** Open a file (path = absolute on disk) in CodeMirror with
syntax highlighting based on extension.

**UI.** Side panel. Toolbar: copy path, open in default app, close. Text
files only; binaries get a "Cannot preview binary file (N bytes)" card.

**Backend.** `read_file(path, max_bytes?)`. Default cap 5MB; larger files
show a "Show anyway" affordance that re-fetches with no cap.

**Edge cases.**
- Path doesn't exist → "File not found". Possibly stale link from an older
  session.
- Binary detection: sniff for null bytes in first 8KB.

**Switchboard ref.** `file-panel.js`, `viewer-panel.js`,
`viewer-toolbar.js`, `codemirror-setup.js`.

---

## F8 — Diff viewer

**Behavior.** Given a file path and two snapshots, render a diff in either
inline (unified) or side-by-side mode. Read-only in MVP.

**UI.** Side panel, replacing the file preview when a diff is active.
Toolbar toggle: Inline ↔ Split. The choice persists via `prefsStore`.

**Backend.** `file_diff(path, original, modified)` — Rust returns a
pre-computed hunk list (we use `similar = "2"` for ranges so the renderer
doesn't have to). The renderer hands the two strings to `@codemirror/merge`.

**Edge cases.**
- Both strings empty → "No changes".
- One string very large → ship anyway; CodeMirror handles 5–10MB OK.

**Switchboard ref.** `viewer-panel.js`, `codemirror-setup.js`.

---

## F9 — CLAUDE.md & plans

**Behavior.** Per project, show `CLAUDE.md` and any `.claude/plans/*.md`.
CLAUDE.md is editable in-app; plans are read-only (they're working
documents Claude writes).

**UI.** Side panel tab "Memory". A small file tree: `CLAUDE.md` + plans.
Edits to CLAUDE.md trigger an explicit Save action with a dirty indicator.

**Backend.** `read_claude_md`, `write_claude_md`, `list_plans`, `read_plan`.

**Edge cases.**
- No CLAUDE.md → "Create CLAUDE.md" button writes a stub.
- File changed on disk while we have a dirty buffer → diff modal asks the
  user to merge or overwrite.

**Switchboard ref.** `plans-memory-view.js`.

---

## F10 — Status indicators

**Behavior.** For any session that has a live PTY, show one of:
running, idle, waiting-input, stopped. Bubble up to sidebar.

**UI.** Colored dot next to the session row; same dot on the project row
(aggregating any live session). Tooltip: "Waiting for input · 12s ago".

**Backend.** In-memory `TerminalManager` state, derived from output flow +
prompt detection. Emits `terminal:status` events.

**Edge cases.**
- False positive on "waiting for input" (some interactive curl output looks
  like a prompt) → fine; the user can see the terminal and react.
- App closed with live terminals → on next launch, no in-memory state, so
  all sessions show as idle until launched again.

**Switchboard ref.** `session-transitions.js`.

---

## F11 — Settings

**Behavior.** Theme, font, claude binary path, claude projects dir
override, font size, diff mode default.

**UI.** Dedicated `/settings` route. Sections: Appearance, Editor, Claude,
Advanced. All values flow into `prefsStore`, written to the plugin store.

**Backend.** `get_setting` / `set_setting` for anything that needs to
influence Rust (claude binary path, projects dir override).

**Switchboard ref.** `settings-panel.js`.

---

## F12 — Project file tree

**Behavior.** Browse the active project's directory on disk in a right-hand
panel. One level loads at a time, when you expand it.

**UI.** `FileTreePanel` lives in the **app shell**, not a route: it stays
open when you go from a project's session list into a session, which is
where a file tree earns its keep — next to a running terminal. Which
project it shows follows the route (`/projects/$id` or
`/projects/$projectId/sessions/$sessionId`); a route with neither says
"Select a project to browse its files."

- Toggled from the `PanelRight` button at the right of the app top bar.
  Open state and width persist (see below). No keyboard shortcut yet:
  `Ctrl+B` is readline's back-a-char and tmux's prefix, so binding it would
  break typing in the embedded claude terminal.
- Panel header: `Files`, collapse-all, refresh, close. The header is where
  a `Changes` tab (git status) goes when that ships.
- Row: chevron for directories, language icon for files (ADR-0006), name,
  and a link glyph on symlinks. Single click selects; a directory also
  toggles. Double-click or `Enter` on a file opens it in the OS default
  app via `plugin-shell`'s `open` (`shell:allow-open` is already granted).
- Root row is the project's display name, expanded the first time the tree
  is shown for that project. Collapse-all collapses the root too, and
  isn't undone on the next render.
- Resizable by dragging the panel's left edge, 200–600px, keyboard
  accessible via arrow keys on the separator.

**Backend.** `list_dir(path, root?)` — see specs/03-backend-rust.md
§ `files` for the sorting, `.git` exclusion, entry cap and symlink rules.

**State.** `panelStore` (zustand). `open` and `width` persist to
localStorage; expanded paths are per-project and deliberately **not**
persisted — a path that existed last session may be gone, and rehydrating
a tree of stale paths is worse than starting collapsed. Migrates behind
`prefsStore` / `tauri-plugin-store` when F11 lands.

**Freshness.** No watcher. Each directory query has a 15s staleTime and
opts into refetch-on-window-focus (the app default is off), plus the
explicit refresh button. Pointing a recursive watcher at arbitrary project
directories means ignore rules, per-project watcher lifecycle and inotify
limits — its own feature, not a side effect of this one.

**Edge cases.**
- Project has no resolvable path → "Project folder not found on disk."
  The toggle keeps working.
- Unreadable directory → inline `permission denied` row in the tree, not a
  toast.
- Directory over the cap → trailing "… N more entries" row, so truncation
  is visible rather than silent.
- Symlink out of the project → shown with a dimmed chevron, never expanded.
- Empty directory → `empty` row, so an expanded node never looks stuck.

---

## Cross-cutting concerns

### Keyboard shortcuts

| Shortcut          | Action                          |
| ----------------- | ------------------------------- |
| `Cmd/Ctrl + K`    | Focus sidebar search            |
| `Cmd/Ctrl + F`    | Find in viewer or terminal      |
| `Cmd/Ctrl + G`    | Go to line (editor only)        |
| `Cmd/Ctrl + N`    | New session in active project   |
| `Cmd/Ctrl + W`    | Kill active terminal            |
| `Cmd/Ctrl + ,`    | Open settings                   |

Implemented via a single `useGlobalShortcuts()` hook listening at the
shell layer.

### Error UX

- Tauri commands return tagged `AppError`. The bridge wrapper rethrows
  with the tag; UI shows a toast for transient errors and an inline
  message for view-specific failures.
- `toast` component lives in `@factorai/ui` (add for MVP; not present in
  factorai-v0's current set).

### Telemetry

None for MVP. Don't add an analytics SDK; we don't need it yet. Sentry
revisited in a deferred milestone if/when an external user base appears
(see Q12).

### Quit guard

When the user closes the window with one or more live PTYs:

1. Rust intercepts `CloseRequested` and emits `app:quit-requested {
   liveCount }`.
2. Frontend opens a `Dialog` from `@factorai/ui`:
   > Quit factorai? N running Claude session(s) will be terminated.
   >   [Cancel]   [Quit & kill sessions]
3. On confirm, frontend calls `invoke('app_quit_confirmed')`. Rust runs
   `TerminalManager::kill_all()` then `app.exit(0)`.
4. On cancel, the dialog dismisses; nothing happens.

This is non-optional and not configurable. The cost of a stray zombie
process running an LLM agent is real money.
