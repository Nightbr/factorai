---
id: profiles
title: Profiles
---

# Profiles

A profile is a name plus a Claude configuration directory. Switching profile sets
`CLAUDE_CONFIG_DIR` on the `claude` process factorai starts, which is the CLI's own isolation
boundary: credentials, settings, hooks, MCP configuration and the projects store all resolve
under it. Two profiles are two complete identities, and factorai never holds a token for either.

## Setting them up

**Settings → Profiles** lists profiles. Each is a name and a directory; the default profile is
the one with no directory at all, which is the CLI's own default. Log each directory in once with
`CLAUDE_CONFIG_DIR=<dir> claude login`.

## Which profile a session gets

- A **new session**, and the shell in the project's footer, run under the project's assigned
  profile, or the default when the project has none. Assign one from the project's menu.
- A **resumed session** runs under the profile it was started with, whatever the project's
  current assignment. Resuming under the wrong directory would find no transcript and silently
  start a fresh conversation under an old name.
- A **running session** cannot change profile. Every control that assigns one says "applies to
  new sessions", and means it.
