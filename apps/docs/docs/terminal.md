---
id: terminal
title: Terminal
---

# Terminal

Every session is a real PTY with xterm.js in front of it, running the actual CLI — `claude` or
`codex`. What you see is what the CLI prints, and what you type goes straight to it: factorai
does not reimplement the agent and never sits between you and it.

## The session terminal

The header holds the only controls: `×` to kill the process, **Restart** in its place once the
process has exited, and the pin. There is no toolbar. The terminal fills the pane with no
scrollbar, like Terminal.app or iTerm2; wheel, trackpad and keyboard scroll as usual.

File paths the agent prints are links that open in the viewer. Copy works with the usual
shortcut and the right-click menu; paste is live in the terminal's own context menu.

## The footer shell

A strip along the bottom of every project view opens your own shell in the project's directory,
beside the agent rather than instead of it: a `git log`, a `cargo test` loop, a dev server. It
belongs to the project, not to a session, so closing a session does not kill it. The footer
splits, so several shells can share it.

## Keyboard

A focused terminal keeps everything it binds: typing to the agent is never interrupted by an app
shortcut. The exceptions are the few chords that exist to reach the rest of the app from a
terminal, such as `Mod+K` for search, `Mod+N` for a new session, `Mod+,` for settings and
`Mod+Shift+E` for the file panel. See [keyboard shortcuts](advanced/keyboard-shortcuts).

## Zoom

The `−` and `+` beside the level in the sidebar footer scale the whole app between 50 and 200
percent, the terminal included; clicking the level resets it to 100. The level persists across
launches.
