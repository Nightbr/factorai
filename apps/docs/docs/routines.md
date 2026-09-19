---
id: routines
title: Routines
---

# Routines

A routine is a saved prompt with a schedule behind it, kept per project: a nightly triage, a
dependency sweep, a lint gate on the hour. When it comes due, factorai starts a session in that
project with the prompt as its first message.

## Creating one

Open a project and switch to its **Routines** tab, beside **Sessions**. A routine has a name, a
schedule, a prompt, an enable switch and a catch-up window. Schedules come as presets or as a
cron expression, and the editor echoes the next few runs so you can see what the expression
means before you save it.

## What a fire does

- It starts an ordinary session: indexed, resumable, searchable, in the sidebar like any other.
- It does **not** open a tab, so a project's scheduled work never takes the window away from
  what you are doing. Its dot is blue while it runs in the background; open it and it becomes an
  ordinary session with an ordinary tab.
- Each session a routine started carries the routine's icon in the list, so you can tell what
  you launched from what a schedule did.

**Run now** on a routine fires it immediately. It declines, and says why, when the project is
already at its concurrency cap.

## When factorai is closed

Routines run only while factorai is open. There is no daemon and no system service. A routine
that came due while the app was closed runs at the next launch if its catch-up window still
covers it, and otherwise does not run at all. The window is the routine's own setting.

## From an agent

An agent can create and schedule routines through factorai's MCP tools, which is how a session
that decides "this should run nightly" makes it so. An agent cannot disable or delete a routine:
taking a schedule away stays a human's decision.
