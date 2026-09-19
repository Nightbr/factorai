---
id: keyboard-shortcuts
title: Keyboard shortcuts
---

# Keyboard shortcuts

These are the defaults. Every row is rebindable under **Settings → Keyboard**, where a binding
can also be cleared; a cleared binding stays cleared across updates, and a default that changes
later moves with the app unless you have overridden it.

`Mod` is Command on macOS and Control on Linux and in a WSL window.

| Shortcut | Action |
| --- | --- |
| `Mod + K` | Focus sidebar search, from anywhere |
| `Mod + F` | Find in the focused viewer or terminal; focus sidebar search anywhere else |
| `Mod + N` | New session in the active project |
| `Mod + W` | Close the focused tab, session or file |
| `Mod + PageDown` | Next tab |
| `Mod + PageUp` | Previous tab |
| `Mod + Shift + E` | Toggle the file panel |
| `Mod + ,` | Open settings |
| `Mod + Q` | Quit |

## When the terminal has focus

A focused terminal keeps every key it binds, so nothing here can interrupt typing to Claude.
The four that fire anyway are `Mod+K`, `Mod+N`, `Mod+,` and `Mod+Shift+E`: they are how you reach
the rest of the app from a terminal you are typing in. `Mod+F` in a terminal stays the
terminal's.

## Quitting

Quitting with an agent mid-run asks first, then kills every child process. There are never
orphaned `claude` processes: an unattended agent is real money.
