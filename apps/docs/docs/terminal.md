---
id: terminal
title: Terminal
---

import Shot from '@site/src/components/Shot';

# Terminal

Every session is a real terminal running `claude` or `codex` itself.

## The session terminal

<Shot
  src={require('../../../assets/images/guide/terminal-file-link@2x.gif').default}
  alt="A Claude Code session prints src/invoices/retry.ts:20; Ctrl+click on the underlined path opens retry.ts in the viewer beside the terminal at line 20"
/>

- The header holds the only controls: the pin, `×` (**Close session**), and **Restart** once the
  process has exited.
- Printed paths and URLs are links: `Ctrl`+click (`Cmd`+click on macOS) opens a path in the
  [viewer](files/index.md) and a URL in your browser. A plain click goes to the agent.
- **Copy:** select text, then `Ctrl+Shift+C` (`Cmd+C` on macOS) or right-click. `Ctrl+C` stays
  the interrupt.
- **Paste:** right-click with nothing selected.

## The footer shell

<Shot
  src={require('../../../assets/images/guide/terminal-footer-shells@2x.png').default}
  alt="Two footer shells split side by side under the session, pnpm test on the left and pnpm dev on the right, with the zsh chip showing 2 panes, + Terminal and Split in the strip"
/>

The strip at the bottom of every project view opens your own shell next to the agent.

- **+ Terminal** opens one in the project's directory, or in the session's
  [worktree](advanced/worktrees). **Split** opens another beside it.
- Each shell is a chip; click the active chip to fold the shells away (they keep running).
- Shells belong to the project: closing a session does not kill them. They run under the project's
  [profile](advanced/profiles).

## Keyboard

A focused terminal keeps its own keys, except these app chords: `Mod+K`, `Mod+N`, `Mod+W`,
`Mod+PageDown`, `Mod+PageUp`, `Mod+,` and `Mod+Shift+E`. On Linux that takes readline's `Ctrl+W`;
rebind the row to get it back. `Mod+F` stays the terminal's. See
[keyboard shortcuts](advanced/keyboard-shortcuts).

## Zoom

`−` and `+` beside the zoom level in the sidebar footer scale the whole app in 10% steps, 50–200%.
Click the level to reset to 100. With the sidebar collapsed, use its **Updates and zoom** menu. The
level persists.
