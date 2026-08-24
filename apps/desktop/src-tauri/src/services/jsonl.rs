use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use tracing::warn;

use crate::error::AppResult;
use crate::models::SessionEvent;

/// Streaming line-by-line parser. Malformed lines are logged and skipped —
/// the schema is undocumented and we'd rather keep going than fail a whole
/// session because of one bad line.
pub struct EventIter {
	reader: BufReader<File>,
	line_buf: String,
}

impl EventIter {
	pub fn open(path: &Path) -> AppResult<Self> {
		let file = File::open(path)?;
		Ok(Self {
			reader: BufReader::with_capacity(64 * 1024, file),
			line_buf: String::with_capacity(4096),
		})
	}
}

impl Iterator for EventIter {
	type Item = SessionEvent;

	fn next(&mut self) -> Option<Self::Item> {
		loop {
			self.line_buf.clear();
			match self.reader.read_line(&mut self.line_buf) {
				Ok(0) => return None,
				Ok(_) => {
					let trimmed = self.line_buf.trim();
					if trimmed.is_empty() {
						continue;
					}
					match serde_json::from_str::<SessionEvent>(trimmed) {
						Ok(ev) => return Some(ev),
						Err(e) => {
							warn!(error = %e, "skipping malformed jsonl line");
							continue;
						}
					}
				}
				Err(e) => {
					warn!(error = %e, "jsonl read error");
					return None;
				}
			}
		}
	}
}

/// Flatten a message body into a plain-text string for FTS indexing. Handles
/// both `content: "..."` and `content: [{type:'text', text:'...'}]` shapes.
pub fn flatten_message_text(content: &serde_json::Value) -> String {
	match content {
		serde_json::Value::String(s) => s.clone(),
		serde_json::Value::Array(arr) => {
			let mut out = String::new();
			for block in arr {
				if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
					if !out.is_empty() {
						out.push('\n');
					}
					out.push_str(text);
				}
			}
			out
		}
		_ => String::new(),
	}
}

/// The absolute paths a message's `tool_use` blocks name, in order.
///
/// **This is deliberately a guess at another program's internal schema** (F21,
/// migrations 0009 and 0010), so every step of it is allowed to find nothing: a
/// block that is not a `tool_use`, an `input` that is not an object, a key we do
/// not know, or a relative path all yield nothing rather than an error. The
/// schema is undocumented and will change; when it does, this quietly stops
/// contributing and the two cwd signals carry the feature exactly as they did
/// before it existed.
///
/// **Relative paths are dropped rather than joined to the session's cwd.** A
/// tool's path is relative to wherever *that call* ran, which is not something
/// the transcript states, and the whole use of this value is deciding which of
/// two checkouts a path is inside. A wrong answer there is worse than no answer.
///
/// **A shell command's own paths count too**, and on the evidence they are the
/// ones that matter: the session that prompted this had 44 `Bash` calls and not
/// one `Read`, `Write` or `Edit`, so a harvest of file-tool keys alone found
/// nothing at all. See [`command_paths`] for how a command string is read, and
/// why reading it loosely is safe.
pub fn tool_use_paths(content: &serde_json::Value) -> Vec<&str> {
	let serde_json::Value::Array(blocks) = content else {
		return Vec::new();
	};
	blocks
		.iter()
		.filter(|b| b.get("type").and_then(|v| v.as_str()) == Some("tool_use"))
		.filter_map(|b| b.get("input"))
		.flat_map(|input| {
			// `file_path` covers Read, Write and Edit; `notebook_path` is NotebookEdit's
			// name for the same thing. Both are checked because a session that only ever
			// edits notebooks is not a session we should be blind to.
			let named = ["file_path", "notebook_path"]
				.iter()
				.find_map(|key| input.get(key).and_then(|v| v.as_str()))
				.filter(|path| path.starts_with('/'));
			// `command` is `Bash`'s only input, and the one an agent driving another
			// checkout by `git -C` and `cd` leaves its evidence in.
			let commanded = input
				.get("command")
				.and_then(|v| v.as_str())
				.map(command_paths)
				.unwrap_or_default();
			named.into_iter().chain(commanded)
		})
		.collect()
}

/// Every absolute-path-shaped token in a shell command, in order.
///
/// **This is a scan, not a parse, and it does not need to be exact.** A command
/// line is not a path list — it holds redirects, `sed` expressions, globs, flags
/// and quoting, and resolving it properly would mean implementing a shell. It
/// does not have to be resolved properly, because the only consumer compares
/// every candidate against the repository's real checkouts and keeps the last
/// one that lands in a *linked* one. `/dev/null`, `/usr/bin/env` and a `sed`
/// script's slashes all resolve to no checkout and cost nothing; a stray token
/// that resolves to the main checkout is discarded by the same rule that
/// discards a config file read from there. That is why loose is safe here and
/// would not be safe if a single candidate were kept.
///
/// Two boundaries are all the precision it needs:
///
/// - A `/` starts a token only after whitespace, a quote, `=`, `,`, `:` or an
///   opening bracket — never after a word character, which is what keeps
///   `e2e/playwright.config.ts` from contributing a bogus `/playwright.config.ts`
///   and `sed -n 's/a/b/'` from contributing anything at all.
/// - A token ends at the first shell metacharacter or whitespace, so
///   `"$(cat /wt/a.ts)"` yields `/wt/a.ts` rather than `/wt/a.ts)"`.
///
/// A redirect's `>` is deliberately *not* a start boundary: `2>/dev/null` is
/// noise, and while the containment check would drop it anyway, a scan that
/// does not collect it cannot spend one of the kept slots on it.
fn command_paths(command: &str) -> Vec<&str> {
	let bytes = command.as_bytes();
	let mut out = Vec::new();
	let mut i = 0;
	while i < bytes.len() {
		if bytes[i] != b'/' || !starts_path(bytes, i) {
			i += 1;
			continue;
		}
		let start = i;
		while i < bytes.len() && !ends_path(bytes[i]) {
			i += 1;
		}
		// Trailing punctuation is sentence noise rather than part of the name — a
		// path at the end of a `&&` chain or before a comma in prose.
		let token = command[start..i].trim_end_matches([',', ':', ';', '.']);
		// `/` alone is the root, which contains everything and so distinguishes
		// nothing. A token starting `//` is a URL's authority — `https://linear.app/…`
		// splits there, because `:` *is* a start boundary (`PATH=/a:/b`) — and a
		// session that links an issue tracker would otherwise spend two of the kept
		// slots on it.
		if token.len() > 1 && !token.starts_with("//") {
			out.push(token);
		}
	}
	out
}

/// Can a `/` at `i` be the start of a path? Only at the start of the command or
/// after a character that separates words — see [`command_paths`].
fn starts_path(bytes: &[u8], i: usize) -> bool {
	if i == 0 {
		return true;
	}
	matches!(
		bytes[i - 1],
		b' ' | b'\t'
			| b'\n' | b'\r'
			| b'\'' | b'"'
			| b'`' | b'='
			| b',' | b':'
			| b'(' | b'{'
			| b'['
	)
}

/// Does a path token end at this byte? Whitespace and the shell metacharacters
/// that cannot appear in a path we would go on to compare.
fn ends_path(byte: u8) -> bool {
	matches!(
		byte,
		b' ' | b'\t'
			| b'\n' | b'\r'
			| b'\'' | b'"'
			| b'`' | b';'
			| b'|' | b'&'
			| b'<' | b'>'
			| b'$' | b'*'
			| b'?' | b'('
			| b')' | b'{'
			| b'}' | b'['
			| b']' | b'!'
			| b'=' | b'#'
			| b'\\'
	)
}

/// Title derivation per specs/02-data-model.md § "Persistence implications".
pub fn derive_title(first_user_text: Option<&str>, session_id: &str) -> String {
	if let Some(text) = first_user_text {
		let trimmed = text.trim();
		if !trimmed.is_empty() {
			let cap = trimmed.chars().take(60).collect::<String>();
			return cap;
		}
	}
	session_id.chars().take(8).collect()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn flatten_string_content() {
		let v = serde_json::json!("hello world");
		assert_eq!(flatten_message_text(&v), "hello world");
	}

	#[test]
	fn flatten_array_content() {
		let v = serde_json::json!([
			{"type": "text", "text": "first"},
			{"type": "tool_use", "name": "Read", "input": {}},
			{"type": "text", "text": "second"}
		]);
		assert_eq!(flatten_message_text(&v), "first\nsecond");
	}

	#[test]
	fn tool_use_paths_reads_the_shapes_claude_writes() {
		let v = serde_json::json!([
			{"type": "text", "text": "opening two files"},
			{"type": "tool_use", "name": "Read", "input": {"file_path": "/wt/feature-x/a.ts"}},
			{"type": "tool_use", "name": "NotebookEdit", "input": {"notebook_path": "/wt/feature-x/b.ipynb"}}
		]);
		assert_eq!(tool_use_paths(&v), vec!["/wt/feature-x/a.ts", "/wt/feature-x/b.ipynb"]);
	}

	/// Every way the guess can miss, in one place: a block that is not a
	/// `tool_use`, a tool with no path at all, and a path that is relative and so
	/// cannot be resolved against a checkout. None of them is an error, and none
	/// of them contributes.
	#[test]
	fn tool_use_paths_ignores_what_it_cannot_use() {
		let v = serde_json::json!([
			{"type": "text", "text": "thinking"},
			{"type": "tool_use", "name": "Bash", "input": {"command": "git -C ../wt status"}},
			{"type": "tool_use", "name": "Read", "input": {"file_path": "src/main.rs"}},
			{"type": "tool_result", "content": "ok"}
		]);
		assert!(tool_use_paths(&v).is_empty());
	}

	/// The shape that made the harvest read command lines at all: a session with
	/// no file-tool call in it, working in a worktree by `cd` and `git -C`.
	#[test]
	fn tool_use_paths_reads_a_shell_command() {
		let v = serde_json::json!([
			{"type": "tool_use", "name": "Bash", "input": {"command": "cd /wt/feature-x && pnpm lint"}},
			{"type": "tool_use", "name": "Bash", "input": {"command": "git -C /wt/feature-x log -1"}}
		]);
		assert_eq!(tool_use_paths(&v), vec!["/wt/feature-x", "/wt/feature-x"]);
	}

	/// Everything a loose scan of a command line must *not* turn into a path.
	/// None of it would survive the containment check either — this pins that the
	/// scan does not spend a kept slot on it in the first place.
	#[test]
	fn command_paths_skips_what_is_not_a_path() {
		assert!(command_paths("sed -n 's/foo/bar/' e2e/playwright.config.ts").is_empty());
		assert!(command_paths("pnpm test 2>/dev/null").is_empty());
		assert!(command_paths("echo a/b/c").is_empty());
		// The root contains everything and so distinguishes nothing.
		assert!(command_paths("ls /").is_empty());
		// A real one, from the session this was built from: `:` has to be a start
		// boundary for `PATH=/a:/b`, which makes a URL look like two paths.
		assert!(command_paths("gh issue view https://linear.app/x/issue/Y").is_empty());
	}

	/// The end boundary, in the two shapes that actually appear: a substitution
	/// and a quoted argument. A token that kept its trailing `)"` would match no
	/// checkout at all.
	#[test]
	fn command_paths_stops_at_shell_punctuation() {
		assert_eq!(
			command_paths(r#"cat "$(realpath /wt/feature-x/a.ts)""#),
			vec!["/wt/feature-x/a.ts"]
		);
		assert_eq!(command_paths("cd /wt/feature-x; ls"), vec!["/wt/feature-x"]);
		assert_eq!(command_paths("rg -n foo /wt/feature-x/*.ts"), vec!["/wt/feature-x/"]);
	}

	#[test]
	fn tool_use_paths_of_a_plain_string_body() {
		assert!(tool_use_paths(&serde_json::json!("just text")).is_empty());
	}

	#[test]
	fn flatten_other_shape() {
		let v = serde_json::json!({"role": "user"});
		assert_eq!(flatten_message_text(&v), "");
	}

	#[test]
	fn derive_title_from_user_text() {
		let title = derive_title(Some("Help me with this React hook"), "abc12345-rest");
		assert_eq!(title, "Help me with this React hook");
	}

	#[test]
	fn derive_title_caps_at_60_chars() {
		let long = "a".repeat(120);
		let title = derive_title(Some(&long), "abc12345-rest");
		assert_eq!(title.chars().count(), 60);
	}

	#[test]
	fn derive_title_falls_back_to_session_prefix() {
		let title = derive_title(None, "abc12345-rest");
		assert_eq!(title, "abc12345");
	}

	// Real Claude events that the strict v1 parser was rejecting.
	#[test]
	fn parses_meta_events_without_uuid_or_timestamp() {
		use crate::models::SessionEvent;

		let mode = r#"{"type":"mode","mode":"normal","sessionId":"abc"}"#;
		let parsed: SessionEvent = serde_json::from_str(mode).expect("mode event must parse");
		assert_eq!(parsed.event_type, "mode");
		assert!(parsed.uuid.is_none());
		assert!(parsed.timestamp.is_none());

		let ai_title = r#"{"type":"ai-title","aiTitle":"Build factorai","sessionId":"abc"}"#;
		let parsed: SessionEvent = serde_json::from_str(ai_title).unwrap();
		assert_eq!(parsed.extra.get("aiTitle").and_then(|v| v.as_str()), Some("Build factorai"));

		let snapshot = r#"{"type":"file-history-snapshot","isSnapshotUpdate":true,"messageId":"m1","snapshot":{}}"#;
		let parsed: SessionEvent = serde_json::from_str(snapshot).unwrap();
		assert_eq!(parsed.event_type, "file-history-snapshot");
	}

	#[test]
	fn parses_conversational_event_with_full_shape() {
		use crate::models::SessionEvent;
		let line = r#"{"type":"user","uuid":"u1","parentUuid":null,"timestamp":"2026-01-01T00:00:00Z","sessionId":"s1","cwd":"/tmp","message":{"role":"user","content":"hello"}}"#;
		let ev: SessionEvent = serde_json::from_str(line).unwrap();
		assert_eq!(ev.event_type, "user");
		assert_eq!(ev.uuid.as_deref(), Some("u1"));
		assert_eq!(ev.cwd.as_deref(), Some("/tmp"));
		assert!(ev.message.is_some());
	}
}
