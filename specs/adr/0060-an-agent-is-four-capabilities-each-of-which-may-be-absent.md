# ADR-0060 — An agent is four capabilities, each of which may be absent

**Date.** 2026-09-22
**Status.** Accepted. Generalises
[ADR-0002](0002-embedded-pty-for-claude.md) (the PTY is how any agent runs),
[ADR-0004](0004-claude-dir-is-read-only.md) (every agent's store is read-only
to us) and [ADR-0015](0015-session-status-from-the-terminal-title.md) (the
title is one status source, not the only one). Leaves
[ADR-0017](0017-ide-bridge-writes-one-lockfile-into-claude-ide.md) Claude-only
on purpose. The contract is `specs/05-features.md` F30, and roadmap item 38 is
where this was asked for.

## Context

factorai spawns, resumes, indexes and watches exactly one CLI. `agents/mod.rs`
already says the store layer is a seam and refuses to write `trait AgentStore`
until a second implementor exists, "because a trait with one implementor is a
guess about the second one's shape". The second implementor is Codex CLI
(0.155.1 read at source tag `rust-v0.155.1` on 2026-09-22), and its shape is
different enough in every dimension that the guess would have been wrong:

| | Claude Code | Codex CLI |
|---|---|---|
| store | `~/.claude/projects/<encoded-cwd>/<id>.jsonl` | `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`, no per-folder directory, `cwd` only inside the file |
| record | one event per line | `{timestamp, ordinal?, type, payload}`, twelve `type`s |
| new-session id | `--session-id <ours>` | none; Codex mints it |
| resume | `--resume <id>` | `resume <id>`, appends to the same file |
| status | title glyph `◐` / `✳` | title items chosen by config, `run-state` renders words |
| config dir | `CLAUDE_CONFIG_DIR`, created on demand | `CODEX_HOME`, fatal if missing |
| IDE protocol | lockfile in `~/.claude/ide/` | none |
| model-facing tools | `--mcp-config` inline JSON | `-c mcp_servers.<name>.*` overrides |

A single `trait Agent` with one method per verb would force every implementor
to answer every verb, and the honest answer for several of them is "cannot".
Codex cannot be handed an id; Gemini CLI (item 38's third) may set no title at
all; some future harness may have no readable transcript. The roadmap asked for
this explicitly: *grade the capabilities rather than requiring all of them*.

## Decision

**An agent is a descriptor plus four capabilities. Each capability is an
`Option`, and the UI has a defined rendering for each one that is `None`.**

```rust
pub struct AgentDescriptor {
	pub id: &'static str,          // "claude" | "codex" — the `agent` column value
	pub display_name: &'static str,
	pub binary_name: &'static str, // what the three-tier probe looks for
	pub config_dir_env: &'static str, // CLAUDE_CONFIG_DIR | CODEX_HOME
	pub config_dir_must_exist: bool,  // false | true
}

pub trait Discovery   { fn discover(&self, store: &Path) -> Vec<Discovered>; fn watch_roots(&self, store: &Path) -> Vec<PathBuf>; }
pub trait Transcripts { fn locate(&self, store: &Path, session: &SessionRef) -> Option<PathBuf>; fn read(&self, path: &Path, from: u64) -> TranscriptIter; }
pub trait Spawn       { fn argv(&self, req: &SpawnRequest) -> Vec<String>; fn env(&self, req: &SpawnRequest) -> Vec<(String, String)>; fn id_source(&self) -> IdSource; }
pub trait Status      { fn parse_title(&self, title: &str) -> Option<SessionStatus>; }

pub struct Agent {
	pub descriptor: AgentDescriptor,
	pub spawn: Box<dyn Spawn>,                 // required — an agent you cannot start is not one
	pub discovery: Option<Box<dyn Discovery>>,
	pub transcripts: Option<Box<dyn Transcripts>>,
	pub status: Option<Box<dyn Status>>,
}
```

The exact signatures are the code's to settle; what this ADR fixes is the
**partition** and the **optionality**:

1. **Spawn is the only required capability.** It yields an argv and an
   environment for a PTY (ADR-0002 unchanged: every agent is a process in a
   PTY, streamed to xterm, killed on quit per ADR-0005). It also states how the
   session gets its id — `IdSource::Ours` (Claude, ADR-0008) or
   `IdSource::Agent` (Codex, [ADR-0062](0062-a-session-id-the-agent-mints-is-adopted-from-its-title.md)).
2. **Discovery** turns a store directory into `Discovered` rows (ADR-0011:
   a folder the agent has worked in, never an identity). Absent → the agent's
   sessions exist only while their PTY is live, and the sidebar says so on the
   row: *not indexed*.
3. **Transcripts** locate a session's file and read it as a stream of
   factorai's own `TranscriptEvent`s (user message, assistant message, tool
   call, rename, cwd change, subagent link). Absent → no search hits, no
   title beyond the id, no resume-by-probe; the row reads *no transcript*.
4. **Status** maps a terminal title to `working | waiting_input`, or `None`
   when the title says nothing. Absent, or present but silent, →
   `SessionStatus::Unknown`, rendered as the hollow `status-unknown` dot
   (DESIGN.md § Status Dot). **Never a default of `working`**: a dot that
   says working because nothing said otherwise is worse than no dot.

**What is deliberately not a capability.**

- **The IDE bridge** (ADR-0017) stays a Claude-specific side effect of
  `Spawn`. It is Claude's protocol, observed against one CLI version; making it
  a capability would advertise an interoperability nobody has tested. When a
  second protocol is observed end to end it becomes one, by a new ADR.
- **Model-facing tools** (ADR-0029) are part of `Spawn::argv` / `Spawn::env`
  for each agent that can take a server registration at launch. The server is
  the same; only the handshake differs.
- **Writing to the store.** Every agent's store is read-only to us
  (ADR-0004 generalised), with the one exception ADR-0027 already carved:
  moving a transcript to the OS trash on delete.

**One registry, keyed by `agent` id.** `agents::registry()` returns the two
agents; `discovered_projects.agent`, `profiles.agent`, `project_profiles.agent`
and the new `routines.agent` all hold a descriptor id and nothing else.
`agents::CLAUDE` stays as the constant for the first one; `agents::CODEX`
joins it.

## Consequences

- `agents/mod.rs`'s "there is deliberately no `trait AgentStore`" paragraph is
  replaced by a pointer to this ADR in the same commit the traits land.
- `services/terminal.rs` loses `find_claude_binary` and `session_flag` as
  direct calls; it asks the registry for the project's agent and calls
  `spawn.argv`. `claude_cli.rs` becomes `agent_cli.rs` with the probe
  parameterised on `binary_name` and the candidate list per agent.
- The indexer iterates `(profile, agent)` pairs; a profile's agent decides
  which `Discovery` and `Transcripts` walk it. A profile whose agent has no
  `Discovery` is skipped by the scan and says so in Settings.
- `sessions` gains `transcript_path` (F30 § "Storage"), because Codex's path
  is not derivable from the id and the folder, and pretending every store is
  Claude-shaped is the assumption this ADR ends.
- Gemini CLI, OpenCode and Cursor each land as one `Agent` value against this
  seam, with whichever capabilities they can truthfully offer. The seam is not
  reopened for them unless one of them needs a fifth capability, and that is a
  new ADR.
