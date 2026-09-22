---
id: projects
title: Projects
---

# Projects

A project is a folder you added. Its sessions are the agent conversations that ran in that
folder, read from where each CLI keeps them: `~/.claude/projects/` for Claude Code,
`~/.codex/sessions/` for Codex. Nothing is imported, copied or migrated: factorai reads the CLIs'
own files and treats them as read-only.

## Adding a project

The `+` menu in the sidebar header has two entries.

- **Add Project…** opens a directory picker. Any folder works, including one no agent has ever
  run in; it starts with no sessions and gets them as you work there.
- **Import from Claude Code…** lists every folder Claude Code has already worked in, one checkbox
  per folder, with the sessions it holds. Tick the ones you want and they are added in turn, each
  indexing its transcripts with progress.

A folder an agent has worked in but you never added does not appear anywhere, and nothing
announces it. Removing a project sticks: the next scan has nothing to put back.

## Organising the sidebar

Projects sit where you put them. Drag a row to reorder it, drop it on a group to file it, drop it
on the edge of a group to leave it beside, or hold it over another project to make a new group
of the two. From the keyboard, `Alt`+arrows move a row and **Move to group** is in the row's
context menu.

**Groups** are rows you name — Pro, Perso, Side projects — that hold projects and collapse to a
count. Ungrouped projects stay at the top level between them, so the sidebar is one list where
some rows expand. An empty group stays until you delete it and shows a *Drop a project here* row
that is also its drop target.

When you would rather have a rule than an arrangement, the sort control in the sidebar header
offers **Manual**, **Name** and **Recent**; groups dissolve under the last two, and dragging is
live only under Manual. The sidebar is resizable between 180 and 480px, and collapses to a rail.

## What a row shows

Each project row carries an avatar coloured from its path, its name, a status dot on the avatar
when any of its sessions is live, and a `+` on hover to start a new session. An expanded project
lists its ten most relevant sessions inline, pinned first, then running, then most recent, with
an *N more…* link to the project page beyond that.
