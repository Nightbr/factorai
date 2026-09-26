---
id: profiles
title: Profiles
---

# Profiles

A profile is a name, an agent, and that agent's configuration directory. Switching profile sets
`CLAUDE_CONFIG_DIR` on a `claude` process or `CODEX_HOME` on a `codex` one — each CLI's own
isolation boundary: credentials, settings, hooks, MCP configuration and the transcript store all
resolve under it. Two profiles are two complete identities, and factorai never holds a token for
either.

## Setting them up

**Settings → Profiles** lists profiles, grouped by agent once both have one, and writes as you
click: there is no Save. **New** takes a name and a directory (suggested from the name), plus the
agent when both are installed; the **agent is chosen when the profile is created and never
changes**, because the directory holds one CLI's login and store. Each agent has one profile
marked **Default**, set with **Make default** in the row's menu. Once both agents have profiles,
one of the defaults is **starred** — **Use for new projects** — and that is what a project with no
profile of its own runs. **Rename** and **Delete** are in the same menu; the default cannot be
deleted, and deleting any profile leaves its directory, its login and its transcripts on disk.
Log each directory in once with `CLAUDE_CONFIG_DIR=<dir> claude login` or
`CODEX_HOME=<dir> codex login`.

## Which profile a session gets

- A **new session**, and the shell in the project's footer, run under the project's assigned
  profile, or the starred default when the project has none. Assign one from the **Profile**
  submenu of the project's right-click menu (there once you have two profiles), where every entry
  carries its agent's mark, or from the chevron on a profile's row in Settings, which lists every
  project with a checkbox. The profile decides the agent as well as the identity.
- A session under a profile other than the default shows the profile's name in its header.
- A **resumed session** runs under the profile it was started with, whatever the project's
  current assignment. Resuming under the wrong directory would find no transcript and silently
  start a fresh conversation under an old name.
- A **running session** cannot change profile. Every control that assigns one says "applies to
  new sessions", and means it.
