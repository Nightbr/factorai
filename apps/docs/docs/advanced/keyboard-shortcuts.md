---
id: keyboard-shortcuts
title: Keyboard shortcuts
---

import Shot from '@site/src/components/Shot';


# Keyboard shortcuts

`Mod` is Command on macOS and Control on Linux and in a WSL window.

| Shortcut | Action |
| --- | --- |
| `Mod + N` | New session in the active project |
| `Mod + K` | Focus the sidebar search, from anywhere |
| `Mod + F` | Find in the focused viewer; focus the sidebar search anywhere else |
| `Mod + Shift + E` | Toggle the file panel |
| `Mod + W` | Close the focused tab: the session, or the file while the viewer has focus |
| `Mod + PageDown` | Next tab |
| `Mod + PageUp` | Previous tab |
| `Mod + ,` | Open settings |
| `Mod + Q` | Quit factorai |

On macOS, Quit is the app menu's `Cmd+Q` and is not listed in Settings.

## Rebinding

<Shot
  src={require('../../../../assets/images/guide/keyboard-rebind@2x.gif').default}
  alt="Settings → Keyboard: clicking Close the focused tab shows Press keys…, pressing Ctrl+Shift+W sets it with a reset arrow beside it, and Save lights up"
/>

In **Settings → Keyboard**, click a chord and press the new one (`Escape` cancels, `Backspace`
clears).

- Taking a chord another row holds leaves that row unbound.
- `×` unbinds, the reset arrow restores one row, **Reset all** restores every row.
- Nothing is written until you press **Save**.
- Your changes survive updates; defaults you have not overridden follow the app.

## When the terminal has focus

Every shortcut except `Mod+F` still fires; the terminal never sees it. On Linux, `Mod+W` takes
readline's `Ctrl+W`; rebind the row to get it back. `Mod+F` in a terminal or text field stays the
field's.

## Quitting

Quitting while an agent is working always asks first; there is no switch for it. Quitting then
kills every child process.
