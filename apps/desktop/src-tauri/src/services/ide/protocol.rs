//! The slice of MCP the bridge answers, over JSON-RPC 2.0 (F20, ADR-0017 § 4).
//!
//! Hand-written rather than an SDK, and ADR-0017 gives the reason: the surface
//! is `initialize`, `tools/list`, `tools/call` and two notifications, against
//! three tools. This project hand-mirrors types across a boundary and takes no
//! code generation; an MCP SDK is the same bet in a different coat. It also keeps the whole protocol readable in one file,
//! which matters for a component whose correctness is a security property.
//!
//! **`getDiagnostics` is deliberately not offered.** We have no diagnostics
//! source — that is roadmap item 14's LSP question — and a tool that always
//! answers "no problems" is not a missing feature, it is a false one the agent
//! will act on. Silence is honest; a confident empty answer is not.
//!
//! **Nothing here writes to the working tree.** `openDiff` and the
//! accept/reject-hunk surface are that path, and they remain a separate
//! decision with a separate ADR (ADR-0017 § 6). ADR-0009's "everything is
//! read-only" is about a git repository and stands untouched. `setWorktree`
//! does write to our **own** database, which is a different boundary; what
//! holds it is not the token — that authenticates a process on this machine,
//! which is a weaker claim than it looks — but the git-derived scope.
//!
//! **Every tool here is called by the CLI, never by the model** (ADR-0029). The
//! CLI registers whatever it discovers in `~/.claude/ide/` under the hardcoded
//! key `ide`, then filters that server's tools down to `executeCode` and
//! `getDiagnostics` before offering any of them to the model. So this is not the
//! place for a tool you want an agent to call: that is
//! [`crate::services::agent_tools`], a plain MCP server under a plain name for
//! exactly this reason.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Deserialize;
use serde_json::{json, Value};
use tracing::{debug, warn};

use super::scope::{containing_root, resolve_within_any};
use crate::services::mcp_wire::{
	self, tool_error, tool_text, Failure, Incoming, INVALID_PARAMS, METHOD_NOT_FOUND,
};

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

/// What this session's bridge knows about its repository's checkouts (F21).
///
/// Three closures rather than three values, because all three change while the
/// session runs: the agent can create a worktree, and the panel can be moved by
/// a signal that arrived a moment ago.
pub struct Worktrees {
	/// Every checkout of this session's repository, **re-derived from git on
	/// every call**. This is the path scope, and ADR-0019 § 2 is why it can never
	/// be anything the client supplied.
	pub checkouts: Arc<dyn Fn() -> Vec<PathBuf> + Send + Sync>,
	/// Record that the agent is working in this checkout — persist it and tell
	/// the renderer. Already validated by the caller: this is the write, not the
	/// decision.
	pub signal: Arc<dyn Fn(&Path) + Send + Sync>,
	/// The checkout the panel is showing for this session, when it is not simply
	/// the session's own cwd. Reported by `getWorkspaceFolders` as a second,
	/// labelled line — never as *the* answer, because the PTY's cwd has not moved
	/// and an agent told otherwise will edit the wrong tree.
	pub current: Arc<dyn Fn() -> Option<PathBuf> + Send + Sync>,
}

/// A file — or a run of lines in one — the human is handing to the agent (F20).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mention {
	pub path: String,
	/// **1-based and inclusive — what the human selected**, which is also what
	/// the viewer's label shows them. The wire wants something else; see
	/// [`at_mentioned`], which is the one place that converts.
	pub line_start: Option<u32>,
	pub line_end: Option<u32>,
}

/// The `at_mentioned` notification for one mention, ready to send.
///
/// Built here rather than in the command so the wire shape lives with the rest
/// of the protocol, and so it can be asserted without a socket.
///
/// **The wire is 0-based, and this is the only place that knows it.** The CLI
/// adds one before printing, so sending the numbers the human selected renders
/// a range one line further down the file than the one they highlighted.
///
/// That was shipped wrong once and found by watching it: a selection the
/// viewer labelled "lines 10–13" arrived as `@biome.json#L11-14`, twice, with
/// different ranges each time. The earlier belief that this field was 1-based
/// came from reading a renderer in the binary that turns out to sit on the
/// far side of the conversion — which is why the fix is pinned by a test that
/// states the observation rather than the inference.
fn to_wire_line(line: u32) -> u32 {
	line.saturating_sub(1)
}

pub fn at_mentioned(path: &Path, mention: &Mention) -> String {
	let mut params = json!({ "filePath": path.to_string_lossy() });
	// Both or neither: the CLI tests them together, and half a range would
	// render as a whole-file mention while looking like it carried a selection.
	if let (Some(start), Some(end)) = (mention.line_start, mention.line_end) {
		params["lineStart"] = json!(to_wire_line(start));
		params["lineEnd"] = json!(to_wire_line(end));
	}
	mcp_wire::encode(json!({ "jsonrpc": "2.0", "method": "at_mentioned", "params": params }))
}

/// One session's view of the protocol.
pub struct Mcp {
	/// Where this session's PTY is actually running. Always in scope, and always
	/// the first thing `getWorkspaceFolders` reports — it is the honest answer to
	/// "where am I", whatever the panel is showing.
	session_cwd: PathBuf,
	worktrees: Worktrees,
	open_file: OpenFile,
	open_editors: OpenEditors,
}

impl Mcp {
	pub fn new(
		session_cwd: PathBuf,
		worktrees: Worktrees,
		open_file: OpenFile,
		open_editors: OpenEditors,
	) -> Self {
		Self { session_cwd, worktrees, open_file, open_editors }
	}

	/// The path scope: the session's cwd, plus every checkout of its repository.
	///
	/// **The cwd is in the set unconditionally**, and that is not belt-and-braces.
	/// A project that is not a repository has no checkouts at all, so without it
	/// the scope would be empty and every `openFile` would be refused — F20,
	/// broken for exactly the projects this feature has nothing to do with.
	fn scope(&self) -> Vec<PathBuf> {
		let mut roots = vec![self.session_cwd.clone()];
		roots.extend((self.worktrees.checkouts)());
		roots
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
			// No `instructions`: everything this server offers is called by the
			// CLI rather than the model, so there is nothing a session needs
			// told about it (ADR-0029).
			"initialize" => {
				Ok(mcp_wire::initialize_result(&params, super::lockfile::IDE_NAME, None))
			}
			"tools/list" => Ok(tools_list()),
			"tools/call" => self.tools_call(&params),
			other => {
				debug!(method = other, "ide bridge was asked for a method it does not have");
				Err(Failure::rpc(METHOD_NOT_FOUND, format!("no such method: {other}")))
			}
		};

		Some(mcp_wire::reply(id, result))
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

	fn tools_call(&self, params: &Value) -> Result<Value, Failure> {
		let name = params
			.get("name")
			.and_then(Value::as_str)
			.ok_or_else(|| Failure::rpc(INVALID_PARAMS, "tools/call needs a name"))?;
		let args = params.get("arguments").cloned().unwrap_or(Value::Null);

		match name {
			"openFile" => Ok(self.open_file(&args)),
			"getWorkspaceFolders" => Ok(self.workspace_folders()),
			"setWorktree" => Ok(self.set_worktree(&args)),
			"getOpenEditors" => {
				Ok(tool_text(&json!({ "editors": (self.open_editors)() }).to_string()))
			}
			other => Err(Failure::rpc(METHOD_NOT_FOUND, format!("no such tool: {other}"))),
		}
	}

	/// Where this session is, and what the human is looking at — as two separate
	/// facts (F21).
	///
	/// **`cwd` first and `viewing` labelled second, never merged.** The panel can
	/// be showing another checkout while the PTY's cwd has not moved; an agent
	/// told that the *view* is its workspace would run `git` in one tree and edit
	/// another. `folders` keeps its old shape and its old meaning so an agent that
	/// only reads that key sees no change.
	///
	/// It is also where the concept is advertised: this is the tool `claude` calls
	/// early, so listing the checkouts here is how an agent discovers there is a
	/// `setWorktree` worth calling.
	fn workspace_folders(&self) -> Value {
		let cwd = self.session_cwd.to_string_lossy().to_string();
		let checkouts: Vec<String> =
			(self.worktrees.checkouts)().iter().map(|p| p.to_string_lossy().to_string()).collect();
		let viewing = (self.worktrees.current)().map(|p| p.to_string_lossy().to_string());
		tool_text(
			&json!({
				"folders": [cwd.clone()],
				"cwd": cwd,
				"worktrees": checkouts,
				"viewing": viewing,
				"hint": "Call setWorktree when you start working in a different git \
						 worktree, so factorai's file tree and changes follow you.",
			})
			.to_string(),
		)
	}

	/// The agent telling us which checkout it is working in (F21).
	///
	/// **Validated against git, not against the string.** The path has to be — or
	/// be inside — a checkout `services::git` enumerated for this repository.
	/// Being liberal about "inside" costs nothing, because the containment set is
	/// git-derived: an agent that sends a file path gets the checkout that holds
	/// it, and an agent that sends `/etc` gets a refusal.
	///
	/// A refusal is a **tool error**, not a JSON-RPC error: the call was
	/// well-formed and the answer is no.
	///
	/// This moves what the panel *shows* and nothing else. It does not widen the
	/// scope — the scope was already every checkout of this repository — which is
	/// what keeps the validator a UX check rather than a security boundary
	/// (ADR-0019 § 2).
	fn set_worktree(&self, args: &Value) -> Value {
		let Some(requested) = args.get("path").and_then(Value::as_str) else {
			return tool_error("setWorktree needs a path");
		};
		let checkouts = (self.worktrees.checkouts)();
		if checkouts.is_empty() {
			return tool_error("this session's project is not in a git repository");
		}
		// Resolved against the checkouts alone — deliberately *not* `scope()`. The
		// session's cwd is in scope so files can be opened there, but a cwd that
		// is not itself a checkout is not somewhere the panel can be rooted.
		let resolved = match resolve_within_any(&checkouts, requested) {
			Ok(p) => p,
			Err(_) => {
				warn!(requested, "ide bridge refused a setWorktree outside the repository");
				return tool_error(&format!(
					"{requested} is not a worktree of this repository. Known worktrees: {}",
					checkouts.iter().map(|p| p.to_string_lossy()).collect::<Vec<_>>().join(", ")
				));
			}
		};
		let Some(checkout) = containing_root(&checkouts, &resolved) else {
			return tool_error(&format!("{requested} is not a worktree of this repository"));
		};
		if !checkout.is_dir() {
			return tool_error(&format!("{} is registered but not on disk", checkout.display()));
		}

		(self.worktrees.signal)(&checkout);
		tool_text(&format!("factorai is now showing {}", checkout.display()))
	}

	fn open_file(&self, args: &Value) -> Value {
		let Some(requested) = args.get("filePath").and_then(Value::as_str) else {
			return tool_error("openFile needs a filePath");
		};

		// The boundary. Everything else in this function is bookkeeping.
		let path = match resolve_within_any(&self.scope(), requested) {
			Ok(p) => p,
			Err(e) => {
				warn!(requested, error = %e, "ide bridge refused a path outside the project");
				return tool_error(&format!("{e}"));
			}
		};
		if !path.is_file() {
			return tool_error(&format!("no such file: {}", path.display()));
		}

		// **The path is itself a signal** (F21). An agent opening a file in a
		// checkout is telling us where it works, and it costs nothing to listen —
		// which matters because F20's conformance pass records that a tool call
		// from the real CLI is still unobserved, so this is the half that works
		// with zero uptake of `setWorktree`.
		if let Some(checkout) = containing_root(&(self.worktrees.checkouts)(), &path) {
			(self.worktrees.signal)(&checkout);
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
			// **Not shown, and said plainly.** The human is looking at a different
			// session, and factorai has nowhere to put the request yet — the tab
			// mark this used to claim was removed for colliding with the session
			// status dot. Reporting "marked" while nothing is marked is the same
			// confident falsehood `getDiagnostics` is kept out of the tool list to
			// avoid, so this says what actually happened and lets the agent decide
			// whether to mention it.
			tool_text(&format!(
				"Not shown: {} belongs to a session the human is not currently viewing.",
				path.display()
			))
		}
	}
}

/// The four we answer. `getDiagnostics` is absent on purpose — see the module
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
			// **Advertised unconditionally, even for a repository with one
			// checkout** (F21). `tools/list` is fetched once at connect, so gating
			// this on "more than one worktree exists" would leave the agent holding
			// a list without the tool at the exact moment it creates the second one.
			{
				"name": "setWorktree",
				"description": "Tell factorai which git worktree you are working in, so its \
								file tree, changes and git graph follow you. Call this after \
								creating a worktree with `git worktree add`, or whenever you \
								start editing files in a different checkout of this \
								repository. Call getWorkspaceFolders to see the checkouts \
								that exist.",
				"inputSchema": {
					"type": "object",
					"properties": {
						"path": {
							"type": "string",
							"description": "Absolute path of the worktree — or of any file \
											inside it. Must be a checkout of this session's \
											repository.",
						},
					},
					"required": ["path"],
				},
			},
		]
	})
}

#[cfg(test)]
mod tests {
	use std::sync::Arc;

	use parking_lot::Mutex;
	use std::fs;
	use tempfile::TempDir;

	use super::*;

	struct Fixture {
		project: TempDir,
		mcp: Mcp,
		opened: Arc<Mutex<Vec<OpenFileRequest>>>,
		/// Every checkout the bridge was told the agent is working in (F21).
		signalled: Arc<Mutex<Vec<PathBuf>>>,
	}

	fn fixture(accepts: bool) -> Fixture {
		fixture_with_checkouts(accepts, Vec::new())
	}

	/// `checkouts` stands in for `services::git::worktree_paths` — the git-derived
	/// set. Empty is the ordinary case: a project that is not a repository, where
	/// nothing about F21 applies and F20 has to keep working unchanged.
	fn fixture_with_checkouts(accepts: bool, checkouts: Vec<PathBuf>) -> Fixture {
		let project = TempDir::new().unwrap();
		let opened = Arc::new(Mutex::new(Vec::new()));
		let signalled: Arc<Mutex<Vec<PathBuf>>> = Arc::new(Mutex::new(Vec::new()));
		let sink = opened.clone();
		let signal_sink = signalled.clone();
		let mcp = Mcp::new(
			project.path().to_path_buf(),
			Worktrees {
				checkouts: Arc::new(move || checkouts.clone()),
				signal: Arc::new(move |p| signal_sink.lock().push(p.to_path_buf())),
				current: Arc::new(|| None),
			},
			Arc::new(move |req| {
				sink.lock().push(req);
				accepts
			}),
			Arc::new(|| vec!["/p/open.rs".to_string()]),
		);
		Fixture { project, mcp, opened, signalled }
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

	// ── Worktrees (F21, ADR-0019 § 2) ────────────────────────────────────────

	/// A checkout with one file in it, standing in for a linked worktree.
	fn checkout(name: &str) -> (TempDir, PathBuf) {
		let dir = TempDir::new().unwrap();
		let root = dir.path().join(name);
		fs::create_dir_all(&root).unwrap();
		fs::write(root.join("a.rs"), "fn main() {}").unwrap();
		(dir, root)
	}

	#[test]
	fn openfile_reaches_a_sibling_checkout_of_the_same_repository() {
		// The live bug this closes: today the scope is the project folder alone, so
		// an agent editing in a worktree cannot open a single file (F20's `Bridge`
		// warning) — every request refused.
		let (_home, wt) = checkout("feature-x");
		let f = fixture_with_checkouts(true, vec![wt.clone()]);
		let reply = call(
			&f.mcp,
			"tools/call",
			json!({ "name": "openFile",
			        "arguments": { "filePath": wt.join("a.rs").to_string_lossy() } }),
		);

		let (text, is_error) = tool_result(&reply);
		assert!(!is_error, "{text}");
		assert_eq!(f.opened.lock().len(), 1);
	}

	#[test]
	fn openfile_still_refuses_a_directory_that_is_not_a_checkout() {
		// The boundary did not move for anything git does not call a checkout of
		// this repository. A sibling *directory* is not a sibling *worktree*.
		let (home, wt) = checkout("feature-x");
		let stranger = home.path().join("not-a-worktree");
		fs::create_dir_all(&stranger).unwrap();
		fs::write(stranger.join("secret.txt"), "x").unwrap();

		let f = fixture_with_checkouts(true, vec![wt]);
		let reply = call(
			&f.mcp,
			"tools/call",
			json!({ "name": "openFile",
			        "arguments": { "filePath": stranger.join("secret.txt").to_string_lossy() } }),
		);

		let (text, is_error) = tool_result(&reply);
		assert!(is_error, "{text}");
		assert!(f.opened.lock().is_empty());
	}

	#[test]
	fn openfile_in_a_checkout_signals_it() {
		// The half that works with zero uptake of `setWorktree`: the agent is
		// already sending absolute paths, and a path in a checkout is it telling
		// us where it works.
		let (_home, wt) = checkout("feature-x");
		let f = fixture_with_checkouts(true, vec![wt.clone()]);
		call(
			&f.mcp,
			"tools/call",
			json!({ "name": "openFile",
			        "arguments": { "filePath": wt.join("a.rs").to_string_lossy() } }),
		);

		assert_eq!(f.signalled.lock().as_slice(), [wt.canonicalize().unwrap()]);
	}

	#[test]
	fn openfile_in_a_project_with_no_checkouts_signals_nothing() {
		// A project that is not a repository. F20 must behave exactly as it did.
		let f = fixture(true);
		let file = f.project.path().join("a.rs");
		fs::write(&file, "x").unwrap();
		let reply = call(
			&f.mcp,
			"tools/call",
			json!({ "name": "openFile", "arguments": { "filePath": file.to_string_lossy() } }),
		);

		let (text, is_error) = tool_result(&reply);
		assert!(!is_error, "{text}");
		assert!(f.signalled.lock().is_empty(), "nothing to signal, so nothing signalled");
	}

	#[test]
	fn setworktree_accepts_a_checkout_and_a_path_inside_one() {
		let (_home, wt) = checkout("feature-x");
		let f = fixture_with_checkouts(true, vec![wt.clone()]);

		let reply = call(
			&f.mcp,
			"tools/call",
			json!({ "name": "setWorktree", "arguments": { "path": wt.to_string_lossy() } }),
		);
		let (text, is_error) = tool_result(&reply);
		assert!(!is_error, "{text}");

		// Liberal about "inside" on purpose: it costs nothing, because the
		// containment set is git-derived rather than client-supplied.
		call(
			&f.mcp,
			"tools/call",
			json!({ "name": "setWorktree",
			        "arguments": { "path": wt.join("a.rs").to_string_lossy() } }),
		);

		let signalled = f.signalled.lock();
		assert_eq!(signalled.len(), 2);
		assert!(signalled.iter().all(|p| *p == wt.canonicalize().unwrap()));
	}

	#[test]
	fn setworktree_refuses_anything_git_does_not_call_a_checkout() {
		let (_home, wt) = checkout("feature-x");
		let f = fixture_with_checkouts(true, vec![wt]);
		let reply = call(
			&f.mcp,
			"tools/call",
			json!({ "name": "setWorktree", "arguments": { "path": "/etc" } }),
		);

		let (text, is_error) = tool_result(&reply);
		assert!(is_error);
		assert!(text.contains("not a worktree"), "{text}");
		// And the refusal names what *is* known, so the agent can retry usefully
		// rather than guess again.
		assert!(text.contains("feature-x"), "{text}");
		assert!(f.signalled.lock().is_empty());
	}

	#[test]
	fn setworktree_refuses_the_session_cwd_when_it_is_not_itself_a_checkout() {
		// The cwd is in scope so files can be opened there. That does not make it
		// somewhere the panel can be rooted — `set_worktree` resolves against the
		// checkouts alone, deliberately not `scope()`.
		let (_home, wt) = checkout("feature-x");
		let f = fixture_with_checkouts(true, vec![wt]);
		let reply = call(
			&f.mcp,
			"tools/call",
			json!({ "name": "setWorktree",
			        "arguments": { "path": f.project.path().to_string_lossy() } }),
		);

		assert!(tool_result(&reply).1);
	}

	#[test]
	fn setworktree_in_a_project_with_no_repository_says_so() {
		let f = fixture(true);
		let reply = call(
			&f.mcp,
			"tools/call",
			json!({ "name": "setWorktree", "arguments": { "path": "/anywhere" } }),
		);
		let (text, is_error) = tool_result(&reply);
		assert!(is_error);
		assert!(text.contains("not in a git repository"), "{text}");
	}

	#[test]
	fn workspace_folders_names_the_cwd_and_lists_the_checkouts() {
		let (_home, wt) = checkout("feature-x");
		let f = fixture_with_checkouts(true, vec![wt.clone()]);
		let reply = call(&f.mcp, "tools/call", json!({ "name": "getWorkspaceFolders" }));
		let (text, _) = tool_result(&reply);
		let body: Value = serde_json::from_str(&text).unwrap();

		// `folders` keeps its old shape and old meaning, so an agent reading only
		// that key sees no change.
		assert_eq!(body["folders"], json!([f.project.path().to_string_lossy()]));
		assert_eq!(body["cwd"], json!(f.project.path().to_string_lossy()));
		assert_eq!(body["worktrees"], json!([wt.to_string_lossy()]));
		// Nothing to report: the panel is showing this session's own cwd.
		assert!(body["viewing"].is_null());
		// The advertisement — this is the tool claude calls early, so it is where
		// an agent learns `setWorktree` exists.
		assert!(body["hint"].as_str().unwrap().contains("setWorktree"));
	}

	#[test]
	fn workspace_folders_reports_the_view_as_a_separate_labelled_fact() {
		// Never merged into `folders`: the PTY's cwd has not moved, and an agent
		// told the *view* is its workspace would run git in one tree and edit
		// another.
		let (_home, wt) = checkout("feature-x");
		let project = TempDir::new().unwrap();
		let viewing = wt.clone();
		let mcp = Mcp::new(
			project.path().to_path_buf(),
			Worktrees {
				checkouts: Arc::new(move || vec![wt.clone()]),
				signal: Arc::new(|_| {}),
				current: Arc::new(move || Some(viewing.clone())),
			},
			Arc::new(|_| true),
			Arc::new(Vec::new),
		);

		let reply = call(&mcp, "tools/call", json!({ "name": "getWorkspaceFolders" }));
		let body: Value = serde_json::from_str(&tool_result(&reply).0).unwrap();
		assert_eq!(body["cwd"], json!(project.path().to_string_lossy()));
		assert!(body["viewing"].as_str().unwrap().ends_with("feature-x"));
	}

	#[test]
	fn tools_list_offers_the_set_we_decided_on_and_not_one_tool_more() {
		let f = fixture(true);
		let reply = call(&f.mcp, "tools/list", Value::Null);
		let names: Vec<&str> = reply["result"]["tools"]
			.as_array()
			.unwrap()
			.iter()
			.map(|t| t["name"].as_str().unwrap())
			.collect();

		// `setWorktree` is last: appended so the three that were here keep their
		// positions, the same rule the panel's tab strip follows.
		assert_eq!(names, ["openFile", "getWorkspaceFolders", "getOpenEditors", "setWorktree"]);
		// The omission is a decision, so it gets an assertion. Answering "no
		// problems" with no diagnostics source is a lie the agent would act on.
		assert!(!names.contains(&"getDiagnostics"));
		// The working-tree write path is a separate ADR and must not appear by
		// accident.
		assert!(!names.contains(&"openDiff"));
		// **Nothing model-facing belongs here** (ADR-0029). The CLI registers this
		// server under the hardcoded key `ide` and shows the model two of its
		// tools, so a tool added here to be called by an agent would be served
		// correctly, pass every test in this file, and never be offered to anyone.
		// `crate::services::agent_tools` is where such a tool goes.
		for absent in ["listRoutines", "createRoutine", "updateRoutine", "setRoutineEnabled"] {
			assert!(!names.contains(&absent), "{absent} belongs to the agent tool server");
		}
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
	fn a_background_session_is_told_the_file_was_not_shown() {
		// The UI declined to steal the viewport, and there is nowhere else to put
		// the request yet. Saying "marked" while nothing is marked is the same
		// confident falsehood getDiagnostics is kept out of the list to avoid.
		let f = fixture(false);
		let file = f.project.path().join("a.rs");
		std::fs::write(&file, "").unwrap();

		let reply = call(
			&f.mcp,
			"tools/call",
			json!({ "name": "openFile", "arguments": { "filePath": file.to_str().unwrap() } }),
		);

		let (text, is_error) = tool_result(&reply);
		assert!(!is_error, "the call was well-formed; the answer is just no");
		assert!(text.starts_with("Not shown:"), "{text}");
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

	/// `at_mentioned`'s wire shape, which the CLI turns straight into prompt
	/// text. Read out of CLI 2.1.235:
	///
	/// ```js
	/// if (e.lineStart && e.lineEnd)
	///   n = e.lineStart === e.lineEnd ? `@${r}#L${e.lineStart} ` : `@${r}#L${e.lineStart}-${e.lineEnd} `;
	/// else n = `@${r} `;
	/// ```
	mod mentions {
		use std::path::Path;

		use super::*;

		fn params(json: &str) -> Value {
			let v: Value = serde_json::from_str(json).unwrap();
			assert_eq!(v["jsonrpc"], "2.0");
			assert_eq!(v["method"], "at_mentioned");
			// A notification has no id — an `at_mentioned` carrying one would be
			// a request the CLI never answers.
			assert!(v.get("id").is_none());
			v["params"].clone()
		}

		fn mention(line_start: Option<u32>, line_end: Option<u32>) -> Mention {
			Mention { path: "/p/a.rs".into(), line_start, line_end }
		}

		#[test]
		fn a_whole_file_carries_no_range() {
			let p = params(&at_mentioned(Path::new("/p/a.rs"), &mention(None, None)));
			assert_eq!(p["filePath"], "/p/a.rs");
			assert!(p.get("lineStart").is_none());
			assert!(p.get("lineEnd").is_none());
		}

		#[test]
		fn a_range_goes_out_zero_based_because_the_cli_adds_one_before_printing() {
			// **Observed, not inferred.** Sending the human's own 1-based numbers
			// rendered a range one line too far down: a selection the viewer
			// labelled "lines 10–13" arrived in the prompt as `#L11-14`. Twice,
			// with different ranges. So the field matches `selection_changed`'s
			// 0-based convention after all.
			let p = params(&at_mentioned(Path::new("/p/a.rs"), &mention(Some(10), Some(13))));
			assert_eq!(p["lineStart"], 9, "the human selected line 10");
			assert_eq!(p["lineEnd"], 12, "…through line 13");
		}

		#[test]
		fn the_first_line_of_a_file_does_not_underflow() {
			// Line 1 is 0 on the wire. `saturating_sub` is what stops a `u32`
			// wrapping to four billion if anything ever hands us a 0.
			let p = params(&at_mentioned(Path::new("/p/a.rs"), &mention(Some(1), Some(1))));
			assert_eq!(p["lineStart"], 0);
			assert_eq!(p["lineEnd"], 0);
		}

		#[test]
		fn half_a_range_is_sent_as_no_range_at_all() {
			// The CLI tests the two together, so a lone `lineStart` renders as a
			// whole-file mention anyway. Dropping it here makes the wire say what
			// the reader will see, instead of carrying a number that does nothing.
			for m in [mention(Some(3), None), mention(None, Some(9))] {
				let p = params(&at_mentioned(Path::new("/p/a.rs"), &m));
				assert!(p.get("lineStart").is_none(), "{p}");
				assert!(p.get("lineEnd").is_none(), "{p}");
			}
		}

		#[test]
		fn the_path_sent_is_the_resolved_one_not_what_was_asked_for() {
			// The command hands us the canonicalised path, and that is what has
			// been scope-checked. Sending the caller's string instead would put an
			// unchecked path on the wire.
			let p = params(&at_mentioned(Path::new("/real/a.rs"), &mention(None, None)));
			assert_eq!(p["filePath"], "/real/a.rs");
		}
	}
}
