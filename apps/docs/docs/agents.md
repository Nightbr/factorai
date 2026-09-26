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
it reports, or `NOT DETECTED`. Expand a card for **Detected binary**, the path factorai resolved,
and **Override path**, to pin a different binary when the probe picked the wrong one or found
none. An override is used as-is, with no fallback to the probe, and applies to the next session
you start; empty means keep auto-detecting. Auto-detection looks on `PATH`, then asks your login
shell, then tries the usual install locations. When it finds nothing, see
[Troubleshooting](troubleshooting#claude-not-found).

## Which agent a project runs

Each [profile](advanced/profiles) belongs to one agent, chosen when the profile is created. A
project runs the agent of its assigned profile; a project with no profile runs the **starred**
default. Both live in **Settings → Profiles**, and once there are two profiles the project's
right-click menu has a **Profile** submenu with the agent mark beside every entry.

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
| Add to agent context | yes, into the composer | yes, as a new turn (`codex queue`), once the thread has had its first message |
| Viewer follows the files the agent reads | yes | not yet |

That last row is honest rather than a plan: it rides on Claude Code's editor protocol, and Codex
has no equivalent to speak to yet. For Codex, "Add to agent context" queues a message into the
running thread; if the thread is idle, Codex answers it right away.

A Codex session begins under an id factorai minted and takes Codex's own the moment the first
turn lands. The tab, the URL and the terminal move over in one step; you will not notice unless
you are watching the address bar.

## Tools for the agent

Both agents get factorai's own tools over MCP, registered at launch: an agent in either CLI can
list, create and update the project's [routines](routines), and switch one off or back on. It
cannot delete one. Codex receives the registration as a
launch-time override, so nothing is written into `~/.codex`.

One difference in how the two find them. Claude Code lists MCP tools up front. Codex keeps them
behind its own tool search, and a vague question ("do you see tools for factorai?") can get a
vague no. Name the server or the tool — "use the factorai MCP server to list the routines" — and
Codex finds and calls it.
