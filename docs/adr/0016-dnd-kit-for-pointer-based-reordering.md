# ADR-0016 — dnd-kit for reordering, because the OS drag session is not ours

- **Status:** accepted
- **Date:** 2026-08-18
- **Supersedes:** nothing. Amends the "no library" reasoning written into
  `specs/05-features.md` § F16.

## Context

The session tab strip (F16) reordered with **native HTML5 drag-and-drop** — 40
lines of `dragstart` / `dragover` / `drop`, a cloned drag image, and a unit-tested
`dropIndex` for the midpoint rule. F16 argued the trade explicitly: ~40 lines
against a ~30KB dependency for one horizontal strip.

**It does not work on macOS.** Reported 2026-08-18: you can pick a tab up — it
dims, so `dragstart` fires — and nothing else happens. The cause is not our code
and not WKWebView:

- `tauri-runtime-wry-2.11.2/src/lib.rs:4894` — Tauri installs a drag-drop handler
  on the webview whenever the window's `dragDropEnabled` is on (the default), and
  that handler **returns `true` unconditionally**: it forwards the event to the
  app as `tauri://drag-*` and reports it handled.
- `wry-0.55.1/src/wkwebview/drag_drop.rs:52,80` — on macOS wry's `WryWebView`
  overrides `draggingEntered` / `draggingUpdated` / `performDragOperation` and
  only calls `super` — i.e. lets WKWebView do its own thing — **when the handler
  returns `false`**.

So on macOS every drag session over the window is swallowed before WebKit sees
it, and the page never receives `dragover` or `drop`. Linux is the opposite by
accident of implementation: `wry-0.55.1/src/webkitgtk/drag_drop.rs:94` returns
`false` from `drag_motion` and only claims a drag that actually carries file
paths, so HTML5 drag-and-drop keeps working there. The feature was built and
QA'd on Linux (`scripts/qa` is X11-only), which is why it shipped looking fine.

Three ways out were considered.

1. **`"dragDropEnabled": false`** on the window. One line, and it genuinely
   works — with no handler installed wry passes every callback through to
   WKWebView (`wry/src/wkwebview/mod.rs:304`). But it spends a **window-level**
   capability on one strip: the app permanently loses Tauri's native file-drop
   events, so "drop a folder here to add a project" stops being available, and
   the flag is a landmine — whoever adds file-drop later re-breaks tab
   reordering, on macOS only, silently. Nothing in CI or Playwright can catch
   either half: it is webview behaviour no test in this repo can reach.
2. **Hand-rolled pointer drag.** `pointerdown` / `pointermove` / `pointerup`,
   reusing `dropIndex`; no dependency, and `PanelResizer` already drags this way.
   Rejected on the user's call, with the reasoning that a second reordering
   surface is already on the roadmap (pinned projects) and that a drag-only
   reorder needs a keyboard path and announcements we would also be writing by
   hand.
3. **A library.** With the caveat that *which* library is the whole question: a
   pointer-based one fixes this, and an HTML5-backend one (`react-dnd`'s
   `HTML5Backend`) fails in exactly the same way, since it rides the same OS drag
   session.

## Decision

Reorder with **dnd-kit**, pinned exact as the repo pins everything:

| Package              | Version | Why it is in the list                          |
| -------------------- | ------- | ---------------------------------------------- |
| `@dnd-kit/core`      | 6.3.1   | `DndContext`, `PointerSensor`, `closestCenter`  |
| `@dnd-kit/sortable`  | 10.0.0  | `SortableContext`, `horizontalListSortingStrategy` |
| `@dnd-kit/modifiers` | 9.0.0   | `restrictToHorizontalAxis` — a strip has one axis |
| `@dnd-kit/utilities` | 3.2.2   | `CSS.Transform.toString` for the item transform |

The classic 6.x/10.x line, not `@dnd-kit/react` (0.x): the rewrite is
pre-1.0 and this is the version everything in the ecosystem is written against.
React 19 is inside every peer range (`react: >=16.8.0`).

Three choices inside the library are ours and are load-bearing:

- **`activationConstraint: { distance: 4 }`.** dnd-kit stops propagating the
  `click` that follows an activated drag, which is right for a drag and fatal for
  a tab: without the threshold, clicking a tab would no longer switch session.
- **`PointerSensor` only — no `KeyboardSensor`.** That sensor takes the space bar
  to lift an item, and space on a `role="tab"` means *activate this tab*. The
  keyboard path is `Alt`+`←`/`→`, which nudges the focused tab one place and needs
  no lift-move-drop mode to discover. `aria-keyshortcuts` carries it.
- **dnd-kit's `attributes` are not spread onto the tab.** They would set
  `role="button"` over our `role="tab"` and point `aria-describedby` at
  "press the space bar to pick up" instructions that are not true here.

`dragDropEnabled` stays at its default, so native file-drop remains available for
whoever wants it.

## Consequences

- **The macOS bug is gone by construction**, not worked around: no OS drag
  session is involved, so nothing in Tauri or wry is in the path.
- **~40KB of JS**, and a dependency that is now load-bearing for a *core* UI
  gesture. The mitigation is that it is one dependency for what is now two
  surfaces: roadmap item 28's pinned-project reordering reuses this rather than
  adding a second mechanism.
- **`dropIndex` and its unit tests are deleted.** The midpoint rule they encoded
  is `closestCenter` plus `horizontalListSortingStrategy` now. That is a real
  loss of cheap, exact coverage, paid for by the library's own test suite and by
  the e2e tests, which had to be rewritten from `dragTo` (HTML5 events) to a real
  pointer drag — and are the only tests that could have caught this class of bug
  in the first place, had they run against a WKWebView.
- **Two behaviours changed on purpose**, both documented in F16: the dragged tab
  is the element itself rather than a cloned drag image, and the list commits on
  drop rather than on every `dragover` — during the gesture the neighbours slide
  under a transform instead of the array being rewritten.
- **Auto-scroll comes free.** The strip overflows, and dragging to its edge now
  scrolls it; the old implementation could not do that at all.
- **The trap is now written down** in `AGENTS.md` § 4: no new HTML5
  drag-and-drop in this app, because it cannot work in this shell.
