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

**Settings → Profiles** lists profiles, grouped by agent once both have one. Each is a name and a
directory; the **agent is chosen when the profile is created and never changes**, because the
directory holds one CLI's login and store. Each agent has a default profile, and one of those is
the **starred** app default: what a project with no profile of its own runs. Log each directory in
once with `CLAUDE_CONFIG_DIR=<dir> claude login` or `CODEX_HOME=<dir> codex login`.

## Which profile a session gets

- A **new session**, and the shell in the project's footer, run under the project's assigned
  profile, or the starred default when the project has none. Assign one from the project's menu,
  where every entry carries its agent's mark: the profile decides the agent as well as the
  identity.
- A **resumed session** runs under the profile it was started with, whatever the project's
  current assignment. Resuming under the wrong directory would find no transcript and silently
  start a fresh conversation under an old name.
- A **running session** cannot change profile. Every control that assigns one says "applies to
  new sessions", and means it.
