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

**No scrollbar, and the grid fills the pane** (2026-08-18). Both came out of one
report — a white bar down the right of every session on macOS — and they are
three separate faults that happened to stack in the same 30px.

- **Colour.** The app declared no `color-scheme`, so WebKit painted every
  platform-drawn widget for a white page: scrollbars above all, but also the
  caret, `::selection` and native control internals. Now `dark` on `:root` and
  `light` on `[data-theme="light"]` in `@factorai/ui`, which fixes the same bar
  in the sidebar, file tree, Changes list and viewer.
- **Presence.** `xterm.css` ships `.xterm-viewport { overflow-y: scroll }`, so
  unlike every other scrolling surface in the app the bar was permanent rather
  than on demand. Whether you saw it at all was a *user* setting:
  `AppleShowScrollBars` defaults to Automatic, which means the opaque legacy
  scrollbar when a mouse is attached and the auto-fading overlay one otherwise.
  Now hidden outright (`scrollbar-width: none`). Scrolling still works — wheel,
  trackpad, keyboard — and drawing nothing is what Terminal.app and iTerm2 do.
  This is the one surface exempt from roadmap item 16's "visible enough to be
  usable": that constraint is about panels you navigate by position, and a
  terminal's scroll position is transient.
- **Width, which was neither of the above.** The scrollbar overlaid the grid
  rather than shrinking it (`.xterm-viewport` is `position: absolute; inset: 0`
  over `.xterm-screen`). The dead strip was `@xterm/addon-fit` reserving 14px for
  an **overview ruler** — the decoration minimap — that we never draw in and
  cannot switch off: xterm 5.5.0 spells that option `overviewRulerWidth`, the
  addon reads a nested `overviewRuler.width` from a later core, and the
  `|| 14` fallback therefore fires every time. That cost about two columns of
  every terminal on every platform. The addon is gone; `Terminal.tsx` sizes the
  grid itself from rendered geometry, with `proposeGeometry` as a pure, tested
  function. Measured on the browser lane: the grid went from 983px to 999px of
  1002px available, the remaining 3px being sub-cell remainder.

Each site carries the full reasoning — the two CSS files and the sizing section
of `Terminal.tsx`.

**Backend.** `terminal_spawn`, `terminal_write`, `terminal_resize`,
`terminal_kill`. `terminal:data` events stream output. The same reader parses
`OSC 0` titles out of that stream to tell working from waiting-for-input — see
F10, which owns the rule.

**Edge cases.**
- `claude` not in PATH → three-tier discovery (PATH → login shell →
  candidate probe) per `03-backend-rust.md`. Only fail if all three miss;
  surface the error with a "Set claude path" override hint.
- **`claude` found but nothing *it* runs is** → the session's own `PATH` is
  resolved from the login shell, not inherited from this GUI process, because a
  GUI process has never sourced an rc file and so has neither Homebrew nor any
  version-manager shim in it. Without that, hooks fail with `/bin/sh: bash:
  command not found`, stdio MCP servers fail their handshake with `-32000`, and
  a `statusLine` command fails with no banner at all. See
  `03-backend-rust.md` § `TerminalManager`. **Verify this from a
  Finder-/launcher-started build**: `pnpm dev` from a terminal inherits a healthy
  `PATH` and hides the bug entirely, which is the likeliest way to get a false
  pass on it.
- Process dies → `terminal:exit` event flips status to Stopped; UI shows
  "Process exited (code 1)".
- Window resize during high output → fit + resize requests are coalesced.
- **Window close with live PTYs** → mandatory confirm dialog. Quitting
  always kills all live children (SIGTERM → 500ms → SIGKILL). No orphan
  zombies, ever. The user can cancel the close.

**Links in terminal output — there are two kinds, and both go through one
gate** (the second wired 2026-08-17).

- **Regex-detected URLs**, found in the text by `WebLinksAddon`.
- **OSC 8 hyperlinks**, which the program *declares* by wrapping text in an
  escape sequence. These do **not** go through `WebLinksAddon` at all; xterm
  routes them to `options.linkHandler`, which is a separate wiring.

Both resolve to `onLinkActivated`: **modifier-click only** — Claude Code is a
TUI, and a bare click lands on interactive output often enough that opening a
browser on one would be an ambush — and then out through the shell plugin, never
`window.open`. The same gate for both deliberately: two kinds of link in one
terminal disagreeing about what a click means is worse than either rule alone,
and the ambush argument does not weaken because the program marked the text.

**Leaving `linkHandler` unset was a crash, not a gap.** xterm's own default for
OSC 8 calls `window.confirm` — and `tauri-plugin-dialog`'s injected init script
unconditionally replaces `window.confirm` with
`invoke('plugin:dialog|confirm')`, a command **plugin-dialog 2.7.1 does not
register** (it registers only `open`, `save`, `message`; `dialog:allow-confirm`
survives as a deprecated alias to `allow-message`). So it rejected with *"not
allowed by ACL"*, and before F17's window-level fix that rejection blanked the
whole app. Had it somehow resolved, the default then calls `window.open`, which
is the wrong destination in a webview anyway.

Two consequences worth keeping:

- **`window.confirm` and `window.prompt` are unusable in this app**, from our
  code or anyone's. Biome's `noRestrictedGlobals` denies both, so ours cannot
  come back; a dependency's cannot be stopped that way, only survived — which is
  what F17's classification now does. Use a `Dialog` from `@factorai/ui`
  (`components/dialog/CloseSessionConfirm` is the pattern).
- **Claude Code emits OSC 8**, which was an open question in roadmap item 15.
  Confirmed from the CLI binary itself (v2.1.233) rather than deduced from the
  crash — it carries a helper that is nothing but an OSC 8 emitter:

  ```js
  function link(url) {
    if (enableANSIColors)
      return `\x1B[1m\x1B]8;;${url}\x1B\\${url}\x1B]8;;\x1B\\\x1B[22m`;
  ```

  Note `claude --help` emits none, so a casual check says the opposite; the
  login screen is a different code path. So the "true OSC 8" half of item 15 is
  answered and wired, and what remains there is the *file*-link half.

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
**and the sidebar's expanded session list** union `list_sessions` with the live
terminals for that project that have no row yet, showing them at the top as
`New session` with a status dot (`pendingSessions` in `lib/sessionGroups.ts`,
shared by both). Without that union a session you navigate away from is
unreachable until you type in it — and the sidebar, which is where you look for
a session *under its project*, said `No sessions yet` about a project with a
running PTY. The sidebar's per-project count stays index-derived. The session
header shows `New session` until a title exists rather than a bare UUID.

Once the transcript is indexed, `sessions:changed` is what replaces the
pseudo-row with the real one and puts the derived title on the tab — see
`specs/04-frontend.md` § "Projects and sessions: no store". Nothing here may
rely on a poll to notice: the tab strip has none.

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

**UI.** **Not a side panel tab.** Q18 turned this claimant away because
`CLAUDE.md` has a cheaper home, and that reason is untouched by the strip later
growing a third tab for F18 — the strip is hardcoded either way, and a Memory tab
would be a worse version of something the tree already does. `CLAUDE.md` is a
file the tree opens, with editing
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

**Rewritten 2026-08-18** from the clarify-needs interview, on user feedback that
the green dot only means "connected" and cannot tell working from finished. The
previous version of this section described four states derived from "output flow
+ prompt detection" on a 200ms tick. All of that is changed: two of its four
states were never emitted by any code, and the mechanism it named is not the one
that works. The reasoning is here rather than in a commit message; the decision
is [ADR-0015](../docs/adr/0015-session-status-from-the-terminal-title.md).

**What it solves.** A live PTY is not one state. Claude is either doing
something, or it has handed back and is waiting for you, and the whole point of
supervising several sessions is knowing which is which without opening each one.
Today every live session is one green dot, which is why closing a session that
finished ten minutes ago still warns you that "any work in progress is lost".

### Behaviour

Three states, for sessions with a live PTY only:

| State           | Means                                        | Colour |
| --------------- | -------------------------------------------- | ------ |
| `working`       | Claude is doing something                    | green  |
| `waiting_input` | Claude has stopped; it is your turn          | amber  |
| `stopped`       | the process is gone                          | grey   |

There is no `idle`: nothing distinguishes "alive with nothing pending" from
"stopped and waiting for you", so the enum does not pretend otherwise. There is
no `running` either — the name is now `working`, because its *meaning* changed
and a silent redefinition is worse than a rename. A live PTY sitting at the
prompt used to be `running`; it is `waiting_input`.

### Backend — the terminal title, not the output

Claude Code sets the terminal title through `OSC 0` and encodes its own state in
the first character:

```
ESC ] 0 ; ✳ Claude Code   BEL      idle
ESC ] 0 ; ◐ Claude Code   BEL      working    (◐ ◑ alternating, 960ms)
ESC ] 0 ; ✳ Date command  BEL      idle again, title now names the turn
```

So the rule, in `TerminalManager`'s reader as bytes arrive — no polling, no tick:

- first char is `✳` (U+2733) → `waiting_input`
- any other non-empty first char → `working`
- no title yet, or a payload we cannot parse → **hold the previous state**
- from `terminal_spawn` until the first title (~300ms) → `working`
- `terminal:exit` → `stopped`

**The rule is inverted on purpose: enumerate the idle marker, treat everything
else as working.** Only `✳` is load-bearing, so any spinner glyph — present or
future — reads correctly. The alternative is to enumerate the *spinner*, and
the prior app shows what that costs: it matches braille frames (U+2800–U+28FF),
which Claude Code no longer emits — against 2.1.234 not one braille codepoint
exists in the binary — so **that check is dead code today**.

**Corrected 2026-08-18**, and the correction is the more useful half. This
section first said their busy state was therefore dead. It is not: they have a
second source for it, `OSC 9;4` progress, so the dead braille check is redundant
rather than load-bearing and their indicator still works. What their design
actually demonstrates is the cost of the choice, not a failure — one of their two
busy sources silently stopped working and nothing told them, because the other
one covered for it. A single enumerated glyph set with no second source would
simply have broken. Hence the inversion here: we have one source, so it must be
the one that cannot go stale.

**Two spinners exist and they are different.** The title animates `◐ ◑`
(U+25D0/U+25D1); the TUI *body* spinner is `· ✢ ✳ ✶ ✻ ✽`. Note that `✳` appears
in the body set, so a rule written against the body spinner would read idle
mid-spin. This rule reads the title and nothing else.

**Nothing has to be configured, and nothing is written anywhere.** No hooks, no
settings file, no environment changes, no cooperation from the CLI beyond what it
already does — which is what makes this safe under
[ADR-0004](../docs/adr/0004-claude-dir-is-read-only.md).

### UI

- Sidebar session rows, and sidebar project rows aggregating their sessions
  **attention first** — `waiting_input > working > stopped`. Same
  precomputed-lookup shape as F13's folder dots, but "worst" means a different
  thing here: for a changed file it is severity, for a session it is who is
  blocked, and the answer is you. A project row ranked `working` first — which
  is how this was built until a screenshot showed it — reads as "busy" when four
  of its sessions are blocked, hiding every one of them. The reverse mistake is
  milder: amber while four sessions hammer away still points at the one to act
  on. A working session resolves itself; a waiting one does not.
- The session header, with `<StatusDot pulse />`.
- **Tab avatars, badged** on the corner, reusing `ProjectIcon`'s existing badge.
  This retires F16's "the avatar, not a status dot" reasoning, which rested on
  every tab being a live PTY and so a row of identical green; that is no longer
  what a live PTY means.

**Only one dot animates.** The pulse is opt-in and used in exactly one place:
the session header, where there is a single dot describing what you are looking
at. Sidebar projects, sidebar sessions and tabs show the same colours without
motion — a dozen things breathing at their own rate is a christmas tree, not a
signal.

**Tooltip.** The state plus relative last activity: `Waiting for input · 12s
ago`.

### What it unblocks

`CloseSessionConfirm` is shown **only** when the session is `working`.
`waiting_input` and `stopped` close without a dialog, which is the ask this
feature came from. `QuitConfirm` is untouched and stays mandatory — losing every
live session at once is a different act, and ADR-0005 decided it.

**Known consequence, accepted 2026-08-18.** While a permission prompt is open the
title reads `✳`, so a session blocked on one reports `waiting_input` and closes
without a confirm. The state that would have caught it is `needs_permission`,
which was considered and dropped (below). What is lost is a dialog, not the
transcript.

### Edge cases

- **A title we don't recognise holds the previous state**, so a Claude release
  that changes the marker degrades to whatever the session last was — and a
  session that never emits a title stays `working`, which is exactly today's
  behaviour. This feature cannot regress the dot to something false; it can only
  stop improving it.
- App closed with live terminals → kill-on-quit means there are none to restore,
  so nothing is stale on next launch.
- Sub-agent transcripts (`subagentOf`) have no PTY and no status dot.

### Verification

Byte fixtures captured from a real session pin the parser: the working→idle
edge, an unknown glyph holding state, and no title staying `working`. Fixtures
are platform-independent by construction, so they prove the parser on both
macOS and Linux CI. `scripts/qa/osc-probe.sh` re-checks the *CLI* — run it after
a Claude update, or on a platform we haven't tried, and read the OSC timeline it
prints.

**Why this is not platform-specific.** factorai pins `TERM=xterm-256color`
itself, so Claude Code's view of its terminal is identical on macOS and Linux and
never reflects the host OS. In the CLI, the title's glyphs are module constants
selected by `isAnimating` with no platform branch, and the writer emits
`SET_TITLE_AND_ICON` with no `TERM`, `isTTY` or platform guard. Elsewhere in that
same file glyphs *are* chosen per platform (`macos ? "⏺" : "●"`), so the absence
here is informative rather than lucky.

### Considered and not built

Kept because each is a thing the next reader will otherwise investigate again.

- **`needs_permission`, via `OSC 777`.** Verified working: `claude --settings
  '{"preferredNotifChannel":"ghostty"}'` makes the CLI emit
  `ESC ] 777 ; notify ; Claude Code ; <message> BEL`, and the messages are
  `Claude needs your permission to use <tool>` (6s after the prompt opens),
  `Claude Code needs your approval for the plan`, `Claude Code wants to enter
  plan mode` and `Claude is waiting for your input`. Dropped by choice: it is a
  fourth state, a settings file to inject, and `CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK=1`
  in the child env to defeat the CLI's "are you away from the terminal" gate.
  Reinstating it is additive.
- **`OSC 9;4` progress.** `terminalProgressBarEnabled` (default on) is documented
  in the CLI's own settings schema as "Emit OSC 9;4 progress sequences during
  long operations", and `4;3;` / `4;0;` do bracket a turn exactly. But they only
  appear when the CLI believes it is talking to iTerm2, which means spoofing
  `TERM_PROGRAM` — lying to every child process about its terminal — to learn
  what the title already says.
- **`OSC 21337 TAB_STATUS`.** The CLI has a *structured* status protocol:
  `indicator=#rrggbb;status=Working…;status-color=#rrggbb`, with three states
  `idle | busy | waiting`. It is gated on a function compiled to
  `return !1`, so it is dead code in 2.1.234. **This is the upgrade to take when
  it ships** — it removes the glyph rule entirely and hands us `waiting` as a
  first-class state.
- **Claude Code hooks.** `PermissionRequest`, `Notification` and `Stop` give
  typed events instead of English message text, and would work for sessions run
  outside factorai. But hooks cannot be defined through `--settings`, so it means
  writing into `~/.claude/settings.json` or a project's
  `.claude/settings.local.json`, plus an inbound IPC channel from hook process to
  app. Not worth it for three states the title already provides.
- **Transcript tailing.** Would separate "finished a turn" from "asked you a
  question and stopped" — a pending `AskUserQuestion` with no `tool_result` is
  visible in the JSONL and invisible in the title. Deferred with the unread axis
  below.
- **The unread / never-opened axis** (`viewed_at` per session, compared against
  `updated_at`) — the third thing the feedback asked for. Deferred: it is durable
  state and a migration, orthogonal to the live PTY states here, and it is what a
  `finished` state would need to mean anything.

**The prior app ref**, read properly on 2026-08-18 because the README's "actively
running, idle, or finished" is worth knowing the mechanism behind. It is **four
signals, not one**, and only two of them are about Claude at all:

| Their state | Where it comes from |
| --- | --- |
| running / stopped | `get-active-sessions` IPC over the main process's `activeSessions` map, polled every 3s while any PTY lives and every 30s otherwise (`main.js:870`, `app.js:559`). Purely "a PTY exists" — the same thing our dot meant before F10 |
| busy | `OSC 9;4` progress, level 1/2/3 (`main.js:1201`) — plus a dead braille-title check at `main.js:1172` |
| idle | the `OSC 0` title's first char being `✳` (`main.js:1173`), gated on having been busy first |
| finished | `responseReadySessions` (`app.js:112`) — the busy→idle edge, recorded **only when that session is not the one you are looking at**, and cleared when you click it |

Two things worth taking from that. **Their "finished" is our deferred unread
axis**, not a process state: it is sticky until you look, which is exactly why a
`finished` state needs `viewed_at` to mean anything. And **`OSC 9;4` costs them
the `TERM_PROGRAM=iTerm.app` spoof** (`main.js:1128`, commented as being for
OSC 9) — the CLI emits no progress otherwise, which is what we measured
independently and why we took the title instead.

Also note the "noise-filtered terminal output" fallback its comments describe
(`app.js:104`) **does not exist in the code**: `setActivity` has exactly two call
sites, both OSC-driven.

---

## F11 — Settings

**Rewritten 2026-08-17** from the clarify-needs interview roadmap item 4 was
gated on. Not built yet. The previous version of this section named a
`/settings` route, four sections and `tauri-plugin-store`; all three are
changed, and the reasoning is below rather than in a commit message.

**The problem it solves is not "the app needs settings".** It is that **three
features in a row have arrived needing somewhere to put a preference and found
nowhere** — item 22's confirm toggles, item 31's release channel, and the diff
mode default that had to be parked in `panelStore` with a comment apologising for
it. That is what makes this worth a surface rather than three one-off toggles.

### Where preferences live — three places, on purpose

| What | Where | Why |
| --- | --- | --- |
| Layout state — widths, open/closed, which tab, expanded paths | `panelStore` / `sidebarStore` / `zoomStore`, localStorage | Nobody sets a panel width in a settings page; they drag it |
| User preferences the renderer alone reads | **`prefsStore`** (`factorai.prefs`), localStorage | Synchronous, so no hydration flash |
| Anything **Rust** must read | the SQLite `settings` table | Rust already has the pool, and it is ACID |

See [ADR-0013](../docs/adr/0013-preferences-storage-split.md), which also records
why **`tauri-plugin-store` is removed** rather than finally used.

**`prefsStore` is a fourth store, not a merger of the other three.** The line is
layout versus preference, and it is worth stating because F12 currently promises
the opposite: its `open`/`width` were going to migrate "when F11 lands", written
when `prefsStore` was going to be the only persisted store. They don't. A dragged
width in a preferences file buys nothing and costs a migration.

**One thing does move:** `diffInline`, which is a genuine preference that ended
up in a layout store. It migrates with a **one-time read-across** — `prefsStore`
adopts the value out of `factorai.panel` on first hydration, then `panelStore`
bumps to v2 and drops the key. A boolean is small, but silently resetting a choice
someone made is not the kind of small that is fine.

### The surface

**A medium modal, driven by the URL.** `?settings=claude|editor|confirmations`,
validated on the root route exactly as `?file=` already is. That is deliberately
both things: the modal keeps the session visible behind it and dismisses on Esc,
and the URL gives deep links, reload/HMR survival and browser-back-closes — which
were the only real arguments for a route.

**Medium, not near-fullscreen.** `FileViewerModal` is that size because Monaco
needs the room. Three short sections in a full-window sheet is settings floating
in empty space.

**Nav in a left column**, so Appearance and Advanced drop in later without
reflowing a horizontal strip. Not `Tabs`: the panel's strip is three peers you
switch between constantly, this is a table of contents.

**A gear in `TopBar`**, right side, left of the panel toggle. Not the sidebar
footer — that is already over-full (see F14), and settings is app-level chrome
rather than session or project chrome. Item 6's window controls sit at the
window's outer edge on both platforms, so the gear moves once by a fixed offset
when that lands rather than competing for the same pixels.

**`Cmd/Ctrl+,` is listed in § "Keyboard shortcuts" and is deliberately not wired
by this feature.** Roadmap item 5 replaces the per-shortcut `useEffect` pattern
with a scheme, and adding a seventh one-off that item 5 would immediately delete
is the churn that item exists to end — it would also have to get the
terminal-focus rule right on its own, which is item 5's hard half. The gear is the
discoverable way in, which is the one that matters; the binding arrives with item 5.

### Save, and what that makes load-bearing

**An explicit Save for the whole modal, with Cancel discarding.** Nothing is
written until you press it.

- **Save is disabled until something changes**, so the button *is* the
  unsaved-changes indicator.
- **A dot marks any nav section holding an edit.** With three sections and two
  coming, "something is unsaved" without "where" makes you click through the nav
  to find it — that is the specific failure a multi-section form with one Save
  button invites.
- **Esc and Cancel discard silently.** Both are deliberate gestures that already
  mean "back out", and a confirm-to-discard on top of Cancel is a small absurdity.
- **Click-outside does nothing while dirty.** It is the one dismissal you trigger
  by accident, reaching for the terminal behind the modal.

**An honest wrinkle:** a `Switch` that flips but does not apply until Save is
making a promise it has not kept. That is common in save-based settings and
workable, but it is *why* the two affordances above are not decoration — they are
what keeps the control from lying.

**Save writes SQLite first**, then `prefsStore`. The fallible store gates the
infallible one, so a failed write is a clean no-op with the draft still on screen
and the reason attached — rather than a half-apply where the renderer's
preferences took and the Rust-readable one didn't, with no way to tell which.

### Sections — three, not four

**Claude.**

- The detected binary and version as read-only text, from `check_claude_cli` —
  which has been on the bridge since M0 **with no callers at all**, so this is its
  first consumer.
- An override field, **empty, with the detected path as placeholder**. This is the
  one trap in the feature: **prefilling it with the detected path would silently
  convert "auto-detect" into a pinned path** the first time Save was pressed for
  any unrelated reason. Then the day `claude` moves — an npm update, a version
  manager switch — the app points at a path that no longer exists while the
  three-tier probe that would have found it is being overridden by a value nobody
  chose. Unset is a real state and it means "keep probing".
- **Validates on blur** with the same `version_for()` probe the detector uses,
  showing the version or the failure inline. An invalid path **disables Save** with
  the reason: the point of validating before you depend on it is not writing it.
- **Running sessions are unaffected** and the row says so. The binary is resolved
  at spawn, so there is nothing to restart, and offering to kill live Claude
  sessions as a side effect of editing a text field would be a strange place to put
  that question.

**Editor.** The diff-mode default (inline vs side-by-side), arriving out of
`panelStore`.

**Confirmations.** Roadmap item 22's two switches, both **on by default**: closing
a session with the `X`, and closing a tab by middle-click. That item is blocked on
*this* item's surface and nothing else, so the two ship together — which is also
what gives this modal enough content to be worth opening, and what proves
`SettingRow` against a real group rather than one text field.

**Appearance and Advanced are dropped until they have content**, and F11 no longer
claims four sections. Appearance would hold theme, which is deferred to its own
roadmap item (below); Advanced would hold item 31's release channel, which does not
exist yet. An empty section reads as a bug.

**Theme is not here, and that is a scope decision rather than an omission.**
Nothing in the app sets `data-theme` today, so the light palette in
`packages/ui/src/styles/globals.css` has never rendered. A theme control is three
unbuilt things — something to set the attribute, a second Monaco theme (only
`factorai-dark` is defined), and Q8's palette→xterm mapper that `Terminal.tsx`
currently hardcodes as three hex values — plus a light-mode pass over every
surface, including F18's lane colours, which have only ever been judged on a dark
background. That is a feature, and burying it in this one is how this one never
lands.

**Q3 still stands:** no projects-dir override. `CLAUDE_HOME` is the escape hatch,
and adding a setting for it means superseding Q3 rather than quietly filling in the
Advanced section.

### Backend

`get_setting` / `set_setting`, keyed by a **mirrored `SettingKey` union** — see
[`03-backend-rust.md`](./03-backend-rust.md) § `settings`. Today's only key is the
claude binary path; item 31's channel is the second.

The override is read by **`find_claude_binary(override)`** rather than
`TerminalManager`'s existing `binary_override` field. That field is documented for
tests, and `check_cli()` calls the finder directly — reusing it would leave the
Claude section reporting "not installed" while spawning worked fine, which is the
one inconsistency this section must not ship with.

### Edge cases

- **No override set, detection failing** → the detected line says so, and the
  field's placeholder falls back to a plain hint. This is the state the section
  exists for.
- **An override pointing at something that is not Claude** → rejected on blur, Save
  disabled. It cannot be persisted.
- **An override that was valid and later stops being** → sessions fail to spawn with
  the existing error. The section shows the probe failing next time it is opened;
  clearing the field restores auto-detection.
- **A hand-edited `?settings=nonsense`** → falls back to the first section rather
  than rendering an empty pane, the same rule `?diff=` follows for an unknown mode.
- **Reload with unsaved changes** → the draft is gone, because the draft is not in
  the URL. Consistent with Cancel, and the alternative is persisting state the user
  had not committed.
- **First run** → every preference is at its default and Save is disabled. Opening
  and closing settings writes nothing.

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
- Panel header: a `Files | Changes | Graph` tab strip (F13, F18), then collapse-all,
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

**State.** `panelStore` (zustand). `open`, `width` and the tab persist to
localStorage; expanded paths are per-project and deliberately **not**
persisted — a path that existed last session may be gone, and rehydrating
a tree of stale paths is worse than starting collapsed.

**Corrected 2026-08-17.** This used to say the store "migrates behind
`prefsStore` / `tauri-plugin-store` when F11 lands". It doesn't, on both counts:
`tauri-plugin-store` is removed entirely (ADR-0013), and F11 draws the line at
layout versus preference — a width you dragged is not something you set in a
settings page, so it stays here. What *does* leave is `diffInline`, which was
parked here for want of anywhere better and is a real preference; it moves to
`prefsStore` with a one-time read-across, and this store bumps to v2 to drop the
key.

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
it), which **F18 appended `Graph` to** rather than reordering, so Changes keeps
its position. Files is the default; the last tab
chosen persists app-wide in `panelStore`, alongside `open` and `width`. The strip
**never** switches itself because a file changed — the panel sits next to a
terminal you are typing into.

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

> `⟳ Update ready`

**The label was shortened 2026-08-17, and the reason is a bug rather than a
preference.** It read `⟳ v0.2.0 ready · Restart`, and in that state the component
returns a flex button with three children and no `min-w-0` — so its content sets a
min-content width the footer cannot shrink. It wants roughly 175px beside
`ZoomControls`, has about 156px at a 288px sidebar, and about 48px at the 180px
floor, so it **clipped the zoom controls instead of degrading**. Now: the version
moves into the tooltip (which also stops the label growing when item 31's channels
make `v0.10.0-alpha.2` a plausible version), `· Restart` goes since the tooltip and
a glowing button both already say it, and `min-w-0` plus `truncate` let it degrade
to the icon at the narrow end rather than pushing its neighbour out.

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

**Sized to be read — changed 2026-08-18 on user feedback.** The label is
`text-sm`, the same size as the sidebar's rows and the commit subject rather
than the 12px the strip shipped with, and a tab may reach **240px** before the
title truncates, up from 176px. At the old pair a tab showed ~18 characters of
a title claude derived from a first message, which is routinely not enough to
tell two sessions in one project apart; 240px and 14px gives ~25. The tab stays
`h-7.5` — the avatar (16px) and the close `×` (14px) moved up with the label
too, so a wide tab reads as one object instead of text with specks beside it. The
cap is still a *cap*: width follows the title, so a short one still makes a short
tab.

**The bar, the mark and the tab each grew 2px on the same feedback**, a follow-up
once the labels were bigger: `TopBar` 40 → 42px (`h-10.5`), the brand mark 16 →
18px (`size-4.5`), a tab 28 → 30px (`h-7.5`). A 40px bar was cut for a 12px
label, and 14px text in it left the strip looking packed rather than roomy. Two
pixels is deliberately the smallest change that reads: it is measured in the
running app, not asserted — 42 / 18 / 30 — because Tailwind's fractional spacing
steps are derived rather than enumerated, and a class that does not exist fails
silently by rendering the default.

**The avatar, badged with the status dot.** The avatar answers the question you
actually have with several tabs open — which project is this one? The project's
name joins the title in the tooltip. A session too new to be indexed shows its
short id, matching the session header.

The badge was added 2026-08-18, and this paragraph used to argue against it:
"every tab is a live PTY by definition, so a dot on each would be a row of green
saying nothing". That was true while a live PTY was one state. F10 made it three,
so the row of dots now says which session wants you — which is the most useful
thing the tab strip can tell you, since it is the surface you are already looking
at. Same corner badge as `ProjectIcon`, not a second mechanism.

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
- **Overflow** scrolls horizontally, with the scrollbar hidden (at 42px it
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

### The window-level half (fixed 2026-08-17)

The sentence above is why a boundary was never going to be enough on its own,
and until 0.10.0 the other half was a **scaffold from M0 that destroyed the app
on any unhandled rejection**: `main.tsx` set `root.innerHTML` to a red `<pre>`,
which unmounts the React tree and every live xterm in it. It predated the
boundary, sat outside React, and won.

What made it visible was the Graph tab. `DiffView` disposes its diff editor
whenever the commit, file or side-by-side mode changes, `createDiffEditor`
computes the diff in a **worker**, and disposing cancels that in-flight request
— so Monaco rejects with a `CancellationError`. Clicking through commits blanked
the app. Monaco's own `onUnexpectedError` drops these deliberately ("ignore
errors from cancelled promises"), so the app was treating as fatal something the
library that produced it does not consider an error at all.

`lib/globalErrors` now classifies before reacting, and the three outcomes are
the design:

- **Cancellation → ignored.** Matched by shape (`Error`, `name` and `message`
  both `Canceled`) rather than by importing Monaco, which would drag the editor
  into the main bundle (ADR-0007 keeps it behind the lazy chunk). All three
  fields are required: an unrelated error merely *named* `Canceled` must still
  surface, or this stops being a filter and becomes a place bugs hide.
  `console.debug` keeps it findable in DevTools.
- **Anything else, app already rendered → non-destructive.** A dismissible
  bottom-right card outside `#root` (`lib/errorNotice`), plus `console.error`.
  Whether the app is up is asked of the **DOM** — `root.childElementCount > 0` —
  rather than tracked with a flag, because the flag is the thing that would go
  stale in exactly the situation this handles.
- **Anything else, nothing rendered → full-screen.** Only here is replacing the
  document right: there is nothing to preserve and no other way to say anything.

`lib/errorNotice` is explicitly a **stopgap**, and item 7 should delete it: once
`@factorai/ui` has a toast and `AppError` has a routing story, a mounted app
should surface these through that. It exists because the alternative today is
`console.error` alone, and an invisible unhandled rejection is precisely how
this survived three releases.

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

## F18 — Git graph

**Specified 2026-08-17**, from the clarify-needs interview roadmap item 1 was
gated on. Not built yet.

**A viewer, not a git client, and that asymmetry is the whole reason it is
tractable.** GitKraken was open beside factorai for exactly one purpose:
*seeing* where the repository is — which branches exist, what is on them, how
they diverged. Everything a git GUI is usually for — committing, rebasing,
merging, resolving — the agent in the terminal below already does better. This
ships the half that justifies the weight and none of the half that doesn't.
[ADR-0009](../docs/adr/0009-git2-for-repository-state.md)'s read-only clause is
untouched: nothing here commits, stages, checks out, pushes or fetches, and
`git2` is compiled `default-features = false`, so network transport isn't merely
unimplemented — it isn't linked in.

### Placement

**A third tab: `Files | Changes | Graph`**, appended so the two existing tabs
keep their positions and their muscle memory. This **amends Q18**, which
originally decided the strip ships "exactly two tabs" — see that question for
what changed and what didn't. Q18's other half is why the strip is safe to grow
at all: selection persists app-wide in `panelStore` and **never switches
itself**.

**The panel is 200–600px, and that is the design input rather than a squeeze to
resolve later.** Q18 disqualified project-wide search from this strip
specifically for wanting more than 288px, and a commit graph is at least as
width-hungry. So phase 1 is a **rail** designed for 288px from the first line —
lanes and subjects in a column, GitLens's sidebar density rather than Git
Graph's tabular spread.

**Phase 2 is deferred, not dropped, and it is a hosting change.** The same
component, at 900–1200px in a near-fullscreen modal: pitch back to its full
12px, subjects untruncated, the detail pane moving from below the list to beside
it. Keeping it a *hosting* change rather than a second layout is what keeps it
cheap enough to actually happen. `FileViewerModal` is the shell precedent, and
F16's per-project tabs are the eventual home for both.

**Bound to the project folder and to that alone** — `Repository::discover()`
from the project root, exactly as F13 does, so a project inside a monorepo shows
that repository. Worktrees change what "the repository" means on screen and are
a later phase.

### The row

**26px, one line, `py-[3px] text-sm`** — the same density as the file tree and
the Changes list, because three tabs that scroll at three rhythms read as three
apps. Left to right: the lane rail, then ref chips, then the subject.

**Refs are badges, and they carry an icon. Changed 2026-08-17 on user
feedback**, from the bare coloured labels this shipped with. A ref is an object
sitting on the row, not an adjective describing the subject beside it, and at
288px the bare labels ran into the subject often enough to read as one string.
The tint is 12% behind a hairline border, so it stays a ground rather than a
filled block — `IconButton`'s no-background rule is about controls, and a badge
is not one.

The icon says **where the ref lives**: a laptop for a local branch, the forge's
own mark for a remote one, a tag for a tag. The forge comes from `origin`'s
configured URL, read in Rust — a config read, never a request to the forge, and
an unrecognised host gets a generic cloud rather than a guess. GitHub and GitLab
marks come from `@iconify-json/simple-icons` through the same build-time
compilation the file-type icons use (ADR-0006); lucide has no brand set.

**A chip is capped at 55% of the text column and truncates.** Uncapped, one
`feature/some-very-long-description` pushed the subject off the row entirely. 55
rather than something tighter because the icons cost width: at 288px a 40% cap
cut `HEAD→main ≡origin` down to `HEAD→…`, which names nothing. The full name is
on the hover card, which is where everything the row cut is supposed to be.

**Refs come before the subject** because they are what you are scanning for, and
they **fold before they collapse**. Three rules, applied in order, mostly
dissolve the crowding rather than managing it:

1. `HEAD` merges into its branch chip rather than taking a slot of its own.
2. `origin/HEAD` is **hidden outright**. It is a symbolic ref duplicating
   `origin/main` and it is the single most common cause of overflow.
3. A local branch and its remote **on the same commit** collapse to one chip.
   This is the load-bearing one: local and remote crowd the same row *only when
   they are in sync* — once they diverge they are on different rows and there is
   nothing to crowd.

So the four-chip worst case — `main`, `origin/main`, `origin/HEAD`, `v0.3.0` —
becomes two chips. What still overflows collapses to a `+N` chip, ordered local
branch → remote branch → tag; the chip is itself hoverable and opens the same
card.

**The first two foldings used to spell themselves out in the label, and no
longer do. Changed 2026-08-18 on user feedback.** The chip read
`HEAD→main ≡origin`: 17 characters, of which 4 were the branch name. Measured at
the default 288px, refs get half the text column — about 17 characters — so the
chip that mattered most was the one guaranteed to truncate, and a tag on the same
commit was pushed into `+1`. The two decorations are **marks** now, beside the
laptop already saying where the ref lives:

- **A tick for HEAD**, which is how a checked-out branch reads in every other git
  UI, at a fifth of the width of `HEAD→`.
- **The forge's own logo for the synced remote**, standing in for ` ≡origin`.
  *Which* remote is a repository-level fact and almost always `origin`, so
  spending eight characters per row naming it never returned the width.

**Nothing is deleted, it moves to the chip's `title`** — `Local branch main ·
checked out (HEAD) · in sync with origin/main`. That is the condition on the
trade: a mark is faster to scan and worse to learn, so it is only an improvement
while the sentence it replaced is one hover away.

**Hovering a chip also releases its width cap**, so a name the row truncated
becomes readable in place without opening the card. The cap is an inline style
computed from the panel width, so the hover rule carries `!` to outrank it.

`+N` is still the common case at 288px for a tagged release on the branch tip —
the chips got shorter, not free, and the icons cost width of their own, which
`fitRefs` charges for. That remains the width constraint Q22 deferred rather than
answered.

### The subject is quiet until you point at it

**Changed 2026-08-18 on user feedback.** The subject was `--foreground` on every
row — 96% lightness, the brightest thing in the panel, repeated down the whole
column. Everything shouting equally is how a list stops having a focus, so the
resting colour is `--secondary-foreground` (82%, the same hue two steps quieter)
and the row under the pointer takes full `--foreground`.

A **selected** row keeps full foreground without waiting for a hover: selection
is a state, not a hover, which is the reasoning the panel toggle already carries
(F12) and the same rule as pinned rows keeping their affordances on show.

### The node is its author

**Added 2026-08-17 on user feedback.** The commit node is a disc in a colour
derived from the author's email, carrying their initials. Scanning a history for
"the ones I did" is a real thing people do to a graph, and it was previously
impossible without opening every row.

**Derived locally, and that is a decision rather than a shortcut.** Gravatar and
the GitHub avatar API both work, and both mean the same thing: every repository
you browse sends that repository's author identities to a third party, from an
app whose README promises it "reads local files and runs local processes" and
whose non-goals say no telemetry and no server. Turning that on is an **open
question with an ADR attached**, not an implementation detail — so the fallback
*is* the avatar today, and it is drawn well enough to stand on its own. The
resolver seam is there: a remote lookup would sit in front of `avatarFor`, and
everything under it stays the offline default.

Colour is one of 12 hues at a fixed lightness and chroma, so no author's dot
shouts louder than another's. The key is the **email**, normalised in Rust, so an
author who changes how their name is spelled keeps their colour.

**A dark tinted disc with near-white initials. Tuned twice on 2026-08-18, in one
conversation, and both moves are worth recording** because the second one is what
the first one taught. It shipped `oklch(62% 0.14 h)` — too saturated, a strip of
loud dots down a rail whose *lane* colours are the thing it exists to show. The
first fix halved chroma and lifted lightness to `oklch(80% 0.07 h)`, which traded
loud for bright: a near-white disc is the lightest thing in the panel, so it
still won the row. `oklch(45% 0.09 h)` is the third try — dark enough to sit
*under* the lane ring around it, tinted enough that twelve hues stay tellable
apart. **Darker still was rendered and rejected**: at `32%` the disc dissolves
into the background and only the ring and the initials read, which costs the one
thing the avatar is for.

The initials move with the fill, and that half is not cosmetic. They were painted
`--card` — a theme token: near-black in the dark theme, **white in the light
one**. That happened to work while the disc was mid-tone, and it would have meant
a pair that only renders correctly in the theme we can currently see, since item
32 has not shipped. `avatarInk` returns a tone of the disc's own hue from the same
function as the fill, so the contrast is a property of `lib/avatar.ts` rather than
of whichever theme is mounted. It **flipped from dark to light** when the fill
went `80%` → `45%`, which is precisely the coupling that gets missed when the two
values live apart; the unit test asserts the *absolute* 50-point lightness gap
for the same reason.

**The disc gives way to a plain dot below a 10px lane pitch.** It is 18px wide
however tight the lanes get, so on a wide history it would cover three lanes and
the rail would stop being traceable — which is the job the rail exists to do.
Those repositories read their authors off the hover card instead, the same trade
the subject makes when it truncates.

**The ring around the disc is the lane's colour. Changed 2026-08-18 on user
feedback**, from the row's background. That ring exists to cut whatever passes
behind the disc, and painting it in the background did that — but it also cut the
node's *own* lane line, so the node read as floating free of the line it sits on,
which is the one relationship the rail is drawn to show. In the lane's colour the
line runs into the node and still nothing behind it shows through.

**The disc keeps the author's hue**, so ring and disc answer the two different
questions a node is asked: which lane, and who. Making the disc itself the lane
colour was the other reading of that feedback and was rejected — it would cost
"scan for the ones I did", which is the entire reason the node became an avatar.

**The rows are indented 12px, and were not. Added 2026-08-18 on user feedback:**
`laneInset` reserves exactly enough rail for the outermost disc to be drawn
*whole*, which is not the same as drawn with air around it — lane 0's avatar came
out with its left edge on x=0, touching the panel border, while every row in
Files and Changes is indented. `ROW_PAD_LEFT` is 12px, the number the Changes tab
and the graph's own `Empty` / Load-more (`px-3`) already agreed on, and the
scroller gained the `py-1` those two share so switching tabs doesn't shift the
first row.

It is a constant in `lib/gitGraph.ts` applied as an inline style rather than a
`pl-3` class, for the same reason `FileTreeNode` keeps `INDENT` in code: `fitRefs`
subtracts it from the text budget, and a Tailwind class would leave the indent and
the budget free to drift. The working row takes the same inset — it sits directly
above HEAD's row, so a 12px disagreement between them reads as the rail bending.

**The rail reserves room for the disc, and did not always.** Fixed the same day:
lane 0's centre sat at half a pitch — 6px — against a disc of radius 9 plus a 1px
ring, so 4px of every avatar on the leftmost lane was clipped by the panel edge.
`laneInset` now claims `AVATAR_RADIUS + AVATAR_RING / 2` whenever an avatar is
actually drawn, and half a pitch below `AVATAR_MIN_PITCH` where the node is back
to a 3px dot and there is nothing to clear. `laneCentre` and `railWidth` derive
from it together — they were computed separately in two files, which is how this
went unnoticed.

### The rail

**The rail's width is capped; the lane pitch compresses.** Budget is ~35% of
panel width. Pitch starts at 12px and compresses toward a **6px floor** as lanes
grow, so four lanes look generous and fourteen still fit; past what 6px can hold
the rail alone scrolls horizontally. The two failure modes this is chosen
against are the ones that matter: **no commit is ever hidden**, and the subject
always keeps a floor.

The alternatives were a fixed 12px pitch (a 16-lane moment leaves ~90px for text
inside a 288px panel) and a hard six-lane cap with an overflow lane — rejected
because its edges are approximate, and a viewer whose entire job is being
trustworthy cannot draw a shape that isn't the repository's.

**Lanes are coloured by index**, from a small fixed palette cycled per lane.
Colour is what makes an edge traceable across a merge in a narrow column, and
tracing is the job. This feature **establishes the repo's categorical colour
tokens** — see
[ADR-0012](../docs/adr/0012-categorical-colour-tokens.md).

### Interaction

**Hover un-truncates. Click goes deeper.** That is the whole rule, and it is
what makes a 38-character row acceptable.

- **Hover** opens a card showing what the row had to cut: full subject, the
  complete ref list (including whatever `+N` hid), author, absolute *and*
  relative date, short SHA. A vendored shadcn **HoverCard**
  (`@radix-ui/react-hover-card`) — the correct primitive for "popover opened by
  hover": it carries open/close delays and does not steal focus. Radix Popover
  is click-triggered, and Tooltip is `role="tooltip"` with content you cannot
  select or click, so neither fits. **Opens immediately, closes after 150ms.
  Changed 2026-08-18 on user feedback**, from a 400ms open delay meant to stop a
  sweep down the list firing a cascade of cards. In use the cascade never arrived
  and the wait did: this card *is* what un-truncates a row, so pointing at a row
  you cannot read and waiting is the whole interaction, and 400ms of nothing
  reads as the app failing to respond. Radix already keeps the sweep tolerable —
  one card is open at a time, and crossing to another trigger swaps the content
  rather than opening a second. The close delay stays, because it is what lets
  the pointer travel from the row onto the card without it vanishing underneath,
  and it costs nothing on the way in. Measured after the change: 45ms from hover
  to visible card.

  **It opens beside the row, to its left. Changed 2026-08-18 on user feedback**,
  and this placement has now been both — so the two complaints are worth keeping
  apart, because they are different complaints rather than one reversed.

  It began as `side="left"` at a fixed `w-80`, and on 2026-08-17 moved under the
  row: opening leftwards put the card outside the panel and over the terminal at
  an offset nothing bounded. Opening under the row fixed that and introduced the
  second complaint — **the card covers the commits below it**, which is the list
  you are reading it in order to navigate. A hover card that hides its own
  context is the worse of the two, so it is back on the left.

  **What actually broke the first time was the width, not the side.** A fixed
  `w-80` inside a panel whose floor is 256px meant collision handling shoved the
  card sideways to fit a width nothing had. It is now bounded at both ends:
  `--radix-hover-card-trigger-width` so it tracks the row, `min-w-72` so a narrow
  panel doesn't produce a cramped card, `max-w-96` so it always fits the space to
  the left. The worst case is a 600px panel in an 1100px window — the minimum
  this app allows — leaving ~500px for a card that can never exceed 384px, so
  Radix never flips it back to the right or slides it somewhere unpredictable.
  Collision padding is on **both axes** now; it was vertical-only while the card
  opened downwards, because the panel *is* the window's right edge and pushing
  left put the card back outside it. Opening leftwards inverts that — the padding
  is what holds it clear of the window's left edge.
- **Click** selects the row and fills a detail pane **docked at the bottom of
  the panel**, split from the list by a horizontal drag handle whose height
  persists in `panelStore`. The pane carries the message body, author, date, the
  short SHA with a copy control, the parent chips, and the commit's changed-file
  list — **reusing `ChangesView`'s row rendering verbatim**, since a `+12 −3`
  badge at 288px is a problem F13 already solved and a second file-row style
  would be a second thing to keep consistent.

  **The pane is a header plus two tabs. Changed 2026-08-18 on user feedback**,
  from one scrolling column with everything stacked. Stacked, the chrome —
  subject, body, author, parents, the Changes heading — could fill the default
  200px pane on its own, so clicking a commit showed everything about it except
  the files you clicked for. The body had already been capped at 80px to fight
  that, which treated the symptom and cost the body its readability.

  - **Above the tabs, always visible: identity.** Subject (clamped to two lines,
    full text on `title`), the short SHA with its copy control, author, relative
    *and* absolute date, and the parent chips. These say *which* commit you are
    looking at rather than being one of the things to look at — and putting them
    in a tab meant trading the file list away to answer "who wrote this". It also
    keeps the parent chips, which are how you walk history, reachable from either
    tab.
  - **`Changes N` and `Description`.** Changes is the default, because the hover
    card already carries subject, refs, author and date, so the files are the
    reason to click at all. The count sits on the tab, so "how much changed" is
    answerable without opening it. The body is uncapped in its own tab — there is
    nothing beneath it to crowd any more.
  - **The selection is component state, not `panelStore`.** It is a reading
    position rather than a preference: it follows you from commit to commit
    within a sitting, which is what you want while walking a history, and starts
    back on Changes next launch.

  **`DEFAULT_DETAIL_HEIGHT` is 280, up from 200**, which is about eight file rows
  once the header and tab strip are taken out. Deliberately not more — the graph
  above it is the reason the pane exists. A raised default reaches nobody on its
  own, since this value has persisted since F18 shipped, so `panelStore` went to
  version 2 with a migration that lifts **only** a height that is exactly the old
  default. Any other number is one somebody dragged to, and overwriting a
  deliberate choice would be the worse failure — and an unrecoverable one, since
  nothing records what they had.
- **Clicking a file** opens the existing Monaco diff:
  `?file=<path>&diff=<parentSha>..<sha>`. Git's own range notation, both ends
  explicit, so nothing in the renderer has to resolve `sha^`.
- **A merge diffs against its first parent**, labelled `vs 88f3b0e`, with every
  parent shown as a chip that selects that commit in the graph. First-parent
  diff on a merge is precisely "what did this merge bring in from the other
  branch", which is the question you have when you click one. A combined diff
  has no Monaco representation, and a parent *picker* is phase-2 polish.
- **Keyboard**: `↑`/`↓` move the selection, `Enter` opens the detail,
  `Home`/`End` jump. A **component-local roving tabindex**, deliberately not a
  global binding — these are list semantics while the list has focus, so they
  add nothing to the one-`useEffect`-per-shortcut problem the keybinding scheme
  exists to solve, and that scheme adopts them unchanged. F2's sidebar `↑`/`↓`
  was deferred to that pass; this breaks with it because 300 rows is where
  mouse-only genuinely hurts.

### Scope of the walk

**All refs**: every local branch, every remote-tracking branch, every tag, and
`HEAD`, walked `TOPOLOGICAL | TIME`. "Which branches exist, what is on them, how
they diverged" is unanswerable from a filtered walk, and "the current branch and
its neighbours" has no definition that survives a real repository — a
six-month-old branch is or isn't a neighbour depending on what you wanted. The
page limit does the work, not the ref count: a revwalk with forty pushed refs and
a 300-commit limit costs what one pushed ref costs.

**Remote-tracking refs are shown and labelled.** The staleness objection is real
in general and does not apply here: the agents in factorai's own embedded
terminal run fetch, pull and push constantly, so `.git`'s remote refs are as
fresh as this workflow makes them — fresher, in practice, than a git GUI polling
on its own schedule. And "am I ahead of `origin/main`" is the most common form
of the divergence question.

### Freshness

**A 30s poll, gated on `open && tab === 'graph'`**, plus `refetchOnWindowFocus`
and the refresh button already in the panel header. This mirrors both existing
precedents exactly: `useGitBranch`'s 30s cadence, because a commit landing is a
`git checkout`-class event and not a keystroke-class one, and `useGitStatus`'s
`enabled` gate, so switching to Files stops the revwalk dead and a closed panel
costs nothing. The 3s Changes cadence is wrong here — a revwalk plus full ref
enumeration is meaningfully more work than a status walk, and rows shifting
under a line you are reading is the annoyance Q18 legislated against for tabs.

### Scale

**300-commit pages, plain DOM, an explicit "Load more".** No virtualisation:
there is none anywhere in this repo, `MAX_CHANGES: 500` is the established
answer to "too many rows", and 900 rows of 26px DOM is not something React
struggles with. `@tanstack/react-virtual` would be a new load-bearing dependency
and therefore an ADR — buy that when paging demonstrably hurts, not before. It
also interacts badly with lane assignment, which is computed across the walk
rather than per row.

### The working tree

**A working-changes row above HEAD, which opens the Changes tab. Reversed
2026-08-17 on user feedback**; this section previously specified a hollow dot on
HEAD's row and rejected the row outright.

A graph showing `main` on a commit while forty files are uncommitted reads as
"clean", and that is a lie worth fixing. The hollow dot fixed it in a way you had
to already know how to read: a filled and a hollow 5px circle differ by a few
pixels at 26px, and nothing on the row said which was which or what to do about
it. The row carries a label and a count, and — the actual point — it can be
clicked.

**The Q18 objection was over-read, and that is worth writing down.** This section
used to say "Q18 forbids it solving that by switching tabs for you". Q18's rule
is that the strip *never switches itself* — "a tab strip that moves under you
while you type into the terminal below it is worse than no tab strip". A row the
user clicks, whose tooltip says where it goes, is navigation and not that. The
rule is about autonomous movement; nothing here moves on its own.

It still does not duplicate F13: the row says *that* there is uncommitted work
and how much, and F13 remains the only place that says what, in the three groups
Q19 models. The count is **free** — the graph tab being open means the panel is
open, so `useGitStatus`'s query is already in cache under the same key.

**The row leads the list only when HEAD is the newest commit.** Detached, or with
newer commits on another branch, HEAD sits further down and a row pinned to the
top would draw an edge into a commit it is not on; those repositories keep the
hollow node on HEAD's own row. Its node is hollow **and dashed**, because nothing
in it is a commit and a marker that looked like its neighbours would be claiming
otherwise.

### Backend

`git_graph`, `git_commit`, `git_blob_at`, and a new `head` field on `GitStatus`
— see [`03-backend-rust.md`](./03-backend-rust.md) § `git`. `GitGraphCommit`
also carries `authorEmail`, lower-cased because it is an identity key rather
than a display string, and the page carries `remoteHost` — which forge `origin`
names, from its configured URL. Both are **config and object reads**; ADR-0009
is untouched and no transport is linked in. **Lane assignment
runs in Rust** and the payload carries lane indices and edge segments; the
renderer draws SVG and never reasons about the DAG. See Q23 for why.

### Edge cases

- **Not a git repository** → the tab stays present and renders `Not a git
  repository.`, the same string and shape as `ChangesView`. `git_status`
  already resolves `repoRoot: null` rather than rejecting; the graph does the
  same thing. The strip must not reflow as you move between projects.
- **Repository with no commits** (unborn `HEAD`) → `No commits yet.` There is
  nothing to walk and that is not an error.
- **Detached `HEAD`** → a bare `HEAD` chip on its commit, with no branch to fold
  into. The session header's badge shows the short SHA in this state, which is
  what `GitStatus.head` is for.
- **Shallow clone** → the walk ends where the clone does and "Load more"
  disappears, rather than offering history that isn't there.
- **Refs moved between pages** → invalidate and refetch from page 1 rather than
  splicing a page walked against different refs onto one that wasn't.
- **A commit with a dozen tags** → chips fill the ref budget, the rest is `+N`,
  and the hover card lists all of them. The row's height does not change.
- **Octopus merge** → all parents are chips; the file list is still the diff
  against parent 1.
- **Orphan branch** → its own lane from the top of the walk, joining nothing.
  This is a lane-assignment test case, not a special case in the UI.

### Non-goals, and they are load-bearing

No commit, stage, discard, rebase, merge, cherry-pick, checkout, push or fetch.
Adding any of them means revisiting ADR-0009, not adding a button. **No session
linking in the first cut** — relating a commit to the session that produced it
is the interesting question and is deferred rather than dropped; the payload
carries full 40-character SHAs and both author and committer timestamps, which
is what a later join needs, and the affordance would live in the hover card and
the detail pane rather than inline on a row that has no room for it.

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
