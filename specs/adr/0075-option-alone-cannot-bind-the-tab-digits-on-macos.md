# ADR-0075 — Option alone cannot bind the tab digits on macOS

**Date.** 2026-11-05
**Status.** Accepted. Narrows ADR-0074's recording rule for the tab digits row,
and records the xterm pass-through change that shipped with it.

## Context

ADR-0074 shipped with one more change: xterm's key handler now also looks at
keystrokes with **Alt**, not only Ctrl or Meta. Before that, a row rebound to an
Alt chord never fired while the terminal had focus. xterm consumed the key and
stopped it, so the binding silently did nothing there. Now an over-terminal row
on an Alt chord fires from the terminal, and the PTY no longer receives that
chord. Ctrl rows already worked this way (`Mod+W` takes readline's `Ctrl+W`).

No default binding uses Alt, so an unchanged keymap behaves exactly as before.
The risk lies in what a user may now record. The tab digits row accepts any
modifier with a digit, and on macOS that modifier can be Option. Option+digit
**types characters** on many Mac layouts: on French, `⌥5` is `{`, `⌥(` is `[`,
`⌥)` is `]`, `⌥-` is `}`, and `⌥⇧L` is `|`. Binding the row to Option would take
those characters out of the terminal and out of Claude's prompt, nine keys at
once, and would look like a broken keyboard rather than a setting.

## Decision

- **Keep the Alt pass-through.** It makes Alt rows consistent with Ctrl rows,
  and reverting it brings back the old silent no-op.
- **On macOS, the tab digits row refuses Option alone**, with or without Shift.
  The row says why: Option with a digit types characters on many layouts, so add
  `⌘` or `⌃`. Option combined with Command or Control types nothing and stays
  allowed.
- **Linux keeps Alt alone.** There, characters come from AltGr (Level3), not from
  Alt, so `Alt+digit` types nothing. The cost there is readline's `Alt+digit`
  argument prefix, which a user who records `Alt` has chosen to give up.

## Consequences

- One more refusal reason on a row that already refuses. `digitsBinding` returns
  the reason (`noDigit`, `typing`, `optionTypes`) rather than `null`, so the row
  can say which one applies.
- Single-chord rows can still be rebound to Option chords on macOS. One chord
  taken from the terminal is a visible, local choice. Nine character keys at
  once is not, which is why only the digits row gets this rule.
- AltGr on Linux is assumed to report `altKey` false in WebKitGTK. If that turns
  out wrong, layouts that type with AltGr+digit would need the same refusal.
