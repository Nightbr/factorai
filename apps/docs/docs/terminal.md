---
id: terminal
title: Terminal
---

# Terminal

Every session is a real PTY with xterm.js in front of it, running the actual CLI — `claude` or
`codex`. What you see is what the CLI prints, and what you type goes straight to it: factorai
does not reimplement the agent and never sits between you and it.

## The session terminal

The header holds the only controls: the pin, `×` (**Close session**) to kill the process and
close the session, and **Restart** in its place once the process has exited on its own. There
is no toolbar. The terminal fills the pane with no scrollbar, like Terminal.app or iTerm2;
wheel, trackpad and keyboard scroll as usual.

File paths and web addresses the agent prints are links: `Ctrl`+click (`Cmd`+click on macOS)
opens a path in the [viewer](files/index.md) and an address in your browser. A plain click goes
to the agent as usual. Paste is in the terminal's own right-click menu.

## The footer shell

A strip along the bottom of every project view opens your own shell beside the agent rather than
instead of it: a `git log`, a `cargo test` loop, a dev server. **+ Terminal** opens one in the
project's directory — or in the checkout the session is working in, when that is a
[worktree](advanced/worktrees) — and **Split** opens another beside the active one. Each shell is
a chip in the strip; clicking the chip you are on folds the shells away and leaves them running.
They belong to the project, not to a session, so closing a session does not kill them, and they
run under the project's [profile](advanced/profiles), so a `claude` you start there is the same
account as the project's sessions.

## Keyboard

A focused terminal keeps everything it binds, except the app chords that exist to reach the rest
of the app from a terminal: `Mod+K` for search, `Mod+N` for a new session, `Mod+W` to close the
tab, `Mod+PageDown` and `Mod+PageUp` to step tabs, `Mod+,` for settings and `Mod+Shift+E` for the
file panel. Those are taken before the terminal sees them — on Linux that includes readline's
`Ctrl+W`, which you can have back by rebinding the row. `Mod+F` stays the terminal's. See
[keyboard shortcuts](advanced/keyboard-shortcuts).

## Zoom

The `−` and `+` beside the level in the sidebar footer scale the whole app in 10% steps between
50 and 200 percent, the terminal included; clicking the level resets it to 100. With the sidebar
collapsed to a rail, the same controls are in its **Updates and zoom** menu. The level persists
across launches.
