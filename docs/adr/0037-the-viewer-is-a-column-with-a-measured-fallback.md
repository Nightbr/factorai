# ADR-0037 — The file viewer is a column with a measured fallback, not a modal

**Status.** Accepted (2026-09-07). Supersedes the V0 host decision inside
[F7](../../specs/05-features.md) — Monaco stays, the modal stops being where it
renders. Narrows [ADR-0007](0007-monaco-for-the-file-viewer.md) not at all: that
ADR chose the editor, this one chooses the room it sits in.

## Context

F7 shipped the viewer as a 90vw × 85vh modal and said so in as many words: "the
cheapest UX that gets the feature useful", with `FileView` written
self-contained and modal-agnostic so a second host could replace the shell
without touching the view. Roadmap item 48 was the user asking for that second
host, because reading a file covers the terminal the file was opened from — in
an app whose whole claim is that you supervise an agent while it works, the one
surface you cannot cover is the agent.

Six hosts were prototyped end to end before any of them was built:

1. a split under the tree, inside the existing right-hand panel;
2. a column of its own between the session and the panel;
3. a tab beside the session in the centre column;
4. a split under the session, in the centre column;
5. file tabs joining `SessionTabs` in the top bar;
6. a detached second window.

Three of them were rejected on the same ground, and it is worth writing down
because it is the whole point of the exercise: 3 and 5 put the file where the
agent was, which is the modal's problem wearing a different shell, and 4 puts a
third thing — agent, viewer, shell dock (F23) — into one column where two of
them already want the bottom.

## Decision

**The viewer is a column between the session and the file panel, and the host is
chosen by measurement rather than by a preference.**

- **Column, when the shell can hold four columns.** Sidebar, session, viewer,
  panel. The viewer keeps its own persisted width.
- **Split under the tree, when it cannot.** Tree above, viewer below, inside the
  panel, with the panel taking a second remembered width because a column that
  now holds two things wants more than 288px.
- The rule is one pure function over measured widths:

  ```
  column ⟺ shellWidth ≥ sidebarWidth + MIN_SESSION_WIDTH + MIN_VIEWER_WIDTH + panelWidth + gutters
  ```

  with a **40px dead band** so dragging a window edge across the threshold does
  not strobe the layout. Both side panels are user-resizable, so the flip point
  is a function of what the user has dragged rather than a constant somebody
  will have to keep in sync with two other constants.

- **`MIN_SESSION_WIDTH = 400`.** The floor is the session's, not the viewer's,
  because the session is the thing this app exists to show. 400px is ~56
  columns, under the 80 the CLI writes for; it is a deliberate trade that buys
  the column at the default 1400px window, and it only binds when the panels are
  dragged to their extremes.

- **A per-checkout tab strip, persisted.** `?file=` stays the *active* file and
  keeps every property F7 gave it — deep-linkable, survives reload and HMR,
  browser-back closes the viewer, and F19's terminal links and F20's IDE bridge
  keep arriving through it. The list of open files is layout state beside it,
  keyed by checkout the way `expandedByCheckout` is (F21) and for the same
  reason: the paths are absolute, and a project with two worktrees is two trees.

- **The modal is demoted, not deleted.** It becomes an explicit *expand*
  affordance in the viewer header, for the case a column is too narrow to read
  in. It is no longer where a file lands.

**Not decided here:** the detached window (exploration 6). It is the app's first
second window and it earns its own ADR — window lifetime, kill-on-quit
(ADR-0005), and the fact that Zustand over `localStorage` does not live-sync
between windows are three separate problems, none of which this one has.

## Consequences

- `FileViewerModal` stops being the host and becomes one of three. The thing F7
  promised — `FileView` is host-agnostic — is now load-bearing rather than
  aspirational, and every view inside it (markdown, image, SVG, pdf.js) has to
  survive a 400px column, which the modal never asked of them.
- `MAX_PANEL_WIDTH`'s fixed 600 stops being the right shape. The ceiling is now
  relative to the shell with the session's floor subtracted, so a panel cannot
  be dragged into the session's space. `clampPanelWidth` stays pure and
  unit-tested; it gains an argument rather than a global.
- **Escape no longer closes the viewer.** In the modal it did, and there it was
  right. In a column it would close a surface the user is reading beside the
  agent, so Escape returns focus to the session and the tab is closed by its own
  `×`, by `Cmd/Ctrl+W`, or by the header's close.
- A restored tab can name a file that no longer exists. The viewer already has
  the honest answer for that — `errorText` says the tree may be out of date —
  and the tab is closed by hand. Refusing to restore at all was the alternative,
  and it loses the case the restore exists for.
- Two layouts mean two sets of drag maths and two persisted widths, which is
  more state than one modal had. The dead band is the only reason this is
  liveable, and it is the part to keep if the rest is ever simplified.
