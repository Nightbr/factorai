---
id: installation
title: Installation and updates
sidebar_label: Installation
---

# Installation and updates

For macOS, Linux, and Windows via WSL 2. Needs a logged-in agent CLI:
[Claude Code](https://claude.com/claude-code) (`claude login`) or
[Codex](https://developers.openai.com/codex/cli) (`codex login`). See [Agents](agents).

## Download

[Releases page](https://github.com/Nightbr/factorai/releases/latest), or the site's
[Download](/#download) button.

| Platform | What you get |
| --- | --- |
| macOS | Universal `.dmg` (Apple Silicon and Intel). Drag `factorai.app` to Applications. |
| Linux | x86-64 `.AppImage`. Make it executable and run it. Needs glibc 2.39+: Ubuntu 24.04+, Debian 13+, Fedora 40+. |
| Windows | `factorai-setup-<version>.exe` (stable releases). Installs the Linux build into your default WSL 2 distribution and adds it to the Start menu. Needs Windows 10 21H2 or Windows 11, x86-64, WSL 2 installed. |

## First launch, and what looks broken

- **macOS says the app is damaged.** Builds are not notarized yet. Right-click `factorai.app`,
  choose **Open**, then **Open** again, or run:

  ```bash
  xattr -dr com.apple.quarantine /Applications/factorai.app
  ```

- **macOS asks for App Management** on the first update; see
  [macOS permission prompts](troubleshooting#macos-permission-prompts).
- **Windows says it protected your PC.** The installer is unsigned: **More info → Run anyway**.
- **Linux says `GLIBC_2.38 not found`.** Your distribution is older than Ubuntu 24.04; build from
  source.

## Updates

- Checked on launch and every six hours, downloaded in the background.
- Never restarts on its own: **Update ready** appears in the sidebar footer and **Update ready —
  restart** in **Settings → About**. Restarting mid-run asks first.
- **Check for updates** (same places) checks now.
- **Settings → Advanced → Update channel**: **Stable** (default) or **Alpha** (every passing commit on
  `main`). Leaving Alpha never downgrades.

## On Windows, keep projects inside the distribution

Keep projects under `~` in the WSL distribution. On `/mnt/c`, git is slow and the session list does
not update on its own; factorai flags such projects.
