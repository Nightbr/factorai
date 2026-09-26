---
id: troubleshooting
title: Troubleshooting
---

import Shot from '@site/src/components/Shot';


# Troubleshooting

For first-launch warnings, see
[Installation](installation#first-launch-and-what-looks-broken).

## `claude` not found

<Shot
  src={require('../../../assets/images/guide/troubleshooting-override@2x.png').default}
  alt="Settings → Agents with Claude Code NOT DETECTED: the card is open, Detected binary says Not found, and an Override path of /home/ada/.npm/bin/claude shows Nothing runnable at that path"
/>

**Settings → Agents** shows `NOT DETECTED`, and a new session prints a red line beginning
*Could not start the session:* (for example `NotFound: claude CLI not found`).
Same for `codex`.

factorai checks its own `PATH`, your login shell, then `~/.local/bin`, `~/.claude/local`, mise and asdf shims, npm and pnpm global directories, nvm,
Homebrew and `/usr/local/bin`.

To fix:

1. Run `command -v claude` (or `command -v codex`) in a terminal.
2. In **Settings → Agents**, expand the card and paste the path into **Override path**. Leaving the
   field checks it: *Nothing runnable at that path* means it is wrong.
3. Press **Save**. New sessions use it.

**A hook, MCP server or statusline command can't find a tool.** factorai reads your login shell's
`PATH` once at startup. After changing shell startup files, quit and relaunch factorai.

## Programs fail inside a session, but work in your own terminal (Linux AppImage)

- `python3` exits with `ModuleNotFoundError: No module named 'encodings'`.
- Another GTK or WebKit program (e.g. `pnpm dev` on a Tauri app) dies with *Failed to spawn child
  process … WebKitNetworkProcess*.

Check inside a session:

```bash
env | grep -c .mount_
```

Anything but `0` means a build before v0.18.1: update.

## Sessions you expected are missing

- **You added the parent folder.** Add the folder the agent ran in; see
  [First run](first-run#adding-your-first-projects).
- **The folder is under `/mnt/c`** (WSL). Move it inside the Linux
  distribution.

## Linux

- **`GLIBC_… not found`**: your distribution is too old; see
  [Installation](installation#first-launch-and-what-looks-broken).
- **`Ctrl+W`, `Ctrl+PageUp` and `Ctrl+PageDown` go to the app, not the terminal.** Rebind them in
  **Settings → Keyboard**; see [Keyboard shortcuts](advanced/keyboard-shortcuts).
- **The renderer crashed**: factorai reloads it and says so. Sessions keep running.

## macOS permission prompts

- **App Management**, on the first update: *"factorai was prevented from modifying apps on your
  Mac"*. Allow it in **System Settings → Privacy & Security → App Management**; it stays allowed.
- **Folder access**, when something factorai runs first touches a protected folder such as
  Documents or Desktop. Prompts after every release mean v0.32.0 or earlier: update.
