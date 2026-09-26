---
id: troubleshooting
title: Troubleshooting
---

# Troubleshooting

The things that go wrong for a reason you would not guess. For first-launch warnings — macOS
calling the app damaged, Windows protecting your PC, a Linux too old for the build — see
[Installation](installation#first-launch-and-what-looks-broken).

## `claude` not found

**Settings → Agents** shows `NOT DETECTED` on the card, and a new session prints a red line
beginning *Failed to spawn claude* instead of starting. The same applies to `codex`.

factorai is a desktop app, so it did not inherit the `PATH` your terminal has. It looks for each
CLI on its own `PATH`, then asks your login shell, then tries the usual install locations:
`~/.local/bin`, `~/.claude/local`, mise and asdf shims, npm and pnpm global directories, nvm,
Homebrew and `/usr/local/bin`. An install somewhere else is not found.

The fix is to tell it where the binary is:

1. In a terminal, run `command -v claude` (or `command -v codex`).
2. Open **Settings → Agents**, expand the agent's card, and paste the path into **Override
   path**. Leaving the field checks it: *Nothing runnable at that path* means it is wrong.
3. Press **Save**. The next session you start uses it; running sessions are unaffected.

An override is used exactly as given, with no fallback to detection, so clear the field if you
later move the install.

**A session starts, but a hook, an MCP server or a statusline command inside it cannot find a
tool.** That is the same `PATH` problem one level down. factorai asks your login shell for its
`PATH` once, at startup, and gives it to every session and shell; if you have just changed your
shell's startup files, quit and relaunch factorai.

## Programs fail inside a session, but work in your own terminal (Linux AppImage)

Two symptoms that do not look like an environment problem:

- `python3` exits with `ModuleNotFoundError: No module named 'encodings'`.
- Another GTK or WebKit program — `pnpm dev` on a Tauri app, for one — dies with *Failed to
  spawn child process … WebKitNetworkProcess*.

An AppImage runs with its own libraries and data directories prepended to `LD_LIBRARY_PATH`,
`PATH`, `XDG_DATA_DIRS`, `PYTHONHOME` and a dozen more, all pointing into its private mount
(`/tmp/.mount_…`). factorai removes every such entry from the environment of each session and
footer shell it starts, including entries left by an AppImage that launched factorai itself.
Check from inside a session:

```bash
env | grep -c .mount_
```

It should print `0`. Anything else means a build from before v0.18.1: update. While you cannot,
prefix the failing command with `env -u` for each variable that names a `.mount_` path, and
filter those entries out of `PATH` and `XDG_DATA_DIRS` rather than unsetting them.

## Sessions you expected are missing

- **The project is the parent folder.** Sessions belong to the exact folder the agent ran in; add
  that folder. See [First run](first-run#adding-your-first-projects).
- **The folder is on the Windows drive** (WSL). A project under `/mnt/c` carries a warning on its
  row and its page: new sessions do not appear on their own there and git is slow. Move the
  folder inside the Linux distribution.

## Linux

- **`GLIBC_… not found` at launch** means a distribution older than the build supports; see
  [Installation](installation#first-launch-and-what-looks-broken).
- **`Ctrl+W`, `Ctrl+PageUp` and `Ctrl+PageDown` reach the app, not the terminal.** On Linux `Mod`
  is `Ctrl`, and these chords fire over a focused terminal, so readline's `Ctrl+W` is taken.
  Rebind them under **Settings → Keyboard**; see [Keyboard shortcuts](advanced/keyboard-shortcuts).
- **If the window's renderer crashes**, factorai reloads it and says so on the way back. Your
  sessions keep running; what is lost is the view — the open file and where you were scrolled.

## macOS permission prompts

Builds are signed with factorai's own certificate rather than an Apple Developer ID, and until
that changes macOS asks for two things:

- **App Management**, the first time an update installs: *"factorai was prevented from modifying
  apps on your Mac"*. Installing an update replaces `factorai.app`, and macOS gates that. Allow it
  under **System Settings → Privacy & Security → App Management**; it stays allowed.
- **Folder access**, when something factorai runs first reaches into a protected folder such as
  Documents or Desktop. The answer sticks across updates. If the same prompts come back after every
  release, you are on v0.32.0 or earlier, where each build voided the last one's grants: update.
