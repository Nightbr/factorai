---
id: sessions
title: Sessions
---

# Sessions

A session is one agent process — `claude` or `codex` — and its transcript. It is the unit of
work in factorai: you launch, watch, resume and kill sessions, and read code to check on what
they did. Which agent a project starts is decided by its profile; see [Agents](agents).

## Starting and resuming

Opening a session points a real terminal at it: a session with a transcript resumes, a new one
starts. There is no separate resume button.

- **New session**: the `+` on a project row, the **New session** button on the project page, or
  `Mod+N` in the active project. The session is linkable and shows a status before the agent
  prints a byte. The chevron beside `+` starts the other installed agent instead.
- **Resume**: click any session in the sidebar, the project page or a search hit.
- **Stop and restart**: the `×` in the session header kills the process; **Restart** appears in
  its place when the process has exited.

Terminals survive navigation. Leave a session to read a file and come back: it is still running.

## Status

The dot beside a session, on its tab and on its project's avatar says what it is doing, read
from the agent's own terminal title rather than guessed at.

| Dot | Meaning |
| --- | --- |
| Green | Working. |
| Amber | Waiting for you: a permission prompt, a question, a turn handed back. |
| Blue | Working with no tab open: a routine running in the background. |
| Grey | Stopped. |
| Hollow grey | Live, but the agent has not said what it is doing yet: a Codex session in its first second. |

Changes that happen while you are elsewhere are visible the moment you look back, in the
sidebar, on the tabs and on the project rows.

## Tabs

Every open session is a tab in the top bar. A tab is *open*, not *running*: it stays when the
process exits, its dot turns grey, and only closing removes it. Tabs are reorderable by drag and
come back when you relaunch. `Mod+W` closes the focused tab, `Mod+PageDown` and `Mod+PageUp`
step along the strip.

Closing a tab whose session is still working asks first, because closing kills the process.

## Pinning

Right-click a session and choose **Pin session**, or use the pin in the session header. A pinned
session leads its project's list, in the sidebar and on the project page, where recency can no
longer push it below the fold. Pinned rows still order among themselves by recency, and a
pinned session takes its sub-agents with it.

## Search

`Mod+K` focuses the sidebar search from anywhere. It searches every message in every session of
every added project, full text, and lists hits grouped by session with the matching excerpt. A
hit opens the session.

Only added projects are indexed: a conversation in a folder you never added is not searchable
until you add the folder.
