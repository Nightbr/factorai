---
id: agents
title: Agents
---

# Agents

factorai runs two CLIs: [Claude Code](https://claude.com/claude-code) and
[Codex](https://developers.openai.com/codex/cli). Install either or both; factorai finds what is
on the machine and drives it. It never handles a credential for either: you log each CLI in
yourself, and factorai starts the process you have already logged into.

## What factorai knows about each

**Settings → Agents** shows one card per agent, collapsed to its badge: `ACTIVE` with the version
it reports, or `NOT DETECTED`. Expand a card to see the path factorai resolved and to pin a
different binary when the probe picked the wrong one. Auto-detection looks on `PATH`, then in a
login shell, then in the usual install locations.

## Which agent a project runs

Each [profile](advanced/profiles) belongs to one agent, chosen when the profile is created. A
project runs the agent of its assigned profile; a project with no profile runs the **starred**
default. Both live in **Settings → Profiles**, and the project's right-click menu shows the agent
mark beside every profile it offers.

To start the other agent once, without changing the project: the chevron beside `+` on the
project row, or **New session with ▸** in the project's menu. Both are absent while only one
agent is installed.

## What is the same, and what differs

Sessions of both agents sit in the same list, sorted by time, and carry the same status dot.
Search covers both stores. The session header shows the agent's mark.

| | Claude Code | Codex |
| --- | --- | --- |
| Transcripts read from | `~/.claude/projects/` | `~/.codex/sessions/` |
| Isolated by | `CLAUDE_CONFIG_DIR` | `CODEX_HOME` |
| Session title | your `/rename`, else Claude's own, else the first prompt | Codex's own thread name, else the first prompt |
| Status | the title glyph | the title's run state |
| New session id | assigned by factorai before the process starts | Codex's, adopted at the first turn |
| IDE bridge (open file, add to context) | yes | not yet |

That last row is honest rather than a plan: the bridge speaks Claude Code's protocol, and Codex
has no equivalent to speak to yet.

A Codex session begins under an id factorai minted and takes Codex's own the moment the first
turn lands. The tab, the URL and the terminal move over in one step; you will not notice unless
you are watching the address bar.

## Tools for the agent

Both agents get factorai's own tools over MCP, registered at launch: an agent in either CLI can
list, create and update the project's [routines](routines). Codex receives the registration as a
launch-time override, so nothing is written into `~/.codex`.
