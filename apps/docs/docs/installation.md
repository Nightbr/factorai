---
id: installation
title: Installation and updates
sidebar_label: Installation
---

# Installation and updates

factorai is a desktop app for macOS and Linux, and for Windows through WSL 2. It needs at least
one agent CLI, already logged in: [Claude Code](https://claude.com/claude-code) (`claude login`)
or [Codex](https://developers.openai.com/codex/cli) (`codex login`). factorai drives the CLI you
have and never handles your credentials. See [Agents](agents) for what it does with each.

## Download

Every build is on the [releases page](https://github.com/Nightbr/factorai/releases/latest), or one
click away from the site's [Download](/#download) button, which picks your platform.

| Platform | What you get |
| --- | --- |
| macOS | A universal `.dmg`, Apple Silicon and Intel in one file. Drag `factorai.app` to Applications. |
| Linux | An `.AppImage` for x86-64. Make it executable and run it. Needs glibc 2.39 or newer: Ubuntu 24.04+, Debian 13+, Fedora 40+. |
| Windows | `factorai-setup.exe`, which installs the Linux build into your default WSL 2 distribution and adds it to the Start menu. Needs Windows 10 21H2 or Windows 11, x86-64, with WSL 2 already installed. |

There is no `.deb` on purpose: the updater can replace an AppImage in place and never a `.deb`,
and a package that silently stops updating is worse than none.

## First launch, and what looks broken

- **macOS says the app is damaged.** Builds are signed but not notarized yet, so Gatekeeper
  refuses the first launch. Right-click `factorai.app`, choose **Open**, then **Open** again, or
  clear the quarantine flag:

  ```bash
  xattr -dr com.apple.quarantine /Applications/factorai.app
  ```

- **macOS asks for App Management** the first time an update installs. Allow it under
  **System Settings → Privacy & Security → App Management**; it stays allowed.
- **Windows warns that it protected your PC** when the installer runs, because the installer is
  unsigned. **More info → Run anyway**. The binary it installs is signed like every other release,
  and the app verifies its own updates.
- **Linux says `GLIBC_2.38 not found`.** The distribution is older than Ubuntu 24.04; build from
  source there.

## Updates

factorai checks for a new release on launch and every six hours, downloads it in the background
and verifies its signature. Nothing restarts on its own, because a restart kills running
sessions: when a version is staged, **Update ready** appears in the sidebar footer and in
**Settings → About**, and you choose when to restart.

**Check for updates** in the same two places runs a check now instead of waiting for the poll.

## On Windows, keep projects inside the distribution

factorai runs as a Linux app under WSLg, so your repositories, toolchain and CLI logins live in
the distribution. Keep projects under `~` there. A folder on `/mnt/c` works, but it goes over a
network filesystem: git is slow and file watching does not work, so the session list will not
update on its own, and factorai marks such a project with a warning.
