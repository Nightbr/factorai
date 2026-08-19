//! The slice of MCP the bridge answers, over JSON-RPC 2.0 (F20, ADR-0017 § 4).
//!
//! Hand-written rather than an SDK, and ADR-0017 gives the reason: the surface
//! is `initialize`, `tools/list`, `tools/call` and two notifications, against
//! three tools. AGENTS.md § 4 already says this project hand-mirrors types
//! across a boundary and takes no code generation; an MCP SDK is the same bet
//! in a different coat. It also keeps the whole protocol readable in one file,
//! which matters for a component whose correctness is a security property.
//!
//! **`getDiagnostics` is deliberately not offered.** We have no diagnostics
//! source — that is roadmap item 14's LSP question — and a tool that always
//! answers "no problems" is not a missing feature, it is a false one the agent
//! will act on. Silence is honest; a confident empty answer is not.
//!
//! **Nothing here writes.** `openDiff` and the accept/reject-hunk surface are
//! the write path, and they are a separate decision with a separate ADR
//! (ADR-0017 § 6). ADR-0009's "everything is read-only" stands untouched.

use std::path::PathBuf;
use std::sync::Arc;

use serde::Deserialize;
use serde_json::{json, Value};
use tracing::{debug, warn};

use super::scope::resolve_within;

/// JSON-RPC's own codes. Tool *failures* do not use these — see
/// [`tool_error`] for why.
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;

/// What the agent asked us to show, once its arguments have been checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenFileRequest {
	/// Absolute, canonicalised, and proven to be inside the session's project.
	pub path: PathBuf,
	/// 1-based, from `startLine`. The viewer's `&line=` takes it directly.
	pub line: Option<u32>,
	/// `makeFrontmost: false` is the agent saying "you don't have to interrupt
	/// anyone for this". It lines up with the rule F20 needed anyway — a
	/// background session marks its tab instead of seizing the window — so the
	/// protocol and our own policy agree rather than fight.
	pub make_frontmost: bool,
}

/// Show a file. Returns false when the UI declined — a session nobody is
/// looking at, for instance — which is reported to the agent as success with a
/// different message, because it asked us to surface a file and we did, at the
/// level the human can act on.
pub type OpenFile = Arc<dyn Fn(OpenFileRequest) -> bool + Send + Sync>;

/// Absolute paths the human currently has open, for `getOpenEditors`.
pub type OpenEditors = Arc<dyn Fn() -> Vec<String> + Send + Sync>;

/// One session's view of the protocol.
pub struct Mcp {
	workspace_root: PathBuf,
	open_file: OpenFile,
	open_editors: OpenEditors,
}

impl Mcp {
	pub fn new(workspace_root: PathBuf, open_file: OpenFile, open_editors: OpenEditors) -> Self {
		Self { workspace_root, open_file, open_editors }
	}

	/// Answer one message. `None` for a notification, which by definition is
	/// not answered, and for anything we cannot parse — replying to a frame we
	/// did not understand is worse than silence, because a malformed `id` makes
	/// the reply unroutable anyway.
	pub fn handle(&self, text: &str) -> Option<String> {
		let incoming: Incoming = match serde_json::from_str(text) {
			Ok(v) => v,
			Err(e) => {
				debug!(error = %e, "ide bridge could not parse a frame");
				return None;
			}
		};

		let params = incoming.params.unwrap_or(Value::Null);
		let Some(id) = incoming.id else {
			self.notification(&incoming.method, params);
			return None;
		};

		let result = match incoming.method.as_str() {
			"initialize" => Ok(self.initialize(&params)),
			"tools/list" => Ok(tools_list()),
			"tools/call" => self.tools_call(&params),
			other => {
				debug!(method = other, "ide bridge was asked for a method it does not have");
				Err(Failure::rpc(METHOD_NOT_FOUND, format!("no such method: {other}")))
			}
		};

		Some(match result {
			Ok(value) => encode(json!({ "jsonrpc": "2.0", "id": id, "result": value })),
			Err(f) => encode(
				json!({ "jsonrpc": "2.0", "id": id, "error": { "code": f.code, "message": f.message } }),
			),
		})
	}

	fn notification(&self, method: &str, params: Value) {
		match method {
			// The CLI's hello, carrying its own pid. Nothing to do with it yet;
			// logged because "did it actually connect" is the first question
			// anyone debugging this will have.
			"ide_connected" => {
				debug!(pid = ?params.get("pid"), "claude connected to the ide bridge");
			}
			"notifications/initialized" => debug!("ide bridge initialised"),
			other => debug!(method = other, "ide bridge ignored a notification"),
		}
	}

	/// **The client's protocol version is echoed back.**
	///
	/// Our surface is three tools and no resources, prompts or sampling, and
	/// none of that has changed shape across MCP revisions — so the honest
	/// answer to "can you speak this" is yes. Echoing avoids pinning a version
	/// list we would then have to chase; the conformance pass against a real CLI
	/// is what would catch it if that ever stops being true.
	fn initialize(&self, params: &Value) -> Value {
		let version = params
			.get("protocolVersion")
			.and_then(Value::as_str)
			.unwrap_or("2025-06-18")
			.to_string();
		json!({
			"protocolVersion": version,
			"capabilities": { "tools": { "listChanged": false } },
			"serverInfo": {
				"name": super::lockfile::IDE_NAME,
				"version": env!("CARGO_PKG_VERSION"),
			},
		})
	}

	fn tools_call(&self, params: &Value) -> Result<Value, Failure> {
		let name = params
			.get("name")
			.and_then(Value::as_str)
			.ok_or_else(|| Failure::rpc(INVALID_PARAMS, "tools/call needs a name"))?;
		let args = params.get("arguments").cloned().unwrap_or(Value::Null);

		match name {
			"openFile" => Ok(self.open_file(&args)),
			"getWorkspaceFolders" => Ok(tool_text(
				&json!({ "folders": [self.workspace_root.to_string_lossy()] }).to_string(),
			)),
			"getOpenEditors" => {
				Ok(tool_text(&json!({ "editors": (self.open_editors)() }).to_string()))
			}
			other => Err(Failure::rpc(METHOD_NOT_FOUND, format!("no such tool: {other}"))),
		}
	}

	fn open_file(&self, args: &Value) -> Value {
		let Some(requested) = args.get("filePath").and_then(Value::as_str) else {
			return tool_error("openFile needs a filePath");
		};

		// The boundary. Everything else in this function is bookkeeping.
		let path = match resolve_within(&self.workspace_root, requested) {
			Ok(p) => p,
			Err(e) => {
				warn!(requested, error = %e, "ide bridge refused a path outside the project");
				return tool_error(&format!("{e}"));
			}
		};
		if !path.is_file() {
			return tool_error(&format!("no such file: {}", path.display()));
		}

		// `startText`/`endText` are the protocol's other way to name a
		// selection: anchors to search the file for. Ignored for now — that is a
		// second resolution strategy with its own not-found case — but logged, so
		// we learn whether the agent actually sends them before building it.
		if args.get("startText").is_some() || args.get("endText").is_some() {
			debug!("ide bridge ignored startText/endText on openFile");
		}

		let request = OpenFileRequest {
			path: path.clone(),
			line: args.get("startLine").and_then(Value::as_u64).and_then(|n| u32::try_from(n).ok()),
			// Absent means yes, matching every editor that implements this.
			make_frontmost: args.get("makeFrontmost").and_then(Value::as_bool).unwrap_or(true),
		};

		if (self.open_file)(request) {
			tool_text(&format!("Opened {}", path.display()))
		} else {
			// Not an error. The human is looking at a different session, so the
			// file is flagged where they will see it rather than thrown over what
			// they are doing. The agent's ask was honoured at the level that
			// keeps a human in the loop, and saying otherwise would invite it to
			// retry.
			tool_text(&format!("Marked {} for review in its session", path.display()))
		}
	}
}

/// The three we answer. `getDiagnostics` is absent on purpose — see the module
/// comment; it is the one omission here that is a decision rather than a gap.
fn tools_list() -> Value {
	json!({
		"tools": [
			{
				"name": "openFile",
				"description": "Open a file in the factorai viewer, optionally at a line.",
				"inputSchema": {
					"type": "object",
					"properties": {
						"filePath": {
							"type": "string",
							"description": "Absolute path, inside the session's project.",
						},
						"startLine": { "type": "number", "description": "1-based line to reveal." },
						"endLine": { "type": "number" },
						"makeFrontmost": {
							"type": "boolean",
							"description": "False asks not to interrupt the human.",
						},
					},
					"required": ["filePath"],
				},
			},
			{
				"name": "getWorkspaceFolders",
				"description": "The project folders this session is open on.",
				"inputSchema": { "type": "object", "properties": {} },
			},
			{
				"name": "getOpenEditors",
				"description": "Files the human currently has open in factorai.",
				"inputSchema": { "type": "object", "properties": {} },
			},
		]
	})
}

/// A successful `tools/call` result. MCP wraps every answer in content blocks
/// rather than returning a bare value.
fn tool_text(text: &str) -> Value {
	json!({ "content": [{ "type": "text", "text": text }] })
}

/// A tool that ran and failed.
///
/// **Not a JSON-RPC error.** Those mean "this call was malformed"; this means
/// "your call was fine and the answer is no". MCP draws that line so a model can
/// read the failure and react, and collapsing the two would turn "that file is
/// outside the project" into a transport fault the agent cannot learn from.
fn tool_error(message: &str) -> Value {
	json!({ "content": [{ "type": "text", "text": message }], "isError": true })
}

struct Failure {
	code: i64,
	message: String,
}

impl Failure {
	fn rpc(code: i64, message: impl Into<String>) -> Self {
		Self { code, message: message.into() }
	}
}

fn encode(value: Value) -> String {
	// A response we cannot serialise is a bug in the shapes above, not a
	// runtime condition — but a panic here would take a session's bridge down,
	// so it degrades to a parse error the client can report.
	serde_json::to_string(&value).unwrap_or_else(|_| {
		r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"internal error"}}"#
			.to_string()
	})
}

#[derive(Deserialize)]
struct Incoming {
	/// Absent for a notification. Kept as a `Value` because JSON-RPC allows a
	/// string or a number and it is only ever echoed back.
	#[serde(default)]
	id: Option<Value>,
	method: String,
	#[serde(default)]
	params: Option<Value>,
}

#[cfg(test)]
mod tests {
	use std::sync::Arc;

	use parking_lot::Mutex;
	use tempfile::TempDir;

	use super::*;

	struct Fixture {
		project: TempDir,
		mcp: Mcp,
		opened: Arc<Mutex<Vec<OpenFileRequest>>>,
	}

	fn fixture(accepts: bool) -> Fixture {
		let project = TempDir::new().unwrap();
		let opened = Arc::new(Mutex::new(Vec::new()));
		let sink = opened.clone();
		let mcp = Mcp::new(
			project.path().to_path_buf(),
			Arc::new(move |req| {
				sink.lock().push(req);
				accepts
			}),
			Arc::new(|| vec!["/p/open.rs".to_string()]),
		);
		Fixture { project, mcp, opened }
	}

	fn call(mcp: &Mcp, method: &str, params: Value) -> Value {
		let body = json!({ "jsonrpc": "2.0", "id": 7, "method": method, "params": params });
		let reply = mcp.handle(&body.to_string()).expect("a request is answered");
		serde_json::from_str(&reply).unwrap()
	}

	/// The text of a `tools/call` result, and whether it was a tool failure.
	fn tool_result(value: &Value) -> (String, bool) {
		let result = &value["result"];
		(
			result["content"][0]["text"].as_str().unwrap_or_default().to_string(),
			result["isError"].as_bool().unwrap_or(false),
		)
	}

	#[test]
	fn initialize_echoes_the_version_and_names_us() {
		let f = fixture(true);
		let reply = call(&f.mcp, "initialize", json!({ "protocolVersion": "2025-06-18" }));

		assert_eq!(reply["result"]["protocolVersion"], "2025-06-18");
		assert_eq!(reply["result"]["serverInfo"]["name"], "factorai");
		assert!(reply["result"]["capabilities"]["tools"].is_object());
	}

	#[test]
	fn a_notification_is_not_answered() {
		let f = fixture(true);
		// No `id` — the defining property of a notification.
		assert!(f
			.mcp
			.handle(r#"{"jsonrpc":"2.0","method":"ide_connected","params":{"pid":42}}"#)
			.is_none());
		assert!(f
			.mcp
			.handle(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#)
			.is_none());
	}

	#[test]
	fn a_frame_we_cannot_parse_gets_silence_rather_than_a_guess() {
		let f = fixture(true);
		assert!(f.mcp.handle("not json at all").is_none());
		assert!(f.mcp.handle("{}").is_none(), "no method means nothing to answer");
	}

	#[test]
	fn tools_list_offers_three_and_deliberately_not_getdiagnostics() {
		let f = fixture(true);
		let reply = call(&f.mcp, "tools/list", Value::Null);
		let names: Vec<&str> = reply["result"]["tools"]
			.as_array()
			.unwrap()
			.iter()
			.map(|t| t["name"].as_str().unwrap())
			.collect();

		assert_eq!(names, ["openFile", "getWorkspaceFolders", "getOpenEditors"]);
		// The omission is a decision, so it gets an assertion. Answering "no
		// problems" with no diagnostics source is a lie the agent would act on.
		assert!(!names.contains(&"getDiagnostics"));
		// The write path is a separate ADR and must not appear by accident.
		assert!(!names.contains(&"openDiff"));
	}

	#[test]
	fn openfile_resolves_a_project_file_and_hands_it_to_the_ui() {
		let f = fixture(true);
		let file = f.project.path().join("src/main.rs");
		std::fs::create_dir_all(file.parent().unwrap()).unwrap();
		std::fs::write(&file, "").unwrap();

		let reply = call(
			&f.mcp,
			"tools/call",
			json!({
				"name": "openFile",
				"arguments": { "filePath": file.to_str().unwrap(), "startLine": 42 },
			}),
		);

		let (text, is_error) = tool_result(&reply);
		assert!(!is_error, "{text}");
		assert!(text.starts_with("Opened "));

		let opened = f.opened.lock();
		assert_eq!(opened.len(), 1);
		assert_eq!(opened[0].line, Some(42));
		assert!(opened[0].make_frontmost, "absent makeFrontmost means yes");
		assert_eq!(opened[0].path, file.canonicalize().unwrap());
	}

	#[test]
	fn openfile_outside_the_project_is_refused_and_never_reaches_the_ui() {
		let f = fixture(true);
		let reply = call(
			&f.mcp,
			"tools/call",
			json!({ "name": "openFile", "arguments": { "filePath": "/etc/passwd" } }),
		);

		let (text, is_error) = tool_result(&reply);
		assert!(is_error);
		assert!(text.contains("outside the project"), "{text}");
		assert!(f.opened.lock().is_empty(), "the boundary holds before the callback");
	}

	#[test]
	fn a_refusal_is_a_tool_error_not_a_transport_error() {
		// The distinction MCP draws: the call was well-formed and the answer is
		// no, which a model can read and react to. A JSON-RPC error would look
		// like a broken connection instead.
		let f = fixture(true);
		let reply = call(
			&f.mcp,
			"tools/call",
			json!({ "name": "openFile", "arguments": { "filePath": "/etc/passwd" } }),
		);
		assert!(reply.get("error").is_none());
		assert!(reply["result"]["isError"].as_bool().unwrap());
	}

	#[test]
	fn openfile_on_a_missing_file_says_so() {
		let f = fixture(true);
		let ghost = f.project.path().join("ghost.rs");
		let reply = call(
			&f.mcp,
			"tools/call",
			json!({ "name": "openFile", "arguments": { "filePath": ghost.to_str().unwrap() } }),
		);

		let (text, is_error) = tool_result(&reply);
		assert!(is_error);
		assert!(text.contains("no such file"), "{text}");
	}

	#[test]
	fn a_background_session_reports_success_with_a_different_answer() {
		// The UI declined to steal the viewport. That is not a failure: the file
		// was surfaced where the human will see it, and telling the agent
		// otherwise invites a retry that would be no more welcome.
		let f = fixture(false);
		let file = f.project.path().join("a.rs");
		std::fs::write(&file, "").unwrap();

		let reply = call(
			&f.mcp,
			"tools/call",
			json!({ "name": "openFile", "arguments": { "filePath": file.to_str().unwrap() } }),
		);

		let (text, is_error) = tool_result(&reply);
		assert!(!is_error);
		assert!(text.starts_with("Marked "), "{text}");
	}

	#[test]
	fn makefrontmost_false_is_carried_through_rather_than_ignored() {
		let f = fixture(true);
		let file = f.project.path().join("a.rs");
		std::fs::write(&file, "").unwrap();

		call(
			&f.mcp,
			"tools/call",
			json!({
				"name": "openFile",
				"arguments": { "filePath": file.to_str().unwrap(), "makeFrontmost": false },
			}),
		);

		assert!(!f.opened.lock()[0].make_frontmost);
	}

	#[test]
	fn getworkspacefolders_answers_this_sessions_project() {
		let f = fixture(true);
		let reply = call(&f.mcp, "tools/call", json!({ "name": "getWorkspaceFolders" }));

		let (text, _) = tool_result(&reply);
		assert!(text.contains(f.project.path().to_str().unwrap()), "{text}");
	}

	#[test]
	fn getopeneditors_reports_what_the_human_has_open() {
		let f = fixture(true);
		let reply = call(&f.mcp, "tools/call", json!({ "name": "getOpenEditors" }));

		let (text, _) = tool_result(&reply);
		assert!(text.contains("/p/open.rs"), "{text}");
	}

	#[test]
	fn an_unknown_method_and_an_unknown_tool_are_both_rpc_errors() {
		let f = fixture(true);

		let reply = call(&f.mcp, "openDiff", Value::Null);
		assert_eq!(reply["error"]["code"], METHOD_NOT_FOUND);

		let reply = call(&f.mcp, "tools/call", json!({ "name": "openDiff" }));
		assert_eq!(reply["error"]["code"], METHOD_NOT_FOUND);
	}

	#[test]
	fn the_id_comes_back_exactly_as_it_was_sent() {
		// JSON-RPC allows a string or a number, and a reply the client cannot
		// route is a reply it will wait out.
		let f = fixture(true);
		let reply: Value = serde_json::from_str(
			&f.mcp.handle(r#"{"jsonrpc":"2.0","id":"abc-1","method":"tools/list"}"#).unwrap(),
		)
		.unwrap();
		assert_eq!(reply["id"], "abc-1");
	}
}
