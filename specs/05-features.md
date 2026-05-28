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

## F3 — Session JSONL viewer

**Behavior.** Render the events of an opened session as a chronological
event log: user, assistant, tool calls/results, summaries.

**UI.** Main pane (top half by default). Markdown bodies rendered with
`marked`. Tool calls collapsed; click to expand. A vertical timeline rail
with hover affordances on each event.

**Backend.** `get_session(session_id, offset, limit)` — paginated for very
long sessions.

**Edge cases.**
- Malformed line in JSONL → skip and log; don't break the view.
- File grows mid-view (live session) → tail by reacting to the watcher.

**Switchboard ref.** `jsonl-viewer.js`.

---

## F4 — Full-text search

**Behavior.** Search across all sessions by message body. Optional filter
to current project.

**UI.** Sidebar search input plus a dedicated `/search` route that lists
hits with snippets. Click a hit → open session at that event.

**Backend.** `search_sessions(query, project_id?, limit)` → FTS5 with
`snippet()`. Returns up to 200 hits with `(session_id, event_index,
snippet)`.

**Edge cases.**
- Empty query → clear results.
- Index not yet built → show "indexing…" with progress.

**Switchboard ref.** none — switchboard searches in JS over JSON; we
upgrade this to SQL FTS.

---

## F5 — Embedded terminal

**Behavior.** Launch `claude` (or `claude --resume <id>` or
`claude --resume <id> --fork-from <uuid>`) inside an xterm.js terminal,
backed by a PTY in Rust.

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

## F6 — Resume & fork

**Behavior.** Resume = start a new PTY against an existing session id.
Fork = pick any event uuid in the JSONL viewer, create a fresh session id,
copy the JSONL up to that event, then launch resume against the new id.

**UI.** Resume = a button on a stopped session, or implicit when opening a
session view that has no live PTY. Fork = right-click any event in the
viewer → "Fork from here".

**Backend.** `fork_session(session_id, at_event_uuid)`:
- Read source `.jsonl` lines up to and including the target uuid.
- Generate a new uuid; write `<new>.jsonl` into the same project dir.
- Return `{ newSessionId }`.
- A subsequent `terminal_spawn({ resumeSessionId })` boots the fork.

**Edge cases.**
- Target uuid not found → InvalidInput error.
- Source file modified mid-fork → re-read and retry once; fail loud after.

**Switchboard ref.** `main.js` fork IPC, `read-session-file.js`.

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
