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

The folder button beside **Projects** in the sidebar header, **Add a project or group**, opens a
menu. The first two entries add projects; an empty sidebar offers the same two as buttons.

- **Add Project…** opens a directory picker. Any folder works, including one no agent has ever
  run in; it starts with no sessions and gets them as you work there.
- **Import from Claude Code…** lists every folder Claude Code has already worked in, with the
  number of sessions it holds and when it was last active. Filter by path, tick the ones you want
  (or **Select all**) and press **Import**; each one is added and its transcripts indexed, with
  progress in the sidebar footer. A folder already in the sidebar is dimmed and marked *in
  workspace*. The list reads Claude Code's store only: a folder you have run only Codex in is
  added with **Add Project…**, and its Codex sessions come with it.

A session belongs to the exact folder it ran in: a conversation started in `~/code/app/web` is a
session of `~/code/app/web`, not of `~/code/app`. See [First run](first-run) for what that means
when you add your first folders.

A folder an agent has worked in but you never added does not appear in the sidebar, and nothing
announces it. **Remove Project**, at the bottom of a project's right-click menu, takes it out of
the sidebar and deletes nothing on disk: the transcripts stay where the agent wrote them, and
adding the folder back restores its sessions. It asks first only when a session in it is running,
because removing stops it. Removing sticks: the next scan has nothing to put back.

## Organising the sidebar

Projects sit where you put them. Drag a row to reorder it, drop it on a group to file it, drop it
on the edge of a group to leave it beside, or hold it over another project until it reads *New
group* to make a group of the two. From the keyboard, `Alt`+`↑` and `Alt`+`↓` move a row; the
row's right-click menu has **Move up**, **Move down**, **Move to group** (with **New group…** at
its foot) and, inside a group, **Remove from group**.

**Groups** are rows you name — Pro, Perso, Side projects — that hold projects and collapse to a
count. Make one with **New Group…** in the header menu, or by holding one project over another.
Ungrouped projects stay at the top level between them, so the sidebar is one list where some rows
expand. An empty group stays until you remove it and shows a *Drop a project here* row that is
also its drop target. A group's right-click menu has **Rename…** and **Remove Group**, which puts
its projects back at the top level and deletes nothing.

When you would rather have a rule than an arrangement, the **Sort and expand projects** control in
the sidebar header offers **Manual**, **Name** and **Recent**, plus **Expand all** and **Collapse
all**. Groups dissolve under Name and Recent, and dragging and the move items are there only under
Manual. The sidebar is resizable between 180 and 480px, and collapses to a rail.

## What a row shows

Each project row carries an avatar coloured from its path, its name, a status dot on the avatar
when any of its sessions is live, and a `+` on hover to start a new session — with a chevron
beside it to pick the agent, once both are installed. A folder that is no longer on disk dims its
row and says *missing*; its sessions stay readable, and no new one can start there.

An expanded project lists up to ten sessions inline — pinned first, then open ones, then the most
recent — with an *N more…* link to the project page beyond that. Pinned sessions are never the
ones cut, and a divider marks where they end. Sub-agent runs are not listed here; the project
page nests them under the session that started them.

Right-clicking a project also offers **New session**, **New routine** and **Reveal in file
manager**.
