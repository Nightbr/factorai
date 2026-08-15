# Features

For each feature: behavior, UI, backend touchpoints, edge cases.
"Switchboard ref" points at the file in the source repo this was derived
from, for cross-checking.

---

## F1 — Project list

**Behavior.** On launch, show every project under `~/.claude/projects/`,
ordered by `last_session_at DESC`. Pinned projects float to the top.

**UI.** Sidebar section. Each row: a collapse/expand chevron, the project
avatar **badged with the status dot** when any terminal in it is live, the
display name, and — on hover — a pin and a `+` for a new session. The badge sits
on the avatar's corner rather than as another item in the row: at four possible
elements (chevron, avatar, name, dot, pin, `+`) the row was reading as a
toolbar.

The sidebar is **resizable** by the same handle mechanism as the file panel —
one `PanelResizer` told which edge it sits on, since the sign of the drag is
all that differs. Width persists (180–480px). The session count was dropped from the row: it
competed with the status dot for the end of the row, and it is not what you
scan a sidebar for.

**Pinning** is a **hover icon, not a context menu.** An earlier draft specced
right-click → Pin / Unpin / Reveal in file manager; nothing in the app has ever
taught anyone to right-click, and building a context-menu system for one action
would drag "Reveal in file manager" along with it. Pinned projects rise into a
block at the top of the list, separated by a divider with **no header** — the
filled pin on each row is what says why they're up there, and it doubles as the
unpin target. The glyph shows **state at rest and action on hover**: an
unpinned row gets an outline pin, a pinned one a filled pin, and hovering a
pinned pin swaps it to a slashed `PinOff` — so the icon answers both "is this
pinned?" and "what will clicking do?" without a tooltip. A slashed pin on an
*unpinned* row would say the opposite of what clicking does, so it is never
used there.

Neither the pin nor the `+` wears button chrome: a filled hover background
behind a 14px glyph in a dense row reads as a widget when all it is is an
affordance. Both sit muted at rest and take full colour only under the cursor.
On a **pinned** project both stay visible without hovering — those are the
projects you start work in, so the affordance shouldn't need hunting for.

The flag is the `projects.pinned` column via `pin_project` — **not** a client
preference, so it is per-machine and survives reindexing (the indexer's upsert
touches only `real_path` and `display_name`, guarded by a test). The click
writes optimistically to the cached list, because the projects query polls at
2s and the row would otherwise sit still long enough to be clicked twice.

The scrolling list reserves a right-hand gutter so those hover buttons never
sit under the scrollbar.

The section header carries a sort control: **Recent** (the backend's
`last_session_at DESC` order, left exactly as returned rather than re-derived
client-side) or **Name**, plus **Expand all** / **Collapse all**. Sort and
expansion persist in `sidebarStore` — unlike the file tree's expanded *paths*,
which go stale when a directory is deleted, a project id stays valid.

**Adding a folder.** Projects otherwise arrive only by the indexer noticing
them under `~/.claude/projects/`, which means the folder you have *never* run
Claude in — the one you most want to start in — cannot be reached from the app
at all. A `FolderPlus` in the section header opens the native directory picker;
the chosen folder becomes a project row and the app navigates to it, where the
existing `+` starts the first session. Adding and starting stay separate
actions: adding is cheap and reversible, starting a session is neither.

The row's id is **Claude Code's own directory encoding of the path**, and that
is the whole design. When a session is finally run there, Claude writes
`~/.claude/projects/<same encoding>/`, the indexer upserts, and it lands on
this row rather than creating a second one for the same folder. Two
consequences fall out of that and are tested: adding a folder twice is a no-op
returning the existing row (so the button cannot make duplicates), and the path
is **canonicalized first** — a symlink or a `..` would otherwise encode to an
id the indexer will never produce, leaving a dead empty row beside the live
one. `display_name` and `pinned` are left alone on conflict; re-adding a
project must not silently unpin it.

Cancelling the picker is an answer, not a failure — nothing happens and nothing
is said. A folder that can't be a project (not absolute, gone, not a directory)
reports in a line under the section header rather than a toast: it belongs to
the button that caused it, and clears the next time that button is pressed.

**Backend.** `list_projects()`, `add_project()`, `pin_project()`,
`resolve_project_path()`. The list comes from the cached `projects` table;
the indexer keeps it up to date.

**Edge cases.**
- Encoded names that resolve to a path that no longer exists → show the
  decoded name as "(missing) /Users/.../foo" and gray out the row.
- New project folders appearing → watcher triggers a project refresh.
- `~/.claude/projects/` doesn't exist → empty state with a one-line
  explainer and a link to install Claude Code. The empty state also points
  at "Add project", since that is the way out of it.

**Switchboard ref.** `sidebar.js`, `derive-project-path.js`,
`folder-index-state.js`.

---

## F2 — Session list

**Behavior.** For an active project, list all sessions newest-first. Show
title, relative timestamp, turn count, and a status badge.

**UI.** Sidebar (or full pane when on `/projects/$id`). Click → open
session view. Keyboard: ↑/↓ to navigate, Enter to open.

An expanded project lists its **10 most relevant** sessions inline: anything
with a live PTY first, then most-recently-active. Running-first is the point —
what an agent is doing *now* matters more than what you touched last, so a live
session stays at the top even when it is the stalest by timestamp. Anything
beyond the ten is an `N more…` link to the project page, rather than an
unbounded list in a narrow column.

**Backend.** `list_sessions(project_id)`.

**Title precedence.** A session's name comes from the first of these that
exists, checked in this order:

1. **`custom-title`** — what Claude Code's `/rename` writes
   (`{"type":"custom-title","customTitle":"…"}`). A name you chose yourself, so
   it wins outright; renaming again appends another line and the last one is
   current.
2. **`ai-title`** — Claude's own generated name (`aiTitle`), rewritten as the
   session develops. An `ai-title` written *after* a rename must not displace
   it, which is why precedence is decided at the end rather than by whichever
   line comes last.
3. First 60 characters of the first user message.
4. The session id's first 8 characters.

An empty or whitespace-only rename falls through rather than blanking the row.

**Edge cases.**
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

## F6 — Resume & new session

**Behavior.** Both are the same act: point a PTY at a session id. Opening a
session view spawns `claude` for that id (F5) — resuming it if it has a
transcript, claiming the id if it doesn't. There is no separate resume
button.

**New session** means factorai picks the id first. `start_session(projectId)`
returns it, the UI navigates to
`/projects/$projectId/sessions/$sessionId`, and the terminal mounts and
spawns exactly as it does for an existing session. The id is real from t=0,
so the route is linkable and the status dot works before `claude` prints a
byte. See ADR-0008.

**UI.** Two entry points, both landing you in the new session's terminal
with the cursor focused:

- Sidebar: a `+` on each project row, revealed on hover/focus. It is a
  sibling of the row's `<Link>`, not nested inside it.
- Project view: a `New session` button in the header, which is also what the
  "no sessions yet" empty state offers.

Both are **disabled** when the project's `realPath` is null, with a tooltip
saying so. That is the case that would otherwise misfile: with no cwd to pass,
`claude` boots in `$HOME` and the session lands under a *different* project
than the row that was clicked.

A `realPath` that resolved once but has since been deleted is **not**
pre-disabled — `list_projects` reports the `cwd` recorded in the transcript and
never stats it. `terminal_spawn` refuses that spawn instead, and `Terminal`
prints the error in the pane. **This has to be enforced in the backend**:
`portable_pty`'s `CommandBuilder::cwd` does not fail on a missing directory, it
just starts the child somewhere else — `$HOME` — which silently produces
exactly the misfiling the disabled button exists to prevent. Found in QA, see
the guard in `spawn_with_argv`.

Pre-disabling the button for that case wants a `missing` flag on `Project`,
which F1's grayed-out missing-project state needs anyway; it belongs there, not
here. The backend guard means the worst outcome meanwhile is a clear error
rather than a session in the wrong project.

`Cmd/Ctrl + N` (see "Keyboard shortcuts") is not wired yet.

**Reachability before indexing.** A new session has no `sessions` row until
`claude` writes its transcript and the watcher reindexes, so the project view
unions `list_sessions` with the live terminals for that project that have no
row yet, showing them at the top as `New session` with a status dot. Without
that union a session you navigate away from is unreachable until you type in
it. The sidebar's per-project count stays index-derived. The session header
shows `New session` until a title exists rather than a bare UUID.

**Edge cases.**
- Clicking `+` twice: the second click returns the still-unmessaged session
  from the first, not a second `claude`.
- Abandoning a new session (stop it without typing): it leaves the store, the
  pseudo-row disappears, and nothing was written to `~/.claude`. Returning to
  that URL later claims the id again and boots a working session.
- A session id in the URL that is neither indexed nor live behaves the same
  way — the probe finds no transcript, so it starts rather than errors.

> **Fork removed.** Earlier drafts specced a "fork from event N" feature
> (`fork_session`, copy JSONL up to a chosen event uuid). It was cut from
> the MVP: its only sensible entry point was a right-click on an event in
> the JSONL viewer, and that viewer was removed (see F3). Forking is not on
> the post-MVP list either unless a concrete need resurfaces.

**Backend.** `start_session(projectId)` plus
`terminal_spawn({ sessionId, projectId, cwd })`. The `--resume` vs
`--session-id` choice is the backend's, made by probing for the transcript —
see `specs/03-backend-rust.md` § "Session ids".

**Switchboard ref.** `main.js` (resume path).

---

## F7 — File viewer

**Behavior.** Open a file from the tree (F12) read-only, with syntax
highlighting, in Monaco (ADR-0007 — this supersedes the CodeMirror 6 plan).

**UI.** V0 is a **modal**, ~90vw × 85vh: the cheapest UX that gets the
feature useful. The eventual shape is a per-project **tab system** switching
between the project page, its sessions and open files — so `FileView` is
written self-contained and modal-agnostic, and `FileViewerModal` is just its
first host.

- Header: file name, dimmed parent directory, then copy-path,
  open-in-default-app and close — all three **in flow on one row**.
  `DialogContent` takes `hideClose` for this: its built-in close button is
  absolutely positioned at `right-4 top-4` and can never share a baseline
  with a dialog's own toolbar.
- Footer: language · size · line count · `read-only`, plus the markdown
  toggle when relevant.
- Monaco config: line numbers on, minimap **off** (noise at modal width),
  **word wrap on** with `wrappingIndent: 'indent'` so reading a file never
  means scrolling sideways, find widget on `Cmd/Ctrl+F`, and
  `automaticLayout: true` — Monaco measures its container on create, and
  inside a dialog that is mid-open-animation that measures zero.

**Markdown.** A `.md` file opens **rendered** (`react-markdown` +
`remark-gfm`, so GFM tables work), with a footer toggle to "View source" and
back. Raw HTML in the document is *not* rendered — react-markdown's default —
so an embedded `<script>` stays inert text; we deliberately don't add
`rehype-raw`. Styling is `@tailwindcss/typography`'s `prose` classes tuned to
the app palette. Links:

- `http(s):` / `mailto:` → handed to the OS, never navigating the webview out
  of the app.
- relative → resolved against the file's own directory and opened **in the
  viewer**, so a README's link to `docs/guide.md` just works.
- `#anchor` → ignored for now.

**Opening.** A **single** click on a file row opens the viewer; directories
still toggle. "Open in default app" moved into the viewer header — it used to
be the tree's double-click, which can't coexist with click-to-open, because
the first click of a double-click opens the modal and the second lands on its
overlay.

**State.** The open file lives in the URL as `?file=<absolute path>`,
validated on the **root** route so every route inherits it (the viewer is
app-level, mounted in `__root` beside `QuitConfirm`). That means reload and
HMR reopen the file, browser-back closes it, and the tab system grows out of
the same place — `?file=` becomes a list of open paths. See
`hooks/useFileViewer.ts`.

**Backend.** `read_file(path, max_bytes?)` and `read_image(path, max_bytes?)`
— see specs/03-backend-rust.md § `files`.

**Images are rendered**, in an `<img>` fed a `data:` URL from `read_image`.
Three decisions behind that:

- **Base64 through a command, not the asset protocol.** The protocol wants a
  static path scope and the paths here are "whatever project you opened".
  `read_file` already validates this ground, so reusing the command boundary
  costs a 33% encoding overhead and buys not having a second route into the
  filesystem.
- **Routed by extension, decided by magic bytes.** The viewer sends a path to
  `read_image` when `iconKeyFor()` calls it an image — reusing the file tree's
  own classifier so the icon and the viewer can never disagree, and avoiding
  reading a 200MB video to discover it isn't a picture. The *verdict* is the
  backend's, from the file's first bytes: a `.png` that is really a PDF is
  refused and falls back to the binary card, rather than handing the renderer
  a broken image with no explanation. (`RIFF` needs bytes 8..12 too — it is
  also `.wav` and `.avi`.)
- **Oversized images are refused, not truncated**, at a 16MB cap of their own
  — larger than the text cap because a photo legitimately is, and still a cap
  because base64 inflates it again on the way across. Half a PNG is not a
  smaller PNG, it is a decode error, so the "Show anyway" affordance that
  makes sense for text is deliberately absent here.

`svg` is **not** in that set: it maps to its own icon key, has no magic bytes,
and is already legible as source. Rendering it is a separate decision.

**Edge cases.**
- Binary (null byte in the first 8KB) → "Cannot preview binary file (N
  bytes)" plus an open-in-default-app button. The same card, with the reason
  swapped, is where a failed image read lands.
- Over the 5MB cap → footer says `truncated` and offers "Show anyway", which
  refetches uncapped. Capped and uncapped reads are separate query keys, so
  the second read actually happens.
- Path gone since the tree listed it → "File not found. The tree may be out
  of date — try refreshing it." (the tree has no watcher, by F12's design).
- Empty file → "This file is empty." rather than a blank editor that looks
  broken.

**Switchboard ref.** `file-panel.js`, `viewer-panel.js`,
`viewer-toolbar.js` (its `codemirror-setup.js` no longer applies).

---

## F8 — Diff viewer

**Behavior.** Given a file path and two revisions, render a diff in either
inline (unified) or side-by-side mode. Read-only.

**UI.** A third mode of `FileView`, inside the existing viewer modal — not a
separate surface (F7 keeps `FileView` self-contained and host-agnostic for
exactly this). Footer toggle: Inline ↔ Split, persisted.

**How it is opened.** `?file=<path>&diff=staged|unstaged|head`. The only thing
producing those URLs today is the Changes tab (F13) — the earlier plan was a
right-click on an event in the JSONL viewer, and that viewer is gone (F3). Do
not build a diff surface with nothing to open it.

**Backend.** `git_blob(path, head|index)` for the git sides and `read_file` for
the worktree side. Monaco's `createDiffEditor` (ADR-0007) computes the diff from
the two strings.

> **`file_diff` was dropped.** The original spec had Rust precompute a hunk list
> with the `similar` crate, for a renderer that would draw hunks itself. ADR-0007
> replaced that renderer with Monaco, which diffs two strings natively — so the
> command had no consumer and was never built. Removed in ADR-0009.

**Edge cases.**
- Both sides identical → "No changes" rather than an empty editor.
- A side that doesn't exist at its revision (added / deleted file) → rendered as
  empty. `git_blob` returns `None`, which is an answer, not an error.
- Binary on either side → the "cannot preview binary" card, not a diff.
- Very large file → both sides obey `read_file`'s 5MB cap and its `truncated`
  flag; a truncated diff says so rather than lying by omission.

**Switchboard ref.** `viewer-panel.js` (its `codemirror-setup.js` no longer
applies — ADR-0007).

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

**Only one dot animates.** The running pulse is opt-in (`<StatusDot pulse />`)
and used in exactly one place: the session header, where there is a single dot
describing what you are looking at. Sidebar projects, sidebar sessions and tabs
show the same colours without motion — a dozen things breathing at their own
rate is a christmas tree, not a signal.

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
- Panel header: a `Files | Changes` tab strip (F13), then collapse-all,
  refresh, close. The tree keeps its layout, spacing, icons and indentation
  exactly as they are — no indent guides, no folder icons, no compact folders,
  no hover actions. The only thing git adds to the tree is **paint**:
  - a changed file's name takes a status colour (modified, untracked,
    conflicted), from the same `git_status` query the Changes tab uses;
  - a directory containing changes gets a dot — including while expanded, so a
    deep tree still shows which subtree the change is in, and a collapsed one
    tells you where to expand without expanding;
  - `ignored` entries (`node_modules`, `target`, `dist`) are dimmed. The flag
    rides on `DirEntry` from `list_dir`, so this costs no extra call.

  Outside a git repository none of the above renders and the tree looks exactly
  as it does today.
- Row: chevron for directories, language icon for files (ADR-0006), name,
  and a link glyph on symlinks. Single click selects; a directory also
  toggles. Double-click or `Enter` on a file opens it in the OS default
  app via `plugin-shell`'s `open` (`shell:allow-open` is already granted).
- Root row is the project's display name, expanded the first time the tree
  is shown for that project. Collapse-all collapses the root too, and
  isn't undone on the next render.
- Resizable by dragging the panel's left edge, 200–600px, keyboard
  accessible via arrow keys on the separator. The scrolling area reserves a
  right-hand gutter so rows never run under the scrollbar — which a long tree
  or a large change set will otherwise produce.

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

## F13 — Changes tab (git status)

**Behavior.** The right-hand panel's second tab lists what has changed in the
active project's repository, and clicking a row opens the diff. Read-only:
factorai shows you what the agent did, it does not stage, discard or commit —
the terminal beside it already does that better. See ADR-0009.

**UI.** A `Files | Changes` tab strip in the panel header (the slot F12 left for
it). Files is the default; the last tab chosen persists app-wide in
`panelStore`, alongside `open` and `width`. The strip **never** switches itself
because a file changed — the panel sits next to a terminal you are typing into.

Three groups, in order, each with a count and hidden when empty:

- **Merge Changes** — conflicted paths. First, because during a rebase they are
  the only thing that matters.
- **Staged Changes** — HEAD ↔ index.
- **Changes** — index ↔ worktree.

A row is: file-type icon (the F12 icon set), basename, dimmed parent path,
`+N −M`, and a status letter. A partly-staged file appears in **both** groups
with its own counts in each — one row per (path, group), which is the only
version where the numbers are true.

Status letters follow git and take their colour from the theme, not from new
hex values: `M` modified, `A` added, `D` deleted, `R` renamed (row shows
`new ← old`), `U` untracked, `C` conflicted.

**Scope.** The whole repository, found by walking up from the project root — so
a project inside a monorepo shows changes above itself, displayed relative to
the project as `../packages/types/index.ts`. This matches what an agent actually
does: run in `apps/desktop`, edit `packages/types`.

**Opening a diff.** A row sets `?file=<path>&diff=staged|unstaged|head` on the
URL — the same `__root`-validated param F7 already uses, so reload and HMR
reopen the diff and browser-back closes it. `FileViewerModal` stays the only
host; `FileView` gains a diff mode using Monaco's `createDiffEditor`, with the
inline/split toggle in the footer. The pair depends on the row's group:
`staged` = HEAD ↔ index, `unstaged` = index ↔ worktree, `head` = HEAD ↔ worktree
for conflicted rows (markers and all — there is no 3-way merge editor and no
resolve action).

Left and right sides come from `git_blob(path, head|index)` and `read_file`.
**This is the feature that wires Monaco's `editor.worker` through Vite's
`?worker` import** — the file viewer deliberately ships worker-less, and a diff
editor without a worker computes its diff on the main thread.

**Freshness.** One shared `git_status` query per project, polled every **3s
while the panel is open** — either tab, because the tree's decorations read the
same data — and nothing at all when the panel is closed. TanStack pauses
intervals when the window is hidden, so a backgrounded app is silent. No
watcher: `.git/index` churns mid-operation and would need debouncing back into
what polling already does (Q17's reasoning, same conclusion).

**Backend.** `git_status`, `git_blob` — see `03-backend-rust.md` § `git`.

**Folder dots are a precomputed lookup, not a scan.** From one status result,
build a single `Map<dirPath, status>` by walking each changed path's ancestors
up to the **repository** root — not the project root, since a project inside a
monorepo has changes above it — worst-status-wins (conflicted > untracked >
modified); a folder row is then an O(1) lookup. The builder is a pure function
(`buildDecorations`), tested without rendering anything.
The obvious alternative — `changes.some(c => c.path.startsWith(dir))` inside the
row — is O(rows × changes) on **every render** of a tree that re-renders on every
poll. VS Code solves the same problem by indexing decorations in a
`TernarySearchTree` and deriving a folder's badge from `findSuperstr(uri)` (a
subtree query) over entries flagged `propagate`; we don't need a trie because our
change set arrives as one array we can index once.

**Edge cases.**
- Not a git repository → the tab stays present and says so. The strip must not
  reflow as you move between projects.
- Clean repo → "No changes" rather than three empty headings.
- Huge change set → capped at 500 rows, with a trailing "… N more changes" row,
  mirroring the file tree's truncation row rather than silently showing a
  prefix. (VS Code says "Too many changes were detected. Only the first N
  changes will be shown" at 10 000; the shape of the message is right, the
  number is ours — see `03-backend-rust.md` § `git`.)
- New directory of untracked files → one row per file, not one row for the
  directory. That is the common agent action and it should be legible.
- Binary file → no line counts, and the diff opens the existing "cannot preview
  binary" card rather than a diff of nothing.
- File deleted from disk between the poll and the click → the diff shows an
  empty right side, which is what deleted means; it is not an error.
- Detached HEAD / mid-rebase / empty repo with no commits → all report normally;
  an empty repo simply has no HEAD side, so everything is an addition.

---

## F14 — Auto-update (OTA)

**Behavior.** The app checks for a new release, downloads and installs it in
the background, and then tells you it's ready. Nothing restarts itself. See
ADR-0010.

**UI.** One control, in the **sidebar footer** (it moved out of `TopBar` when
the session tabs took that space, F16). At rest it is a quiet, clickable
"Check for updates" — a label that checks now rather than waiting for the
6-hour poll, so the updater is observable instead of merely promised; it reports
"Checking…", then either the badge below or "Up to date" for a few seconds
before settling back. Only a staged version earns the accent:

> `⟳ v0.2.0 ready · Restart`

Checking and downloading are silent by design. An announcement you can't act on
yet ("downloading 43%…") is noise beside a running agent, and the useful moment
is the one where a restart would actually gain you something.

**Restarting is a quit.** `relaunch()` tears the process down and takes every
live PTY with it — but it never fires `CloseRequested`, so the quit guard
(ADR-0005) never sees it, and a running Claude session would die without a
word. So the badge runs the same confirmation on the same terms:

> Restart to update? factorai 0.2.0 is ready. Restarting terminates N running
> Claude session(s). This cannot be undone — the update will also apply on its
> own the next time you quit and reopen.
>   [Later]   [Restart & kill sessions]

With no live sessions it restarts immediately, no dialog.

**Cadence.** On launch, then every 6 hours. factorai is meant to sit open for
days beside running agents, so launch-only would rarely fire. One install per
run: once a version is staged, further checks would re-download the same
release.

**Backend.** `tauri-plugin-updater` against
`https://github.com/Nightbr/factorai/releases/latest/download/latest.json`,
with signatures verified against the public key in `tauri.conf.json`.
`tauri-plugin-process` provides `relaunch()`. Both are imported **lazily** and
behind `isTauri()`, so browser-only dev and Playwright never load them and the
hook is simply inert there.

**Edge cases.**
- **Development builds never check.** `pnpm dev` runs an unpackaged binary
  whose version trails every release, so without a guard the updater finds an
  update on every launch, downloads the bundle, and offers to restart the
  developer into a release build of the code they are currently editing.
- Offline, or the endpoint is unreachable → stays silent. The app works, it's
  just not the newest; the error is logged, not surfaced.
- Already on the latest version → `check()` resolves null, nothing renders.
- Signature mismatch → the plugin refuses the install and it surfaces as an
  error state, which renders nothing. That is the failure mode we want: no
  update beats an unverified one.
- A `.deb` install has no update path at all — which is why Linux ships
  AppImage only (ADR-0010).
- macOS first install is still unsigned and needs the Gatekeeper dance; updates
  applied in-place afterwards don't re-quarantine.

---

## F15 — Zoom

**Behavior.** Scale the whole app up or down, persisted across launches.

**UI.** Three controls in the sidebar footer, beside the indexer status: `−`,
the current level, `+`. Clicking the level resets to 100% — the affordance
every browser has, and it saves a third button in a 288px footer. Each button
disables at its limit (50% / 200%), which is how clamping shows up to a user.

**Why the webview, not CSS.** `getCurrentWebview().setZoom()` rather than a CSS
transform or a root font-size: the embedded terminal draws to a canvas sized
from its container, so webview zoom makes it reflow properly — the container's
`ResizeObserver` refits xterm and the new cols/rows reach the PTY — whereas a
transform would scale a bitmap and blur the text while lying to the PTY about
its size.

**Backend.** None of ours. `core:webview:allow-set-webview-zoom` in
`capabilities/default.json`; the API is imported lazily and skipped outside
Tauri, so browser-only dev and Playwright exercise the control's state without
a webview to scale.

**Edge cases.**
- Repeated steps drift in floating point (`0.8 - 0.1` is `0.7000000000000001`),
  which would render as `70.00000000000001%` and never compare equal to the
  floor. `clampZoom` rounds to one decimal.
- A persisted value that isn't a finite number (an older build, a hand-edited
  store) falls back to 100% rather than propagating `NaN` into `setZoom`.

**Not wired: keyboard shortcuts.** `Cmd/Ctrl +/-/0` are the obvious bindings
and Tauri offers `zoomHotkeysEnabled` as a one-line config, but the embedded
terminal has first claim on keystrokes — the same reasoning that keeps `Ctrl+B`
off the file-tree toggle (Q15). It belongs to the keybinding pass.

---

## F16 — Session tabs

**Behavior.** The top bar carries a tab per **live session**, for switching
between running agents without going through the sidebar.

**A tab is a running PTY**, not an open document. The strip is driven straight
off `terminalStore`, so a tab appears when a session spawns and goes when the
process exits, however it exited. The header stays an honest picture of what is
running rather than a second list to keep in sync — and it renders nothing at
all when nothing is live, so the bar looks untouched until the first session.

**UI.** Project avatar, session title, and a close button that appears on hover
or on the active tab; a permanent row of `×` is a row of accidents waiting.

**The avatar, not a status dot.** Every tab is a live PTY by definition, so a
dot on each would be a row of green saying nothing; the avatar answers the
question you actually have with several open — which project is this one? The
project's name joins the title in the tooltip. A session too new to be indexed shows its short id, matching the
session header.

- **Reorder** by dragging, using native HTML5 drag-and-drop rather than a
  library: ~40 lines against a ~30KB dependency for one horizontal strip.
  The strip reorders **live, on `dragover`** — the tab travels to where it
  will land while you are still holding it, rather than making you drop to
  find out. Two things that took getting right:
  - **The ghost is a clone, not the element.** The browser snapshots the
    source *after* `dragstart` returns, so the dimming that marks a tab as in
    flight lands on the drag image too and you drag a near-invisible sliver;
    an inactive tab paints no background, so the snapshot is bare text on
    nothing. `setDragImage` takes a solid clone parked off-screen for the one
    frame the snapshot needs — off-screen rather than `display: none`, since
    an element with no layout box snapshots blank.
  - **The swap waits for the midpoint.** Swapping the moment two tabs touch
    puts the other tab under the cursor, which swaps them back, and the pair
    flickers as long as you hover there. Crossing the centre line is a
    commitment you have to travel back across to undo. `dropIndex` is that
    arithmetic, unit-tested, and its "stay put" cases are the guard —
    `to === from` is what stops the reorder firing.

  Releasing outside the strip keeps the last previewed order rather than
  snapping back: the strip has been showing that arrangement the whole way, so
  reverting on release would undo something you had already watched happen.
- **Overflow** scrolls horizontally, with the scrollbar hidden (at 40px it
  would eat a third of the strip) and a wheel handler mapping vertical scroll
  onto it — otherwise the wheel does nothing over the header and the tabs read
  as stuck. Switching session scrolls the new active tab into view.
- **Order** is in memory and appends at the end. Persisting it would be
  meaningless: quitting kills every PTY (ADR-0005), so there are no tabs to
  restore.

**Closing kills the session, so it always asks** — same terms as the quit
guard: an unattended `claude` is real money, and closing one mid-task loses its
work. On confirm the tab is dropped immediately rather than waiting for
`terminal:exit`; we know what we just did, and a tab that waits for an event is
a tab that lingers forever if the event is missed. A **failed** kill keeps the
tab, since the PTY may well still be running.

**Edge cases.**
- Closing the tab you're looking at navigates to its project; closing any other
  leaves you where you are.
- A session that exits on its own takes its tab with it, with no dialog — you
  didn't ask for it to close, so there is nothing to confirm.

---

## Cross-cutting concerns

### Keyboard shortcuts

| Shortcut          | Action                          |
| ----------------- | ------------------------------- |
| `Cmd/Ctrl + K`    | Focus sidebar search            |
| `Cmd/Ctrl + F`    | Find in viewer or terminal      |
| `Cmd/Ctrl + G`    | Go to line (editor only)        |
| `Cmd/Ctrl + N`    | New session in active project (not wired yet — F6 ships the buttons only) |
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
