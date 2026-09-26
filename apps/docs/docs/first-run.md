---
id: first-run
title: First run
---

import Shot from '@site/src/components/Shot';

# First run

factorai opens on an empty sidebar: *No projects yet*, with **Add Project…** and **Import from
Claude Code…**.

<Shot
  src={require('../../../assets/images/guide/first-run-empty@2x.png').default}
  alt="The sidebar on first launch: an empty Projects list reading No projects yet, with Add Project… and Import from Claude Code… buttons"
/>

First, check **Settings → Agents** (`Mod+,`): each agent reads `ACTIVE` with a version, or
`NOT DETECTED`. An undetected agent cannot start sessions; see
[Troubleshooting](troubleshooting#claude-not-found).

## Adding your first projects

<Shot
  src={require('../../../assets/images/guide/first-run-import@2x.png').default}
  alt="The Import from Claude Code dialog listing six folders under /home/ada/code with session counts and last activity; billing-api, docs-site and homelab are ticked, thesis-2024 is marked missing, and the button reads Import 3"
/>

- **Import from Claude Code…** lists the folders Claude Code has worked in, with their session
  counts. Tick the ones you want and import. Past sessions appear once indexing finishes.
- **Add Project…** picks any folder, including one only Codex or no agent has run in.

**Add the folder the agent ran in, not its parent.** Sessions started in `~/code/app/web` belong
to `~/code/app/web`; adding `~/code/app` does not bring them in. This is the usual reason a
project comes up empty. Git worktrees are the exception; see [Worktrees](advanced/worktrees).

More in [Projects](projects).

## What discovery does

factorai reads each CLI's transcripts where they are, read-only, and never copies them: Claude
Code's under `~/.claude/projects/`, Codex's under `~/.codex/sessions/`, or a
[profile's](advanced/profiles) own directory.

Only added folders are indexed and searchable.

## Why sessions appear on their own

factorai watches those stores. Any new transcript shows up in its project's list, whether it came
from factorai, a [routine](routines), or `claude` / `codex` in your own terminal. Nothing to refresh.

A new session is listed as *New session* until its first message, then takes the agent's title.
Remove a project and add it back, and every session returns.
