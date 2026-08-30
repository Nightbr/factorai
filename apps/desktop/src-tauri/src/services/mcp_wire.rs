//! JSON-RPC 2.0 and the sliver of MCP that both of factorai's servers speak.
//!
//! There are two, and they exist for different reasons (ADR-0029):
//!
//! * [`super::ide`] is the **IDE bridge** — the connection the `claude` CLI
//!   discovers through `~/.claude/ide/<port>.lock`. Its tools are called by the
//!   CLI itself, never by the model.
//! * [`super::agent_tools`] is the **agent tool server** — an ordinary MCP
//!   server, registered by name at spawn, whose tools the model can call.
//!
//! What is shared is only the wire: the envelope, the two failure shapes, and
//! the request struct. Everything about *which* tools exist and what they may
//! touch stays in the server that owns them.
//!
//! Hand-written rather than an SDK, per ADR-0017 § 4 and AGENTS.md § 4 — this
//! project hand-mirrors types across a boundary and takes no code generation.

use serde::Deserialize;
use serde_json::{json, Value};

/// JSON-RPC's own codes. Tool *failures* do not use these — see [`tool_error`]
/// for why.
pub const METHOD_NOT_FOUND: i64 = -32601;
pub const INVALID_PARAMS: i64 = -32602;

/// A successful `tools/call` result. MCP wraps every answer in content blocks
/// rather than returning a bare value.
pub fn tool_text(text: &str) -> Value {
	json!({ "content": [{ "type": "text", "text": text }] })
}

/// A tool that ran and failed.
///
/// **Not a JSON-RPC error.** Those mean "this call was malformed"; this means
/// "your call was fine and the answer is no". MCP draws that line so a model can
/// read the failure and react, and collapsing the two would turn "that file is
/// outside the project" into a transport fault the agent cannot learn from.
pub fn tool_error(message: &str) -> Value {
	json!({ "content": [{ "type": "text", "text": message }], "isError": true })
}

/// A JSON-RPC error, for a call that was malformed rather than refused.
pub struct Failure {
	pub code: i64,
	pub message: String,
}

impl Failure {
	pub fn rpc(code: i64, message: impl Into<String>) -> Self {
		Self { code, message: message.into() }
	}
}

/// Serialise a reply.
pub fn encode(value: Value) -> String {
	// A response we cannot serialise is a bug in the shapes above, not a
	// runtime condition — but a panic here would take a session's server down,
	// so it degrades to a parse error the client can report.
	serde_json::to_string(&value).unwrap_or_else(|_| {
		r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"internal error"}}"#
			.to_string()
	})
}

/// One request off the wire.
#[derive(Deserialize)]
pub struct Incoming {
	/// Absent for a notification. Kept as a `Value` because JSON-RPC allows a
	/// string or a number and it is only ever echoed back.
	#[serde(default)]
	pub id: Option<Value>,
	pub method: String,
	#[serde(default)]
	pub params: Option<Value>,
}

/// The `initialize` result, with the client's own protocol version echoed back.
///
/// **Echoed rather than pinned.** Neither server offers resources, prompts or
/// sampling, and the tool half has not changed shape across MCP revisions — so
/// the honest answer to "can you speak this" is yes. Pinning a version list is a
/// list we would then have to chase; a conformance pass against a real client is
/// what would catch it if that ever stops being true. The CLI has been observed
/// asking for `2025-06-18` on the bridge and `2025-11-25` over HTTP.
pub fn initialize_result(params: &Value, server_name: &str) -> Value {
	let version =
		params.get("protocolVersion").and_then(Value::as_str).unwrap_or("2025-06-18").to_string();
	json!({
		"protocolVersion": version,
		"capabilities": { "tools": { "listChanged": false } },
		"serverInfo": { "name": server_name, "version": env!("CARGO_PKG_VERSION") },
	})
}

/// Wrap a handler's outcome in the JSON-RPC envelope for `id`.
pub fn reply(id: Value, result: Result<Value, Failure>) -> String {
	match result {
		Ok(value) => encode(json!({ "jsonrpc": "2.0", "id": id, "result": value })),
		Err(f) => encode(
			json!({ "jsonrpc": "2.0", "id": id, "error": { "code": f.code, "message": f.message } }),
		),
	}
}
