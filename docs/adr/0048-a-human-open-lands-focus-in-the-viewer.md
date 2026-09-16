# ADR-0048 — opening a file puts focus in the viewer's pane

**Date.** 2026-09-16
**Status.** Accepted. Completes
[ADR-0047](0047-escape-closes-the-file-tab-that-has-focus.md), which made
`Escape` a key of the pane's without giving anything a way to *reach* the pane.
The contract is `specs/05-features.md` F7 § Tabs.

## Context

ADR-0047 scoped `Escape` — and, before it, `Mod+W` and the tab steps (F28) — to
"focus is in this pane". That is the right scope, and on the day it shipped it
left a gap the same user found: the gesture that opens a file is a click
somewhere *else*. A click on a tree row leaves focus on the tree row; a Changes
row, a commit's file list and a `Ctrl`-click on a path in the terminal all leave
focus where the click was. So the file arrives, the reader looks at it, presses
`Escape` — and nothing happens, because the keystroke went to the tree, or to
the terminal, where `Escape` means something else entirely.

Every key the pane owns had the same gap. `Mod+W` over a tree row closes the
*session* tab (F28's document-level registration), and the find forward never
fires at all. ADR-0047 already fixed the mirror image of this — focus after a
close — by focusing the pane when the view under it unmounts; nothing did the
same for the open.

The rule cannot simply be "the pane takes focus whenever `?file=` changes". Two
of the paths through `useFileViewer.open` are not gestures anybody made:

- the **checkout re-seed** (F21, `AppShell`), which re-opens a checkout's last
  file when a session in a linked worktree comes to the front, and
- the agent's own **`openFile`** over the IDE bridge (F20), which arrives over a
  socket while the human may be typing to the agent that sent it.

Taking the caret for either is the ambush ADR-0037 argued against, and worse
than the one it was arguing about: it moves focus off something the human is
using, not just on top of it.

## Decision

**A file opened by a human lands with keyboard focus on the viewer's pane.**

- **`open` asks; the pane answers.** `useFileViewer.open` is the one place every
  route into the viewer passes through (ADR-0037), so the request is made there,
  beside the `openTab` it already writes. It cannot focus anything itself: the
  first open is what *mounts* the pane, so at that moment there is no element to
  focus.
- **The request is a path, held in `viewerStore` and collected on the render
  that shows it.** Keyed by path rather than a flag, so a request nothing
  answered cannot be collected later by an unrelated mount — a host switch
  across the width threshold (ADR-0037) remounts the pane with a file already
  showing, and that must not move focus. `viewerFocusVerdict` is the whole rule
  and is pure: `wait`, `drop`, `take`.
- **Focus already inside the pane keeps it.** Clicking a tab chip opens through
  the same call, and a reader stepping through chips with `Escape` would
  otherwise lose the strip after the first one. The expanded modal keeps it for
  the same reason — Radix owns focus while it is open.
- **A machine open passes `focus: false`.** The two are the checkout re-seed and
  the IDE bridge. The option defaults to true because every other caller is a
  gesture, and a new route into the viewer is a human one until it says
  otherwise.
- **The pane, not the editor.** Focus lands on the pane's own element — the same
  place ADR-0047 gives it back to after a close — and not on Monaco. A file is
  editable in place (F26), and a caret dropped into a buffer nobody asked to
  edit turns a stray keystroke into an unsaved draft.

## Consequences

- `Escape`, `Mod+W`, `Mod+PageUp`/`PageDown` and the find forward all work on a
  file the moment it opens, from wherever it was opened.
- Opening a file moves focus out of the file tree, which is the cost: walking a
  directory by `Tab` and `Enter` now needs `Shift+Tab` back to the row it was
  on. Accepted because a single click in the tree opens a *preview* tab, and the
  gesture that does it is a mouse gesture — the reader who typed `Enter` on a
  row asked for the file just as much as the one who clicked it.
- The terminal keeps the caret when the agent pushes a file, so F20's open is
  still something the human walks over to rather than something that takes the
  window. `useFileLinks` already hands focus *back* to the terminal when a file
  it opened is closed, so a `Ctrl`-click, a read and an `Escape` now round-trip
  without touching the mouse.
- One more piece of the viewer's state lives in `viewerStore` rather than in the
  URL. It is deliberately not persisted: a focus request restored on launch
  would open the app with focus on a file nobody just asked for.
