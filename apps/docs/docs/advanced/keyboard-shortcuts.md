---
id: keyboard-shortcuts
title: Keyboard shortcuts
---

# Keyboard shortcuts

These are the defaults. Every row is rebindable under **Settings → Keyboard**: click the chord
and press the new one (`Escape` cancels, `Backspace` clears). Assigning a chord another row holds
takes it, and that row is left unbound. `×` unbinds a row, the reset arrow puts one back, and
**Reset all** restores the lot; nothing is written until you press **Save**. A cleared binding
stays cleared across updates, and a default that changes later moves with the app unless you have
overridden it.

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

On macOS, Quit is the app menu's `Cmd+Q` and is not listed in Settings, because the menu takes
the key before the app sees it.

## When the terminal has focus

Every row except `Mod+F` fires even while the terminal has focus: they are how you reach the rest
of the app from a terminal you are typing in, and the terminal never sees them. On Linux that
means `Mod+W` takes readline's `Ctrl+W` (delete the previous word); rebind the row if you want
the key back. `Mod+F` in a terminal, or in any text field, stays the field's.

## Quitting

Quitting with an agent mid-run asks first, then kills every child process. There are never
orphaned `claude` or `codex` processes: an unattended agent is real money.
