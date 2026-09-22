//! Codex CLI (F30, ADR-0060): the four capabilities as this codebase sees
//! them. Spawn (argv), discovery (every rollout's `cwd`), transcripts (the
//! rollout reader, mapped onto the same `SessionEvent` the Claude indexer
//! consumes) and status (the title's `run-state` word).
//!
//! Every fact below was read at source tag `rust-v0.155.1` and then checked
//! against real rollouts on 2026-09-22 — the checked ones are recorded in
//! `tests/fixtures/codex/` and cited in `specs/05-features.md` § F30. Two of
//! them corrected the spec: new threads default to `history_mode:
//! "paginated"`, and the `thread-id` title item renders a **truncated**
//! prefix of the uuid, not the whole thing (ADR-0062 as amended).

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::Deserialize;
use tracing::warn;

use crate::agents::{Discovered, CODEX};
use crate::models::{SessionEvent, SessionMessage};
use crate::services::terminal::TerminalStatus;

/// Where the rollouts live under `CODEX_HOME`: `sessions/YYYY/MM/DD/`.
pub const SESSIONS_SUBDIR: &str = "sessions";
/// Append-only `{"id","thread_name","updated_at"}` lines; newest wins. Where
/// Codex's own auto-title for a thread is found.
pub const INDEX_FILE: &str = "session_index.jsonl";

/// The title items factorai asks the Codex TUI to render, in order. The title
/// is how both the status dot (`run-state`) and the id adoption (`thread-id`,
/// ADR-0062) read the session, which is why the user's own
/// `tui.terminal_title` is not honoured for a session factorai runs.
pub const TITLE_ITEMS: &str = r#"tui.terminal_title=["run-state","thread-id"]"#;

/// The environment variable the bearer token for factorai's tool server
/// travels in: Codex reads it by name from `mcp_servers.<name>.bearer_token_env_var`.
pub const TOOLS_TOKEN_ENV: &str = "FACTORAI_MCP_TOKEN";

/// factorai's tool server, as a Codex spawn registers it (ADR-0029, F30 §
/// "Spawn"): a streamable-HTTP server named after us, with the token read from
/// the environment rather than written into argv.
pub struct ToolsRegistration {
	pub url: String,
}

/// Build the argv for a Codex session — the part after the binary.
///
/// - `resume` is the adopted id of a session Codex already knows; `None`
///   starts a new thread (Codex mints the id — there is no flag to pass one).
/// - `tools` registers factorai's MCP server by `-c` override, so nothing is
///   written into `CODEX_HOME` (ADR-0004, ADR-0039) and the user's own servers
///   in `config.toml` survive — `-c` merges.
/// - `prompt` is a routine's first message, one positional argument, exactly
///   as for Claude (F22): empty is not an argument.
///
/// No `--cd`: the PTY's cwd is the folder. No policy flags: Codex's own
/// `config.toml` owns sandbox and approvals, and factorai is not where a
/// sandbox gets loosened.
pub fn argv(
	resume: Option<&str>,
	tools: Option<&ToolsRegistration>,
	prompt: Option<&str>,
) -> Vec<String> {
	let mut v = Vec::new();
	if let Some(id) = resume {
		v.push("resume".into());
		v.push(id.to_string());
		// Codex filters `resume` by cwd and asks before switching folders; the
		// session is already spawned where its transcript says it ran.
		v.push("-c".into());
		v.push(r#"tui.resume_cwd="session""#.into());
	}
	v.push("-c".into());
	v.push(TITLE_ITEMS.into());
	if let Some(t) = tools {
		let name = crate::services::agent_tools::SERVER_NAME;
		v.push("-c".into());
		v.push(format!(r#"mcp_servers.{name}.url="{}""#, t.url));
		v.push("-c".into());
		v.push(format!(r#"mcp_servers.{name}.bearer_token_env_var="{TOOLS_TOKEN_ENV}""#));
	}
	if let Some(p) = prompt.filter(|p| !p.is_empty()) {
		v.push(p.to_string());
	}
	v
}

/// The argv, after the binary, that queues one user message into a running
/// thread: `codex queue --thread <id> --message <text>` (F30 § "Add to agent
/// context"). Observed 2026-09-22: delivered into a live TUI, and when the
/// thread is idle it starts a turn at once — the message lands as a user turn
/// verbatim, so it is written as one.
pub fn queue_argv(thread_id: &str, message: &str) -> Vec<String> {
	vec![
		"queue".into(),
		"--thread".into(),
		thread_id.to_string(),
		"--message".into(),
		message.to_string(),
	]
}

/// The user turn that "Add to agent context" becomes for Codex: one
/// `@path#Lstart-end` per mention, the path relative to the session's folder
/// when it is inside it, absolute otherwise. Claude's bridge adds the same
/// mention to the composer without sending; Codex has no such channel, so the
/// turn says what it is rather than reading as a question.
pub fn mention_message(cwd: &Path, mentions: &[(PathBuf, Option<(u32, u32)>)]) -> String {
	let mut lines: Vec<String> = mentions
		.iter()
		.map(|(path, range)| {
			let shown = path.strip_prefix(cwd).unwrap_or(path).to_string_lossy().into_owned();
			match range {
				Some((start, end)) if start == end => format!("@{shown}#L{start}"),
				Some((start, end)) => format!("@{shown}#L{start}-{end}"),
				None => format!("@{shown}"),
			}
		})
		.collect();
	lines.insert(
		0,
		"Added to your context from the file panel — no action needed unless asked:".to_string(),
	);
	lines.join("\n")
}

// ---------------------------------------------------------------------------
// Status and adoption, from the title
// ---------------------------------------------------------------------------

/// What the `run-state` title item says the agent is doing.
///
/// Observed 2026-09-22 with [`TITLE_ITEMS`]: `Ready`, then `Ready | <prefix>...`,
/// `Starting | …`, `Working | … ⠴` (a braille spinner trails while a task runs
/// and for a while after), back to `Ready | …`. Source adds `Thinking`,
/// `Waiting` — Codex waiting on the model or a tool, **not** on the human,
/// hence `Working` here — and `[ ! ] Action Required` when an approval is
/// pending. The word is matched, never a substring, so the spinner and the id
/// cannot vote.
pub fn classify_title(payload: &str) -> Option<TerminalStatus> {
	let trimmed = payload.trim();
	if trimmed.contains("Action Required") {
		return Some(TerminalStatus::WaitingInput);
	}
	let state = trimmed.split(" | ").next()?.trim();
	match state {
		"Ready" => Some(TerminalStatus::WaitingInput),
		"Starting" | "Working" | "Thinking" | "Waiting" => Some(TerminalStatus::Working),
		_ => None,
	}
}

/// The thread id the title carries — **a prefix**, because the TUI truncates
/// the item to 29 characters plus `...` (observed: `01a0c975-21fa-7e51-ae6f-cb104...`).
/// Twenty-four hex digits of a v7 uuid is more than enough to pick the rollout
/// out of a store; the full id comes from that file's name (ADR-0062).
pub fn thread_prefix_from_title(payload: &str) -> Option<String> {
	let mut parts = payload.split(" | ");
	parts.next()?;
	let raw = parts.next()?.trim();
	let raw = raw.split_whitespace().next()?; // drop a trailing spinner glyph
	let prefix = raw.trim_end_matches('.').trim_end_matches('…');
	let ok = prefix.len() >= 8 && prefix.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
	ok.then(|| prefix.to_ascii_lowercase())
}

// ---------------------------------------------------------------------------
// The store on disk
// ---------------------------------------------------------------------------

/// Every rollout under `<codex_dir>/sessions/`, whatever day it was written.
/// Three fixed levels (`YYYY/MM/DD`), so this walks a handful of directories
/// and never recurses into anything else.
pub fn rollouts(codex_dir: &Path) -> Vec<PathBuf> {
	let mut out = Vec::new();
	let root = codex_dir.join(SESSIONS_SUBDIR);
	let Ok(years) = std::fs::read_dir(&root) else { return out };
	for year in years.filter_map(Result::ok).map(|e| e.path()).filter(|p| p.is_dir()) {
		let Ok(months) = std::fs::read_dir(&year) else { continue };
		for month in months.filter_map(Result::ok).map(|e| e.path()).filter(|p| p.is_dir()) {
			let Ok(days) = std::fs::read_dir(&month) else { continue };
			for day in days.filter_map(Result::ok).map(|e| e.path()).filter(|p| p.is_dir()) {
				let Ok(files) = std::fs::read_dir(&day) else { continue };
				out.extend(
					files
						.filter_map(Result::ok)
						.map(|e| e.path())
						.filter(|p| p.extension().is_some_and(|e| e == "jsonl"))
						.filter(|p| session_id_of(p).is_some()),
				);
			}
		}
	}
	out.sort();
	out
}

/// The uuid at the end of `rollout-<local ts>-<uuid>.jsonl`, which is also
/// `session_meta.id`. `None` for a file that is not a rollout.
pub fn session_id_of(path: &Path) -> Option<String> {
	let stem = path.file_stem()?.to_str()?;
	let stem = stem.strip_prefix("rollout-")?;
	// A reverted thread is `<thread>_<rollout>`; the thread id is what we key by.
	let stem = stem.split('_').next()?;
	if stem.len() < 36 {
		return None;
	}
	let id = &stem[stem.len() - 36..];
	is_uuid(id).then(|| id.to_ascii_lowercase())
}

fn is_uuid(s: &str) -> bool {
	s.len() == 36
		&& s.chars().enumerate().all(|(i, c)| match i {
			8 | 13 | 18 | 23 => c == '-',
			_ => c.is_ascii_hexdigit(),
		})
}

/// The rollout for a session id, if the store holds one.
pub fn transcript_path(codex_dir: &Path, session_id: &str) -> Option<PathBuf> {
	let want = session_id.to_ascii_lowercase();
	rollouts(codex_dir).into_iter().find(|p| session_id_of(p).as_deref() == Some(want.as_str()))
}

/// The rollout whose id starts with `prefix` and whose first turn happened in
/// `cwd` — the adoption probe (ADR-0062). Newest first, so two sessions in one
/// folder that somehow share a prefix resolve to the one just started.
pub fn find_by_prefix(codex_dir: &Path, prefix: &str, cwd: &Path) -> Option<(String, PathBuf)> {
	let prefix = prefix.to_ascii_lowercase();
	let mut hits: Vec<(String, PathBuf)> = rollouts(codex_dir)
		.into_iter()
		.filter_map(|p| session_id_of(&p).map(|id| (id, p)))
		.filter(|(id, _)| id.starts_with(&prefix))
		.collect();
	hits.sort_by(|a, b| b.1.cmp(&a.1));
	hits.into_iter().find(|(_, p)| {
		read_meta(p).is_some_and(|m| Path::new(&m.cwd) == cwd) || read_meta(p).is_none()
	})
}

/// The `session_meta` line's fields we use.
#[derive(Debug, Clone, Deserialize)]
pub struct Meta {
	pub id: String,
	pub cwd: String,
	#[serde(default)]
	pub timestamp: Option<String>,
	#[serde(default)]
	pub parent_thread_id: Option<String>,
}

#[derive(Deserialize)]
struct Line {
	#[serde(default)]
	timestamp: Option<String>,
	#[serde(rename = "type")]
	kind: String,
	#[serde(default)]
	payload: serde_json::Value,
}

/// The first line of a rollout, when it is a `session_meta`. `None` for a file
/// that is empty (Codex materialises it at the first turn), truncated, or not a
/// rollout — never a guess.
pub fn read_meta(path: &Path) -> Option<Meta> {
	let file = File::open(path).ok()?;
	let mut first = String::new();
	BufReader::new(file).read_line(&mut first).ok()?;
	let line: Line = serde_json::from_str(first.trim()).ok()?;
	if line.kind != "session_meta" {
		return None;
	}
	serde_json::from_value(line.payload).ok()
}

/// Every folder this store holds a thread for, keyed by the folder itself
/// (F30 § "Discovery"). Codex keeps no per-folder directory; `cwd` inside each
/// rollout is the only record of where it ran.
pub fn discover(codex_dir: &Path) -> Vec<Discovered> {
	let mut seen: HashMap<String, ()> = HashMap::new();
	let mut out = Vec::new();
	for path in rollouts(codex_dir) {
		let Some(meta) = read_meta(&path) else { continue };
		if seen.insert(meta.cwd.clone(), ()).is_none() {
			out.push(Discovered { agent: CODEX, key: meta.cwd.clone(), real_path: Some(meta.cwd) });
		}
	}
	out
}

/// Codex's own name for each thread, from `session_index.jsonl` — newest line
/// per id wins, and a line with no name is a removal.
pub fn thread_names(codex_dir: &Path) -> HashMap<String, String> {
	#[derive(Deserialize)]
	struct Entry {
		id: String,
		#[serde(default)]
		thread_name: Option<String>,
	}
	let mut out = HashMap::new();
	let Ok(file) = File::open(codex_dir.join(INDEX_FILE)) else { return out };
	for line in BufReader::new(file).lines().map_while(Result::ok) {
		let Ok(e) = serde_json::from_str::<Entry>(line.trim()) else { continue };
		match e.thread_name.filter(|n| !n.trim().is_empty()) {
			Some(name) => {
				out.insert(e.id.to_ascii_lowercase(), name);
			}
			None => {
				out.remove(&e.id.to_ascii_lowercase());
			}
		}
	}
	out
}

// ---------------------------------------------------------------------------
// The rollout, read as the indexer's events
// ---------------------------------------------------------------------------

/// A rollout, line by line, as [`SessionEvent`]s the indexer already knows how
/// to consume. Same byte accounting as `jsonl::EventIter` so the incremental
/// index (PERF-03) works unchanged: a resume appends to the same file.
///
/// What maps (F30 § "Transcripts", checked against real rollouts):
///
/// | line | event |
/// |---|---|
/// | `session_meta` | `cwd` |
/// | `response_item` / `message` role `user` or `assistant` | a message; `input_text` / `output_text` blocks become `text` |
/// | `turn_context` | `cwd` |
/// | `event_msg` / `task_started` | one turn |
/// | everything else | skipped, whole line |
///
/// Developer messages (Codex's injected instructions) are dropped, and a user
/// message that is the `# AGENTS.md instructions for …` injection is dropped
/// too: it is context, not something anybody said.
pub struct RolloutIter {
	reader: BufReader<File>,
	line_buf: String,
	complete: u64,
}

impl RolloutIter {
	pub fn open_at(path: &Path, offset: u64) -> crate::error::AppResult<Self> {
		let mut file = File::open(path)?;
		if offset > 0 {
			file.seek(SeekFrom::Start(offset))?;
		}
		Ok(Self {
			reader: BufReader::with_capacity(64 * 1024, file),
			line_buf: String::with_capacity(4096),
			complete: offset,
		})
	}

	/// Bytes consumed as whole lines — see `jsonl::EventIter::complete_bytes`.
	pub fn complete_bytes(&self) -> u64 {
		self.complete
	}
}

impl Iterator for RolloutIter {
	type Item = SessionEvent;

	fn next(&mut self) -> Option<Self::Item> {
		loop {
			self.line_buf.clear();
			match self.reader.read_line(&mut self.line_buf) {
				Ok(0) => return None,
				Ok(n) => {
					let whole = self.line_buf.ends_with('\n');
					let trimmed = self.line_buf.trim();
					if trimmed.is_empty() {
						if whole {
							self.complete += n as u64;
						}
						continue;
					}
					match serde_json::from_str::<Line>(trimmed) {
						Ok(line) => {
							self.complete += n as u64;
							if let Some(ev) = map_line(line) {
								return Some(ev);
							}
							continue;
						}
						Err(e) => {
							if whole {
								self.complete += n as u64;
							}
							warn!(error = %e, whole, "skipping malformed rollout line");
							continue;
						}
					}
				}
				Err(e) => {
					warn!(error = %e, "rollout read error");
					return None;
				}
			}
		}
	}
}

/// The marker Codex puts in front of the AGENTS.md it injects as a user turn.
const INJECTED_INSTRUCTIONS: &str = "# AGENTS.md instructions for ";

/// Whether a user-role message is Codex's own context rather than something
/// the person typed: the injected AGENTS.md, and the `<environment_context>`
/// block it opens every thread with. Neither titles a session nor belongs in
/// search.
fn is_injected_context(text: &str) -> bool {
	let t = text.trim_start();
	t.starts_with(INJECTED_INSTRUCTIONS)
		|| t.starts_with("<environment_context>")
		|| t.starts_with("<INSTRUCTIONS>")
}

fn map_line(line: Line) -> Option<SessionEvent> {
	let mut ev = SessionEvent {
		event_type: line.kind.clone(),
		uuid: None,
		parent_uuid: None,
		timestamp: line.timestamp,
		session_id: None,
		cwd: None,
		version: None,
		message: None,
		extra: serde_json::Map::new(),
	};
	match line.kind.as_str() {
		"session_meta" | "turn_context" => {
			ev.cwd = line.payload.get("cwd").and_then(|v| v.as_str()).map(str::to_owned);
			if line.kind == "session_meta" {
				if let Some(id) = line.payload.get("id").and_then(|v| v.as_str()) {
					ev.session_id = Some(id.to_string());
				}
			}
			Some(ev)
		}
		"response_item" => {
			if line.payload.get("type").and_then(|v| v.as_str()) != Some("message") {
				return None;
			}
			let role = line.payload.get("role").and_then(|v| v.as_str())?;
			if role != "user" && role != "assistant" {
				return None;
			}
			let blocks: Vec<serde_json::Value> = line
				.payload
				.get("content")
				.and_then(|c| c.as_array())
				.map(|items| {
					items
						.iter()
						.filter_map(|b| b.get("text").and_then(|t| t.as_str()))
						.map(|t| serde_json::json!({ "type": "text", "text": t }))
						.collect()
				})
				.unwrap_or_default();
			let injected = blocks
				.first()
				.and_then(|b| b.get("text").and_then(|t| t.as_str()))
				.is_some_and(is_injected_context);
			if role == "user" && injected {
				return None;
			}
			ev.message = Some(SessionMessage {
				role: role.to_string(),
				content: serde_json::Value::Array(blocks),
			});
			Some(ev)
		}
		"event_msg" => {
			// One turn per `task_started`; the rest of the event stream is
			// Codex's own bookkeeping.
			if line.payload.get("type").and_then(|v| v.as_str()) == Some("task_started") {
				ev.event_type = "turn".into();
				Some(ev)
			} else {
				None
			}
		}
		_ => None,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../tests/fixtures/codex");

	#[test]
	fn a_new_session_carries_only_the_title_override() {
		assert_eq!(argv(None, None, None), vec!["-c", TITLE_ITEMS]);
	}

	#[test]
	fn a_resume_names_the_thread_and_pins_its_folder() {
		let v = argv(Some("abc"), None, None);
		assert_eq!(&v[..2], ["resume", "abc"]);
		assert!(v.contains(&r#"tui.resume_cwd="session""#.to_string()));
	}

	#[test]
	fn the_tool_server_is_registered_by_name_with_the_token_in_the_environment() {
		let v = argv(None, Some(&ToolsRegistration { url: "http://127.0.0.1:1/mcp".into() }), None);
		assert!(v.contains(&r#"mcp_servers.factorai.url="http://127.0.0.1:1/mcp""#.to_string()));
		assert!(v.contains(
			&r#"mcp_servers.factorai.bearer_token_env_var="FACTORAI_MCP_TOKEN""#.to_string()
		));
		assert!(!v.iter().any(|a| a.contains("Bearer")), "the token never goes in argv");
	}

	#[test]
	fn a_mention_becomes_one_user_turn_with_at_paths_relative_to_the_folder() {
		let cwd = Path::new("/home/alice/code/pong");
		let msg = mention_message(
			cwd,
			&[
				(PathBuf::from("/home/alice/code/pong/src/main.rs"), Some((10, 20))),
				(PathBuf::from("/home/alice/code/pong/README.md"), None),
				(PathBuf::from("/home/alice/other/x.ts"), Some((3, 3))),
			],
		);
		let lines: Vec<&str> = msg.lines().collect();
		assert!(lines[0].starts_with("Added to your context"));
		assert_eq!(lines[1], "@src/main.rs#L10-20");
		assert_eq!(lines[2], "@README.md");
		assert_eq!(lines[3], "@/home/alice/other/x.ts#L3");
		assert_eq!(queue_argv("abc", "hi"), vec!["queue", "--thread", "abc", "--message", "hi"]);
	}

	#[test]
	fn a_prompt_is_one_positional_argument_and_empty_is_none() {
		let v = argv(None, None, Some("Triage the inbox"));
		assert_eq!(v.last().unwrap(), "Triage the inbox");
		assert_eq!(argv(None, None, Some("")).len(), 2);
	}

	#[test]
	fn never_claudes_flags() {
		for v in [argv(None, None, Some("x")), argv(Some("id"), None, None)] {
			assert!(!v.iter().any(|a| a == "--session-id" || a == "--resume"), "{v:?}");
		}
	}

	#[test]
	fn the_title_sequence_of_one_real_turn_reads_as_working_then_waiting() {
		// Recorded 2026-09-22 through a PTY with `TITLE_ITEMS`.
		assert_eq!(classify_title("Ready"), Some(TerminalStatus::WaitingInput));
		assert_eq!(
			classify_title("Ready | 01a0c975-21fa-7e51-ae6f-cb104..."),
			Some(TerminalStatus::WaitingInput)
		);
		assert_eq!(
			classify_title("Starting | 01a0c975-21fa-7e51-ae6f-cb104..."),
			Some(TerminalStatus::Working)
		);
		assert_eq!(
			classify_title("Working | 01a0c975-21fa-7e51-ae6f-cb104... ⠴"),
			Some(TerminalStatus::Working)
		);
		assert_eq!(
			classify_title("Ready | 01a0c975-21fa-7e51-ae6f-cb104... ⠙"),
			Some(TerminalStatus::WaitingInput)
		);
		assert_eq!(classify_title("[ ! ] Action Required"), Some(TerminalStatus::WaitingInput));
		// Codex's "Waiting" is on the model, not on you.
		assert_eq!(classify_title("Waiting | abc"), Some(TerminalStatus::Working));
		assert_eq!(classify_title("Codex"), None);
	}

	#[test]
	fn the_thread_prefix_is_read_without_the_ellipsis_or_the_spinner() {
		assert_eq!(
			thread_prefix_from_title("Working | 01a0c975-21fa-7e51-ae6f-cb104... ⠴"),
			Some("01a0c975-21fa-7e51-ae6f-cb104".into())
		);
		assert_eq!(thread_prefix_from_title("Ready"), None);
		assert_eq!(thread_prefix_from_title("Ready | not-an-id"), None);
	}

	#[test]
	fn a_rollout_filename_names_its_thread() {
		let p = Path::new(
			"/x/sessions/2026/09/22/rollout-2026-09-22T16-11-31-01a0c975-21fa-7e51-ae6f-cb1045c10d51.jsonl",
		);
		assert_eq!(session_id_of(p).as_deref(), Some("01a0c975-21fa-7e51-ae6f-cb1045c10d51"));
		assert_eq!(session_id_of(Path::new("/x/notes.jsonl")), None);
	}

	#[test]
	fn the_fixture_store_is_discovered_read_and_named() {
		let dir = Path::new(FIXTURE);
		let found = discover(dir);
		assert_eq!(found.len(), 1, "{found:?}");
		assert_eq!(found[0].agent, CODEX);
		assert_eq!(found[0].key, "/home/alice/code/pong");
		assert_eq!(found[0].real_path.as_deref(), Some("/home/alice/code/pong"));

		let files = rollouts(dir);
		assert_eq!(files.len(), 1);
		let id = session_id_of(&files[0]).unwrap();
		assert_eq!(transcript_path(dir, &id).as_deref(), Some(files[0].as_path()));
		assert_eq!(
			find_by_prefix(dir, &id[..29], Path::new("/home/alice/code/pong")).map(|(i, _)| i),
			Some(id.clone())
		);
		assert_eq!(thread_names(dir).get(&id).map(String::as_str), Some("Reply with pong"));

		let events: Vec<SessionEvent> = RolloutIter::open_at(&files[0], 0).unwrap().collect();
		let cwd = events.iter().find_map(|e| e.cwd.clone());
		assert_eq!(cwd.as_deref(), Some("/home/alice/code/pong"));
		let messages: Vec<(&str, String)> = events
			.iter()
			.filter_map(|e| e.message.as_ref())
			.map(|m| (m.role.as_str(), crate::services::jsonl::flatten_message_text(&m.content)))
			.collect();
		// Neither the injected AGENTS.md nor the environment block is a message
		// anybody said; the prompt is.
		assert!(messages.iter().all(|(_, t)| !is_injected_context(t)));
		assert_eq!(
			messages.first().map(|(r, t)| (*r, t.as_str())),
			Some(("user", "Reply with exactly the word: pong"))
		);
		assert!(messages.iter().any(|(r, t)| *r == "assistant" && t.contains("pong")));
		assert_eq!(events.iter().filter(|e| e.event_type == "turn").count(), 1);
	}
}
