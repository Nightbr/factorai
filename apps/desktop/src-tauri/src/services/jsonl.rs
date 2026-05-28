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
}
