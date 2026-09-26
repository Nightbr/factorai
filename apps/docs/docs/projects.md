---
id: projects
title: Projects
---

import Shot from '@site/src/components/Shot';

# Projects

A project is a folder you added; its sessions are the agent conversations that ran there.

## Adding a project

The folder button beside **Projects** in the sidebar header, **Add a project or group**, opens a
menu.

- **Add Project…**: pick any folder, even one no agent has run in.
- **Import from Claude Code…**: lists folders Claude Code has worked in, with session count and
  last activity. Tick (or **Select all**) and press **Import**. Already-added folders are marked *in
  workspace*. Add Codex-only folders with **Add Project…**.

**Remove Project**, at the bottom of a project's right-click menu, takes it off the sidebar and
deletes nothing; adding it back restores its sessions. It asks first if a session is running.

## Organising the sidebar

<Shot
  src={require('../../../assets/images/guide/projects-organise@2x.gif').default}
  alt="Dragging homelab above dotfiles to reorder it, holding recipes over homelab until the row reads New group, naming the new group Side projects, then dropping dotfiles onto that group"
/>

- **Drag** a row to reorder it, onto a group to file it, onto a group's edge to place it beside,
  or hold it over another project until it reads *New group*.
- **Keyboard**: `Alt`+`↑` / `Alt`+`↓` move a row.
- **Right-click menu**: **Move up**, **Move down**, **Move to group** (with **New group…**) and,
  inside a group, **Remove from group**.

**Groups** are named rows that hold projects and collapse to a count. Create one with **New
Group…** in the header menu, or by holding one project over another. A group's right-click menu has
**Rename…** and **Remove Group** (its projects return to the top level).

**Sort and expand projects**, in the sidebar header: **Manual**, **Name**, **Recent**, **Expand
all**, **Collapse all**. Under Name and Recent, groups dissolve and dragging and the move items are
off.

The sidebar resizes between 180 and 480px and collapses to a rail.

## What a row shows

<Shot
  src={require('../../../assets/images/guide/projects-row-menu@2x.png').default}
  alt="The right-click menu of the homelab project inside the Side projects group: New session, New session with, New routine, Move up, Move down, Move to group, Remove from group, Reveal in file manager and Remove Project"
/>

- An avatar coloured from the path, with a status dot when a session is live.
- A `+` on hover to start a session, with a chevron to pick the agent when both are installed.
- *missing*, dimmed, when the folder is gone: sessions stay readable, new ones cannot start.

An expanded project lists up to ten sessions (pinned, open, then recent) and an *N more…* link.
Sub-agents appear only on the project page.

The right-click menu also has **New session**, **New routine** and **Reveal in file manager**.
