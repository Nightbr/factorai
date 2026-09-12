# ADR-0044 — Windows is WSL 2, not a second port

**Date.** 2026-09-12
**Status.** Accepted. Amends `specs/07-open-questions.md` Q1, which dropped
Windows entirely, and the "no Windows in v1" line in every document that carried
it.

## Context

Users asked for a Windows build. The question is not whether to have one — it is
which of four architectures a Windows build means, because factorai's backend is
unusually entangled with the machine the agent runs on:

- The indexer reads `~/.claude/projects/**/*.jsonl` directly and the watcher
  holds an inotify watch over it (`services/indexer.rs`, `services/watcher.rs`).
- Two servers bind `127.0.0.1:0` and **the agent connects back to them** — the
  IDE bridge (F20, ADR-0017) and the agent tool server (ADR-0029). Which one a
  session uses is advertised by a lockfile the CLI enumerates at
  `~/.claude/ide/<port>.lock`, with `0600` permissions.
- Sessions are `claude` in a PTY, and kill-on-quit is non-optional (ADR-0005).
- `git2` reads the repository on every status, blob and graph page (ADR-0009).

Four candidates:

1. **Native `windows-msvc` build, reaching into WSL** over `\\wsl.localhost` and
   spawning through `wsl.exe`.
2. **Native build, no WSL** — everything on Windows, `claude` native.
3. **Split backend** — a thin Tauri shell on Windows, a headless factorai server
   inside the distribution, the VS Code Remote-WSL model.
4. **The Linux build, running inside the distribution under WSLg.**

## Decision

**Option 4.** On Windows, factorai is the Linux build, running inside a WSL 2
distribution under WSLg. There is no `windows-msvc` target, no second bundle, no
platform port. The Windows deliverable is a bootstrapper that provisions nothing
and installs the AppImage into the user's own distribution.

**Anything that must differ inside WSL is decided at runtime, not by `#[cfg]`.**
One binary, one target triple, two environments: `cfg!(windows)` is never true
there and `#[cfg(target_os = "linux")]` cannot tell a distribution apart from a
laptop running Debian. `services/wsl.rs` is the only place that asks, and it
answers exactly two questions — are we inside WSL, and is this path on the
Windows drive.

### Why not option 1

It is the one that looks cheapest and has three holes we could not close:

- **The watcher dies.** `/mnt/c` and `\\wsl.localhost` are the same 9p share, and
  inotify does not deliver events over it (microsoft/WSL#216; the kernel's own
  `inotify: disallow watches on unsupported filesystems` series names 9p). The
  sidebar would silently stop updating. Polling instead means stat-ing thousands
  of transcripts over 9p every few seconds.
- **The bridges cannot be reached.** A Windows-side `127.0.0.1` listener is not
  reachable from inside the distribution under the default NAT networking at all,
  and under `networkingMode=mirrored` it is reachable only when it works —
  microsoft/WSL#40343 has the SYN-ACK returning from a different ephemeral port
  and Linux answering RST. Both of factorai's servers depend on the agent dialling
  back.
- **git is slow**, for the same 9p reason, on the operation the Changes tab and
  the graph run constantly.

### Why not option 2

`claude` does now run natively on Windows — the PowerShell tool landed in 2.1.139
and Git for Windows is optional — so this is buildable. It is still the wrong
product: the repositories, the toolchain, the shell rc files and the login these
users work with live inside the distribution. An ADE that cannot see them is an
ADE for a machine nobody is developing on.

### Why not option 3

It is the architecturally correct answer and it is what Anthropic shipped for
Claude Code Desktop. Read what that product still cannot do inside a WSL session:
*"the integrated terminal, connectors and plugins, session forking, the file
browser pane, and file suggestions when you type `@`"*. The integrated terminal is
ADR-0002 and the file browser is F12 — between them they are most of factorai.
Option 3 means rebuilding precisely the parts a much larger team has not shipped,
in exchange for a native title bar.

### What option 4 costs

- **WSLg renders through a virtual GPU on a software GL path**, and WebKitGTK's
  accelerated compositing misbehaves there. The installed `.desktop` entry sets
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` and `WEBKIT_DISABLE_COMPOSITING_MODE=1` for
  that launcher only — never globally, so Linux users keep acceleration.
- **Reveal in file manager does not work**, and is a documented limitation rather
  than a fix. There is no `FileManager1` on that bus, and `xdg-open` on a
  directory cannot bring up Explorer with an item selected. External links are
  fine — the crate behind Tauri's link opening has its own WSL path
  (`powershell.exe … Start-Process`) — but nothing there helps reveal.
- **A project kept on the Windows drive gets a watcher that never fires.** Not
  fixable from inside the app — see `windowsFilesystem` below.
- Windows chrome is WSLg's, not Windows'. This is a developer tool; the people
  asking for it already run Linux GUI apps this way.

## Consequences

1. **The build matrix does not change.** `x86_64` Linux, and that AppImage is
   what Windows users run. No `aarch64` build, so **ARM64 Windows is out of
   scope** — a distribution on an ARM device is `aarch64` and there is nothing to
   install into it.
2. **The floor is Windows 10 21H2 (build 19044) or Windows 11**, x86_64, with WSL
   2 and WSLg. That is WSLg's floor rather than WSL 2's: WSL 2 itself goes back
   further, but Windows 10 needs the Microsoft Store WSL package (`wsl --update`)
   to have WSLg at all.
3. **Windows is tier 2 for support and tier 1 for the release gate.** Bug reports
   are answered; the promise is not "equal to macOS". But `factorai-setup.exe` is
   in the publish job's required-asset list and its job is a `needs:` edge on
   `publish`, so a release that failed to build it stays a draft. The installer is
   built with `makensis` on the Linux runner, so this adds no Windows runner and
   no new class of flake.
4. **The installer is unsigned.** There is no free Authenticode CA — since June
   2023 CAs must hold code-signing keys on FIPS hardware, so the old "buy a `.pfx`,
   put it in a secret" route no longer exists. Self-signing buys nothing a user
   sees on Windows, unlike macOS where ADR-0034's self-signed certificate buys a
   stable designated requirement. SmartScreen's warning is documented in the
   README beside the macOS right-click-Open section. SignPath Foundation, which is
   free for open-source projects, is applied for; when it lands it is a step in
   the same job and no other change.
5. **`latest.json` gains no Windows key.** `tauri-plugin-updater` resolves its
   platform key from the compile-time target triple, so the running app looks up
   `linux-x86_64` and could never read a Windows entry. The bootstrapper is a
   one-shot artifact; the app self-updates as the AppImage it is. A Windows key
   becomes correct if and when a native build ships, which is the condition that
   would reopen this ADR.
6. **`Project.windowsFilesystem` exists** (`services/wsl.rs`,
   `specs/02-data-model.md`, F1). It is true for a project under `/mnt/<letter>`
   seen from inside WSL, and it drives a badge on the sidebar row and a line on
   the project page. It warns and allows rather than refusing: the folder works
   for everything except live updates, and the human decides. It is computed per
   query rather than stored — a prefix test with nothing to go stale, so a column
   would cost a migration and buy nothing.
7. **PR #3 is declined** rather than merged. It ported the backend to
   `windows-msvc`: `#[cfg(windows)]` arms in `child_env`, `shell_path`,
   `ide/lockfile` and `git::canonical`, a UNC-aware `encode_path`, a
   `windows-latest` leg on the quality workflow. Every one of them serves a target
   this ADR says we do not build, so all of it would be dead on the day it landed.
   It also branched off an older `main` and its `#[cfg(unix)]` `encode_path`
   replaces only `/`, silently reverting the fix that encodes `.` as well — without
   which the transcript probe misses any session run under a `.claude/worktrees`
   checkout and `--resume` degrades to `--session-id`, losing the conversation
   (F21). Its lasting value is the map: those five modules are where platform
   sensitivity lives, and under WSLg every one of them is Linux and needs nothing.

## What would reopen this

A native `windows-msvc` build becoming worth shipping — which needs, at minimum,
mirrored networking to be dependable enough for the agent to dial back into the
two loopback servers, and an answer for the watcher that is not polling 9p.
