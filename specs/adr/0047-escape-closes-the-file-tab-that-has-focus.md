# ADR-0047 — `Escape` closes the viewer's file while the pane has focus

**Date.** 2026-09-16
**Status.** Accepted. Reverses one consequence of
[ADR-0037](0037-the-viewer-is-a-column-with-a-measured-fallback.md) — "Escape no
longer closes the viewer" — on a user report. The contract is
`specs/05-features.md` F7 § Tabs and F28 § `Mod+W`.

## Context

ADR-0037 moved the viewer out of a modal and into a column beside the session,
and took `Escape` away with it: over a surface you are reading next to the agent,
a key that makes it vanish is an ambush. What shipped in its place was three
closes, none of them a keystroke over the thing being closed — the `×`, a
middle-click, and `Mod+W`.

A user asked for `Escape` back on 2026-09-16. It was built narrowly first,
firing only while a tab chip held keyboard focus, and the same user found it in
the dev window within the hour: *it does not work with focus on the code, nor on
the markdown viewer*. That is the whole finding. A reader reading a file has
focus on the **file**, not on a 100px chip above it, so a binding scoped to the
chip is one nobody can reach — which is the same failure the `Mod+W`-over-the-
terminal correction recorded a day earlier (ADR-0046, F28).

Two things make the ambush argument weaker than it read in ADR-0037. The pane
now has a strip: closing one file uncovers the next rather than emptying the
column, so the keystroke usually *switches* rather than vanishing anything. And
`Escape` is the one key every surface in the window already owns a meaning for,
so scoping it by focus is something the app does elsewhere rather than a new
rule.

## Decision

**`Escape` closes the file the viewer is showing, from anywhere inside the
pane** — the editor, the rendered markdown, a diff, an image, a PDF, the tab
strip, the expand control. It is handled on the pane's own `onKeyDown`, so the
scope is exactly "focus is in this pane".

- **Find takes the first press.** Gated on the same `findHandle.isRevealed()`
  the expand modal already gates on, so a search closes before the file does and
  the sequence is `Escape`, `Escape`. Monaco stops the keystroke itself whenever
  it handles one — a widget it closed, a selection it cleared, a suggestion it
  dismissed — so most of that never reaches the pane; the gate is what covers
  the markdown preview's own `FindBar`, which does not stop it.
- **Outside the pane nothing changes.** The terminal keeps `Escape`, which is
  not negotiable — it is how you leave a mode in every TUI, Claude's prompt
  included — and so does every dialog, menu and the session strip.
- **The session strip does not get it.** Two strips that disagree are two strips
  to learn, so this is a real cost, and the alternative is worse: a session close
  can raise F10's `needsCloseConfirm` dialog, which `Escape` then dismisses — one
  key that asks a question and cancels it, depending on how fast it repeats.
- **A tab chip closes its own tab**, which matters only for a chip that is not
  the file being shown: `FileTabs` handles the key and stops it there, and moves
  focus to the tab taking the closed one's place so a run of `Escape` closes a
  run of tabs instead of dropping focus on `<body>` after the first.
- **Not a keymap action** (F28, ADR-0046). The keymap is for app-level chords
  that fire from wherever you are standing; `Escape` is the opposite of that, and
  a settings row offering to rebind it would be offering something every other
  surface's dismissal would have to honour too.

**The pane takes `tabIndex={-1}`.** A rendered markdown document, an image and a
PDF have nothing focusable in them, so clicking one left focus on `<body>` and
the pane saw no keys at all — which is why the narrow version failed over the
preview as well as over the editor. With the pane focusable by click, every key
it already owned (`Mod+W`, the tab steps, the find forward) starts working there
too; that is a fix, not a side effect.

## Consequences

- `Escape` over a file with an unsaved draft is F26's question exactly as the
  `×` is: same `closeTab` call, same guard, no second answer to keep in step.
- Closing the last tab closes the viewer, because that is what closing the last
  tab does however it is closed. ADR-0037's "not an ambush" survives as the
  thing it was really protecting: it takes one keystroke per open file, each
  with focus in the pane, and none of it while you are typing to the agent.
- Monaco's own `Escape` meanings come first for free, since it stops what it
  handles. A selection cleared or a suggest widget dismissed is a press the pane
  never sees.
- The expand modal is unchanged: it is not this pane, Radix owns its dismissal,
  and its find gate already reads the same handle.
