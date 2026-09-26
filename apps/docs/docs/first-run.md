---
id: first-run
title: First run
---

# First run

factorai opens on an empty sidebar: *No projects yet*, with **Add Project…** and **Import from
Claude Code…** under it. Nothing is added for you. The sidebar is the folders you chose, not
everything an agent has ever touched.

Before the first session, check **Settings → Agents** (`Mod+,`): each agent's card reads `ACTIVE`
with a version, or `NOT DETECTED`. An agent that is not detected cannot start sessions; see
[Troubleshooting](troubleshooting#claude-not-found).

## Adding your first projects

- **Import from Claude Code…** is the quick start if you already use Claude Code: it lists the
  folders it has worked in, with how many sessions each holds. Tick the ones you want and import
  them; their past sessions are there as soon as indexing finishes, which the sidebar footer
  counts off.
- **Add Project…** takes any folder from a picker — one only Codex has run in, or one no agent
  has run in yet.

**Add the folder the agent ran in, not its parent.** A session belongs to the exact directory it
was started from: conversations started in `~/code/app/web` are sessions of `~/code/app/web`, and
adding `~/code/app` does not bring them in. If a project you expected to have history comes up
empty, this is almost always why. The one exception is a git worktree, which stays part of the
project it was made from; see [Worktrees](advanced/worktrees).

[Projects](projects) covers the rest: groups, ordering, removing.

## What discovery does

factorai never imports or copies a conversation. Each CLI already keeps its transcripts —
Claude Code under `~/.claude/projects/`, Codex under `~/.codex/sessions/`, or under a
[profile's](advanced/profiles) own directory — and factorai reads them where they are, treating
those stores as read-only.

Discovery is the cheap first pass over those stores: it works out which folder each set of
transcripts belongs to. That is what the import list is made of. Only folders you have added go
further: their transcripts are parsed, titled, and put in the search index. A folder you never
added costs nothing beyond being discovered, and is not searchable until you add it.

## Why sessions appear on their own

factorai watches those stores. Whenever an agent writes a transcript, the session it belongs to
is indexed again and shows up in its project's list — whether you started it in factorai, a
[routine](routines) did, or you ran `claude` or `codex` in a terminal of your own in that folder.
You never refresh anything, and a session started elsewhere is resumable here like any other.

A session you start in factorai is listed as *New session* until its first message is written,
then takes its title from the agent. Remove a project and add it back, and every session returns,
because the transcripts never moved.
