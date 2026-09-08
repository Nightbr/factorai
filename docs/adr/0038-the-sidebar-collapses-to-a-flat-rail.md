# ADR-0038 — The sidebar collapses to a flat rail that navigates

**Status:** Accepted — 2026-09-08

## Context

The sidebar is always on screen and always 180–480px wide (F1). The window's
other optional column, the file panel, already goes away with one click (F12).
Doing the same on the left runs into one difference that decides the whole
shape: **the sidebar is the app's navigation.** A file tree you dismissed is a
file tree you can re-open when you next want one; a navigation column you
dismissed is an app with no way to change what you are looking at.

So it collapses to a 48px rail rather than to nothing. That much was settled
when the item was written ([`specs/roadmap/TODO.md`](../../specs/roadmap/TODO.md)
item 53). What was not settled is what a rail *does*, and the three answers
below are where this landed after working through it — each of them a departure
from what that item first wrote down.

Layout state, so it lives in `sidebarStore` beside `width` ([ADR-0013](0013-preferences-storage-split.md)),
and the widths it reports feed the rules in [ADR-0037](0037-the-viewer-is-a-column-with-a-measured-fallback.md).

## Decision

### The rail routes. It does not expand.

Clicking a glyph navigates to that project and leaves the sidebar at 48px. The
item first said the click should expand *and* route, which makes the rail a
launcher that destroys itself on first use: you collapsed it to get the pixels
back, and a click that hands them away undoes the thing you asked for. A rail
that cannot be used without ceasing to be a rail is not navigation, and
navigation is the whole reason it is left behind.

The search icon follows the same rule: it routes to `/search` rather than
expanding a field. A 48px input is not a degraded input, it is a broken one —
and the expanded field only debounces into that same navigation anyway.

**The consequence is that the toggle is the only control that expands the
sidebar.** That is coherent, and it is also load-bearing in a way worth stating
in F1: until roadmap item 5 picks the bindings for both this and the file-tree
toggle, the control is mouse-only.

### Groups are flattened away. One glyph per project.

A group is one row holding projects ([ADR-0025](0025-groups-are-rows-in-the-sidebar-tree.md)).
Drawn as one folder glyph it would have nothing to route to, and — since a
click no longer expands — every project inside it would be unreachable from the
rail.

This does not contradict ADR-0025. `viewRows` already dissolves groups under
two of the three sort modes, on the same reasoning: a group is part of the
**arrangement**, and `name`/`recent` are ways to *find* a row rather than ways
to view the arrangement. A 48px column has no arrangement to show either. The
rail is therefore `flattenProjects(viewRows(rows, sort))` — one expression, all
three modes, no ordering logic of its own.

Reordering is off while collapsed, gesture ([ADR-0016](0016-dnd-kit-for-pointer-based-reordering.md))
and keyboard path together. Dragging 48px glyphs to rearrange a workspace is a
gesture with no target, and half a gesture is worse than none.

### What a 48px column cannot show, a hover card shows.

The standing objection to a rail is that a project's sessions disappear, and a
rail that nests them is a tree at 48px. A card is neither. It lists the same
sessions the expanded row lists, **by the same rules and from the same
component** — the three-key order, the `Math.max(limit, pinnedCount)` cap, the
pinned divider, the `N more…` link, each row's pin/copy/delete menu — and it
carries the row's own `+`, so starting work is still one click from the rail.

The item ruled a hover flyout out of scope, on the grounds that a *peek that
re-collapses itself* is a different feature. It is: that objection is about
navigation, and this is about content the rail admits it cannot draw. The card
opens on focus as well as hover and its content is focusable, so what it holds
is reachable from the keyboard.

**There is no pin on a project glyph**, because a project has no pin. The row's
hover pin was removed when hand-ordering replaced pinning (F1). The pin that
remains is a session's, in the session row's own menu, and it works in the card
exactly as it works in the list.

## Consequences

- `collapsed` is a boolean beside `width`, not a width of zero: a width is how
  much sidebar you want and this is whether you want one at all, so expanding
  restores what you dragged. Same split `panelStore` keeps between `open` and
  `width`.
- **Every consumer of the sidebar's width must ask `effectiveSidebarWidth`.**
  There were three — `resolveViewerHost` and `maxViewerWidth` in `AppShell`, and
  `maxPanelWidth` in `FileTreePanel` — and a collapsed sidebar reporting its
  stored width makes the shell believe it has less room than it has. A fourth
  consumer added later has the same obligation.
- The resizer is not rendered while collapsed. A handle that resizes nothing is
  a handle that lies, and the clamp keeps its 180px floor, so there is no
  drag-to-collapse.
- The toggle is instant, with no width transition. Every frame of a CSS width
  animation is a resize event, and a PTY resize per frame is a `SIGWINCH` storm
  at the agent. A transition needs a debounced refit before it can ship.
- Collapsing rescues focus to the toggle when focus was inside the sidebar.
  Nothing else in the shell removes the rows focus is on.
- The project context menu is now one component with an `arrange` slot the
  caller fills, so the row and the glyph cannot drift.
- `/search` needed a field of its own; it had none, and rendered results for a
  `q` the sidebar's box put in the URL.

## Alternatives considered

- **A second toggle in `TopBar`, beside the file-tree button.** Cheaper and
  symmetric, and it reads as window chrome rather than as this column's own
  state. Rejected: the rail exists precisely so the control has somewhere of its
  own to stand. The asymmetry with the file-tree toggle is real and is stated in
  F1.
- **Expand-and-route, as item 53 first wrote it.** See above.
- **A folder glyph per group, expanding on click.** Two different click
  behaviours in one column, and grouped projects reachable only by expanding.
- **A tooltip with the project name instead of the card.** Answers "which
  project is this", which the avatar already answers, and not "what is running
  in it", which is what the rail gave up.
- **Keeping the footer's two widgets inline.** `UpdateBadge` would survive — it
  drops its label in a narrow `@container` — but `ZoomControls` is three
  controls and cannot. One overflow menu is honest about the width; two
  half-rendered widgets are not.
