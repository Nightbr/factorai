---
id: routines
title: Routines
---

# Routines

A routine is a saved prompt with a schedule behind it, kept per project: a nightly triage, a
dependency sweep, a lint gate on the hour. When it comes due, factorai starts a session in that
project with the prompt as its first message.

## Creating one

Open a project and switch to its **Routines** tab, beside **Sessions**, then press **New
routine** — or choose **New routine** from the project's right-click menu. A routine has a
**Name**, a **Schedule**, a **Prompt** (sent as the session's first message), an **Enabled**
switch and a **Run if missed** window.

The schedule is a preset — **Every hour** at a minute past the hour, **Daily at**, **Weekly on**
a day, **Monthly on day** — or **Custom…**, which takes a five-field cron expression in local
time. Under it, the editor echoes the next few runs, so you can see what the expression means
before you save it; a schedule that never fires in the next year says so. Times follow
**Settings → Appearance → 24-hour clock**.

Each row in the list shows the schedule in words and the next run, then what happened last time:
when it last ran, that it was skipped, or why the last run failed. The row's controls are **Run
now**, edit, delete (which asks, and leaves any session the routine started running) and the
enable switch, which stops future runs and never kills a session already going.

## What a fire does

- It starts an ordinary session: indexed, resumable, searchable, in the sidebar like any other.
- It does **not** open a tab, so a project's scheduled work never takes the window away from
  what you are doing. Its dot is blue while it runs in the background; open it and it becomes an
  ordinary session with an ordinary tab.
- Each session a routine started carries the routine's icon in the list, and the time it ran, so
  you can tell what you launched from what a schedule did and two runs of one routine apart.
- A routine whose previous session is still running is skipped rather than started twice, and
  its row says so.

**Run now** fires the routine immediately, under the same rules. When it declines, the row says
*Did not run —* and why: the previous session is still running, a run for it is already
starting, or the app-wide limit on routine sessions is reached.

That limit is **Settings → Routines → Routine sessions at once**, two by default. It exists
because ten projects with an hourly routine all come due at `:00`; scheduled runs past it queue
in due order and start late rather than being skipped.

## When factorai is closed

Routines run only while factorai is open. There is no daemon and no system service. A routine
that came due while the app was closed runs at the next launch if it is still inside its catch-up
window, and otherwise does not run at all; several missed runs coalesce into one. The window is
**Settings → Routines → Run missed routines for up to**, six hours by default, and a routine can
set its own in **Run if missed … hours late**. Switching **Run if missed** off means it never
runs late.

## From an agent

An agent can list, create and change routines through factorai's MCP tools, which is how a
session that decides "this should run nightly" makes it so. It can also switch a routine off or
back on — the reversible form — but it cannot delete one: taking a schedule away for good stays a
human's decision. A routine an agent created or changed says so on its row.
