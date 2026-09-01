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
/// `title_source` is the display form of the first user message that carried
/// intent — see [`title_display`], which the indexer applies while choosing it.
/// With none, the session UUID's prefix is the last resort.
pub fn derive_title(title_source: Option<&str>, session_id: &str) -> String {
	if let Some(text) = title_source {
		let trimmed = text.trim();
		if !trimmed.is_empty() {
			return trimmed.chars().take(60).collect();
		}
	}
	session_id.chars().take(8).collect()
}

/// The title text a single user message contributes, or `None` when it carries
/// nothing to title a session by.
///
/// Claude Code wraps what the user did in marker tags, and two kinds reach the
/// first user message wanting opposite treatment:
///
/// - **Commands** are intent worth a title, shown as they were typed with the
///   sigil kept: `<bash-input>git pull</bash-input>` → `!git pull`, and
///   `<command-name>/foo</command-name>` (+ optional `<command-args>`) →
///   `/foo args`.
/// - **Context** — the local-command caveat, a `<system-reminder>`, the IDE's
///   open-file note — is machinery, not something the user said. It is stripped;
///   whatever prose is left titles the session, and a message that was nothing
///   but context yields `None` so the next user message is tried instead.
///
/// The raw text still feeds FTS unchanged. See specs/02-data-model.md
/// § "Persistence implications".
pub fn title_display(text: &str) -> Option<String> {
	if let Some(cmd) = tag_inner(text, "bash-input").map(str::trim).filter(|c| !c.is_empty()) {
		return Some(format!("!{cmd}"));
	}
	if let Some(name) = tag_inner(text, "command-name")
		.map(|n| n.trim().trim_start_matches('/'))
		.filter(|n| !n.is_empty())
	{
		let mut out = format!("/{name}");
		if let Some(args) = tag_inner(text, "command-args").map(str::trim).filter(|a| !a.is_empty())
		{
			out.push(' ');
			out.push_str(args);
		}
		return Some(out);
	}
	// Older/argless slash shapes carry only the message; keep the command, sigilled.
	if let Some(msg) = tag_inner(text, "command-message")
		.map(|m| m.trim().trim_start_matches('/'))
		.filter(|m| !m.is_empty())
	{
		return Some(format!("/{msg}"));
	}
	let stripped = strip_context_tags(text);
	let trimmed = stripped.trim();
	(!trimmed.is_empty()).then(|| trimmed.to_owned())
}

/// The context-marker blocks Claude Code injects around a user message — the
/// paired `<tag>…</tag>` shapes that are machinery rather than user intent —
/// removed, so what the user actually wrote is left to title by. A tag with no
/// closing partner is left in place rather than swallowing the rest of the text.
fn strip_context_tags(text: &str) -> String {
	const CONTEXT_TAGS: [&str; 6] = [
		"local-command-caveat",
		"local-command-stdout",
		"local-command-stderr",
		"system-reminder",
		"ide_opened_file",
		"ide_selection",
	];
	let mut out = text.to_owned();
	for tag in CONTEXT_TAGS {
		let open = format!("<{tag}>");
		let close = format!("</{tag}>");
		while let Some(start) = out.find(&open) {
			let Some(rel) = out[start + open.len()..].find(&close) else {
				break;
			};
			let end = start + open.len() + rel + close.len();
			out.replace_range(start..end, "");
		}
	}
	out
}

/// The text between the first `<tag>` and its matching `</tag>`, if both appear.
fn tag_inner<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
	let start = text.find(&format!("<{tag}>"))? + tag.len() + 2;
	let end = start + text[start..].find(&format!("</{tag}>"))?;
	Some(&text[start..end])
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

	/// The 60-char cap counts the sigil too, so a long command is still bounded.
	#[test]
	fn derive_title_caps_a_long_source() {
		let long = format!("!{}", "a".repeat(120));
		let title = derive_title(Some(&long), "id");
		assert_eq!(title.chars().count(), 60);
		assert!(title.starts_with("!a"));
	}

	/// A `!`-command is titled by its command, sigil kept, not the wrapper tag —
	/// even when the transcript trails the captured stdout/stderr in the same text.
	#[test]
	fn title_display_unwraps_bash_input() {
		assert_eq!(
			title_display("<bash-input>git pull</bash-input>").as_deref(),
			Some("!git pull")
		);
		let with_output = "<bash-input>git status</bash-input>\n<bash-stdout>clean</bash-stdout>";
		assert_eq!(title_display(with_output).as_deref(), Some("!git status"));
	}

	/// A slash command keeps its `/`, normalises to exactly one, and appends args —
	/// whichever order the `command-*` tags appear in.
	#[test]
	fn title_display_unwraps_slash_command() {
		// A name already carrying its slash keeps exactly one.
		let named = "<command-message>foo</command-message><command-name>/foo</command-name>";
		assert_eq!(title_display(named).as_deref(), Some("/foo"));

		// A bare name gets a slash added, and args follow after a space.
		let with_args = "<command-name>foo</command-name><command-args>bar baz</command-args>";
		assert_eq!(title_display(with_args).as_deref(), Some("/foo bar baz"));

		// Message-only shape still reads as a slash command.
		assert_eq!(
			title_display("<command-message>foo</command-message>").as_deref(),
			Some("/foo")
		);
	}

	/// Injected context is stripped: a note the user did not type does not title a
	/// session, and one that only wraps context contributes nothing at all.
	#[test]
	fn title_display_strips_injected_context() {
		// Prose after an IDE note titles by the prose.
		let ide = "<ide_opened_file>The user opened /path/to/file in the IDE.</ide_opened_file>\nadd a test for this";
		assert_eq!(title_display(ide).as_deref(), Some("add a test for this"));

		// A message that is only context yields nothing, so the caller tries the next.
		let caveat = "<local-command-caveat>Caveat: messages below were generated while running local commands.</local-command-caveat>";
		assert_eq!(title_display(caveat), None);
		let reminder =
			"<system-reminder>\nThe user named this session \"my session\".\n</system-reminder>";
		assert_eq!(title_display(reminder), None);
	}

	/// Plain prose that merely mentions a tag name (no closing tag) is not a
	/// wrapper and passes through untouched.
	#[test]
	fn title_display_leaves_plain_prose_alone() {
		let prose = "how should a <bash-input> tag look in the title?";
		assert_eq!(title_display(prose).as_deref(), Some(prose));
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
