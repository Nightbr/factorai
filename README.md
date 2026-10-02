<div align="center">

<a href="https://factorai.build"><img src="assets/brand/factorai-lockup.png" alt="factorai" width="200"></a>

### IDE is dead. Long live the ADE

Agentic Development Environment for the AI era

[![site: factorai.build](https://img.shields.io/badge/site-factorai.build-FFB020?style=flat-square&labelColor=272B31)](https://factorai.build)
[![status: alpha](https://img.shields.io/badge/status-alpha-FFB020?style=flat-square&labelColor=272B31)](https://github.com/Nightbr/factorai/releases)
[![platform: macOS, Linux and Windows through WSL 2](https://img.shields.io/badge/platform-macOS%20%C2%B7%20Linux%20%C2%B7%20WSL%202-3A4048?style=flat-square&labelColor=272B31)](#install)
[![CI](https://img.shields.io/github/actions/workflow/status/Nightbr/factorai/quality.yml?branch=main&style=flat-square&labelColor=272B31&color=FFB020&label=CI)](https://github.com/Nightbr/factorai/actions/workflows/quality.yml)
[![licence: MIT](https://img.shields.io/badge/licence-MIT-3A4048?style=flat-square&labelColor=272B31)](LICENSE)

[Download](https://factorai.build/#download) · [Guide](https://factorai.build/docs/first-run) · [Roadmap](https://github.com/users/Nightbr/projects/1) · [Contributing](CONTRIBUTING.md)

</div>

> [!NOTE]
> **Early, and used daily by several senior engineers.** Two update channels,
> switched in **Settings → Advanced**: **Stable** (default) gets a release once
> alpha users have run it; **Alpha** gets every passing change on `main`, often
> several a day. Leaving alpha never downgrades. Point factorai at work your
> version control can recover.

You stopped writing most of the code. Your editor never noticed.

factorai is built the other way round: **the unit of work is a session, not a
file.** You supervise, decide, review, and set the rules. Agents do the rest.
Free, open source, community-driven: no company, no paid tier.

### Run several agents at once

Each session is the real `claude` or `codex` CLI in a real terminal, and keeps
running when you look away. A dot says whether it is *working*, *waiting for
you* or *stopped*.

![Three sessions open as tabs, one agent mid-task in its terminal, and the sidebar's dots saying which is working, waiting or stopped](assets/images/factorai-sessions.png)

### Agents on a schedule

A routine is a saved prompt on a cron, per project. It runs in the background
without taking a tab, and catches up on runs missed while factorai was closed.

![A project's Routines tab: a nightly triage, a weekly dependency bump and a disabled monthly job, each with its schedule and next run](assets/images/factorai-routines.png)

### Arranged the way you think

Drag projects into groups you name, or sort by name or recent. Keyboard too.

![Projects dragged into the Pro and Side projects groups in the sidebar](assets/images/guide/projects-organise@2x.gif)

### Every message, every session

Full-text search across every transcript, read in place from `~/.claude` and
`~/.codex`. Nothing imported, nothing copied.

![A search for "retry" finding matches in four sessions across three projects, each with the line it matched](assets/images/factorai-search.png)

### Audit whenever you choose

Changes, diffs and the commit graph sit beside the terminal, and keep up with
an agent mid-edit.

![The Changes panel grouping a merge conflict, staged and unstaged files, a diff of one of them open, and the agent that made them beside it](assets/images/factorai-changes.png)

![The Graph tab: a merged branch, tags and the current branch, with one commit open on its changed files](assets/images/factorai-graph.png)

### Local and private

No telemetry, no account, no server. factorai drives the CLIs you already
logged into and never touches your credentials. Closing the window kills every
agent it started.

## Install

Download from [factorai.build](https://factorai.build/#download) or
[Releases](https://github.com/Nightbr/factorai/releases): `.dmg` for macOS,
`.AppImage` for Linux (glibc 2.39+), `factorai-setup.exe` for Windows, which
installs the Linux build into WSL 2. It updates itself and asks before
restarting. You need [Claude Code](https://claude.com/claude-code) or
[Codex](https://developers.openai.com/codex/cli), already logged in.

Something look broken? See [installation](https://factorai.build/docs/installation)
and [troubleshooting](https://factorai.build/docs/troubleshooting). Building from
source is in [CONTRIBUTING.md](CONTRIBUTING.md).
