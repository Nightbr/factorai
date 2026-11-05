# ADR-0074 — The tab digits are one row that is never split

**Date.** 2026-11-05
**Status.** Accepted. Extends ADR-0046's keymap; makes one exception to its
stealing rule. Issue #72.

## Context

`Mod+1`…`Mod+9` to jump to a session tab was asked for, configurable from
Settings > Keyboard like every other binding. ADR-0046's keymap is one action,
one chord, and a chord recorded onto a row steals it from whichever row held it.
Nine digits do not fit that shape well:

1. **Nine rows** would let a user bind tab 4 to something unrelated to tab 3,
   which nobody wants, and would bury the section under nine near-identical
   rows.
2. **Stealing one digit** leaves the sequence with a hole in it: `Mod+3` does
   something else while `Mod+2` and `Mod+4` still switch tabs. That reads as a
   bug, not as a choice.
3. **The library matches by character.** `@tanstack/hotkeys` falls back to
   `KeyboardEvent.code` only when the character is not a letter. AZERTY's digit
   row types `&`, `é`, `"`, `'`, `(`, `-`, `è`, `_`, `ç` unshifted, so `Ctrl+2`
   (`é`) would never match `Mod+2`. The recorder has the same blind spot: it
   records `Mod+é`.

## Decision

- **One action, `switchToTab`, whose binding is a modifier on the digits.** It
  is stored as its `1` chord — `Mod+1` stands for `Mod+1`…`Mod+9` — so the map's
  type, the overrides-only persistence, reset and unbind are unchanged. A spec
  flag, `digits`, marks the row; `chordsOf` expands it to nine wherever chords
  are compared.
- **`Mod+9` is the last tab**, the browser convention. Session tabs only,
  whatever has focus, and over the terminal.
- **The row is never split.** In the settings draft, a collision involving the
  digits row in either direction is refused with a message on the row being
  recorded, rather than stolen. Every other collision still steals, as ADR-0046
  decided. In the merge, a digits row that finds any of its chords already held
  — by an override that predates it — comes up unbound as a whole, which is
  ADR-0046's "the user's override outranks a later default", applied to nine
  chords at once.
- **Digits match by physical key.** The digits row does not go through the
  library's matcher: `useShortcuts` listens for it on `document` and matches
  `KeyboardEvent.code` (`Digit1`–`9`, `Numpad1`–`9`) with the modifiers exact.
  xterm's pass-through asks the same function. The settings section records a
  digit key as its digit, from `code`, for every row.
- **Recording needs a modifier other than Shift**, because a bare or shifted
  digit is typing, and this row takes its chords from the terminal.

## Consequences

- A second matching path beside the library's, for one row. It is small and
  pure (`tabDigitOf`), and it is the only one of the two that works on AZERTY.
- The digits row ignores `target` and `ignoreInputs`: it is global and
  over-terminal by definition. A future digits row that needed either would have
  to add them.
- xterm's pass-through now looks at Alt chords too, not only Ctrl and Meta, so a
  row rebound to an Alt chord reaches the app from the terminal. That costs one
  map lookup per Alt keystroke and changes nothing for unbound Alt chords.
- Refusing is new in a section that otherwise never refuses; the footer text
  says so.
