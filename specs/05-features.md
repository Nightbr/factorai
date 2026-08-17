# Features

For each feature: behavior, UI, backend touchpoints, edge cases.
"The prior app ref" points at the file in the source repo this was derived
from, for cross-checking.

---

## F1 — Project list

**A project is a folder you added.** Not a directory Claude happens to have
worked in — see [ADR-0011](../docs/adr/0011-a-project-is-a-folder-in-the-workspace.md),
which is the contract this section implements. `~/.claude/projects/` is a
**discovery source**: we read it to find out which folders Claude has been used
in, and it takes an explicit act of yours to turn one of those into a project.

Two tables, two owners. `projects` is what you added and only your actions
write it; `discovered_projects` is what an agent's store contains and only the
scan writes it. Everything else in this section falls out of that split, most of
all the fact that **removing a project sticks** — the scan has nothing to put
back.

**Behavior.** On launch, show the folders in the workspace, ordered by
`last_session_at DESC`. Pinned projects float to the top. A folder Claude has
never run in is an ordinary project with no sessions yet; a folder Claude has
worked in that you never added does not appear at all, and nothing announces it.

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

**Pinning** is a **hover icon, and also a context-menu item.** An earlier draft
of this section rejected a right-click menu outright, on the grounds that
nothing in the app teaches anyone to right-click and that building the system
for one action would drag "Reveal in file manager" along with it. **That
reasoning has expired** and this paragraph supersedes it: there are three
actions now, and one of them — Remove — has nowhere else sane to live. A fifth
hover target in a 180px row is a misclick waiting to happen on a row with no
undo.

So the row has both, and they are not redundant: the icon is the fast path for
the action you take constantly, the menu is the one place all three live. The
hover icon stays exactly as specced below. Pinned projects rise into a
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

**The row's context menu** (`ContextMenu` in `@factorai/ui`, shared with the
file tree's — TODO item 3 needs the same primitive) carries **Pin / Unpin**,
**Reveal in file manager**, a separator, and **Remove Project**. Remove sits
below the separator and nowhere near Pin: the two are otherwise a slip apart and
only one of them is reversible with a click.

**Removing a project.** It drops the folder from the workspace and purges this
project's rows from the index. Nothing under `~/.claude` is touched — ADR-0004
— so no work is destroyed; adding the folder back re-parses it from transcripts
that never moved.

It does **not ask first**, and does not offer an undo. Nothing on disk changes
and recovery is Add Project… away, so a dialog on every removal would be
friction on exactly the action this whole model exists to make possible — you
will do it thirty times the week you upgrade. The cost of a misclick is a
re-parse.

The **one exception is a live session**. Then it confirms, names the count, and
on confirm kills those PTYs and closes their tabs before removing the row. The
alternative is `claude` still running with no row and no tab to reach it by,
which is precisely the invisible-agent state ADR-0005's quit guard exists to
prevent. If a kill fails the removal is abandoned rather than completed: the
tab is where you can still see the process, so keeping it is the safe failure.
Removing the project you are currently looking at navigates home.

The section header carries a sort control: **Recent** (the backend's
`last_session_at DESC` order, left exactly as returned rather than re-derived
client-side) or **Name**, plus **Expand all** / **Collapse all**. Sort and
expansion persist in `sidebarStore` — unlike the file tree's expanded *paths*,
which go stale when a directory is deleted, a project id stays valid.

**Adding a folder — two doors, one action.** The `FolderPlus` in the section
header is a **menu**: **Add Project…** opens the native directory picker, and
**Import from Claude Code…** opens the dialog below. Both call `add_project`
with a path; there is one concept in the data model and nothing special about a
Claude-derived project once it is in. A menu rather than two icons because the
header is 180px at its narrowest and already carries the sort control.

The chosen folder becomes a project and the app navigates to it, where the
existing `+` starts the first session. Adding and starting stay separate
actions: adding is cheap and reversible, starting a session is neither.

The **empty state** carries both as buttons rather than pointing at the icon in
prose — it is the one screen where the way out is the only thing worth saying.
Its copy leads with "No projects yet", not with what `~/.claude` contains: an
empty workspace has nothing to do with what Claude has.

**Import dialog.** One row per folder Claude has worked in, each a checkbox with
its full path, session count and last activity — enough to answer "is this the
one I mean". Read straight from the store via `read_dir` + `stat`, never parsed,
so it opens instantly however much history is there; and read from the store
rather than the index precisely because the index only covers the workspace.

- A **filter box** matches on the whole path, not the display name: with a dozen
  repos the names collide long before the paths do.
- **Select all** is three-valued. A partial selection shows a dash, because an
  empty box would say something false about what clicking does. Already-open
  rows are excluded from its counts, so it doesn't read as perpetually partial.
- **Already-open rows are shown, checked and disabled**, not filtered out — the
  list then answers "is this one already in?" rather than leaving you wondering
  whether it's missing. Same stance as the disabled `+` on a missing project:
  disable rather than remove, so there is somewhere to hang the explanation.
- A folder that is **gone from disk** is dimmed and labelled, and still
  importable. Every transcript survives; only starting a session is impossible.
- Rows are **newest-first**, which is what "is this the one I mean" usually turns
  on. No sort control: with a filter and a select-all already in a dialog you
  use twice, a third knob earns less than it costs.
- Importing runs the adds **sequentially**. Each one kicks off an index of its
  folder, and firing a dozen scans at one SQLite connection is how the first run
  that matters feels broken.

`@factorai/ui` gained a `Checkbox` for this (`@radix-ui/react-checkbox`). It is
paired with `Label htmlFor` rather than nested inside a `<label>`: a Radix
checkbox renders a `<button>`, which is not a labelable element, so the wrapping
form would associate nothing and swallow the click.

Adding is also what makes a folder **searchable**: indexing is gated on the
workspace, so `add_project` kicks off a scan of that folder on a background
thread, reporting through the `indexer:progress` events the footer already
shows. A store with thousands of turns would otherwise block the command.

The project's id is a **uuid**, and the folder's canonical path is what makes it
unique. Adding a folder twice is a no-op returning the existing project, so
neither the picker nor the import dialog can make duplicates; the path is
**canonicalized first**, so a symlink or a `..` lands on the row it should.
`display_name` and `pinned` are left alone on conflict — re-adding a project
must not silently rename or unpin it.

Cancelling the picker is an answer, not a failure — nothing happens and nothing
is said. A folder that can't be a project reports in a line under the section
header rather than a toast: it belongs to the button that caused it, and clears
the next time that button is pressed.

"Can't be a project" is: not absolute, not a directory, or **a path no agent has
history for that isn't on disk**. That last clause is doing real work. From the
picker a missing path is always a mistake, since you can only browse to a folder
that exists. From the import dialog it isn't: the folder was deleted, every
transcript survived, and reading that history is the whole reason the row is
offered. One rule covers both without a flag the caller can get wrong — and it
still rejects a typo, which no store has ever heard of.

**Backend.** `list_projects()`, `add_project()`, `remove_project()`,
`list_import_candidates()`, `pin_project()`, `resolve_project_path()`.
`list_projects` joins the workspace to its discovered directories and aggregates
`session_count` / `last_session_at` per query rather than storing them — they
change whenever the indexer runs, and a stale count is worse than a join.

**Edge cases.**
- **A project whose folder is gone** → the row dims to half opacity, gains a
  quiet `missing` label, and carries the full path in its tooltip (the next
  question is always "moved from where?", which a display name can't answer).
  Both `+` entry points disable, and the project page's `New session` disables
  with the path shown in `destructive` under the title.

  It is a `missing` column on `projects`, **set by the indexer's scan** — not
  computed per `list_projects` call, which is polled every 2s and would put a
  stat on every project in a hot path to answer a question that changes when
  someone deletes a directory. The flag clears on a later scan, so a restored
  folder needs no wiped database, and `add_project` clears it too — that command
  has just canonicalized the directory, so it knows better than a stale flag
  does.

  There is no longer a third state to distinguish it from. A project is a
  folder, so `real_path` is never null; "we never learned where this is" is now
  a property of a *discovered directory*, and one that can't be added until it
  resolves.

  Dimmed rather than struck through or badged in red: the row is still worth
  opening, since every transcript under `~/.claude/` is still there. Only
  *starting* is impossible. And the `+` is **disabled rather than removed** —
  a control that vanishes leaves nowhere to hang the explanation.

  The backend guard stays regardless: `portable_pty`'s `CommandBuilder::cwd`
  does not fail on a missing directory, it silently starts the child in
  `$HOME`, which files the session under the wrong project. The flag is the
  affordance; the guard is the invariant.
- **Claude runs somewhere new** → the watcher sees it and, if the folder is in
  the workspace, indexes it. If it isn't, the event is dropped **silently**.
  There is no badge, no count and no nudge: projects arriving uninvited is the
  thing this design removes, and the import dialog reads the store fresh every
  time it opens, so nothing is lost by staying quiet.

  The watcher still watches the whole tree recursively and filters late. That is
  deliberate: a folder you added and have never run Claude in has no store
  directory to watch until its first session exists, and only a recursive watch
  on the parent notices that appearing.
- `~/.claude/projects/` doesn't exist → nothing to import, which is not an
  error. The empty state points at "Add project", since that is the way out of
  it, and at installing Claude Code.

**The prior app ref.** `sidebar.js`, `derive-project-path.js`,
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

**Sub-agent rows.** A sub-agent transcript (`<session>/subagents/agent-*.jsonl`,
`subagent_of` set — see `specs/02-data-model.md`) is folded into the project
page **under the session that spawned it**, and is **collapsed by default**.

- The parent row gets a disclosure chevron in a left gutter and an
  `agent-count` badge. The count is not decoration: while the group is shut it
  is the only thing that says the agents exist. A session with none gets no
  chevron, but the gutter is still reserved, so titles line up in one column
  either way.
- Expanding indents the agents **past** the parent's title rather than level
  with it — nesting you can't see isn't nesting — and each carries a
  `sub-agent` badge and a `read-only` label where a parent has its chevron.
- Those two sit **right-aligned**, so every row's badge shares a column. They
  used to sit inline after the title, which truncates, so the badge landed at a
  different x on every row.
- The disclosure toggle is a sibling of the row's `Link`, never a child: a
  button inside an anchor is invalid and the two fight over the click.
- Expansion is per-session, **local to the page and not persisted** — same
  stance F12 takes for the file tree, and for the same reason.

Groups order by the parent's recency. An **orphaned** sub-agent (parent
transcript deleted) keeps its marking and leads its own group: filing it under
a parent that isn't in the list would hide it completely, and it is still
readable. `groupSessions` in `lib/sessionGroups.ts` is that fold, unit-tested
apart from the rendering.

The sidebar's inline ten-session list **excludes** sub-agents — its slots are
for sessions you can go back into, and the project page is where the nested
rows live.

**Edge cases.**
- Session file is huge (>100MB) → still index, just lazily.

**The prior app ref.** `sidebar.js`, `session-cache.js`.

---

## F3 — Session view (terminal-first)

**Behavior.** Opening a session shows the embedded terminal (F5) filling
the pane, with a thin header for the project name + session id. There is
**no** chronological JSONL event viewer for ordinary sessions.

**The header's one control is a close `×`**, an `IconButton` at the right
end, swapping to a labelled `Restart` when no PTY is live. Closing kills the
process, disposes the pooled xterm and navigates back to the project — which
is why it is a `×` and not the `Stop` it used to be: `Square` says "halt
something you stay parked on". It opens `CloseSessionConfirm`, the **same
component** a tab's `×` opens (F16), because two confirms for one act drift
apart — and until 2026-08-16 they had, the tab asking and the header not
asking at all. The dead branch needs no confirm and gets none. A kill that
fails still navigates away and **keeps** the session in `terminalStore`, so
the project page's status dot goes on telling the truth about a PTY that may
still be running.

**A git branch badge sits between the project name and the session title**
(added 2026-08-17) — the `GitBranch` glyph plus the branch name, muted, no
border and no background. It says where you are; it is not a control, and
nothing about it is clickable. A long name truncates at `12rem` rather than
pushing the close button around, with the full name on hover, following the
session id beside it.

It is **absent entirely** in all three of the states that are not "on a
branch", none of which is an error: the project has no repository
(`git_status` resolves `repoRoot: null` rather than rejecting — see F13), the
status has not loaded yet, or the repository has no branch to name. That last
case covers both a detached `HEAD` and an unborn branch, and `GitStatus`
carries no head SHA to tell them apart — so the badge stays quiet rather than
guessing "detached". Showing the SHA would need a new field on `GitStatus`.

**It does not reuse `useGitStatus`.** That hook is gated on the right panel
being open, because the Changes tab and the tree's decorations are its only
consumers and closing the panel should stop its 3s working-tree walk dead. The
badge is visible whether or not the panel is, so it has its own observer
(`useGitBranch`) on the **same query key** — one cache entry and one request
per project, two cadences. The badge polls at 30s and on window focus: a branch
changes when someone runs `git checkout`, not on every keystroke the agent
makes. It takes the project path as an argument rather than reading the active
project, so a session opened from search still names its own repository.

**Sub-agent sessions are the exception, and read-only.** A sub-agent
transcript can never be resumed — `claude --resume` probes for a top-level
`<id>.jsonl` and an agent id has none, so "opening" one as a terminal would
spawn a fresh `claude` under the agent's id. Instead the session view swaps
the terminal for a paged transcript rendering: `get_session_tail` (last 100
events, widened by "show earlier"), meta events skipped, message bodies
flattened the way the indexer flattens for FTS. No Stop/Restart buttons —
there is no process. Plain stateless rows honour the freeze that killed the
v1 event viewer:

> **History note.** M1 shipped a full JSONL event viewer (`EventLog` /
> `EventCard`). It was removed in `c6374d6`: mounting 100+ stateful React
> components in a single paint froze the WebKitGTK webview on Linux even
> with tail-pagination. The session view is now terminal-first
> (terminal-first). The only surfaces that render session content are
> search results (F4), which show short `snippet()` excerpts, and the
> sub-agent transcript view — both cheap to render and bounded.

**Backend.** `get_session_tail(session_id, limit)`, and nothing else — it is
what the sub-agent transcript view reads, and it resolves a sub-agent's
transcript path through its `subagent_of` parent.

There was an offset-paged `get_session` beside it, kept "available for future
use" after the viewer went. It was never called again and was **deleted on
2026-08-16** (roadmap item 9). Said plainly so it isn't re-added by reflex: a
command that reads a transcript by offset is the shape of the viewer the
history note above says not to rebuild. If a search-hit context preview ever
wants a bounded window around a hit, that is a new command with a hit position
in its signature, not this one restored.

**Edge cases.**
- Malformed line in JSONL → skip and log during indexing; never fatal.

**The prior app ref.** `main.js` terminal-first layout. (The old
`jsonl-viewer.js` port is retired.)

---

## F4 — Full-text search

**Behavior.** Search across the workspace by message body. Keep it simple: one
query string, optional filter to a single project, ranked results. No
event-level navigation (the session view is terminal-only — see F3), so a hit
identifies a *session*, not a position within it.

**Scope: added folders only** (ADR-0011). Indexing is gated on the workspace, so
a conversation in a folder you never added was never parsed and there is nothing
of it to find. This is a real loss of reach and is worth stating plainly: before
ADR-0011 search covered every folder Claude had ever touched, and the moment you
most want that is the moment you can't remember which folder it was. The
recovery path is to add the folder, which re-parses it with progress, and then
search. If that proves to be the wrong trade in use, the fix is small — un-gate
indexing and drop the `project_id IS NOT NULL` clause in `services/search.rs`.

**UI.** Sidebar search input (debounced) plus a dedicated `/search` route
that lists hits grouped by session, each with a `snippet()` excerpt and the
matched role. Click a hit → navigate to that session (opens its terminal).

**Backend.** `search_sessions(query, project_id?, limit)` → FTS5 over
`messages_fts` with `snippet()` + `bm25()` ranking. Returns up to `limit`
(default/cap 200) hits, each `{ sessionId, projectId, title, role, snippet }`
(`title` JOINed from `sessions` for the result label). The FTS index stores
no per-event position, so hits carry no `event_index`.

`messages_fts` carries **no `project_id` column**. It used to, holding the
encoded directory name, which was stable; a workspace id is not, since removing
a project and adding it back mints a new one and every stored row would be
stale. The project is resolved through `sessions` → `discovered_projects`
instead — one indexed join, always current, and the same join is what scopes the
search: it is inner, and a directory with no `project_id` isn't in the
workspace.

**Edge cases.**
- Empty / whitespace query → clear results, no command call.
- FTS special characters → the query is passed as a quoted FTS string so a
  stray `"` or `*` can't error the match.
- Index not yet built (cold start) → results are simply empty until the
  initial scan completes; the sidebar already surfaces `indexer:progress`.

**The prior app ref.** none — the prior app searches in JS over JSON; we
upgrade this to SQL FTS.

---

## F5 — Embedded terminal

**Behavior.** Launch `claude` (or `claude --resume <id>`) inside an
xterm.js terminal, backed by a PTY in Rust.

**UI.** Main pane, under F3's header — which holds the only controls there
are: close `×` (or `Restart` when the process is dead). No toolbar. This line
used to advertise "Resume/Restart, Kill, Copy selection, Search-in-terminal
(`Cmd+F`)"; copy-selection has no control at all, and `SearchAddon` is loaded
but nothing drives it, so `Cmd+F` is a keyboard-scheme item (roadmap item 5),
not a shipped one.

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

**The prior app ref.** `main.js` (PTY spawning), `terminal-manager.js`,
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

**The prior app ref.** `main.js` (resume path).

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

**Language detection resolves through Monaco's own registry** — extension,
then exact filename (`Dockerfile`, `Makefile`) — rather than a second
hand-written table beside `lib/fileIcon.ts`. The footer's label is Monaco's
own alias, so `rust` reads `Rust`.

**JSON is registered by hand, and the reason is worth keeping** (fixed
2026-08-17). `basic-languages` carries ~80 Monarch grammars and JSON is the one
common language missing from it — css, html, javascript and typescript are all
there, but JSON ships solely as a language *service*. So `.json` was absent
from the registry entirely, fell through to `plaintext`, and every JSON file
rendered unhighlighted with `Plain Text` in the footer.

The obvious fix does not work: importing the JSON feature's `register` installs
the full mode, whose `jsonMode` statically imports the code-action, hover and
completion providers, which pull editor contributions `editor.api` carries no
services for — the viewer then dies on open with `[createInstance]
CodeActionController depends on UNKNOWN service actionWidgetService`. Turning
the features off via `setModeConfiguration` does **not** help, because ESM
imports are static: the modules load whether or not their providers are used.

So `monaco.ts` registers the language itself and attaches only
`createTokenizationSupport`, the one piece free of the editor's DI graph — it
imports nothing but `jsonc-parser` and returns a plain `TokensProvider`. That
is exactly the syntax highlighting wanted and nothing else: no worker, no
IntelliSense, no red squiggles on a file the reader cannot edit anyway. It is
registered with `supportComments: true` and with `.jsonc` / `.json5` added to
Monaco's extension list, so a commented config tokenises its comments as
comments. **This was invisible to both `tsc` and the smoke suite** and was
found by opening a `.json` file in the dev app; `tests/smoke/file-viewer.spec.ts`
now guards it.

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

**Image controls** live in the view's own footer, not the modal header — the
header's actions are generic (copy path, open externally, close) and belong to
whatever hosts `FileView`.

- **Zoom** steps *multiplicatively* (×1.25), between 0.25 and 8. Additive
  steps would be a quarter of the image at 1× and three percent of it at 8×;
  a constant ratio is a constant apparent step. Deliberately wider than the
  webview zoom in F15 (0.5–2), which rescales the whole UI — this one exists
  to look at a screenshot's pixels. The wheel zooms without a modifier, since
  the pane has nothing else to scroll. **Scale 1 is *fit*, not natural size**:
  the `<img>` keeps `object-contain`, so a huge screenshot starts scaled down
  and a favicon starts alone.
- **Pan** is a pointer drag, enabled only above fit, with `setPointerCapture`
  so a fast drag that leaves the pane keeps panning. The stage is
  `overflow-hidden` with a transform rather than a scroll container — native
  scrollbars would fight the drag for the same gesture. Double-click resets;
  so does clicking the readout, which resets **zoom and pan together**, since
  a reset that left the image in a corner wouldn't look like one.
- **Copy** puts a PNG on the system clipboard.

**The clipboard needs Tauri, and finding that out cost a round trip.**
`navigator.clipboard.writeText` works in this webview — the header's copy-path
button is proof — so the obvious implementation is `clipboard.write()` with a
`ClipboardItem`. It does not work: **WebKitGTK doesn't implement
`ClipboardItem`**, the promise rejects, and nothing reaches the clipboard.
Verified rather than assumed — after a web-API copy, `xclip -t TARGETS` still
offered text targets only.

So copy goes through `tauri-plugin-clipboard-manager`, handed **raw RGBA** via
`Image.new`. Not the PNG bytes we already hold: `Image.fromBytes`/`fromPath`
make Tauri decode, which needs its `image-png` feature and *still* wouldn't
cover jpeg or webp. A canvas has already decoded the image for us, so RGBA is
free and format-agnostic — every format copies the same way. The web API is
kept for the browser-only lane, where Chromium does implement it.

No ADR for the new plugin: it is the same class of decision as the shell,
dialog, fs, process and store plugins, none of which took one. The failure
mode is what earns the write-up here, not the dependency.

A refused clipboard write says **"Copy failed"** rather than showing a tick.
A silent failure means pasting stale content somewhere else and not knowing.

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

**The prior app ref.** `file-panel.js`, `viewer-panel.js`,
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

**The prior app ref.** `viewer-panel.js` (its `codemirror-setup.js` no longer
applies — ADR-0007).

---

## F9 — CLAUDE.md & plans

**Behavior.** Per project, show `CLAUDE.md` and any `.claude/plans/*.md`.
CLAUDE.md is editable in-app; plans are read-only (they're working
documents Claude writes).

**UI.** **Not a side panel tab** — Q18 settled the strip as `Files | Changes`
and it is not a registry. `CLAUDE.md` is a file the tree opens, with editing
switched on for that one path, which makes plans free (they are `.md` under
`.claude/plans/`). Roadmap item 2 builds it that way.
Edits to CLAUDE.md trigger an explicit Save action with a dirty indicator.

**Backend.** `read_claude_md`, `write_claude_md`, `list_plans`, `read_plan`.

**Edge cases.**
- No CLAUDE.md → "Create CLAUDE.md" button writes a stub.
- File changed on disk while we have a dirty buffer → diff modal asks the
  user to merge or overwrite.

**The prior app ref.** `plans-memory-view.js`.

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

**The prior app ref.** `session-transitions.js`.

---

## F11 — Settings

**Behavior.** Theme, font, claude binary path, claude projects dir
override, font size, diff mode default.

**UI.** Dedicated `/settings` route. Sections: Appearance, Editor, Claude,
Advanced. All values flow into `prefsStore`, written to the plugin store.

**Backend.** `get_setting` / `set_setting` for anything that needs to
influence Rust (claude binary path, projects dir override).

**The prior app ref.** `settings-panel.js`.

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
  toggles. Single click on a file **opens the viewer** (F7) — not the OS
  default app: "Open in default app" lives in the viewer's header instead,
  via `plugin-shell`'s `open` (`shell:allow-open` is already granted),
  because the first click of a double-click has already opened the modal
  and the second lands on its overlay.
- **Right-click opens a menu on the row** (`FileRowMenu`), which is how the
  row can have no hover actions and still let you do more than open a file —
  at 288px a permanent control is a permanent accident. Right-clicking also
  **selects** the row: `panelStore` holds one `selectedPath` and there is no
  multi-select, so the row being acted on has to be the one you can see. Five
  rows, in order:
  - **Open** — the viewer, same as a click. Disabled on a directory.
  - **Open in default app** — `openExternally`. Enabled on a directory, where
    it hands the folder to the file manager.
  - **Copy contents** — the file as text. Disabled, *with the reason in the
    label*, for a directory, a binary, or a file `read_file` returned
    truncated: half a file on the clipboard that looks like a whole one is
    worse than no row at all. The read happens when the menu opens, through
    the viewer's own cache entry, so the disabled state is the truth rather
    than a guess. An image copies as an image (`copyImageFile`), reaching the
    same clipboard bridge the viewer's Copy-image button uses.
  - **Copy absolute path** — `entry.path` verbatim, no `~` collapsing: a path
    you copy is a path you paste into a shell.
  - **Copy relative path** — against the project root, POSIX separators, no
    leading `./`. The root row itself is `.`.

  A copy is acknowledged by a **transient tick on the row** (a cross if the
  clipboard refused), the pattern the viewer's copy-path button already uses.
  The menu has closed by then, so it cannot say so itself, and there is still
  no toast (roadmap item 7).
- **The WebView's own context menu is suppressed on app chrome**
  (`useNativeContextMenu`), because it is a browser's: measured on WebKitGTK
  2.52.3, right-clicking the panel or the sidebar draws `Back · Forward ·
  Stop · Reload · Inspect Element`. `Reload` there drops every pooled xterm.
  Two exceptions keep it: **the terminal**, where the native menu is a live
  `Cut · Copy · Paste` and pasting into the prompt is the only mouse-driven
  paste a session has (F5), and **text fields**. macOS is unverified.
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
work. The dialog is `components/dialog/CloseSessionConfirm`, **shared with the
session header** (F3): one component, so the two surfaces cannot come to
disagree about what the act is called or whether it is worth asking about.
On confirm the tab is dropped immediately rather than waiting for
`terminal:exit`; we know what we just did, and a tab that waits for an event is
a tab that lingers forever if the event is missed. A **failed** kill keeps the
tab, since the PTY may well still be running.

**Edge cases.**
- Closing the tab you're looking at navigates to its project; closing any other
  leaves you where you are.
- A session that exits on its own takes its tab with it, with no dialog — you
  didn't ask for it to close, so there is nothing to confirm.

## F17 — Error boundary

**Added 2026-08-17.** A throw during render used to unmount the tree and leave
an empty window: no message, and in a desktop app no address bar to reload
from. `components/layout/ErrorBoundary` is the floor under that.

**One boundary, at the root**, mounted in `App.tsx` **outside** the query
client and the router — a crash while constructing either is exactly the kind
it has to catch, and a boundary nested under them would go down with them.

**Root-only is a deliberate first cut.** Per-surface boundaries — so a broken
file tree cannot take a running terminal's pane down with it — are the obvious
next step, and are recorded in the roadmap rather than half-built.

**What it does not catch, because no React boundary does:** errors in event
handlers, in `setTimeout`, in unhandled promise rejections — anything outside
the render phase. Those belong to the toast path under "Error UX" below. Keep
the two apart: a toast is useless once the tree is gone, and this screen is far
too much for a command that returned an `AppError`.

**The screen shows the error rather than hiding it.** Name, message and
component stack in a scrollable block, because the person using this app is a
developer and a redacted "something went wrong" wastes the one moment the
information exists. Three actions:

- **Reload** — `window.location.reload()`. The webview reloads, not the
  process, so the PTYs survive: they live in Rust state and `terminalStore`
  re-syncs from `terminal_list()`. What does **not** survive is xterm's
  scrollback, since nothing snapshots or replays it. The screen says so
  underneath rather than letting it be discovered.
- **Report an issue** — opens a prefilled GitHub issue in the browser. It is a
  link, not a reporting service: nothing is sent, the user reads and edits the
  whole body first, and § "No telemetry" is untouched. The body carries the
  message, the component stack, the app version (a Vite `define` from
  `package.json`, so the crash path does not depend on the Tauri bridge still
  working) and the user agent — enough to tell a WebKitGTK bug from a macOS
  one.
- **Copy details** — the same report to the clipboard.

**The URL must be percent-encoded, and that is load-bearing rather than
tidiness.** The shell open scope in `tauri.conf.json` is `https?://\w[^\s]*`,
so a URL carrying a raw space or newline — which every stack trace has — fails
the plugin's regex validation and the click silently does nothing. Both halves
are guarded: `lib/crashReport.test.ts` on the building side and
`src-tauri/tests/shell_open_scope.rs` on the scope itself.

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
