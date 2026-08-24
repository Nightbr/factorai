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

/// The absolute file paths a message's `tool_use` blocks name, in order.
///
/// **This is deliberately a guess at another program's internal schema** (F21,
/// migration 0009), so every step of it is allowed to find nothing: a block that
/// is not a `tool_use`, an `input` that is not an object, a key we do not know,
/// or a relative path all yield nothing rather than an error. The schema is
/// undocumented and will change; when it does, this quietly stops contributing
/// and the two cwd signals carry the feature exactly as they did before it
/// existed.
///
/// **Relative paths are dropped rather than joined to the session's cwd.** A
/// tool's path is relative to wherever *that call* ran, which is not something
/// the transcript states, and the whole use of this value is deciding which of
/// two checkouts a path is inside. A wrong answer there is worse than no answer.
pub fn tool_use_paths(content: &serde_json::Value) -> Vec<&str> {
	let serde_json::Value::Array(blocks) = content else {
		return Vec::new();
	};
	blocks
		.iter()
		.filter(|b| b.get("type").and_then(|v| v.as_str()) == Some("tool_use"))
		.filter_map(|b| b.get("input"))
		// `file_path` covers Read, Write and Edit; `notebook_path` is NotebookEdit's
		// name for the same thing. Both are checked because a session that only ever
		// edits notebooks is not a session we should be blind to.
		.filter_map(|input| {
			["file_path", "notebook_path"]
				.iter()
				.find_map(|key| input.get(key).and_then(|v| v.as_str()))
		})
		.filter(|path| path.starts_with('/'))
		.collect()
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
