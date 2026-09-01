# Features

For each feature: behavior, UI, backend touchpoints, edge cases.

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

**Behavior.** On launch, show the workspace **in the order the user put it in** —
one ordered list of rows, where a row is either a project or a **group** holding
projects, and a group expands (ADR-0025).
A folder Claude has never run in is an ordinary project with no sessions yet; a
folder Claude has worked in that you never added does not appear at all, and
nothing announces it.

**UI.** Sidebar section. Each row: a collapse/expand chevron, the project
avatar **badged with the status dot** when any terminal in it is live, the
display name, and — on hover — a `+` for a new session. The badge sits on the
avatar's corner rather than as another item in the row: at four possible elements
(chevron, avatar, name, dot, `+`) the row was already reading as a toolbar, which
is also why the reorder gesture added no sixth element and no grip.

The sidebar is **resizable** by the same handle mechanism as the file panel —
one `PanelResizer` told which edge it sits on, since the sign of the drag is
all that differs. Width persists (180–480px). The session count was dropped from the row: it
competed with the status dot for the end of the row, and it is not what you
scan a sidebar for.

### Ordering

**Every project sits where you dragged it.** A project has no position of its
own: it has a **row** in `sidebar_rows`, and the row has a `sort_order` scoped to
its parent (ADR-0025, which supersedes ADR-0023 for this). Written by
`reorder_sidebar` — not a client preference, so it is per-machine and survives
reindexing (the indexer writes `discovered_projects`, never these tables, guarded
by a test).

`projects.sort_order` held this until migration 0012. It could not survive groups:
an ordinal on the project row means "position at the top level" or "position
inside my group" depending on a *different* column, and order split across two
tables cannot interleave a group row with a loose project — which would have
reinstated the two-tier list this section had just flattened.

**This replaced pinning**, which stood here until 2026-08-26 as a hover icon plus
a context-menu row, floating a block of projects to the top above a headerless
divider. A pin is a one-bit approximation of an ordering: it can say "this
matters" and nothing else, and it forced the list into two tiers that the sort
control then had to mean the same thing inside both of. One hand-ordered list has
no tiers and nothing to reconcile. Migration 0011 dropped the column and seeded
the ordinals from `pinned DESC, display_name ASC`, so the decision behind an
existing pin is carried forward as a position rather than thrown away.

**The sort control offers `Manual`, `Name` and `Recent`**, in the `ArrowUpDown`
menu in the section header alongside Expand all / Collapse all. `Manual` is the
default and reads `sort_order`. The other two are **views over the same list**:
they derive an order from fields the row already carries and write nothing.
`Recent` derives from `last_session_at`, with projects Claude has never run in
sorting last — "never used" is not "used most recently". All three go through one
pure exported `sortProjects`, so the rule is testable without a render.

**The drag is live in `Manual` only.** Under `Name` or `Recent` there is no
sensor, no key handler and no `Move up` / `Move down` in the row's menu: a
derived order has nowhere for a drop to land, and the ordinal a drop would write
is invisible behind the rule overriding it. Letting a drop silently switch the
mode to `Manual` was considered and rejected — a 4px slip on a click would then
change a mode nobody asked to change. The menu rows are **absent rather than
disabled**, because the thing blocking them is a sort mode in a different menu
and a greyed row invites a hunt for it.

**The gesture is dnd-kit, pointer-based** ([ADR-0016](../docs/adr/0016-dnd-kit-for-pointer-based-reordering.md)),
with the 4px activation distance that keeps a click a click. Listeners sit on the
**whole row** rather than a grip, and the sortable node is the whole `<li>`, so an
expanded project lifts with its session list instead of leaving it behind under
whatever row takes its place. The row's `<Link>` carries `draggable={false}`: a
native anchor is draggable by default and that drag is the HTML5 one, which is
dead in this shell on macOS. The lift is tonal plus a hairline ring, not a
shadow — see `DESIGN.md`.

**The keyboard path is `Alt`+ArrowUp / `Alt`+ArrowDown**, on the row rather than
the link so it fires wherever focus sits inside the row, announced by
`aria-keyshortcuts`. Not dnd-kit's `KeyboardSensor`: it takes the space bar to
lift, and space on a project row means *open this project*. `SessionTabs` made
the same call first (F16). `Move up` / `Move down` in the context menu are the
discoverable form of the same move and go through the same code.

**The write is one command for the whole tree**, and it **rejects a stale set**:
the row ids it is handed must be exactly the sidebar's rows, each once, or nothing
is written and it errors — so an arrangement computed against a tree that has
since changed cannot be applied. Extended to two levels, that check also catches a
row named at two levels at once, which a per-scope check cannot see. One command
rather than a scoped pair is what makes moving a project *between* groups a single
atomic write. The renderer writes optimistically and restores its snapshot on that
error, and it **pauses the 2s poll for the duration of the drag**, so no row can
move, appear or vanish under the pointer mid-gesture.

**A newly added project lands at the top** of the top level, via
`MIN(sort_order) - 1` rather than renumbering. F1 already navigates to the project
you just added, and sending you to a row below the fold is the wrong end of the
list. Ordinals therefore go sparse; `list_sidebar` tie-breaks on `display_name` so
the order stays deterministic, and only `reorder_sidebar` renumbers densely from
zero. `add_project` is idempotent by path, so it must not give a re-added folder a
second row either.

**Two commands read the workspace, and they answer different questions.**
`list_sidebar` returns the tree and is the sidebar's; `list_projects` stays flat
and alphabetical for the tab strip, the project route, the import dialog and
search, which all want a list of projects rather than an arrangement. The tree
carries **no ordinals** across the boundary — the order is the array's order,
because the stored numbers are sparse and must not become arithmetic the renderer
does.

Neither the `+` nor the chevron wears button chrome: a filled hover background
behind a 14px glyph in a dense row reads as a widget when all it is is an
affordance. Both sit muted at rest and take full colour only under the cursor. On
the **selected** project the `+` stays visible without hovering — that is the row
you start work in, so the affordance shouldn't need hunting for.

### Groups

**A group is a row that holds projects** — Pro, Perso, Side projects. It is where
the pinned block went: a group you named is a better answer to "these three
matter" than a boolean was, and unlike a pin it says *why* they are together.

**Ungrouped projects are not a group.** They stay at the top level, interleaved
with the group rows, so the sidebar is one ordered list where some rows expand. A
synthetic "Ungrouped" container was the alternative and it makes a fresh workspace
display a group nobody created.

**The row**: a chevron, the name, and a count **only when collapsed** — where it
is the one thing that can say what is inside; expanded it would repeat what you
can see while competing with the name at 180px. No avatar, because `ProjectIcon`
hashes its hue from a path and a group has none. No `+`, because there is no cwd
to start a session in and a button that had to pick one of the group's projects
for you is worse than no button. The name is set in the header's 12px uppercase,
so a group reads as a quiet heading over the project names it contains rather than
competing with them.

**An empty expanded group renders one muted "Drop a project here" row, and that
row is the drop target.** The placeholder and the affordance are the same thing.
It has to be its own droppable — the group's `<li>` is already a sortable under
the group's row id, and dnd-kit cannot share an id — so it registers as
`empty:<rowId>` and the sidebar strips the prefix, which makes dropping there
resolve to exactly the same move as dropping on the group's header. Without it an
empty group would be unreachable by drag, since `SortableContext` has no item
inside it to collide with. An empty group **stays**: you made the container on
purpose.

**No sub-groups**, and it is the schema that says so —
`CHECK (kind = 'project' OR parent_id IS NULL)`. In the database rather than only
in the commands, so nesting cannot be written whichever command has a bug.

**Hold a project over another to group them.** Resting a dragged project on
another one for `GROUP_DWELL_MS` (800ms) changes what the drop means: instead of
inserting beside it, the drop creates a group holding both, with its name editor
open. A ring fills on the target row from 300ms, then the row takes an accent
ring and reads "New group" — so the change of meaning is visible *before* it
commits, which is what actually prevents accidents rather than the wait being
long. Moving off the row cancels. The ask was 2000ms; 800 was chosen because
creating a group is reversible and two seconds of holding a button reads as the
app having hung.

There is **no offer over a group row**, and none when either the row in hand or
the row under it is already inside a group: grouping those would need nesting. In
each of those cases the drop does the useful thing instead — files into the group,
or places beside the row.

**A group row is three drop zones, and the space below the list is a fourth.**
Its top quarter means *before the group*, its bottom quarter *after it*, and the
middle half *into it*; an ordinary row is two zones split at the middle. The
position comes from where the pointer sits within the row, not from which
direction the drag came — so the line drawn before the drop and the tree written
after it are the same value. A group row that only ever meant "into" left every
position near a group unreachable: a project could not be put between two groups
or after the last one. And the area below the last row is its own droppable
meaning **the end of the top level**, because dnd-kit's collision detection always
resolves to some row — so without it a drop near the bottom snapped into whichever
container happened to be last.

**The dwell means one thing: create a group.** It is timed only where a hold would
do that — over a loose project, with a loose project in hand. It used to also
spring a collapsed group open, which put the same filling ring over the one row
where a group will *not* be created. Spring-open is gone and is not missed: the
middle of a collapsed group row is already "into", so the drop works without
expanding anything.

**Nothing displaces, and the drag is carried by an overlay.** The list does not
rearrange itself to open a gap — a 2px accent line on the target's edge says where
the drop lands, and dropping *into* a group marks the group row with an accent
ring instead of a line. dnd-kit's `verticalListSortingStrategy` was tried first
and is wrong here twice over: it assumes a flat list of equal-height siblings,
which a tree whose children live inside their group's `<li>` is not (it drew rows
on top of each other and let a dragged row overflow into the group below), and it
*moved the row being aimed at* — fatal for a gesture whose whole point is resting
on a row. What you are carrying is a **compact chip** in a `DragOverlay`, narrower
than a row so it never covers the target or the marks drawn on it; the source row
stays in place at 40% opacity. **A group collapses for the duration of its own
drag**, so every draggable thing in the sidebar is one row rather than a
four-row block, and re-opens on drop.

**One gesture files and reorders, because the drop target decides the level.**
Dropped on a top-level row, the moved row joins the top level there; dropped on a
row inside a group, it joins that group; dropped on a group's own header, it goes
to the top of that group. A **group** being dragged only ever moves among the
top-level rows.

**The keyboard is a different operation, deliberately.** `Alt`+arrows *walks* the
list rather than aiming at a target, so it has its own rule: up from a group's
first child leaves the group, landing just above it; down from its last child
leaves below it; stepping into an **expanded** group above or below enters it at
the near end; a **collapsed** group is stepped over, for the same reason its
children are not drop targets. Routing the nudge through the drag's rule made
`Alt`+ArrowUp on a first child a permanent no-op — the row above a first child is
the group's header, and dropping there means the top of the group it was already
at the top of.

**Removing a group returns its projects to the top level in the group's own
position**, keeping the order they had inside it, so the list looks like the
group's box was erased rather than like its contents were flung to one end. It
un-files; it never deletes. Silent when the group is empty and confirmed when it
holds projects — exactly `remove_project`'s rule: a dialog only where something
real is at stake.

**Groups dissolve under `Name` and `Recent`.** Those modes show every project in
one derived list, the ones inside collapsed groups included. A group row is part
of the arrangement, and these two are a way to *find* a row rather than a way to
view the arrangement — sorting within and among groups instead would make the
control mean one thing at the top level and another inside, which is the
criticism this section already makes of the old pinned block. Switching mode
therefore changes the sidebar's shape, which is the cost.

**Expansion joins `sidebarStore.expanded`**, one shared array, no version bump:
projects stay keyed by **project** id and groups are keyed by **row** id. Keying
uniformly by row id would invalidate every persisted project id and collapse
everyone's sidebar once, for no benefit, since a project has exactly one row.
`expandAll` / `collapseAll` mean projects *and* groups.

The scrolling list reserves a right-hand gutter so those hover buttons never
sit under the scrollbar.

**The row's context menu** (`ContextMenu` in `@factorai/ui`, the same primitive
the file tree's menu reuses — F12) carries **Move up** / **Move down** under
`Manual`, **Reveal in file manager**, a separator, and **Remove Project**. An
earlier draft of this section rejected a right-click menu outright, on the
grounds that nothing in the app teaches anyone to right-click and that building
the system for one action (pin) would drag "Reveal in file manager" along with
it. **That reasoning has expired** and this paragraph supersedes it: Remove has
nowhere else sane to live, and the two Move rows are the keyboard's complete
answer to a gesture a mouse would otherwise own. A fifth hover target in a 180px
row is a misclick waiting to happen on a row with no undo. Remove sits below the
separator and away from everything else: it is otherwise a slip from Reveal, and
only one of the two is reversible.

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
`display_name` and `sort_order` are left alone on conflict — re-adding a project
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
`list_import_candidates()`, `reorder_projects()`, `resolve_project_path()`.
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

---

## F2 — Session list

**Behavior.** For an active project, list all sessions newest-first. Show
title, relative timestamp, turn count, and a status badge.

**UI.** Sidebar (or full pane when on `/projects/$id`). Click → open
session view. Keyboard: ↑/↓ to navigate, Enter to open.

An expanded project lists its **10 most relevant** sessions inline: **pinned
first**, then anything with a live PTY, then most-recently-active. Running-first
is the point of the second key — what an agent is doing *now* matters more than
what you touched last, so a live session stays above an idle one even when it is
the stalest by timestamp. Anything beyond the ten is an `N more…` link to the
project page, rather than an unbounded list in a narrow column.

**Pinned rows are never what the cap drops.** The ten slots cap the *unpinned*
remainder, so a project with twelve pins lists twelve rows — the user's own
doing, and visible on screen. A pin you can be pushed out of view by is not a
pin.

**Backend.** `list_sessions(project_id)`.

**The status dot has its own 32px column on the project page, always reserved**
(2026-08-29, user feedback, narrowed and then widened across several rounds —
`DESIGN.md` § Status Dot has the metric and why). It used to sit inline before the title, so a
running session's name started 16px right of an idle one's and the list read as
ragged. The disclosure gutter already worked this way for sub-agents; this is
the same rule one level in. The routine origin icon moved to the right-hand
badge column for the same reason. The sidebar's rows are unchanged — their dot
is right-aligned, so the names already line up.

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

### Pinning a session

**Right-click a session row → `Pin session`, or the pin button on the row.** A
pinned session leads its project's list — in the sidebar's inline list and on the
project page — where recency can no longer push it below the fold. It is the
answer to "the session I keep coming back to keeps sinking", which until now was
solved by leaving a tab open.

**One bit, not an ordinal.** A project's position in the sidebar is a stored
ordinal you drag (F1, ADR-0023/0025); a session's is not, and the difference is
the shape of the list. A session list is dozens of rows sorted by a recency that
moves every turn, with rows arriving from the indexer and leaving when a
transcript does — there is no hand order to preserve, so the whole requirement
is *exempt this row from recency*. Migration 0015's comment says this, because
the next reader arrives holding migration 0011, which removed exactly such a bit
from `projects`.

**Ordering.** Pinned first, then live, then recency — and **pinned rows order
among themselves by recency too**, so the list keeps one ordering rule and the
pin only decides which side of the boundary a row is on.

**A pinned parent takes its sub-agents with it.** The sort key is the *group's*
pin, not the row's: `list_sessions` orders by it and the renderer's
`groupSessions` only nests, so a sub-agent travels above unpinned sessions while
never being pinned itself. Sub-agents cannot be pinned — they are not sessions
you go back into.

**Where the control is.** The sidebar's row: the context menu's first item, and a
pin button that appears on hover or focus and **stays visible once pinned**,
where it doubles as the row's mark. The project page has no toggle; it honours
the order and names the two blocks (`Pinned` / `Recent`, drawn only when both
exist). The session view's header shows a `pinned` mark for the session you are
looking at — a mark, not a control, since a toggle there would reorder a list you
cannot see.

**The boundary is the mark, not a per-row icon.** In the sidebar a rule between
the two blocks; on the project page, where every row already has a rule under it,
the two captions. Two pins with nothing between them and the rest of the list
read as a broken sort.

**Backend.** `set_session_pinned(session_id, pinned)`, then `sessions:changed`
for the project — every list on screen is a `list_sessions` too. `pinned` rides
on `SessionSummary`, joined in the same query for the reason the checkout and
routine marks are: every row that draws it needs it on first paint.

**Indexed sessions only.** A session spawned but never messaged has no
transcript (ADR-0008) and so no row to keep a pin on; it is already at the top of
the list by the live-first rule, so a pin there would buy nothing. Pinning one is
`NotFound` rather than a silent no-op — a pin that quietly did not happen is a
mark you would believe you had made.

**Lifetime.** `session_pins` (migration 0015) is the one session-adjacent table
that carries a foreign key: unlike `session_worktrees` and `session_routines`,
which are written at spawn before the `sessions` row exists, a pin can only be
made from a row that is already listed. `ON DELETE CASCADE` is then the whole of
its lifetime — deleting a session takes its pin, and so does the indexer's reap
when a transcript disappears. A session restored from the trash comes back
unpinned.

### Copying a session's transcript path

**Right-click a session row → `Copy transcript path`.** The absolute path of the
session's `.jsonl`, on the clipboard. It is the file you feed to another agent,
to `jq`, or to a bug report, and there is no other way to get it from inside the
app: deriving it by hand means knowing that Claude names a project's directory
by dropping the leading `/` from its path and replacing the rest with `-`.

**Backend.** `session_transcript_path(session_id)`, addressed by the store key
recorded when the session was indexed — so a sub-agent's nested
`<parent>/subagents/<id>.jsonl` is right too. The path comes back whether or not
the file is still there; a transcript that has moved since the last scan is one
of the reasons someone is asking where it lives.

**The row reports, not the menu.** The menu has closed by the time the clipboard
write returns, so the row wears a tick — or a cross, when either half refuses —
for a moment after, the same mark the file tree's rows use (F12). A tick for a
copy that did not happen is worse than no mark at all: the path pasted into the
bug report would be a stale one.

### Deleting a session

**Right-click a session row → `Delete session` → confirm.** The row is in the
sidebar's inline list under an expanded project — the surface you are already on
when a stale session is in your way. The project page's rows do not carry the
menu yet.

**What it does** (ADR-0027): moves the transcript
`<store dir>/<session-id>.jsonl` to the operating system's trash, along with the
`<session-id>/` directory holding its sub-agent transcripts, and drops the
session's index rows — `sessions`, `messages_fts`, `session_worktrees`,
`session_routines` — in one transaction. `sessions:changed` follows, so the
project page and the sidebar agree without waiting for a poll.

**The trash, not `unlink`.** This is the only action in the app that removes a
user's own work, so it is recoverable by the means they already know, and the
dialog says so rather than warning that nothing can be undone. Restoring the
file from the trash restores the session: the next scan re-indexes it and the
row comes back with its title.

**Backend.** `delete_session(session_id)`. It refuses — `InvalidInput` — while
the session has a live PTY. That is not the path the UI takes: the renderer kills
first, exactly as `useRemoveProject` does, because a kill that fails must leave
the tab standing rather than orphan a running `claude` (ADR-0005).

**Confirming is not optional, and the dialog changes with the session.**

- Idle: names the session and says the transcript goes to the trash.
- Running: says the session will be **stopped** first, and the button reads
  `Stop & delete`. Losing a running agent is a different loss from losing a
  finished transcript, and the button that does it says so.
- With sub-agents: names how many go with it. They are not reachable once their
  parent is gone, so a count is the honest thing to show before the click rather
  than a surprise after it.

**The menu holds this one item.** A session row's other verbs are already the
row itself — clicking it opens the session — so a menu padded out to look like
the project row's would be three decoys around the one destructive thing. The
item is `destructive`, which is the same marking `Remove Project` carries and
the only signal a one-item menu has room for.

**Edge cases.**
- Deleting the session you are looking at navigates to the project page. Same
  rule `useRemoveProject` applies, for the same reason: a route pointing at a
  transcript that is gone renders an error where a list should be.
- Deleting a session with an open tab closes the tab. A tab is only removed by
  closing, and deleting the session *is* closing it.
- A **sub-agent** row has no `Delete session`. It is not a session you can go
  back into, its file belongs to its parent's directory, and deleting one alone
  would leave a hole its parent's transcript still references. Delete the parent.
- The trash can refuse — a store on a filesystem without one, a `$HOME` on
  another mount. The error is shown and **nothing is deleted**; there is no
  `unlink` fallback, since quietly turning a recoverable delete into a permanent
  one is the surprise the decision exists to avoid.
- A session with no transcript yet (spawned, never messaged — ADR-0008) has no
  row to right-click. Closing its tab is what disposes of it.

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
> with tail-pagination. The session view is now terminal-first. The only
> surfaces that render session content are
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

**A hit names its project, not just its session.** Results are workspace-wide,
and a session title on its own doesn't place a conversation: two projects
routinely hold a "Fix the flaky test". The row leads with the project's
`ProjectIcon` and display name — the same path-hashed icon the sidebar and the
tab strip are scanned by — then the session title, then the matched role. The
project's folder is the row's hover title.

**Backend.** `search_sessions(query, project_id?, limit)` → FTS5 over
`messages_fts` with `snippet()` + `bm25()` ranking. Returns up to `limit`
(default/cap 200) hits, each
`{ sessionId, projectId, projectName, projectPath, title, role, snippet }`
(`title` JOINed from `sessions`, `projectName` / `projectPath` from `projects`,
for the result label). `projectPath` travels because the icon's hue is hashed
from the path, so a name alone would colour the same project differently here
than in the sidebar. The FTS index stores no per-event position, so hits carry
no `event_index`.

`messages_fts` carries **no `project_id` column**. It used to, holding the
encoded directory name, which was stable; a workspace id is not, since removing
a project and adding it back mints a new one and every stored row would be
stale. The project is resolved through `sessions` → `discovered_projects` →
`projects` instead — indexed joins, always current (a renamed project is named
correctly in hits indexed before the rename), and the same joins are what scope
the search: they are inner, and a directory with no `project_id` isn't in the
workspace.

**Edge cases.**
- Empty / whitespace query → clear results, no command call.
- FTS special characters → the query is passed as a quoted FTS string so a
  stray `"` or `*` can't error the match.
- Index not yet built (cold start) → results are simply empty until the
  initial scan completes; the sidebar already surfaces `indexer:progress`.

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

**The last column, at a fractional zoom** (2026-08-20). Characters cut in half
down the right edge of the pane at 120%. Neither the sizing above nor a lost
column: xterm's DOM renderer sets each row to exactly the grid's width with
`overflow: hidden`, then makes the text fill it by giving every span a
`letter-spacing` of `cellWidth - measuredCharWidth`. The two inputs are measured
differently — `cellWidth` from `OffscreenCanvas.measureText` (nominal, and
zoom-invariant), `measuredCharWidth` from laying out 32 characters and reading
the **integer** `offsetWidth`. At zoom 1 that run reads 250px for 249.61 and the
correction comes out negative, so the text is narrower than the grid; at 1.2 it
reads 249 for 249.51 and the correction is positive, so every character is drawn
0.0157px too wide. Over 130 columns that is 2px more text than the row will
show, and the last glyph loses a quarter of itself. Whether it happens is a coin
flip on where `32 x advance` falls against an integer — in WebKitGTK, zooms 1.2
and 1.5 clip and 1.0 and 2.0 don't, which is why this never reproduced at 100%.

The fix is 8px of horizontal slack on the row's clip box rather than a chase
after the metric — the terminal's own `p-2`, which the container now also
declares `overflow-hidden` so the spill cannot leave the pane. Measured in the
renderer under WebKitGTK at zoom 1.2: the worst row (114 spans, a colour change
per character) went from 3.11px past its clip box to 4.88px inside it. Rows
still clip vertically, deliberately: nothing accumulates down a column, and a
tall glyph should be cut rather than bleed into the row below.

Each site carries the full reasoning — the two CSS files and the sizing section
of `Terminal.tsx`.

**One xterm per session, and it never leaves the document** (2026-08-28).
Terminals are pooled: one xterm instance per session, kept for the app's
lifetime, so reopening a session shows its scrollback and its output keeps
arriving while you are looking at something else. What changed is where the
pooled host *lives*. It used to be appended to the pane on mount and
`removeChild`'d on unmount; now every host that has been shown stays in the
pane, stacked, and switching session toggles `visibility`.

The report was **the wheel not scrolling the terminal after a tab switch, on
macOS** — clicking into the terminal restored it, and Linux could not reproduce
it. The strip and the session route share one pane element (switching tab
re-renders `SessionView`, it does not remount it), so the only thing that moved
was the host: measured in the browser lane, six disconnections from the document
per switch. WebKit on macOS routes wheel events on its scrolling thread against
the document's **wheel event region**, built from nodes whose wheel handlers were
registered while connected; a subtree that leaves the document drops out of it,
and xterm's wheel listener lives on `.xterm` inside the host. The scrolling
thread then never hands the event to the page — until a click forces the
main-thread hit test that rebuilds the region, which is exactly the workaround
the report describes. WebKitGTK has no scrolling thread and no region, so the
same DOM churn is invisible on Linux.

Two things were wrong on every platform as well, quietly. A detached element
measures `offsetHeight` 0, and xterm's `Viewport._innerRefresh` keeps running in
the background as output arrives: it recorded that 0 as the viewport height, and
its `scrollTop` write — which a detached element ignores — left
`_ignoreNextScrollEvent` latched `true`, so the first wheel tick after coming
back was swallowed. `visibility` rather than `display: none` because a hidden box
still has layout: the background terminal stays the pane's size and is already
correct when you switch to it, while being neither hit-testable nor focusable.

The pooled xterm is also `open()`ed on a host that is already in the pane, so its
first char-size and render-dimension measurements are taken against a real
layout instead of being corrected by the first fit.

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

**A third kind of link — a path — is F19**, and it is not OSC 8 either: the CLI
marks up URLs and never paths, so paths are matched by a link provider over the
buffer. Same modifier gate, different destination — the viewer rather than the
shell. F19 owns that rule; this section owns the two URL paths.

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

**Images in a rendered document go through `read_image` too** (fixed
2026-08-19). `![logo](docs/logo.png)` had been rendering as a broken image, and
no amount of correct markdown would have fixed it: a relative `src` is a path on
disk, and the webview has no filesystem origin to resolve one against. So the
`img` handler resolves the `src` the same way a link's `href` is resolved and
reads the bytes through the same command the image viewer uses, arriving as a
`data:` URL — which keeps the "one route into the filesystem" property below
rather than opening the asset protocol for this.

- **A remote `src` is left alone.** The webview can fetch that itself, and a
  shields.io badge in a README is the common case.
- **An SVG comes back through `read_file`**, since it has no magic bytes for
  `read_image` to accept — the same split `SvgPreview` already makes, and it
  gets the same `encodeURIComponent` data URL for the same reason.
- **A missing file leaves its alt text**, in a dashed placeholder, rather than a
  silent gap: the extension may have lied and the backend refused the bytes, and
  either way the caption is the only thing left that says what was meant to be
  there.
- **`data:` and `file:` srcs never arrive.** react-markdown's default URL
  sanitiser replaces them with an empty string, and we keep that default — an
  empty `src` renders the placeholder, because `<img src="">` re-requests the
  document itself.
- **The fragment and query are dropped and percent-escapes decoded**, because a
  `src` is a URL and its target here is a path: `![](my%20logo.png)` is a file
  with a space in its name.

A leading `/` resolves as a **filesystem** path, for images and links alike.
There is no site root here to be relative to, so `/home/me/diagram.png` means
that file.

**Frontmatter is lifted out and laid out as fields** (added 2026-08-24,
ADR-0022). A `---` block at the top of a document is metadata, not prose, and
react-markdown has no plugin for it: the fences parsed as thematic breaks or a
setext heading and every field ran together into one paragraph — the metadata was
on screen and unreadable, which is worse than showing it properly or not showing
it at all. So `splitFrontmatter` takes the block off before remark sees the
document, and it becomes a panel above the prose.

- **Only a closing block counts, and only at the very start.** A document whose
  first line is `---` and which never fences again opens with a thematic break,
  and treating that as broken frontmatter would put a card on every one of them.
  Either fence closes it (`---` or `...`), CRLF and a leading BOM included, and an
  empty block gets no panel — there is nothing to show.
- **It is parsed as YAML, by `yaml`** — not by a regex over `key: value` lines.
  A quoted value with a colon in it, a block scalar, an inline list and a nested
  map are all ordinary in the documents this viewer is pointed at, and a subset
  parser reads those *wrongly* rather than failing on them. Fields keep the order
  they were written (`mapAsMap`, since a plain object reorders integer-like keys).
- **The panel is collapsible, and which way it starts is a preference**
  (`frontmatterOpen`, default open — F11). Somebody working through a spec wants
  `status` and `owner` on screen; somebody reading a document whose frontmatter is
  bookkeeping wants the prose to start at the top of the pane. The chevron is a
  **peek and is not written back** to the preference, unlike the diff viewer's
  inline toggle: that one is a reading mode you stay in, and a setting edited by
  accident is worse than one more click. Collapsed, the header carries the field
  count; open, it does not restate what the reader is looking at.
- **Four shapes, and no more.** A scalar is text, a list is a row of chips in the
  neutral hue (the coloured chips mean something by their colour — they are git
  refs), a nested map is an indented field list of its own, and `null`, an empty
  string, an empty list and an empty map are all *no value* — an em dash, because
  a blank cell reads as a rendering that gave up. A `2026-08-24` stays the string
  the author typed: the core schema this parses under does not make it a date.
- **A URL value is a link handed to the OS**, the same two schemes a markdown link
  hands over and no others. The frontmatter of a spec is where its tracking issue
  lives.
- **A block that will not parse keeps its source**, under a one-line reason, in
  the dashed frame a missing image and a broken mermaid fence get. So does a block
  that parses to something other than a mapping — a bare list is valid YAML and has
  no fields to lay out.

**A `mermaid` fence renders as a diagram** (added 2026-08-24, ADR-0021). The
documents this viewer is pointed at are the ones an agent writes and the ones a
repository already has, and a diagram left as its own source is the one kind of
content where the rendered view is *worse* than the source view — `specs/`
and `docs/adr/` in this repo are the worked example.

- **Only a `mermaid` fence counts.** A fence labelled `mmd`, or one with no label, is
  a code block and stays one. Guessing at unlabelled fences would turn any file
  whose first line reads `graph TD` into a rendering attempt.
- **Mermaid is loaded only when a document has one.** It is ~2.5MB, larger than
  Monaco, and it sits behind a dynamic import a level below the viewer's own
  chunk — opening a README with no diagram in it does not pay for it. See
  `components/viewer/mermaid.ts`.
- **The diagram is drawn in the app's palette**, resolved from the CSS custom
  properties at render time rather than from a second copy of the palette:
  mermaid seeds its derived colours with `khroma`, which cannot parse the
  `oklch()` our tokens are written in, so `mermaidTheme.ts` converts them. The
  seeds are neutral on purpose — a node is the raised surface a code block is,
  not the brand amber. A diagram is content, and content coloured like chrome
  reads as chrome.
- **A fence mermaid cannot parse keeps its source**, under a one-line error, in
  the same dashed frame a missing image gets. Mermaid's own error rendering is
  a bomb glyph with nothing to say which fence produced it, and it is turned
  off (`suppressErrorRendering`) so the failure can be reported in place.
- **Diagrams are rendered, not interactive.** No pan, no zoom; a wide diagram
  scrolls sideways in its own container. `click` directives are inert, because
  `securityLevel` stays at its `strict` default — the same stance as not adding
  `rehype-raw`.
- **A fence occupies no space until its diagram lands.** Same call as
  `LocalImage`, same reason: a placeholder that reflows the page a frame later
  is worse than a beat of nothing.

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

**Freshness.** Two halves, both added 2026-08-31, because an agent edits the
file you are reading and the viewer used to show neither the edit you had
closed the file on nor the one landing in front of you.

**Opening re-reads**, and so does switching paths inside the viewer. Every
on-disk read behind it (`read_file`, `read_image`, `read_pdf`, a rendered
document's inline images, and the worktree side of an F13 diff) has
`staleTime: 0`; only a git object named by a full SHA is cached for the life of
the process. These all read with `staleTime: Infinity` on the reasoning that a
file open in the viewer is a snapshot and the refresh path is reopening it. The
second half did not hold: with the key never stale, a reopen was answered from
the cache, so an edit stayed invisible for `gcTime` (5 minutes).
`lib/viewerQuery.ts` holds the two policies.

**And the open file is watched** — `watch_file` on open, `unwatch_file` on
close, `file:changed` in between (see `03-backend-rust.md` § `FileWatch` for the
directory watch, the 250ms debounce and the path-scoped release).
`hooks/useWatchedOpenFile.ts` owns the subscription, mounted at the shell where
`?file=` lives, and invalidates the three read namespaces for the event's path —
its own path, not the one on screen, so a notification that arrives after the
reader has moved on refreshes a cache entry nobody is reading.

**The subscription's lifetime is exactly the viewer's**, which is the whole
reason this is two commands rather than a watcher pointed at the project: with
no file open there is no debouncer thread and no inotify descriptor. Q17 decided
against a watcher for the **tree** and that stands — a recursive watch on an
arbitrary project directory means ignore rules, per-project lifecycle and
inotify limits, and one open file has none of those. The wrong answer is worse
here, too: a stale row in a tree is a row you can click, while stale contents
look exactly like current ones.

**Nothing moves under the reader.** `refetchOnWindowFocus` stays off, so
alt-tabbing refreshes nothing; and a refresh that *does* arrive keeps the place
you were in — the Monaco host saves `saveViewState()` (scroll, selection, folds)
before it disposes the editor and restores it into the new one, keyed by path so
the next file starts clean. A `&line=` position still wins, but only when it is
one the reader has not been sent to yet, so a refresh no longer re-jumps to a
line a terminal link asked for ten minutes ago.

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

**PDFs are rendered too**, by pdf.js, page by page onto canvas (ADR-0018).

The webview will not do this for us. WKWebView has Apple's PDF viewer built in
and WebKitGTK has nothing, so the one-line `<iframe>` renders on macOS and shows
a blank pane on Linux — F16's drag-and-drop bug with the platforms swapped. So
pdf.js is bundled, along with its worker and the four asset sets it resolves at
runtime (standard fonts, CMaps, WASM decoders, ICC profile), because there is no
network here for any of them to come from. `vite/pdfjsAssets.ts` stages them into
`public/pdfjs/`; ADR-0018 has the rest.

- **Routed by extension, decided by magic bytes**, the same split images get.
  `pdf` is an icon key like any other, so the file tree's icon and the viewer's
  choice cannot disagree. `read_pdf` refuses anything not starting `%PDF-`, and
  a `.pdf` that is really a zip lands on the binary card rather than inside
  pdf.js's parser, which would fail with a sentence about document structure.
- **Its own chunk, below the viewer's.** `FileView` reaches `PdfView` through
  `React.lazy`, so opening a source file loads Monaco and not a PDF
  implementation. `ImageView` stays a static import: a few hundred lines, no
  dependency.
- **Oversized is refused, not truncated**, at 32MB — larger than the image cap
  because a scan legitimately is, and no "Show anyway", because half a PDF is
  not a shorter document.
- **Continuous vertical scroll**, all pages in one scroll container. Every page
  is measured at scale 1 in one pass before anything rasterises, so its box is
  reserved up front and the scrollbar is honest from the first paint; only the
  pages within one of the current page hold a canvas, and the rest keep their
  empty box. A 400-page document costs what a 4-page one does, which is the
  whole reason this isn't `ImageView` with a page number bolted on.
- **Crisp, and fast to zoom.** Canvases rasterise at `devicePixelRatio × zoom`.
  A zoom step re-renders, and a render already in flight is cancelled rather
  than awaited — pdf.js rejects the cancelled one, which is the normal case and
  not an error.
- **Text is selectable**, through pdf.js's text layer over each page. Its
  positioning rules are upstream's, copied into `pdfTextLayer.css` rather than
  imported: `pdf_viewer.css` is 6347 lines of Firefox's own viewer — `:root`
  blocks, XFA widgets, `button` rules — and pulling all of it in to get 145
  lines would land in this app's cascade. A colocated test reads the installed
  package and fails if the copy drifts. There is no find bar yet; see
  `roadmap/TODO.md`.
- **100% on open** — one CSS pixel per PDF point, the page at its authored size.
  Fit-width was built first and dropped on the user's call (2026-08-19): a scale
  derived from the pane is a different number in every pane, so the same document
  opens looking different depending on where the panel divider is, and "100%" is
  the one reading that means something without knowing the pane. A page wider
  than the pane can therefore start off-screen to the right; the stage scrolls
  both ways. Zoom steps ×1.25 between 0.5 and 4 — narrower than the image
  viewer's 0.25–8, which exists to look at a screenshot's pixels. Clicking the
  readout returns to 100%.
- **The wheel scrolls; Cmd/Ctrl+wheel zooms.** Deliberately the opposite of the
  image viewer, where a bare wheel zooms because that pane has nothing to
  scroll. This one is a document. Cmd +/− stays with F15's webview zoom.
- **Pages are white paper on the dim stage**, not recoloured for the dark
  theme. A PDF is a fixed-layout artefact; inverting it would turn every
  photograph and chart in it into a negative.
- **An encrypted PDF asks for its password**, in the pane, and forgets it when
  the viewer closes — reopening asks again. A wrong one re-prompts with
  "Incorrect password." Nothing is stored: this app writes no secrets.

**Two bugs found building this, both invisible to type checking.** A single
`GlobalWorkerOptions.workerPort` is *one* Worker and pdf.js takes ownership of
it, so tearing one document down killed the next with "PDFWorker.create - the
worker is being destroyed" — a `workerSrc` URL gives each document its own.
And the fit-width scale this
originally opened at was read off a ref during render, where it is still null on
the render that mounts the pane, so every document opened at 100% instead — with
no error anywhere. Measuring it honestly took `ResizeObserver` state, since the
stage also reads zero wide while the modal is still animating open, the same trap
Monaco's `automaticLayout` note describes. Fit-width is gone now (above), but
both halves of that are true of anything else that measures this pane.

**A changed `.pdf` in the Changes tab keeps `DiffView`'s binary dead end.**
Diffing two rendered documents is a feature of its own — which side, aligned
how, what counts as a change — and it is in `roadmap/TODO.md`, not here.

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
future — reads correctly. The alternative is to enumerate the *spinner*,
and that is dead on arrival: the frames an enumeration would match are braille
(U+2800–U+28FF), and against 2.1.234 not one braille codepoint exists in the
binary. An enumerated glyph set also goes stale silently — nothing announces
that the set stopped matching — and we have exactly one source for this state,
so it has to be the one that cannot go stale.

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

---

## F11 — Settings

**Rewritten 2026-08-17** from the clarify-needs interview roadmap item 4 was
gated on, and **shipped 2026-08-20**. The previous version of this section named
a `/settings` route, four sections and `tauri-plugin-store`; all three are
changed, and the reasoning is below rather than in a commit message.

**What the build settled that the design left open** — three things, each in its
section below: what `installed` means when `--version` doesn't answer, what Save
does with a path nobody blurred, and where the restore switch is actually
honoured.

**The problem it solves is not "the app needs settings".** It is that **three
features in a row have arrived needing somewhere to put a preference and found
nowhere** — the close-confirm toggles, item 31's release channel, and the diff
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

**A medium modal, driven by the URL.** `?settings=claude|editor|confirmations|sessions`,
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

### Sections — four

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
- **Save re-checks a path nobody blurred.** Typing and clicking Save straight
  after would otherwise write a path that had never been probed — blur is where
  the *feedback* happens, not where the guarantee lives. A path already known bad
  greys the button out; an unknown one is checked by Save itself, which fails with
  the reason and writes nothing.
- **A resolved path whose `--version` fails is accepted, and says so.**
  `installed` means the binary resolved, not that it answered: a wrapper script or
  a hanging `--version` is a real state, and letting a version probe veto a binary
  that spawns sessions perfectly well would be the same mistake as `check_cli`
  ignoring the override. The row reads "Found, but it reported no version" and
  Save is enabled.
- **Running sessions are unaffected** and the row says so. The binary is resolved
  at spawn, so there is nothing to restart, and offering to kill live Claude
  sessions as a side effect of editing a text field would be a strange place to put
  that question.

**Editor.** The diff-mode default (inline vs side-by-side), arriving out of
`panelStore`. **The diff footer's own toggle writes the same value**, which it
already did — flipping it there is a choice about how you read diffs, and two
places disagreeing about what "default" means would be worse than one that both
set. A toggle made behind an open modal is picked up the next time it opens
rather than moving under a draft.

Beside it, **whether a markdown document's frontmatter panel starts open** (F7,
default on). This one is the mirror of the diff toggle and deliberately so: the
panel's chevron does *not* write back here, because it is a peek at one document
rather than a mode you stay in.

**Confirmations.** Two switches, both **on by default**: closing a session with
the `X`, and closing a tab by middle-click. They were roadmap item 22 until it
folded into item 4 — they were blocked on *this* surface and nothing else, so the
two ship together — which is also
what gives this modal enough content to be worth opening, and what proves
`SettingRow` against a real group rather than one text field.

**Sessions.** One switch, **on by default**: restore open session tabs on launch
(F16). **Honoured at `terminalStore`'s hydration**, by dropping the persisted
tabs on the way in rather than declining to write them on the way out — so the
switch describes *launch*, and nothing has to be remembered at quit. Turning it
back on does not bring that list back: those tabs were not open, so the next
launch restores what you had then, and a shadow copy of a list nobody is looking
at would be a second source of truth for one boolean's sake. Added 2026-08-18, and it is the one section here whose feature shipped
first — restore landed unconditionally because this surface did not exist yet, so
the switch arrives after the behaviour and must default on or it changes what
people already have. The heading is *Sessions* rather than *Startup* because the
unit of work in this app is a session and this is where the next per-session
preference goes; a startup section would describe when a preference applies
rather than what it applies to.

**Appearance.** One switch, added 2026-08-29: **24-hour clock**, on by default.
Off shows AM/PM. It is what every surface that prints a clock reads — a
routine's schedule, its next run, the graph's absolute timestamps and the
routine editor's own time field, which is a hand-built control precisely so it
can follow this rather than the browser's locale (F22). This is the section
that was "absent until it has content"; theme joins it when the roadmap's item
32 lands.

**Routines.** Two numbers, added by F22 and both in the SQLite table because
**Rust** reads them — `RoutineRunner` does, on every tick. *Run missed routines
for up to N hours* is the app-wide catch-up default a routine may override, where
`0` means never run late; *routine sessions at once* is the concurrency cap, and
its description says the thing that is not obvious — the rest **queue and run
late**, they are not skipped. Both are text fields normalised on save the way the
binary override is: a value that is not a whole number in range is treated as
unset rather than written, because a cap of `NaN` reaches the scheduler.

**Appearance and Advanced are dropped until they have content.** This heading read
"three, not four" until Sessions arrived, and the count is not the point — having
content is. Appearance would hold theme, which is deferred to its own roadmap item
(below); Advanced would hold item 31's release channel, which does not exist yet.
An empty section reads as a bug.

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
[`03-backend-rust.md`](./03-backend-rust.md) § `settings`. Three keys: the claude
binary path, and F22's `routines.catchup_hours` and `routines.max_concurrent`.
Item 31's channel is the fourth.

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
- **The button does not brighten while the panel is open** — changed 2026-08-20
  on user feedback, and it did until then. Every icon in the top bar is one
  colour, `IconButton`'s default; the open state rides on `aria-pressed` and on
  the fact that a 288px panel is either there or it is not. The colour was
  restating the unmissable, and once F11's gear landed beside it the two
  neighbouring icons disagreed about what a header icon looks like.
- Panel header: a `Files | Changes | Graph` tab strip (F13, F18), then collapse-all,
  refresh, close. **Refresh spins while its refetch is in flight** — added
  2026-08-20; before that a click on a large repository was indistinguishable
  from a click on nothing until rows changed, or didn't. It watches
  `useIsFetching` on the same key it invalidates, so the spin reports work rather
  than reassuring on a fixed timer, and it stops on a **rotation boundary**
  (`animationiteration`, not a timeout): a 20ms refetch is one clean turn instead
  of a one-frame flash ending at an arbitrary angle, and a slow one is a whole
  number of turns. Both the Files and Graph buttons use it; Changes has no button
  because it polls at 3s. The tree keeps its layout, spacing, icons and indentation
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
`prefsStore` with a one-time read-across, and this store bumps to **v3** to drop
the key (it was already at v2, for `detailHeight`'s raised default).

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

**A diff's two sides age separately.** `head` and `index` are moving names —
commit or stage and the blob under them is a different object — so both sides
of a working-tree diff, and the worktree read itself, re-read on open exactly
as F7's viewer does. Only an F18 range, whose ends are full SHAs, is cached for
the life of the process.

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

**The label was shortened — decided 2026-08-17, and actually in the code on
2026-08-18.** That gap is the point of this paragraph now: this text described the
short label as done, `UpdateBadge.tsx` had not been touched since 2026-08-14, and
nothing noticed for a day because the badge only renders when an update is
*staged* — so the first person to see it was a user, on the release that shipped
the fix for something else. A spec that says "fixed" is not a fix; F14 was wrong
about its own code.

The bug: the label read `⟳ v0.2.0 ready · Restart`, from a flex button with three
children, no `min-w-0` and nothing able to truncate — so its content set a
min-content width the footer cannot shrink. It wants roughly 175px beside
`ZoomControls`, has about 156px at a 288px sidebar, and about 48px at the 180px
floor, so it **clipped the zoom controls instead of degrading**. Measured on the
report: 174px of badge against a cell that ended at 157.

What the code now does, in the order the space runs out:

1. The label is `Update ready`. The **version moved into the tooltip**, which also
   stops it growing when item 31's channels make `v0.10.0-alpha.2` a plausible
   version, and `· Restart` went with it — a glowing button and a tooltip saying
   "click to restart" are already two ways of saying so.
2. `inline-flex` + `max-w-full` + `truncate` mean the badge hugs its content but
   can never be wider than its cell, so it shortens instead of running under its
   neighbour.
3. Below ~120px of cell — which is what the 180px sidebar floor leaves — the label
   **hides outright** and the badge is its mark alone, via a container query on the
   footer cell. Truncation alone gets you a pill reading `Upd…`, which is a broken
   word rather than a degradation.

**The badge does not resize the footer.** The row is a fixed 36px (`h-9`, the
file panel header's height) rather than one that hugs its content — fixed
2026-08-20. The badge is 24px tall and everything else in the footer is 18px or
less, so the footer grew by 6px the moment an update staged itself: the sidebar
shifting under you to announce something the badge was already announcing, and a
second, wordless way of saying the same thing that the width work above went to
some trouble to keep quiet.

Checking and downloading are silent by design. An announcement you can't act on
yet ("downloading 43%…") is noise beside a running agent, and the useful moment
is the one where a restart would actually gain you something.

**Restarting is a quit.** `relaunch()` tears the process down and takes every
live PTY with it — but it never fires `CloseRequested`, so the quit guard
(ADR-0005) never sees it, and a working Claude session would die without a
word. So the badge runs the same confirmation on the same terms — literally the
same terms, since 2026-08-21: `needsQuitConfirm` and `quitConfirmSentence` in
`lib/quitConfirm.ts` decide for both doors (ADR-0020).

> Restart to update? factorai 0.2.0 is ready. Claude is working in 1 of 4 live
> sessions. Restarting terminates all 4 — work in progress is lost. This cannot
> be undone — the update will also apply on its own the next time you quit and
> reopen.
>   [Later]   [Restart & kill sessions]

**With nothing working it restarts immediately, no dialog** — including when
live sessions are sitting at their prompt, which is the common case for an app
left open beside finished work. Unlike the quit path there is no `kill_all()` to
run first: `relaunch()` ends the process and takes the PTYs with it.

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

**Behavior.** The top bar carries a tab per **open session**, for switching
between agents without going through the sidebar.

**A tab is an open session. The dot says whether it is running. A tab goes when
you close it, and only then.** Rewritten 2026-08-18, and this paragraph used to
say the opposite: "a tab is a running PTY, not an open document", with the strip
driven straight off `terminalStore.bySession` so a tab went the moment its
process exited, however it exited. That was an honest picture of what was
running and a dishonest one of what you had open — and the app already disagreed
with itself about which of those the strip was for. The session route
deliberately does *not* navigate away when a process exits, so you could sit
reading `[process exited]` with `Restart` under your hand while the strip had
already deleted that session's tab.

What the three sentences buy, in order:

- **Open, not live**, so a tab survives an exit — and survives a quit, which is
  what makes restoring the strip on launch mean anything at all.
- **The dot carries the difference**, and nothing else does. F10 gave
  `StatusDot` a `stopped` colour and `ProjectIcon` a corner badge to put it in;
  both were wired and neither had ever been drawn in a tab, because under the old
  invariant a stopped tab could not exist. No second treatment — no dimming, no
  italics: the tab keeps its size, weight and colour, and the badge goes grey.
- **Only closing removes**, from either surface. That is the whole rule for how
  a tab disappears; there is no other way and no timeout.

The strip still renders nothing at all when nothing is open, so the bar looks
untouched until the first session — which is now "until the first session ever"
rather than "until the first one today".

**Amended 2026-08-29 by F22 (routines).** The rule loses its converse: a tab is
an open session, **and a session may run without one**. `tabs` is no longer a
superset of `terminalStore.bySession` — a routine's session runs with a hidden
pooled xterm and no tab until a human opens it, at which point it becomes an
ordinary tab and everything above applies to it unchanged. What this costs is
that `bySession` no longer answers "does this have a tab", which several surfaces
had been entitled to assume; see ADR-0026 § Consequences.

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

- **Reorder** by dragging, with **dnd-kit** — pointer events, never the OS drag
  session. **Changed 2026-08-18 on a user report, and the report was macOS-only.**
  This shipped as ~40 lines of native HTML5 drag-and-drop, and this bullet used to
  justify that as the cheaper side of a trade against a ~30KB dependency. The
  trade was decided on Linux, where it works. On macOS it does nothing at all:
  Tauri's own drag-drop handler reports every drag session on the window as
  handled, and wry then never forwards it to WKWebView, so the page sees
  `dragstart` and nothing after it. You pick a tab up, it dims, and it will not
  move. ADR-0016 has the call sites and the three ways out; the one taken keeps
  native file-drop available for the app and moves the strip off the OS gesture
  entirely.

  What that changes to look at:
  - **The tab you drag is the tab**, not a snapshot of it. The old code dimmed
    the source and dragged a cloned drag image, because the browser snapshots the
    element *after* `dragstart` returns — so the dimming landed on the image and
    you dragged a near-invisible sliver of an inactive tab that paints no
    background. dnd-kit translates the real element: it lifts, with a shadow and
    above its neighbours, and they slide under it.

    **Translated, and only translated.** dnd-kit publishes the active item's
    transform through `adjustScale(translate, over.rect, activeNodeRect)`, so its
    `scaleX` is the ratio of the tab you are over to the tab you are holding —
    meant for a `DragOverlay` that morphs into the target's box, and pure
    distortion when the element itself is what moves: with tabs sized by their
    titles, dragging a short one onto a long one visibly zoomed it. The style is
    `CSS.Translate.toString`, never `CSS.Transform.toString`. Reported and fixed
    2026-08-18, hours after the migration, which is the sort of thing a bounding
    box in a test can assert and a screenshot review cannot.
  - **The order commits on drop, and the preview is a transform.** Before, every
    `dragover` rewrote the list, which needed `dropIndex`'s midpoint rule to stop
    two tabs flickering under a stationary cursor — swap the moment they touch and
    the one you swapped with is now under the pointer, which swaps them back.
    `closestCenter` plus `horizontalListSortingStrategy` is that rule now, so both
    the arithmetic and its unit tests are gone. What you see mid-drag is the same
    thing either way: the arrangement you would get, rather than a drop you have
    to make to find out.
  - **Releasing outside the strip still keeps the previewed order** rather than
    snapping back. The strip has been showing that arrangement the whole way, so
    reverting on release would undo something you had already watched happen.
  - **A press is a click until it has travelled 4px.** dnd-kit suppresses the
    `click` after a drag it activated, which is right — a drag must not also
    navigate — and would otherwise mean clicking a tab no longer switches session.
  - **Dragging to the strip's edge scrolls it**, which the HTML5 implementation
    could not do at all.
- **`Alt`+`←` / `Alt`+`→` moves the focused tab** one place, because a
  drag-only reorder is unreachable without a mouse. Not dnd-kit's
  `KeyboardSensor`: it lifts an item with the space bar, and space on a
  `role="tab"` already means *activate this tab*. A nudge needs no mode, and
  `aria-keyshortcuts` on the tab is where a screen reader finds it.
- **Overflow** scrolls horizontally, with the scrollbar hidden (at 42px it
  would eat a third of the strip) and a wheel handler mapping vertical scroll
  onto it — otherwise the wheel does nothing over the header and the tabs read
  as stuck. Switching session scrolls the new active tab into view.
- **Order** appends at the end and is **persisted** — see "Restored on launch"
  below. This bullet used to end "persisting it would be meaningless: quitting
  kills every PTY (ADR-0005), so there are no tabs to restore", which was true
  only for as long as a tab *was* a PTY. ADR-0005 is untouched; what changed is
  that a tab now outlives the process.

**Closing kills the session, and asks first while Claude is working** — same
terms as the quit guard: an unattended `claude` is real money, and closing one
mid-task loses its work. `needsCloseConfirm` owns *when*, and the dialog it
guards, `components/dialog/CloseSessionConfirm`, is **shared with the session
header** (F3): one component and one predicate, so the two surfaces cannot come
to disagree about what the act is called, when it is worth asking about, or
whether it is at all. This paragraph read "so it always asks" until 2026-08-18,
stale since F10 gave the strip a status to consult. A **stopped** tab has no
process to kill and so closes without a question.

On confirm the tab is dropped immediately rather than waiting for
`terminal:exit`; we know what we just did, and a tab that waits for an event is
a tab that lingers forever if the event is missed. A **failed** kill keeps the
tab, since the PTY may well still be running.

**Clicking a stopped tab restarts it.** It disposes the pooled xterm and spawns
against the same session id — which is exactly what the header's `Restart` does,
so the strip is a restart button for a tab you are not on and for the one you
are, with no exception carved out for the active tab. The cost is the exit
message and the scrollback of a session that just died. The case where that
matters is the one where you are already looking at it, and there the exit
message is on screen with `Restart` beside it; reaching this by clicking the tab
is a deliberate act, not a stray one.

**Edge cases.**
- Closing the tab you're looking at navigates to its project; closing any other
  leaves you where you are.
- A session that exits on its own **keeps its tab**, greyed, with no dialog —
  you didn't ask for it to close, so there is nothing to confirm and nothing to
  remove. This bullet used to end "takes its tab with it".

### Restored on launch

**User ask, 2026-08-17; built 2026-08-18.** The tabs you had open come back when
you restart the app. This is what the invariant above was changed for.

**Restored tabs are stopped, and nothing spawns on launch.** Kill-on-quit is
non-optional and this does not reopen it (ADR-0005, Q10): every PTY died at quit,
so there is no process to bring back. The alternative — respawning
`claude --resume` for each tab at launch — was rejected, and not for the reason
it is usually given. It is not API cost: a resumed `claude` loads its transcript
and sits at a prompt, spending nothing. It is that N tabs means N processes, N
sets of MCP servers, and N runs of claude's own `SessionStart` hooks, which match
`resume` — arbitrary code, run before you have looked at the window, deciding on
the human's behalf what `00-overview.md` § "The operating model" says the human
decides. **The first thing that starts a process is your click.**

**What is persisted, and where.** `terminalStore` gains `tabs`, an ordered
`{ sessionId, projectId }` list, on localStorage under `factorai.terminals`.
`bySession` — the map every other surface reads to answer "is this running" — is
**not** persisted and does not change meaning. That split is the whole reason
this was cheap: nine call sites read `bySession`, every one of them means
running, and TypeScript would have caught almost none of them if the meaning had
shifted underneath, because the dangerous ones read `.status`, `Object.keys()`
or `id in bySession`. The two fields are kept in step by the same reducers that
already kept `order` in step with `bySession`:

| reducer | `bySession` | `tabs` |
| --- | --- | --- |
| `attach` (spawn) | add | append if absent |
| `removeByTerminal` (`terminal:exit`) | remove | **keep** |
| `detach` (close) | remove | remove |

Written continuously, as zustand's `persist` does by default and as
`sidebarStore` and `panelStore` already do — so a crash, a force-quit and the
`ErrorBoundary` reload all keep your tabs, which are the launches you most want
them back on. A quit-time snapshot would have caught only the clean case.

Per ADR-0013 this is **not** a preference and does not go near `prefsStore`:
nobody sets it in a settings page. It is the same kind of value as
`sidebarStore`'s `expanded`.

**Stale ids are dropped, quietly.** A tab whose `projectId` is no longer in
`list_projects` goes without an error — `sidebarStore`'s v1→v2 precedent, where
persisted project ids stopped matching anything and were dropped rather than
remapped. It matters more here than it did there: F6 refuses a spawn with no
`realPath` precisely because `portable_pty` would otherwise start `claude` in
`$HOME` and misfile the session under a different project than the tab names.

The filter needs `list_projects`, which is async, so **restored tabs paint only
once that query resolves**. Unlike a sidebar width there is no default state to
flash — an empty strip for the length of one local query is invisible. The
reason `sidebarStore` could not wait is that it had something on screen to
correct.

**Transcripts are not probed.** A tab whose `.jsonl` has been deleted stays, and
clicking it claims the id as a fresh session (ADR-0008: no transcript means
`--session-id`). The index row is gone by then too, so the tab shows its short id
rather than the title of a conversation that no longer exists. A per-session
probe at boot would cost a round trip each and read an index that lags the
watcher's 1s debounce — wrong in the direction that drops a tab you wanted.

**A `missing` project keeps its tab.** It is still in `list_projects` (F1 reports
the `cwd` recorded in the transcript and never stats it), so the tab survives and
the spawn fails loudly in the pane. That is F6's existing behaviour, not a new
one.

**No cap.** They are your tabs; the strip scrolls, and the `×` is right there.

**`terminal_list` is wired at boot**, which it never was. `terminalStore` and
`ErrorBoundary` both carried comments claiming a reload re-synced from it, and
the command had no renderer-side caller at all — so a reload kept every PTY alive
in Rust and lost every tab, stranding running sessions off the strip. Fixed as
its own commit ahead of this feature: the merge it needs — live PTYs unioned onto
the persisted list, live winning, position preserved — is the same merge restore
needs, and it is correct under the old invariant too.

**Where you land is unchanged**: `/`, with the tabs showing and none active.
Navigating into a session spawns it (F6), so restoring the active tab would
reintroduce respawn-on-launch by the back door. `04-frontend.md`'s `lastProjectId`
was deleted 2026-08-17 for being speculative, and stays deleted.

**No switch yet, and that is deliberate.** The ask was for a preference; F11 is
specified and unbuilt, so there is nowhere to put one that is not half of someone
else's feature. Restore ships on, unconditionally, and F11 gains a **Sessions**
section holding the switch — defaulting on, so it changes nothing when it
arrives. Recorded as a checkbox in roadmap item 4 rather than as a memory.

### Where "open" shows outside the strip

**Every session list marks what is open**, from one derived record:
`openSessions(tabs, bySession)` in `lib/sessionGroups.ts`, mapping session id to
`{ projectId, status }` with `stopped` for anything without a live PTY.
`projectStatus` and the session rows already took that structural shape, so they
change the argument they are handed rather than their signatures.

- **Sidebar session rows and the project page's session list** both show the dot
  when a session is open — one rule, since they list the same sessions and are
  read the same way.
- **Sidebar project rows** roll it up, so a project holding open tabs with
  nothing running shows grey. `STATUS_RANK` already ranks `stopped` last, so a
  project with one waiting session and four stopped ones still reads amber.
- **`orderSessions` floats open sessions** above recency, not just running ones,
  so what you have open clusters at the top of its project. The 10-row cap is
  unchanged: ten open sessions in one project fill the list, which is then a list
  of the ten you have open, and the project page shows everything uncapped.
- **`pendingSessions` stays live-only.** It exists to show a session claude has
  not written a transcript for yet; a stopped one has no process and no
  transcript, so a permanent `New session` row for it would be a ghost no reindex
  ever clears. A restored never-messaged session shows in the strip and nowhere
  else.
- **`UpdateBadge`'s count, the quit guard's count, and the session header's
  Close-versus-Restart** are all still about running processes and all still read
  `bySession`. The quit guard does not fire for stopped tabs, because there is
  nothing to kill — and since ADR-0020 it does not fire for `waiting_input` ones
  either, because there is nothing in flight to lose. What it kills is still
  every live PTY; `bySession` is read twice now, once for each count.

This reverses one line of `projectStatus`'s reasoning — "a grey dot on every
project you have ever opened is noise" — and the reversal is narrower than that
line makes it sound. The dot is not shown for every project you have ever opened;
it is shown for every project you have a tab open in, which is a set you control
with the `×`.

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

**The cap used to lift on the chip's own hover, and no longer does. Changed
2026-08-18 on user feedback** about chips overflowing. Releasing it in place did
not make a long name readable, because at 288px it does not fit uncapped either:
the chip grew past the panel's edge, pushed the subject off the row on its way,
and did both under the pointer while you were sweeping across. Un-truncating is
the hover card's job — one pointer-rest away, with room to wrap.

**The card bounds its chips too**, which is the other half of the same report: a
chip there is uncapped by a number but capped by the card (`max-w-full`), and its
label **wraps** rather than truncating. Unbounded, a flex item sized by a
56-character ref overflowed the card and printed the name across the graph beside
it.

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
is a state, not a hover — the same rule as the selected project keeping its `+`
on show (F1). (This used to cite the panel toggle's open state as the precedent. That
went away on 2026-08-20: the rule holds for a row in a list, where the resting
colour is all you have to tell rows apart, and not for a header icon whose state
is a whole panel being on screen. See F12.)

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
  reads as the app failing to respond. The close delay stays, because it is what
  lets the pointer travel from the row onto the card without it vanishing
  underneath, and it costs nothing on the way in. Measured after the change: 45ms
  from hover to visible card.

  **One card is open at a time, and the list owns which one. Added 2026-08-18 on
  user feedback**, which reported commits that persist while you move the pointer
  quickly. They did. This spec previously credited Radix with keeping the sweep
  tolerable; that was wrong, and removing the open delay is what exposed it. Every
  row is its own `HoverCard` root and roots know nothing of each other, so
  crossing five rows opened five cards, each then sitting out its own 150ms close
  delay stacked over the session pane — five entrance animations at five different
  offsets, which is what "glitchy" was. `GraphView` holds the carded sha for the
  whole list and passes each row `open`, so opening one closes the last. The close
  is **guarded on the sha**: the row you left reports closed a delay *after* the
  row you arrived at reported open, and an unguarded handler would shut the card
  you are pointing at. Rows are `memo`'d with sha-taking callbacks for this — a
  list-wide open state otherwise re-renders all 300 rows per row crossed.

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
  same thing. The strip must not reflow as you move between projects. **The same
  pixel, too**: all three tabs share one `PanelEmpty`, and the graph — which
  renders outside the `py-1` scroll wrapper Files and Changes sit in, because it
  owns its own scrolling and docks a detail pane — repeats that padding
  explicitly. Its line sat 4px above theirs until 2026-08-18, on one click's
  distance.
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

**The question is "is an agent working", not "is a process alive"** —
narrowed 2026-08-21, ADR-0020. Every live PTY still dies either way; what
changed is when factorai stops to ask you about it. A window full of
sessions that handed the turn back an hour ago has nothing in flight to
lose, and a dialog that fires there is a keystroke rather than insurance
— it trains you to dismiss without reading exactly the dialog you want
read on the day one of them *is* mid-run. This is F10's rule for closing
one session (`needsCloseConfirm`), applied to the two gestures F10 left
on the old signal.

When the user closes the window:

1. Rust intercepts `CloseRequested` and reads two counts —
   `live_count()` (what quitting kills) and `working_count()` (sessions
   whose status is `working`).
2. **`working_count() > 0`** — prevent the close and emit
   `app:quit-requested { liveCount, workingCount }`. The frontend opens a
   `Dialog` from `@factorai/ui`:
   > Quit factorai? Claude is working in 1 of 4 live sessions. Quitting
   > terminates all 4 — work in progress is lost. This cannot be undone.
   >   [Cancel]   [Quit & kill sessions]

   The `of N` clause is dropped when every live session is working. On
   confirm, the frontend calls `invoke('app_quit_confirmed')`; Rust runs
   `TerminalManager::kill_all()` then `app.exit(0)`. On cancel the dialog
   dismisses and nothing happens.
3. **`working_count() == 0` with live PTYs** — no dialog, but the close
   handler calls `kill_all()` itself before letting the close through.
   The dialog's confirm used to be the only caller on this path, and
   `Drop` on `TerminalManager` is a crash backstop rather than something
   Tauri's exit promises to run.
4. **Nothing live** — the close proceeds untouched.

**Kill-on-quit stays non-optional and not configurable** (ADR-0005). The
cost of a stray zombie process running an LLM agent is real money, and
narrowing the *question* does not narrow the killing. Unlike the
per-session close (F10, F11) there is no preference here either: this one
is about losing every live session at once.

**The wording lives in one place.** `lib/quitConfirm.ts` owns both the
predicate (`needsQuitConfirm`) and the sentence
(`quitConfirmSentence`), because the restart in F14 is the same decision
at a second door — and the two already drifted once, when the restart
shipped with no confirmation at all.

**Known gap, inherited from F10.** A session parked on a permission
prompt reads as `waiting_input` — Claude's title says idle while its own
dialog is open — so quitting will not ask about it. Closing that needs
the `needs_permission` state F10 recorded as considered and not built,
and it closes for every gesture at once when it lands.

---

## F19 — Clickable file links in terminal output

**Behavior.** `Ctrl`/`Cmd`-click a path in the agent's output and it opens in
the viewer (F7) — at the line, if the path carried one. A directory reveals
itself in the file tree instead (F12). A path that isn't on disk was never a
link in the first place.

This is the fourth member of the navigation family: F12–F14 are "I know roughly
what I want, find it"; this is "the thing on screen right now, open it", which
is both cheaper and far more frequent.

### It is a link provider, not OSC 8 — settled 2026-08-19

Roadmap item 15 left this fork open, and it decides the size of the feature.
Answered from the CLI binary (2.1.235): the only OSC 8 emitter it carries is the
`link(url)` helper quoted in F5, and it is used for **URLs**. Nothing marks up a
*path*. Grepping the binary for `file://` finds ripgrep's `--hyperlink-format`
templates (`file://{host}{path}#{line}`, `vscode://…`) vendored inside it, which
is a convincing false positive and not us — rg is invoked without that flag.

So a path Claude Code prints is plain text, and the only thing that can turn it
into a link is us matching it. **OSC 8 stays wired for URLs (F5) and contributes
nothing here.** The two paths remain separate in xterm and remain separately
correct.

**The cost item 15 worried about does not exist.** It feared "a regex over every
frame of a busy TUI". `ILinkProvider.provideLinks(bufferLineNumber, callback)`
is called by xterm for the **hovered line only**, on mouse move — not per frame,
not for the buffer. A TUI redrawing at speed costs nothing at all until the
pointer is over it.

### The grammar

A candidate is path-shaped text with an optional `:line` or `:line:col` suffix.
In scope, all of it verified against disk before it becomes a link:

- **Absolute paths**, and `~/`-prefixed ones expanded against `HOME`. The agent
  prints `~/.claude/…` constantly and it is unambiguous.
- **Relative paths** with a separator — `src/lib/foo.ts`, `./scripts/qa/kill.sh`.
- **Bare filenames** with no separator at all — `README.md`, `Cargo.toml`. These
  are common in the agent's prose and cheap to allow *because* of verification:
  `package.json` mid-sentence links only if a `package.json` really sits at the
  base.
- **Wrapped lines are joined first.** xterm marks continuation rows `isWrapped`,
  and the provider is handed one row. Without walking the wrap, the long paths
  most worth clicking are exactly the ones that never link — which is the
  failure nobody would report as a bug, only as "it doesn't really work".

Out of scope, deliberately: **paths containing spaces.** Nothing in the output
quotes them, so there is no way to know where the path ends, and guessing turns
"open the file" into "open some prefix of the file".

### Verification is what makes that grammar affordable

`path_kinds(paths) -> Vec<PathKind>` (`03-backend-rust.md` § `files`) answers
file / directory / missing for a batch, called once per hovered line with every
candidate on it and memoised in the renderer. Three things fall out of it:

- Version strings, prose and `foo.ts` inside a sentence stop being links,
  without a cleverer regex.
- Item 15's requirement that a stale path "should say so rather than opening an
  empty editor" is met by never linking it. There is still a race — verified on
  hover, deleted before the click — and that lands in `FileView`'s existing read
  error, which is the right place for it.
- Returning the **kind** rather than a boolean is what lets a directory do
  something sensible instead of opening an empty editor.

### The base a relative path resolves against

Session `cwd` first, then the project's `realPath`. Whichever resolves to
something real wins; if neither does, it was not a link.

Worth knowing that **today this chain is a no-op**: `Terminal.tsx` spawns the
PTY with `cwd: projectCwd`, so the two are the same string. It earns its place
for **resumed** sessions, where `SessionSummary.cwd` comes from the transcript
and can be a subdirectory of the project.

### Modifier-click, the same gate as F5

`onLinkActivated`'s rule is reused verbatim, and the reason in its doc comment is
unchanged by the destination: Claude Code is a TUI, and a bare click lands on
interactive output — a menu row, an approval prompt — often enough that throwing
a viewer over the terminal on one would be an ambush. Three kinds of link in one
terminal disagreeing about what a click means would be worse than any of the
three rules alone.

### Where the click lands

The existing `FileViewerModal` via `?file=`, plus a new **`?line=`** (and
`?col=`) driving Monaco's `revealLineInCenter` + `setPosition`. One viewer, one
entry point, URL-driven — so browser-back closes it, and the F20 bridge's
`openFile` calls exactly the same `useFileViewer().open(path, { line })` rather
than inventing a second way in.

**A directory opens the panel, expands to it and selects it.** This is the one
place a programmatic panel change is justified against `panelStore`'s rule that
the strip never moves under you: that rule is about a surface moving *while you
type*, and this is the direct answer to a click you just made.

**A directory the tree cannot show is not a link.** `~/.claude/projects/` is
real, and interesting, and the tree only shows this project — so clicking it
would do nothing at all. A link that underlines and then ignores you is worse
than plain text, so a directory only links when it is inside one of the bases.

**Focus returns to the terminal on close.** The modal is a Radix `Dialog` and
traps focus already; the missing half is restoring it to the xterm textarea. Skip
it and the sequence is: click a path, read it, press `Esc`, type — and the
keystrokes go nowhere.

### Shape

Resolution — candidate matching, `~` expansion, base resolution, the
`path_kinds` cache, and the open — lives in `lib/fileLinks.ts`, separate from
the xterm wiring that calls it. **The live terminal is the only consumer for
now**; a rendered transcript is a completely different implementation of the
same idea, and the split exists so that one can be added without a rewrite
rather than because it is being added.

**Roadmap.** Item 15.

---

## F20 — IDE bridge: the agent opens files in our viewer

**Status: built, and the CLI connects — observed 2026-08-19 against 2.1.235.**
Roadmap item 19 and
[ADR-0017](../docs/adr/0017-ide-bridge-writes-one-lockfile-into-claude-ide.md),
which hold the decisions and the reasoning behind each. This section is the
behaviour they add up to.

The conformance pass earned its place immediately. Everything was unit-tested
and green, and the first run against the real binary connected, completed the
handshake and **reset**, with nothing sent — because the CLI builds its socket
as `new WebSocket(url, { protocols: ["mcp"], … })` and we were not echoing
`Sec-WebSocket-Protocol`. No test caught it, because our own test client never
asked for a subprotocol. Fixed and pinned; the log now reads `ide bridge
initialised` and `claude connected to the ide bridge`.

**What is still unobserved is a tool call.** `initialize`, the notifications and
the lifecycle are exercised end to end; `openFile` reaching the viewer from the
agent's side has only been driven by unit tests. Record the CLI version with any
future pass — this one was 2.1.235.

**Behavior.** factorai presents itself to the `claude` CLI as an editor. The
agent asks us to show a file; it opens in the viewer (F7), at the line if the
request carried one. That is the whole of the first slice, and it is
deliberately the half that writes nothing.

**Why it matters more than its size suggests.** Everything the app does today is
*pull*: the human goes and looks at the Changes tab, the tree, the diff. This is
the **push** half — the agent asks and the human decides in place, which is two
of the four verbs in `00-overview.md` § "The operating model". F19 makes the
agent's *output* actionable by parsing it; this makes the agent's *intent*
actionable by protocol. They meet at the same viewer, and `openFile` calls the
same `useFileViewer().open(path, { line })` a terminal link does.

### The protocol, as of CLI 2.1.235

Read out of the shipped binary rather than inferred, and the version matters:
nothing in CI can prove we still match a program that ships weekly.

- We write `~/.claude/ide/<port>.lock`, mode `0600`, holding
  `workspaceFolders`, `pid`, `ideName`, `useWebSocket`, `runningInWindows` and
  `authToken`. **The port is the filename**, which is why it cannot be anywhere
  else.
- The CLI TCP-probes the port, then connects by WebSocket with the token in an
  `X-Claude-Code-Ide-Authorization` header.
- `CLAUDE_CODE_SSE_PORT` in the child's environment selects *among the lockfiles
  it found*. It adds no search path and is not a substitute for the file.
- Autodetect polls ~30s and connects only when **exactly one** entry matches, so
  a developer with VS Code open is a coin toss unless the port is pinned. Ours
  is: one server per session, its port in that session's environment.

### Tools we answer, and one we deliberately do not

First slice: `ide_connected`, `getWorkspaceFolders`, `openFile`,
`getOpenEditors`. **F21 appended a fourth tool, `setWorktree`**, and widened
`getWorkspaceFolders`'s answer — see F21 for both, and note that the new tool is
advertised unconditionally because `tools/list` is fetched once at connect.
**Nothing else will be added here, because nothing else can be.** The CLI
registers this connection under the hardcoded key `ide` and hands the model only
`executeCode` and `getDiagnostics` from it, so every tool above works for one
reason: **the CLI calls them, not the model.** A tool meant for an agent goes on
factorai's own MCP server instead — F22 § "Routines over MCP" and
[ADR-0029](../docs/adr/0029-model-facing-tools-need-a-server-that-is-not-the-ide.md).
`ideName: "factorai"` in our lockfile names a row in the `/ide` picker and
nothing more.

**`setWorktree` writes, and to our own database rather than the working tree.**
ADR-0017 § 6 put `openDiff` out of scope because it would be the first time
factorai wrote to a *repository*; our own tables are a different boundary, and
what holds it is scope rather than the token — a path checked against the
session's repository, which the client cannot address.

**`getDiagnostics` is not registered, on purpose.** We have no diagnostics
source — that is item 14's LSP question — and advertising the tool while
returning `[]` tells the agent *there are no errors*, which it will act on.
Silence is honest; a confident empty answer is not.

**The same rule binds `getOpenEditors`, and it is easier to get wrong.** It is
offered, so it has to be *answered* — a hardcoded empty list while the human has
a file open is the identical lie in a place where returning nothing looks like a
reasonable stub. The viewer holds at most one path (`?file=`), so the renderer
reports it to the backend rather than the tool guessing. If that wiring is not
there, the tool comes out of the list until it is.

`openDiff`, `close_tab` and `closeAllDiffTabs` come with the write path, which
is a separate decision and a separate ADR (ADR-0017 § 6).

### `openFile`, mapped onto a viewer that is not VS Code

- `startLine` / `endLine` → `&line=` (F19). This is why that param exists before
  this feature does.
- **Text anchors (`startText` / `endText`) are ignored for now**, and logged when
  one arrives so we learn whether they are worth a second resolution strategy
  with its own not-found case.
- **`preview` is ignored**, and the name is a false friend: it is VS Code's
  *preview tab* — the italic-titled tab the next open replaces — not a render
  mode. What a reader wants from it is already true here for a different reason:
  `FileView` opens markdown and SVG rendered, with a source toggle, whoever
  asked for the file. One behaviour, three entry points.
- **`makeFrontmost: false` agrees with a rule we would have needed anyway.** An
  `openFile` for a session that is not the tab in front marks that tab and
  leaves the reader where they are; only the active session's request opens the
  viewer. An agent-centred ADE is not a human-absent one, and `panelStore`
  already encodes the sibling rule that a surface must not move under you while
  you type. The call succeeds either way — it asked us to surface a file, and we
  did, at the level the human can act on.

### Where an `openFile` lands

Rust decides, and the renderer obeys, so the rule lives in one place. The bridge
opens the viewer when the request's session is the one in front *and* the agent
did not ask to stay out of the way.

**Otherwise nothing happens, and the agent is told exactly that** — "not shown:
that file belongs to a session the human is not currently viewing". Not an
error: the call was well-formed and the answer is no.

There *was* a mark on the background session's tab, and it was removed rather
than recoloured. It used `--primary`, which is `--color-status-waiting`'s exact
value, so it was indistinguishable from "this session is waiting for you" — on a
tab that already carries a status badge. Where the request should land instead
is **open**: the toast primitive roadmap item 7 wants is the likely home, since
a transient event probably deserves a transient surface. Until then the bridge
reports honestly rather than claiming a mark nobody can see, which is the same
rule that keeps `getDiagnostics` out of the tool list.

`ide_report_ui` is how Rust knows any of this: the renderer reports the active
session and the open file whenever either changes. Fire-and-forget — a report
that goes missing leaves a stale picture that errs towards marking a tab, which
is the harmless direction.

### The header shows nothing until something is wrong

**A working bridge is invisible.** It was briefly a blue "connected" dot and
that was the wrong instinct twice over: a badge for the healthy case is a label
that is always on, which is a label you stop reading, and it spends header width
on the state you never need to act on. Removed on user feedback the same day it
landed.

**A broken one gets a badge**, immediately before the close control — the
right-hand end is where this header already keeps the things you act on, while
the project and branch names on the left say where you are. It carries the
reason in its tooltip, because "something is wrong" that does not say what is a
worse header than no badge at all.

That is the one state worth a pixel: **an agent that cannot open a file looks
exactly like an agent that chose not to.** Everything else about the bridge
belongs in the log.

Reported today for the failure we can name without guessing — the bridge did not
bind or could not write its handle, so every `openFile` for that session will
silently do nothing. Two other shapes of "connection issue" are deliberately
*not* reported yet, because neither can be told from normal behaviour without a
timer and a threshold: **a client that never attaches** (indistinguishable from
one that is still starting — the CLI's own autodetect polls for 30 seconds) and
**one that detaches while the PTY lives on** (which is what `/ide` disconnect
looks like). A badge that cries wolf on either is worse than the silence it
replaced.

**A reloaded renderer asks every bridge to re-announce** (`ide_resync`), because
a reload throws the renderer's state away while every PTY and every bridge
carries on — the same hole `terminal_list` fills for tabs. The answers come back
as ordinary `ide:status` events rather than as a returned list, and that is what
makes it correct rather than merely convenient: a returned list has to be merged
with whatever arrives while the call is in flight, and nothing distinguishes a
stale entry from a fresh one. Replaying down the same channel puts every update
in one ordered queue with nothing to reconcile.

There is **no off switch yet**, and that is the same shape as F18's restore
preference: F11 is specified and unbuilt, so the switch lands there rather than
becoming half of someone else's feature. Recorded in roadmap item 4.

### Handing files to the agent

The other direction, and the thing that makes this a bridge rather than a remote
control: **right-click files in the tree → "Add to agent context"**, which
arrives in the agent's prompt box as `@path`, or `@path#L12-18` for a run of
lines.

The label says *agent*, not *Claude*, and that is the same rule the bridge's own
badge follows: Claude is the only agent factorai drives today, but ADR-0011
already generalised "an agent's store" past it and `00-overview.md` puts agents
at the centre rather than one vendor. A control named after today's
implementation is a rename waiting to happen.

**`at_mentioned`, not `selection_changed`, and the modal is why.** VS Code
streams your editor selection continuously and the CLI renders it in its footer
("4 lines selected · In foo.ts"). Our viewer is a modal you must dismiss before
you can type, so anything living only in the footer is one keystroke from being
forgotten — and the footer is *behind* the modal while you are selecting, so you
never see the feedback at the moment you act. Text in the prompt survives the
viewer closing and is visible in what you are about to send.

**The wire is 0-based; everything above it is 1-based** — and getting that
backwards shipped, briefly, before being caught by watching it. A selection the
viewer labelled "lines 10–13" arrived in the prompt as `@biome.json#L11-14`: the
CLI adds one before printing, so sending the numbers the human selected points
one line further down the file than the one they highlighted.

The earlier belief came from reading a renderer in the binary that prints
`#L${lineStart}` verbatim — which turns out to sit on the *far side* of the
conversion. **A schema read out of a binary tells you the shape, not the
convention**, and only running it tells you the second. The single conversion
lives in `protocol::at_mentioned`, pinned by a test that states the observation
rather than the inference; a selection starting on line 1 therefore goes out as
a literal `0`, which was checked against the real CLI and is not dropped.

**Selection lives in the tree, and a modified click never navigates.** Plain
click is unchanged — select and open. Ctrl/Cmd-click toggles a row into the
selection; shift-click takes the run between the anchor and the row. Neither
opens the viewer nor expands a directory: you are building a set to hand over,
and a modal thrown over the tree on every ctrl-click would make the gesture
unusable.

**Shift-click ranges stop at a directory boundary**, falling back to selecting
the one row. The tree is recursive and every node fetches its own listing, so
there is no flat list of what is visible — a range across directories would mean
lifting every lazily-loaded listing out of its node, which is its own piece of
work. A parent already holds its children in order, so siblings cost nothing.

Right-clicking inside a selection acts on all of it and outside one replaces it,
the way every file manager behaves. The menu row names the count — "Add 3 items
to agent context" — because a gesture that sends more than you meant is worse than
one
you have to repeat.

**It fails loudly**, unlike the rest of the bridge. No session in front and the
row is disabled rather than hidden; no bridge, or Claude not attached, and the
call errors. This is a gesture the human just made and is watching for, so
"nothing happened" has to be visible.

**Lines come from the viewer**, through a control in its footer rather than its
header: the footer is the only place that knows the selection, and the label has
to name the range — "Add lines 12–18 to agent context" — because a control that
sends
more than you highlighted is worse than one you press twice. Absent rather than
disabled with no session in front; in a row of metadata a greyed control reads
as broken.

A selection ending at **column 1 does not include that line**. Dragging from 12
to the start of 19 highlights nothing on 19, so `#L12-19` would claim a line the
reader never touched — every editor trims this, and the CLI's own footer
arithmetic does the same subtraction on `selection_changed`.

### Not in this feature

`selection_changed` — the ambient half, where merely selecting in the viewer
tells the agent what you are looking at. Deferred rather than dropped: it is
what the CLI's footer is built for, and it needs the viewer to report a live
selection. Its own roadmap entry.

**Roadmap.** Item 19.

---

## F21 — Worktrees as a first-class session citizen

**Specified and built 2026-08-21**, from the clarify-needs interview roadmap
item 1's last bullet was gated on. Detection, the bridge tool, the widened scope,
the roll-up, the persistence and the panel that follows are all in.

**One thing is deliberately still open, and it is the premise**: a `setWorktree`
call from the real CLI has never been observed. The conformance pass is roadmap
item 37's last box. Two things work with zero uptake of the tool — the `openFile`
inference and the `sessions.cwd` default — so the floor is "correct but passive"
rather than "broken". The graph's per-checkout `HEAD` chips are the other
remainder, and they are cosmetic.
[ADR-0019](../docs/adr/0019-a-worktree-is-a-checkout-not-a-project.md) holds the
two decisions that constrain everything below — what a worktree *is*, and what
the bridge is allowed to reach.

**The problem, stated as it actually appears.** An agent asked to work on two
things at once reaches for `git worktree add`, and from that moment factorai is
describing the wrong directory. The tree, the Changes tab, the graph's working
row and the tree's decorations all key off one string — the project's
`realPath` — so the panel confidently shows a clean checkout while the agent
edits a tree the app cannot see. Worse, the session doing the work often is not
in the project at all: `claude` keys its store by cwd, so a session started in
`~/wt/feature-x` lands under a different `~/.claude/projects/` directory and,
under ADR-0011's exact-path attachment, becomes a project you never added rather
than a session of the one you did.

**Agent-driven first, and that is the design rather than an economy.** The agent
creates the worktree — it is one command, in a terminal, and `05-features.md`
F18 and ADR-0009 have already settled that factorai does not do git's writing
for it. What factorai owes it is to *follow*. So the mechanism is the agent
saying where it went and the app moving, not a picker the human is expected to
keep in sync with a process they are supervising rather than driving.

### A worktree is a checkout of the project's repository

Never a row in `projects`. The set of checkouts is read from git — the main one
and every linked one — and it is keyed by the repository, not by which checkout
you happened to add. A project that *is* a linked worktree therefore sees the
same set as one that is the main checkout: it is the same repository whichever
door you came in by.

**Sessions roll up by repository, and ADR-0011's rule is tried first.** A
session recorded in `~/wt/feature-x` attaches to the project owning that
repository — but only if no project claims its path exactly. So adding
`~/wt/feature-x` yourself keeps its sessions where they were, and nothing moves
under someone who has already built a workflow out of the workaround.

### The signals, and the shapes that keep defeating them

**This section was called "why there are only two", and the heading is the
record of what this feature has cost.** Five shapes of "the agent moved and
factorai did not" have reached a user, each one defeating every signal that
existed when it arrived; the two the design started with are the first two
below. The pattern is worth stating plainly for whoever meets the sixth: every
signal so far has been *correct* and about the wrong place, so the question to
ask a new one is not "is this true" but "what is it evidence of".

The bridge (F20) is the **only** channel an agent has into factorai, so it is
where following has to happen. `at_mentioned` runs the other way — human to
agent — and is not a signal.

1. **`setWorktree { path }`**, a fourth tool on the bridge's `tools/list`.
   Intent, stated. Validated in Rust against the repository's registered
   worktrees; an unregistered or missing path is a **tool error**, not a
   JSON-RPC error, following the line `services/ide/protocol.rs` already draws
   between "your call was malformed" and "your call was fine and the answer is
   no".
2. **An `openFile` path inside a checkout the panel is not showing.** The agent
   is already sending absolute paths through this tool; a path in another
   checkout is it telling you where it works, at no cost and with no new
   protocol. It also covers the agent that never learns the tool, which on the
   evidence of F20 — *"what is still unobserved is a tool call"* — is the case
   to design for.

`getWorkspaceFolders` starts answering with the repository's checkouts and which
one is current. It is the read side of the same concept and the tool `claude`
already calls early, so it is where an agent discovers that any of this exists.
Its **old `folders` key keeps its old shape and meaning**, so an agent reading
only that sees no change; what is added is `cwd`, `worktrees`, `viewing` and a
one-line `hint` naming `setWorktree`.

**`viewing` is a second, labelled fact and is never merged into `folders`.** The
panel can be showing another checkout while the PTY's cwd has not moved, and an
agent told the *view* is its workspace would run `git` in one tree and edit
another. It is `null` when there is nothing to report.

**The human's own mention path shares the scope.** "Add to agent context" (F20)
resolved against the session's cwd alone, so once the tree can be rooted at a
worktree, the gesture would have failed for exactly the files the panel was
showing. It now resolves against the same set.

**A third signal was added 2026-08-21, after the first two failed on a real
session.** Asked to open a worktree, the agent created one, moved into it, said
so in prose — and called nothing. No `setWorktree`, no `openFile` in the
worktree, so the bridge saw nothing at all. The panel sat on the main checkout.

So the session's **last recorded `cwd`** is now read too, before its first. This
reverses the interview's decision, and the reason given there was simply wrong:
"an agent working in a worktree by absolute path never changes `claude`'s own
cwd" — the agent `cd`'d into it, and `claude` relocated its whole store directory
to match.

**It is only safe because this is containment, not equality.** A session's `cwd`
follows every `cd` a shell command makes; one real transcript churned between the
project root, `apps/desktop/src-tauri` and once
`node_modules/.pnpm/@xterm+xterm@5.5.0/…`. Every one of those is *inside* the
main checkout and so resolves to it. Only a path in a linked worktree resolves to
the worktree, which is why the noise is harmless and why the raw last value must
never be compared to the project root directly. `cwd` keeps its own meaning, so
F19's path resolution is untouched — see migration 0008.

**One signal stays rejected**, for a reason the above does not weaken: polling
`git worktree list` and treating a newly-appeared checkout as the live session's
becomes a coin toss the moment two sessions are live in one project.

**A fourth shape defeated all three signals** (seen 2026-08-24, in a user's
session). The agent ran `git worktree add -b … ../pearl-eng-3834`, then drove
that checkout entirely by `git -C ../pearl-eng-3834 …` and absolute paths. Its
own cwd never moved, so `last_cwd` still named the checkout it started in; it
called no `setWorktree`; and it reads and writes files through its own tools
rather than the bridge, so no `openFile` ever arrived. Every signal was right and
every one of them pointed at the wrong tree.

**So a fourth signal was added, and it is the one this document rejected.** The
last **absolute path the session's own `tool_use` blocks name** —
`sessions.last_touched`, migration 0009 — read through the same containment as
the two cwds. The rejection said it "means parsing another program's internal
tool schema", which is true and is the cost paid: nothing in that parse is
required to be present, an unrecognised shape yields no path rather than an
error, and if the schema changes this quietly stops contributing and the cwds
carry the feature exactly as they did before. What changed is the other side of
the trade — the alternative is a panel that confidently describes the wrong
directory, which is the failure the whole feature exists to prevent.

**It is believed ahead of the cwds, and only when it names a linked checkout.**
Both halves matter. Ahead, because the case it exists for is one where the cwds
are *correct and useless*: an agent that never moves its cwd keeps naming the
checkout it started in for ever, so reading that first would mean this step never
runs in the one situation it was added for. Linked-only, because a touched path
in the main checkout says nothing — an agent working in a worktree reads a shared
config, a sibling package or the spec it is working from all day, and letting
that count would flicker the panel between checkouts on every tool call. A path
in a *linked* checkout is the opposite: nothing else in the session points there.

**Relative paths are dropped rather than resolved.** A tool's path is relative to
wherever that call ran, which the transcript does not state, and the entire use
of this value is deciding which of two checkouts a path is inside. A wrong answer
there is worse than no answer.

**Every path is compared resolved, and stored raw.** `git_worktrees` has always
canonicalized, so the session's side has to as well or the comparison is between
two names for one directory: a tool's absolute path can carry `..`, and a shell's
own idea of where it is is the *logical* path, which keeps whatever symlink you
walked through. `list_sessions` resolves `cwd`, `last_cwd` and every entry of
`touched_paths` on
the way out and the table keeps the raw value — `resume_cwd` probes
`encode_path(cwd)` for a transcript, and `claude` encoded the path it was given.
Resolving on the way in would make that probe miss for exactly the moved
sessions it exists for.

**A fifth shape defeated the fourth signal the same afternoon** (2026-08-24,
the same user, hours later). The agent created `../pearl-eng-3333`, worked in it
for an hour, and did all of it through `Bash`: 44 shell calls, and not one
`Read`, `Write` or `Edit`. The fourth signal harvests `file_path` and
`notebook_path`, so it found nothing at all, and the two cwds — as in the fourth
shape — went on correctly naming the checkout the session started in.

**So a shell command's own paths are harvested too**, which is the fourth
signal's trade taken one step further rather than a new one. A command line is
not a path list: it holds redirects, `sed` expressions, globs, flags and
quoting, and reading it properly would mean implementing a shell. It is
therefore read *loosely* — every absolute-path-shaped token, bounded by
whitespace and shell punctuation, with two rules that exist only because real
transcripts contain them (a `/` after a word character is part of a relative
path or a `sed` script and starts nothing; a token beginning `//` is a URL's
authority).

**The looseness is why the signal became a list, and the two changes are one
decision.** Replayed over that transcript, "the last absolute path anywhere in
the session" belonged to no checkout in 31 of 42 candidates — `/dev/null`,
`/usr/bin/env`, a scratch script — and to the main checkout in 4 more. A single
stored value would have spent most of an hour naming something useless, and each
time it did, the panel would have snapped back to the project the agent was not
working in. `sessions.touched_paths` keeps the last eight instead (migration
0010), and the resolution takes **the most recent entry that lands in a linked
checkout**, which makes every other candidate free. Over the same transcript
that answers `pearl-eng-3333` — the right tree — from the first command that
named it onwards.

**The cap selects nothing and is not tuned.** It bounds a column. The scan of
one command can contribute several paths, so eight is a few commands of history,
and a session genuinely working in a checkout names it again long before eight
unrelated paths go by. A repeat moves its entry to the end rather than adding
one, or a session in one worktree would hold eight copies of the same path and
be back to a window one entry wide.

**The human's picker is still the floor under all five.** An agent can work in
two checkouts at once, and no inference can rank them — see "The escape is one
control".

### The scope the bridge resolves against

[ADR-0019](../docs/adr/0019-a-worktree-is-a-checkout-not-a-project.md) § 2 holds
the decision; three things about the implementation are worth stating here.

**The set is the session's cwd plus every checkout of its repository**, and the
cwd is in it unconditionally. That is not belt-and-braces: a project that is not
a repository has no checkouts at all, so without it the scope would be empty and
every `openFile` refused — F20, broken for exactly the projects this feature has
nothing to do with. `services::git::worktree_paths` is where the rest comes from,
and a checkout that is not on disk is dropped there rather than reported, because
a directory that does not exist cannot contain the path about to be compared
against it.

**`setWorktree` resolves against the checkouts alone, deliberately not the whole
scope.** The cwd is in scope so files can be opened there; a cwd that is not
itself a checkout is not somewhere the panel can be rooted. The two sets differ
by exactly that one path, and conflating them would let the agent root the panel
on a directory git knows nothing about.

**The human's own mention path shares the scope.** "Add to agent context" (F20)
resolved against the session's cwd alone, so once the tree can be rooted at a
worktree the gesture would have failed for exactly the files the panel was
showing. It resolves against the same set now.

### The panel moves, and the route still owns the project

**Either signal moves the panel**, immediately, with no confirmation. This is
the deliberate asymmetry of the feature: the human's supervision happens over
what the agent *did*, and a panel that needs a click before it will show you
that is a panel describing the past.

Three bounds keep it from being obnoxious:

- **The route decides the project; the signal decides the checkout.** A signal
  from another project is ignored. `FileTreePanel`'s contract — *"which project
  it shows follows the route"* — is untouched, because a panel and a header
  naming different repositories is not liveness, it is a bug that reads like
  one.
- **Only a live session's signal counts.** The bridge is per-session and dies
  with it (ADR-0017 § 2), so a closed session cannot move the panel with a late
  frame.
- **Two live sessions in one project will trade the panel** between their
  checkouts. Accepted, knowingly: it is the honest rendering of two agents
  working in two trees, and the alternative — pinning the panel to one of them —
  is the picker this feature deliberately does not ship yet.

**The escape is one control, and since 2026-08-24 it is a picker.** v0 shipped
an `IconButton` beside the header badge that returned the panel to the worktree
containing `sessions.cwd` — an undo of an automatic move, deliberately not a
select, because the point of v0 was to find out whether agent-driven following
works and a select would have let it look like it does. It does work. What it
cannot cover turned up in a real session and is stated under "The signals"
below: an agent that drives a worktree entirely by `git -C` and absolute paths
leaves nothing to follow. So the mark is now the trigger of a menu listing every
checkout, and the revert is an item inside it rather than a second control in the
header.

**A pick outranks an inference and is undone by the revert, not by the agent.**
It writes the same `session_worktrees` row a signal writes — one question, one
record — and the renderer marks it `pinned`, which is what makes the next
`openFile` in another checkout leave the panel where the human put it. The flag
is in the store and not in the table on purpose: a reload resolves to the picked
checkout from the row like any other, and drops only the immunity, because an
agent that moves after a reload is one the panel should follow again.

**It deletes the row, and it has to.** `clear_session_worktree` is the only write
to `session_worktrees` that does not come from the bridge. Clearing only the
in-memory signal would leave the persisted checkout to win the very next read, so
the button would appear to do nothing — or worse, work until you navigated away.
Idempotent, because the control is drawn from state a double-click can outrun. A full select —
and telling the agent when a human moves the panel — is deferred; see "Not in
this feature".

### Which checkout a session is showing

Three steps, first match wins:

1. `session_worktrees.path`, if it is still a registered worktree of the
   repository *and* still on disk. The human's pick arrives here too, which is
   why it needs nothing else to outrank the inferences below.
2. The **linked** checkout containing the most recent entry of
   `sessions.touched_paths` that lands in one, by longest containment. Asymmetric
   on purpose, and read as a list rather than as its last entry — "The signals"
   above has why, and why it sits ahead of the cwds rather than behind them.
3. The checkout containing `sessions.last_cwd`, then the one containing
   `sessions.cwd`, by longest containment — which is what makes a session started
   *or moved* into a worktree correct with no signal at all. The `cwd` step is
   also the revert target above.
4. `projects.real_path`.

A project route with no session in front always shows step 4. It has no session
whose checkout could be meant, and guessing from the most recent one would make
the tree change when you navigated away from it.

**A checkout that stops being valid falls back to the next step and says so
once** —
`git worktree remove`d, or its directory deleted while you are looking at it.
Not doing this is worse than it sounds: `Repository::discover()` walks up from a
missing path's nearest existing parent, so an unhandled removal quietly re-roots
the panel on whatever repository sits above the deleted directory, and nothing
on screen says the subject changed.

### The consequence that is not optional: resume cwd

`attachPty` spawns with `projectCwd`, and `session_flag()` decides `--resume`
versus `--session-id` by probing for a transcript at
`encode_path(cwd)/<id>.jsonl` — there is a test named
`session_flag_is_scoped_per_folder` asserting exactly that. So a rolled-up
worktree session, restarted with the project's path as cwd, finds no transcript,
claims `--session-id` for an id `claude` already knows, and the conversation is
either refused or silently replaced by an empty one.

**Fixed 2026-08-21, and in Rust rather than the renderer.**
`TerminalManager::resume_cwd` reads the session's recorded cwd through a
`session_cwd` callback — the same shape as F11's `user_binary`, for the same
stated reason: the manager needs an answer from a database it should not hold —
and it overrides `opts.cwd` when it has one. A bug fix on its own merits, and it
has to land before the roll-up rather than with it.

**The renderer cannot do this, which is why it does not.** `Terminal.tsx` learns
`sessionCwd` from a query that resolves *after* the component mounts and
`attachPty` has already spawned, so a renderer-side `sessionCwd ?? projectCwd`
would be correct only when the sessions list happened to be cached — right when
arriving from the session list, wrong when arriving by URL or after a restore.
An earlier draft of this section specified exactly that, which is how the race
was found.

**It prefers the recorded folder only when the transcript is really there**, not
merely when the index has a cwd. That is the narrower test on purpose: the
recorded folder is worth preferring *because* it is where the transcript is, so
if the folder moved or the store was cleaned it buys nothing and would only
start the session somewhere the caller did not ask for. Falling through to
`opts.cwd` is the behaviour that predates the fix.

**It is also the line between two things that must not be conflated.** The
transcript's own cwd is where `claude` runs and what makes resume work. The
persisted worktree is what the panel shows. Spawning from the persisted value
was considered and rejected: when the two disagree, that spawn silently loses
the conversation, which is the failure this whole paragraph exists to prevent.

### What persists, and where

`session_worktrees(session_id, path, updated_at)` — see
`02-data-model.md`. **No foreign key to `sessions`, and that is a correction
migration 0007 made after 0006 shipped with one.** A brand-new session has no
`sessions` row — that table is derived from transcripts, and a row appears only
once Claude has written one — so an agent creating a worktree early, the exact
case this feature exists for, signalled for an id the constraint had never heard
of and the insert failed. The panel moved anyway, because the event fires either
way, which is precisely the "shows what a reload disagrees with" split the
write-then-emit ordering exists to prevent.

The constraint was the design error, not the ordering: this table is a record of
what the agent said, keyed by an id factorai minted (ADR-0008), and making its
lifetime depend on the scan noticing a transcript is the mistake ADR-0011 was
written to correct, one level down. Cleanup moved to `reap_deleted`, which is
where sessions are actually deleted and which already exempts live ones — the
same guard a checkout record needs. **Found by using the app**, not by a test. Persisted, because a session resumed tomorrow should come
back in the tree it was working in, and it is Rust that validates and writes it,
so ADR-0013 puts it in SQLite rather than localStorage.

**Its own table, not a column on `sessions`.** `sessions` is derived state: the
scan upserts it from transcripts. Recording a decision in a table another owner
rewrites is precisely the mistake ADR-0011 was written to fix, and the fact that
the upsert already has to `COALESCE` one column it does not own is an argument
against adding a second, not for it.

### Keying, because two caches are wrong across checkouts

- **Tree expand state moves to the checkout**, not the project.
  `panelStore.expandedByProject` holds *absolute* paths, so switching checkout
  under one project id seeds a tree with paths from a different tree.
- **`gitStatus` keys on the checkout.** Different tree, different answer; this
  one should refetch.
- **`gitGraph` keys on the project folder, and needed no change at all.**
  Worktrees share one object database and one set of refs, so the commit list is
  the same list whichever checkout you are in, and `git_graph` discovers the
  repository from whatever path it is handed. The project folder does not move
  when the panel follows the agent, so it is already the per-repository key this
  rule was asking for. Keying it on the *checkout* — the obvious reading, and
  what an earlier draft of this line said — would refetch a full page of
  identical commits on every switch.

### On screen

**The branch badge names the *checkout's* branch, not the project's. Corrected
2026-08-21**, having shipped for one commit saying `main` beside a worktree that
was on `demo/worktree`. A badge that names a branch you are not looking at is
worse than no badge, and it made the two facts beside each other contradict
instead of complement. `useGitBranch` takes the resolved checkout, which also
means it shares the cache entry the panel is already polling for that path.

**Both marks call a checkout the same thing** — git's own name for the worktree,
which is its directory's, through one shared `checkoutLabel`. Not its branch:
that is the badge next to it, and printing it twice spends width restating a fact
rather than adding one. The directory is also what tells two checkouts apart when
they share a branch, or when one has a detached HEAD and no branch to print. The
two disagreed for one commit — `wt-demo` in the header, `demo/worktree` in the
panel — which reads as two different places.

**The session header's mark is drawn when the repository has more than one
checkout**, and it names the one you are in whichever that is. A single-checkout
project's header is byte-identical to what it was before F21, which is the point:
95% of projects pay nothing for this. The gate was "the checkout is not the
project's own" until 2026-08-24 and moved with the picker: once a repository has
two checkouts, which of them you are looking at is a fact worth a mark even when
it is the main one, and the mark is where the picker lives. Beside the branch and
never instead of it — two facts rather than one, because they usually agree and
the interesting cases are when they do not: a detached `HEAD` in a worktree, or
two checkouts on one branch.

**A checkout on no branch names its commit instead. Added 2026-08-24.** The
branch badge was simply absent for a detached `HEAD`, which is the right answer
for a folder that is not a repository and the wrong one here: beside a checkout
mark that is present, the gap reads as "the app has nothing to say about the
branch" rather than "there is no branch". It draws the short SHA behind a commit
icon — a position in history is not a name for one — with the full SHA on hover.
A folder outside a repository still draws nothing, since it has no branch *and*
no commit.

**The mark is the menu's trigger**, rather than a control beside it. The header
already carries a status dot, a project, a branch, a title and a close button,
and one thing that both says where you are and takes you elsewhere is fewer
things in that row than a mark plus a switcher. It keeps `IconButton`'s hover
rule — the text and icon take colour, no filled block — so it still reads as
quiet furniture until you reach for it.

**A menu row is a name, and a subtitle only when there is a second fact.**
Rewritten 2026-08-24 on user feedback, having shipped a row that put the checkout
name and its branch side by side in a 256px menu. That is one fact printed twice
in every repository that names a worktree after its branch — which is every
repository that uses them seriously — so both strings truncated to the prefix
they share, and one of them overflowed the menu rather than ellipsing inside it
(a flex child's `min-width: auto` refuses to shrink; `truncate` needs the
`min-w-0` chain to fire at all). What replaced it:

- **384px wide**, and scrolling at `60vh`. Five checkouts with 40-character names
  is the case this menu is *for*, not its edge.
- **The branch is a subtitle, and only when the name does not already carry it** —
  tested by the branch's last segment appearing in the name, which survives the
  usual `feature/eng-3759-x` → `repo-eng-3759-x` renaming. A checkout with no
  branch says `detached HEAD` rather than nothing, since that is the fact you
  most need before picking it.
- **No `main` chip.** Git's main checkout is the list's first row, so the position
  says it; beside a branch called `main` the word read as a stutter. The two
  chips left are `locked` and `missing`, which change whether a row can be chosen
  at all — a missing one is listed and disabled, per the rule below.
- **The full name, branch and path are one hover away**, in the row's `title`.
  The path is there and nowhere else: it is what tells two checkouts apart when
  everything else about them reads the same, and it is never short enough to
  spend a row on.

The revert stays the separated last item.

**The tree names the checkout beside its root folder**, `text-xs`, and **only
when it is not the project's own**. So the root row reads `factorai · ⧉
feature-x`: what the project is called, and which of its checkouts you are
looking at.

**Moved there from the panel's `h-9` header, 2026-08-21 on user feedback.** That
row already holds three tabs and two icons at 288px, and a fourth thing in it is
a fourth thing competing for the same width. The cost, accepted: the Changes and
Graph tabs have no root row, so they carry no mark — the session header names the
checkout too, and it is visible from all three tabs.

Two earlier reasons for the header placement were both wrong and are recorded so
they are not re-argued. "A project route has no session header to read" — a
project route always resolves to step 4, so the mark could never appear there
anyway. And "all three tabs describe the same tree" is true but does not follow:
the tab you are on decides whether there is anywhere to put it.

**The graph gets a chip per checkout's `HEAD`**, through F18's existing
badge machinery and its "the icon says where the ref lives" rule. In a
worktree-heavy repository this is the reason to open a graph at all: three
checkouts, visible at once, on the commits they are actually sitting on.

**The sidebar rows carry no checkout mark. Removed 2026-08-21 on user
feedback**, having shipped for one commit. The argument for it was that the
roll-up mixes checkouts into one list, so two rows of a project are otherwise
indistinguishable — true, and outweighed: the sidebar is the densest list in the
app, the mark repeated down every row of a worktree-heavy project, and it cost a
`gitWorktrees` query per expanded project to resolve honestly. Which checkout a
session is in is a fact you need once you are *in* it, and the session header
says so there.

### Every checkout git knows is listed, odd ones marked

`locked` and `prunable` show as `text-xs` metadata, in the same voice as the
project row's existing `missing`; a checkout whose directory is gone is listed
as `missing` and `setWorktree` on it is a tool error. A bare repository simply
contributes no main-checkout row and its linked ones list normally.

Filtering the unusable ones out was rejected: a session whose cwd is inside a
filtered-out checkout resolves to the project instead, and nothing on screen
says why — a checkout you cannot see is one you cannot reason about.

### Not in this feature

- ~~**A worktree picker in the header.**~~ Shipped 2026-08-24 — see "The escape
  is one control" above. The deferral was right and its condition was met:
  agent-driven following was verified first, and the picker landed for the shape
  no inference can reach.
- **Telling the agent when the human moves the panel.** `getWorkspaceFolders`
  reports the session's own cwd first and the current view second, clearly
  labelled, so an agent that asks is never misled into editing a tree it was not
  started in. Pushing a notification was rejected for now: `claude` ignores
  notifications it does not know, so it would be an unverifiable write to the
  wire.
- **Creating, removing or pruning a worktree from factorai.** ADR-0009 stands.
  The agent does this in one line, in the terminal below.
- **New sessions starting in the shown checkout.** A separate decision, and it
  interacts with `start_session`'s live-session reuse (ADR-0008) rather than
  with anything here.

### Latency: the checkout list has to be fresh, not just correct

**Measured end to end on a real agent, 2026-08-21.** Prompted to open a
worktree, the agent created one and moved into it; the index carried the new
`last_cwd` **11–13 seconds** later, which is the watcher's own cadence and fine.
The panel then sat on the main checkout anyway, because resolution needs the new
checkout to be *in* `git_worktrees` and that list was on a 30s poll. Correct
data, stale list, and on screen it looked exactly like a feature that does not
work — which is how it was first reported.

So **`sessions:changed` invalidates `git-worktrees`** as well as the session
lists. That event fires for precisely the change that matters: a session's
recorded directory moving is the moment a new checkout might exist. Re-measured
with the invalidation in place, the panel was fully switched **one second** after
the index saw the move — a window the 30s poll cannot fire in.

Sharper than shortening the poll, which would pay for freshness on every project
all day to catch something that happens a few times a day. It is invalidated by
key *prefix*, because the checkout list is keyed by path while the event carries
a project id, and joining the two is not this hook's business.

### The premise this rests on

Everything above assumes an agent either calls the tool or opens a file. F20
records that a tool call from the real CLI is **still unobserved**, so the
honest statement is that slice 3 is where the premise is tested. If uptake is
poor, the recovery is a better tool description and the deferred picker — not a
different architecture, since the `openFile` inference and the `sessions.cwd`
default both work without any uptake at all.

**Roadmap.** Item 37.

---

## F22 — Routines: a project's scheduled agent sessions

**Specified and built 2026-08-29**, from a clarify-needs interview. Slice 1 is
in: the schema, the runner, the commands, the tabbed project view with its
editor, the two context-menu items, the origin icon and the tabless spawn.
**Slice 3 — the MCP tool group — landed 2026-08-30**; see § "Routines over MCP"
below. The skills picker (slice 2) is still outstanding. The two decisions
everything below rests on are in
[ADR-0026](../docs/adr/0026-a-routine-runs-without-a-tab.md) — what a fire
starts, and who decides it is time — with
[ADR-0028](../docs/adr/0028-an-agent-schedules-work-but-does-not-unschedule-it.md)
holding what an agent may do to a schedule. Sequencing and the slices are roadmap
item 42.

**A Routine is a per-project object: a name, a schedule, a prompt, an enable
switch, and a catch-up window.** When it comes due, factorai starts an agent
session in that project with the prompt as its first message — **and does not
open a tab**. What it produces is an ordinary session: indexed, resumable,
searchable, in the sidebar, and tabbed the moment a human opens it.

**It runs only while factorai is open.** No daemon, no launch agent, no systemd
unit. This is a real limit and it is stated as behaviour rather than buried as a
caveat: a routine due at 03:00 on a closed laptop runs when you next open the
app, if its catch-up window still covers it, and otherwise does not run at all.

**Why it is a first-class object rather than a setting.** `00-overview.md` §
"The operating model" makes the human four things, the fourth being the one who
sets the rules agents run under. A routine is that verb in its strongest form —
the rule is written once and then runs without you — which is also why it is the
first thing in this app that acts unasked, and why the visibility rules below
are not decoration.

### The fire

1. `RoutineRunner` (Rust) ticks on the wall clock, finds what is due, mints a
   session id, writes `last_run_at` and `session_routines`, and emits
   `routine:fire`.
2. The renderer mounts a pooled `Terminal` for that id whose host is **never
   shown** and which puts **no entry in `tabs`**.
3. `claude` starts with the prompt as argv — `--session-id <id> "<prompt>"`, or
   `--resume <id> "<prompt>"` on the other branch of the existing transcript
   probe (`03-backend-rust.md` § "Session ids"). Not typed into the PTY: that is
   a race against the CLI's startup which lands in a trust dialog when it loses.

From there it is a session like any other. Status comes from the same OSC title
parse (F10), the IDE bridge starts with it (F20), the indexer picks it up when
Claude writes the transcript.

**F16 is amended by this feature.** Its invariant was *a tab is an open session*,
with `tabs` a superset of the live map; it becomes **a tab is an open session,
and a session may run without one**. Everything else in F16 stands: a tab still
survives an exit and a quit, and still goes only when you close it.

### Being visible without being in your way

The rule this feature has to satisfy: **an agent is never running invisibly.**

- **The sidebar lists routine sessions like any other**, and they feed the
  project's aggregate status dot. The dot appearing while you are elsewhere is
  the ambient signal that something started.
- **That dot is blue while the session has no tab** (`status-background`, added
  2026-08-30). It is `working` in a different colour rather than a fourth state:
  where a session runs is orthogonal to what it is doing, and `waiting_input`
  keeps its amber wherever it runs. Opening the session gives it a tab, and the
  dot goes green with everything else.
- **A live session with no tab used to have no dot anywhere.** Every list drew
  from `useOpenSessions`, a projection of the tab strip, so a routine's session
  was invisible in exactly the surfaces that exist to say what is running — the
  failure `00-overview.md` § "The operating model" rules out. The lists read
  `useSessionMarks` now: open sessions *and* live ones, with `background`
  carrying the difference.
- **A routine's session is named for its routine *and the time it started***
  until Claude writes a transcript to take a title from. A daily routine produces
  a row a day with the same name, and in the sidebar several can be live at once.
- **A small icon marks a session a routine started** — in the sidebar row, in the
  project list, and beside the avatar in its tab once it has one — with a tooltip
  naming the routine. Not the `SubAgentBadge` pill: that does not fit a 240px
  tab, and this needs one treatment in all three places.
- **No notification when a routine fires.** A notification every weekday at 09:00
  is training to dismiss the ones that matter. What deserves one is a routine
  session reaching `waiting_input` or exiting, which is roadmap item 35's
  trigger — and that item inherits the requirement that its trigger cannot be
  driven off the tab strip, since these sessions have no tab.
- **The sidebar does not list routines themselves.** It answers *what is
  happening*; the project view answers *what is configured*. Sidebar rows stay
  one kind of thing, which is what keeps the drag, the grouping and the keyboard
  path (ADR-0025) tractable.

### The project view: `Sessions | Routines`

The project route grows a two-tab strip, selected through a **route search
param** (`?tab=routines`) so the context menu — and later the MCP tool — can land
you on it. Same `TabButton` shape as the file panel's strip (Q18), or the
`tabs.tsx` primitive in `@factorai/ui`.

**`New routine` sits in the page header, where `New session` is** — one action
in one place, switching with the tab rather than moving to the list below it
(2026-08-29, user feedback). The empty state carries a second copy, because a
hero that names an action and does not offer it is a sign, not a state.

**The project's context menu gains two items at the top**, above the reorder
block and separated from it: **`New session`** and **`New routine`**. Those exact
labels — the project view's header button already says `New session`, and two
different verbs on two adjacent items reads as a difference that is not there.
`New routine` navigates to the Routines tab and opens the editor.

**The routines list** is one row per routine: name, the schedule in plain
language, the next fire, the enable switch, and the last run — including
`skipped, still running` and `interrupted` when that is what happened. **An
empty project gets the hero**, not a grey sentence: the mark, a title, the
sentence explaining what a routine is, and the button.

### The editor

Inline on the Routines tab, not a modal: it holds a name, a schedule, a
multi-line prompt, a skills list and two switches, and you want to see the other
routines while writing one.

- **Schedule is a preset picker** — hourly, daily at HH:MM, weekly on DAY at
  HH:MM, monthly — with **`Custom…`** revealing the raw cron field. **The cron
  string is what is stored**, whichever wrote it, so the presets, the custom
  field and the MCP tool all speak one representation.
- **The next few fire times, in plain local time, under the control**,
  recomputed as you type. This is the whole defence against a schedule that
  silently never fires; an expression that cannot be parsed says so here.
- **The time field is ours, not `<input type="time">`.** The native control
  renders on the *browser's* locale, which the app's own clock setting cannot
  reach — so the editor showed `09:00 AM` in the field and `Next: today 9:00` in
  the line directly under it, from one value. `TimeField` is hour, minute and an
  AM/PM select when the app is on a 12-hour clock; the value crossing its
  boundary is always 24-hour, so the meridiem is a rendering rather than a second
  piece of state.
- **Catch-up shows the app-wide default as its value**, not as a placeholder with
  "(app default)" beside it — the number in the box is the one that will be used,
  and editing it is what makes it this routine's own.
- **The skills list sits beside the prompt field.** Clicking a skill inserts
  `/name` at the cursor. Sources are the project's `.claude/skills/` and the
  user's `~/.claude/skills/`, name and description read from each `SKILL.md`
  frontmatter — a read-only scan, so ADR-0004 is untouched. The descriptions are
  the point: the question a routine author has is *what can I call from here*,
  not how to save keystrokes. A `/`-triggered autocomplete inside the textarea
  is a later improvement, tracked, and deliberately not the first version.
- **Two switches**: enabled, and catch-up with its window. Catch-up has an
  **app-wide default in settings** (a `SettingRow` in F11's modal, stored in the
  SQLite `settings` table because Rust reads it — ADR-0013) which each routine
  may override, because a nightly digest is worth running four hours late and a
  "check CI now" is not worth running at all once missed.

### The rules that keep it from misbehaving

- **Overlap: skip, and record the skip.** A routine due while its own previous
  run is still live does not start a second one. Same instinct as
  `start_session`'s double-click guard, and the only rule under which an
  overrunning routine cannot pile up.
- **A global concurrency cap, with a queue.** At most N routine sessions start at
  once — ten projects with an hourly routine all fire at `:00` — and the rest
  queue in due order. N is a settings row. **A queued fire is not a skipped
  fire**: it runs late, which is what a cron user expects under load.
- **Catch-up coalesces.** Five missed hourly runs inside the window are **one**
  run, not five.
- **A fire counts as run the moment the session starts.** So a run that
  kill-on-quit (ADR-0005) takes is not eligible for catch-up: re-running an agent
  that already committed and pushed is worse than skipping it, and nothing can
  tell those two apart afterwards. The list still shows it as interrupted.
- **Disabling stops future fires and nothing else.** It never kills a running
  session — that is not what a switch means.
- **Deleting asks first, and also leaves the running session alone.** Its origin
  icon degrades to a tooltip reading *started by a routine that no longer
  exists*. Killing an agent is never a side effect of editing a schedule.

### Run now

Every row has one, and it fires **through the runner's own path** — the overlap
skip and the concurrency cap included. A manual run that ignored those would be a
second set of rules for the same act, and it is the button most likely to be
clicked twice. It is disabled for a project whose folder is gone, the same rule
and the same tooltip the new-session button has.

**It always says what happened** (2026-08-29, user report: it "failed sometimes
without any error displayed"). `run_routine_now` returns an outcome —
`started` with the session id, or `skipped` / `capped` / `failed` with the reason
in the words the row shows: *its previous session is still running*, *N routine
sessions are already running, which is the limit in Settings → Routines*, or
whatever stopped the spawn. The rules that decline a run are the scheduler's, so
the two paths cannot drift; what a manual run owes on top is an answer, because
somebody is watching the button.

### Storage

`routines` and `session_routines` — see `02-data-model.md`. Two things about the
shape matter here: the origin lives in **its own table with no foreign key**,
because a brand-new session has no `sessions` row and the runner writes at spawn
(the trap migration 0007 found), and the schedule lives in SQLite rather than a
renderer store because Rust reads it (ADR-0013).

### Routines over MCP

**Slice 3, built 2026-08-30.** Four tools an agent can call to schedule
follow-up work in the project it is working in — `listRoutines`,
`createRoutine`, `updateRoutine`, `setRoutineEnabled`, reaching the agent as
`mcp__factorai__*`. What an agent may do to a schedule is
[ADR-0028](../docs/adr/0028-an-agent-schedules-work-but-does-not-unschedule-it.md);
where the tools live is
[ADR-0029](../docs/adr/0029-model-facing-tools-need-a-server-that-is-not-the-ide.md).

**They are not on the IDE bridge, and the first version of this slice was.** It
shipped, answered every call correctly over the bridge's socket, and was invisible
to every agent — because the CLI registers whatever it discovers in
`~/.claude/ide/` under the hardcoded key `ide` and then offers the model only two
of that server's tools. F20's tools work because the *CLI* calls them; none of
them was ever model-facing. So factorai runs a second MCP server under its own
name, handed to each session at spawn, and that is what these four live on. Full
reasoning and the evidence are in ADR-0029.

**It reverses two-thirds of what this section used to record.** Slice 3 was
written down as full CRUD with no provenance and no off switch, against the
recommendation at the time, with a note to revisit before it was built. The
revisit kept the third — there is still no off switch, and F11 / item 4 still own
the bridge-wide one — and changed the other two.

- **An agent may schedule work; only a human unschedules it.** There is no
  `deleteRoutine`. Disable is the reversible form of the same act and covers what
  the slice was for: an agent that scheduled something it should not have can
  stop it, and cannot destroy the row that says it did. The editor's delete asks
  first, and a tool call has nobody to ask — the same reasoning `Run now` uses to
  refuse a second set of rules for one act, run backwards.
- **Every write records the session that made it**, in two columns: who created
  the routine, and whose hand was last on it. An agent may amend a routine a
  *human* wrote, which is the case one column cannot record — the row would still
  read as untouched.
- **The list marks a routine an agent touched.** One small icon beside the name,
  the tooltip saying whether it was written or amended and naming the session.
  Not clickable, and not a notification: an agent writing a schedule is rare
  rather than frequent, but the mark is the ambient answer the same way the status
  dot is, and item 7's toast is where a transient version would live if it turns
  out to be wanted.
- **The tools cannot leave the session's project.** None of them takes a
  `projectId` — it is resolved at spawn and bound into the bridge — and an id
  from another project is refused in the words that fit an id that does not
  exist. This is ADR-0017 § 3's path scope, in the database.
- **`updateRoutine` is a patch; the editor stays a full replacement.** An agent
  holds a subset of the fields; a form holds all of them. `catchupHours` is the
  field that decides it, because `null` there means *inherit the app-wide
  default* — so the wire carries three states, and an unsent window is never
  silently reset.
- **A new routine is enabled unless asked otherwise.** A schedule waiting to be
  armed is a draft the agent will nonetheless report as scheduled.
- **Both callers hit the same validation, which got stricter.** A cron has to
  parse *and* project a next run — `0 0 31 2 *` used to save cleanly and never
  fire — the name and prompt are bounded, and a project holds at most **20**
  routines. The concurrency cap bounds what runs; nothing bounded what
  accumulates, and an agent inside a routine's own session can write more.

**Every routine write emits `routines:changed`**, whichever caller made it. The
editor invalidates its own query already; this is what makes a schedule an agent
changed appear in a Routines tab that is open in front of you.

### Being found without being asked for

**A tool an agent cannot see is a tool nobody calls**, and for a day this one was
invisible in the way that matters. Asked *"create a routine that checks for the
day's reminders"*, a session reached for Claude Code's built-in **`schedule`**
skill — cloud agents, whose own description carries the words *routine*, *cron*
and *schedule* — interviewed the human for a turn, and failed with an HTTP 403
because the vault was a private repository Claude's cloud cannot read. It found
`createRoutine` only when the human typed *"on factorai"*.

Nothing had told that session it was **running inside factorai**. Three things do
now, and none of them is decoration:

- **The server introduces itself.** MCP's `initialize` carries an `instructions`
  field, which Claude Code injects into the conversation as `## factorai`. Ours
  says where the session is running — the project's folder, which it can check
  against its own `pwd` — and that scheduling recurring work here means
  `createRoutine` rather than a cloud routine, because a factorai routine needs
  nothing pushed to a remote and no repository access granted to anyone. It also
  states the limit in the same breath: **it runs only while factorai is open.**
  That sentence is a property of the tool, not a hedge — a session that scheduled
  something without knowing it would be promising work factorai cannot do.
- **`createRoutine` is always loaded**, so it exists at the moment somebody says
  "create a routine" rather than being something a model must first think to go
  looking for. Only that one: it is the tool that has to be there unprompted, and
  the other three are reachable once the server is known.
- **The rest carry search hints**, in the words people actually use — routine,
  schedule, cron, recurring, daily — for the path where a model does go looking.

`listRoutines` is also marked read-only, which is simply true of it and of
nothing else here. Nothing is marked destructive, because after ADR-0028 nothing
here destroys anything.

**The acceptance test runs a real `claude`.** `tests/agent_tools_conformance.rs`
hands the binary the same `--mcp-config` a session gets, asks it in English to
schedule something, and looks in the database. It is `#[ignore]` because it costs
a model turn, and it exists because its absence is precisely what let the first
version of this slice ship broken: every other test proves factorai's half, and
factorai's half was never the part that was wrong.

A second one asks in the user's own words **without naming factorai**, and fails
if the model reaches for a cloud routine instead. That is the only assertion that
could have caught the discoverability failure above — everything else in the
suite passed while it was live.

### Later slices

- **The skills picker** is slice 2. Additive, and it blocks nothing.

**Roadmap.** Item 42.
