//! A streamable-HTTP MCP endpoint, one per session (ADR-0029).
//!
//! **Why HTTP and not the WebSocket next door.** The bridge's transport is
//! `ws-ide`, which the CLI accepts only from its own `~/.claude/ide/` discovery
//! — handed the same config through `--mcp-config` it never dials at all
//! (observed, 2.1.251). `http` is the transport a plain MCP server is registered
//! with, and a plain server is the only kind whose tools reach the model.
//!
//! **Why hand-rolled and not axum.** ADR-0017 § 4 rejected axum for the bridge
//! because it drags hyper and tower in for one endpoint serving no HTTP; this
//! endpoint serves HTTP, but it serves exactly one route, one method and one
//! content type, to one client, on loopback. The parser below is smaller than
//! the dependency, and — like the bridge — its correctness is a security
//! property, so being readable in one file is worth more than being general.
//!
//! What is here is the transport and the door: bind, authenticate, and hand
//! whole messages to a `handler`. What they *mean* is [`super::tools`]'s problem.

use std::net::{Ipv4Addr, SocketAddr, TcpListener as StdTcpListener};
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tracing::{debug, warn};

use crate::error::{AppError, AppResult};

/// Turns one request message into an optional reply. `None` for a notification.
pub type Handler = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;

/// A body larger than this is refused unread.
///
/// A `tools/call` carrying a routine prompt is the biggest thing that arrives,
/// and the store caps that at 8 KB. This is generous against that and small
/// enough that a malformed `Content-Length` cannot make us allocate.
const MAX_BODY: usize = 256 * 1024;

/// Given by the CLI as `Authorization: Bearer <token>`, from the `headers` block
/// of the config we hand it at spawn.
const BEARER: &str = "bearer ";

/// A live tool server for one session. Dropping it stops the listener.
pub struct AgentToolsServer {
	addr: SocketAddr,
	token: String,
	task: tauri::async_runtime::JoinHandle<()>,
}

impl AgentToolsServer {
	/// Bind and start accepting.
	///
	/// **Bound synchronously**, before anything is spawned: the port has to be
	/// known to write the `--mcp-config` argument, and a bind failure has to
	/// reach the caller rather than disappearing into a task nobody awaits. Port
	/// 0 lets the OS choose, so nothing here collides with a second factorai.
	pub fn start(handler: Handler) -> AppResult<Self> {
		let std_listener = StdTcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
			.map_err(|e| AppError::Io(format!("binding the agent tool server: {e}")))?;
		std_listener
			.set_nonblocking(true)
			.map_err(|e| AppError::Io(format!("agent tool socket: {e}")))?;
		let addr = std_listener
			.local_addr()
			.map_err(|e| AppError::Io(format!("agent tool socket: {e}")))?;

		// The same shape of secret the bridge mints, and for the same reason it
		// is not the real boundary: anything running as this user can read the
		// argv we put it in. What holds is the scope baked into the tools.
		let token = uuid::Uuid::new_v4().simple().to_string();
		let accept_token = token.clone();

		let task = tauri::async_runtime::spawn(async move {
			let listener = match TcpListener::from_std(std_listener) {
				Ok(l) => l,
				Err(e) => {
					warn!(error = %e, "agent tool server could not adopt its listener");
					return;
				}
			};
			loop {
				let Ok((stream, peer)) = listener.accept().await else { return };
				let token = accept_token.clone();
				let handler = handler.clone();
				tauri::async_runtime::spawn(async move {
					if let Err(e) = serve(stream, token, handler).await {
						debug!(%peer, error = %e, "agent tool connection ended");
					}
				});
			}
		});

		debug!(port = addr.port(), "agent tool server listening");
		Ok(Self { addr, token, task })
	}

	pub fn port(&self) -> u16 {
		self.addr.port()
	}

	pub fn token(&self) -> &str {
		&self.token
	}

	/// The `--mcp-config` value handed to `claude` at spawn.
	///
	/// **Inline JSON rather than a file**, because the config is per session and
	/// dies with it: a file would have to be written somewhere, cleaned up on a
	/// `SIGKILL`, and would put the token on disk for no gain over argv, which
	/// any process running as this user can already read.
	///
	/// **Never with `--strict-mcp-config`.** That flag would make ours the *only*
	/// MCP servers the session has, silently dropping every server the user
	/// configured. Merging is the whole point.
	pub fn mcp_config_arg(&self) -> String {
		serde_json::json!({
			"mcpServers": {
				super::tools::SERVER_NAME: {
					"type": "http",
					"url": format!("http://127.0.0.1:{}/mcp", self.port()),
					"headers": { "Authorization": format!("Bearer {}", self.token) },
				}
			}
		})
		.to_string()
	}
}

impl Drop for AgentToolsServer {
	fn drop(&mut self) {
		self.task.abort();
		debug!(port = self.port(), "agent tool server stopped");
	}
}

/// One connection. The CLI reuses it across `initialize`, `tools/list` and every
/// `tools/call`, so this loops rather than answering once.
async fn serve(mut stream: TcpStream, token: String, handler: Handler) -> std::io::Result<()> {
	let mut buf = Vec::new();
	loop {
		let Some(request) = read_request(&mut stream, &mut buf).await? else { return Ok(()) };

		if !authorised(&request.authorization, &token) {
			warn!("agent tool server rejected a request with a bad or missing token");
			write_response(&mut stream, 401, "").await?;
			return Ok(());
		}

		// A frame with no `id` is a notification: acknowledged with 202 and no
		// body, which is what the MCP HTTP binding asks for.
		match handler(&request.body) {
			Some(reply) => write_response(&mut stream, 200, &reply).await?,
			None => write_response(&mut stream, 202, "").await?,
		}
	}
}

struct Request {
	authorization: String,
	body: String,
}

/// Read one HTTP/1.1 request. `None` at a clean end of stream.
///
/// Deliberately incurious: the method and the path are not checked, because
/// there is one route and the token is what decides whether a request is
/// answered. Everything it *does* parse is the part that could otherwise make us
/// read the wrong number of bytes.
async fn read_request(
	stream: &mut TcpStream,
	buf: &mut Vec<u8>,
) -> std::io::Result<Option<Request>> {
	// Headers first, up to the blank line.
	let head_end = loop {
		if let Some(at) = find_headers_end(buf) {
			break at;
		}
		let mut chunk = [0u8; 4096];
		let n = stream.read(&mut chunk).await?;
		if n == 0 {
			return Ok(None);
		}
		buf.extend_from_slice(&chunk[..n]);
		if buf.len() > MAX_BODY {
			return Err(std::io::Error::other("request headers too large"));
		}
	};

	let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
	let mut authorization = String::new();
	let mut length = 0usize;
	for line in head.split("\r\n").skip(1) {
		let Some((name, value)) = line.split_once(':') else { continue };
		match name.trim().to_ascii_lowercase().as_str() {
			"authorization" => authorization = value.trim().to_string(),
			"content-length" => length = value.trim().parse().unwrap_or(0),
			_ => {}
		}
	}
	if length > MAX_BODY {
		return Err(std::io::Error::other("request body too large"));
	}

	let body_start = head_end + 4;
	while buf.len() < body_start + length {
		let mut chunk = [0u8; 4096];
		let n = stream.read(&mut chunk).await?;
		if n == 0 {
			return Ok(None);
		}
		buf.extend_from_slice(&chunk[..n]);
	}
	let body = String::from_utf8_lossy(&buf[body_start..body_start + length]).to_string();
	// Keep whatever the client pipelined behind this request.
	buf.drain(..body_start + length);
	Ok(Some(Request { authorization, body }))
}

fn find_headers_end(buf: &[u8]) -> Option<usize> {
	buf.windows(4).position(|w| w == b"\r\n\r\n")
}

async fn write_response(stream: &mut TcpStream, status: u16, body: &str) -> std::io::Result<()> {
	let reason = match status {
		200 => "OK",
		202 => "Accepted",
		401 => "Unauthorized",
		_ => "Error",
	};
	// `Content-Length` on every response including the empty ones, so the client
	// can keep the connection and does not wait for a close that is not coming.
	let head = format!(
		"HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\n\
		 Content-Length: {}\r\nConnection: keep-alive\r\n\r\n",
		body.len()
	);
	stream.write_all(head.as_bytes()).await?;
	stream.write_all(body.as_bytes()).await?;
	stream.flush().await
}

/// `Authorization: Bearer <token>`, compared in constant time.
///
/// The scheme is matched case-insensitively because HTTP says so; the token is
/// not.
fn authorised(header: &str, expected: &str) -> bool {
	if header.len() < BEARER.len() || !header[..BEARER.len()].eq_ignore_ascii_case(BEARER) {
		return false;
	}
	tokens_match(header[BEARER.len()..].trim(), expected)
}

/// Constant time over equal-length inputs. Length is compared first and leaks
/// only the length, which is fixed for every token we mint.
fn tokens_match(presented: &str, expected: &str) -> bool {
	let (a, b) = (presented.as_bytes(), expected.as_bytes());
	if a.len() != b.len() {
		return false;
	}
	let mut diff = 0u8;
	for (x, y) in a.iter().zip(b) {
		diff |= x ^ y;
	}
	diff == 0
}

#[cfg(test)]
mod tests {
	use std::io::{Read, Write};
	use std::net::TcpStream as StdStream;

	use super::*;

	/// Send a raw request and read the whole response. Deliberately a hand-built
	/// client: the thing under test is our parser, and a library would paper over
	/// exactly the framing mistakes it exists to catch.
	fn request(port: u16, auth: Option<&str>, body: &str) -> (u16, String) {
		let mut s = StdStream::connect(("127.0.0.1", port)).expect("connect");
		let auth = auth.map(|t| format!("Authorization: {t}\r\n")).unwrap_or_default();
		let req = format!(
			"POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\n{auth}Content-Type: application/json\r\n\
			 Content-Length: {}\r\n\r\n{body}",
			body.len()
		);
		s.write_all(req.as_bytes()).unwrap();
		s.flush().unwrap();
		read_reply(&mut s)
	}

	fn read_reply(s: &mut StdStream) -> (u16, String) {
		let mut buf = Vec::new();
		loop {
			let mut chunk = [0u8; 1024];
			let n = s.read(&mut chunk).unwrap();
			if n == 0 {
				break;
			}
			buf.extend_from_slice(&chunk[..n]);
			let text = String::from_utf8_lossy(&buf).to_string();
			if let Some((head, rest)) = text.split_once("\r\n\r\n") {
				let len: usize = head
					.split("\r\n")
					.find_map(|l| l.strip_prefix("Content-Length: "))
					.and_then(|v| v.parse().ok())
					.unwrap_or(0);
				if rest.len() >= len {
					let status =
						head.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
					return (status, rest[..len].to_string());
				}
			}
		}
		(0, String::new())
	}

	fn echo_server() -> AgentToolsServer {
		AgentToolsServer::start(Arc::new(|text: &str| {
			// A frame with no `id` is a notification and gets no reply, which is
			// what the 202 path is for.
			if text.contains("\"id\"") {
				Some(format!("{{\"echoed\":{}}}", text.len()))
			} else {
				None
			}
		}))
		.expect("bind")
	}

	#[tokio::test]
	async fn a_request_with_the_right_token_is_answered() {
		let server = echo_server();
		let bearer = format!("Bearer {}", server.token());
		let (status, body) =
			request(server.port(), Some(&bearer), r#"{"id":1,"method":"tools/list"}"#);
		assert_eq!(status, 200);
		assert!(body.contains("echoed"), "{body}");
	}

	#[tokio::test]
	async fn a_bad_or_missing_token_never_reaches_the_handler() {
		// The token is not the real boundary — the scope baked into the tools is
		// (ADR-0017 § 3) — but it should still cost more than a guess, and a
		// handler that ran before the check would make it cost nothing.
		let reached = Arc::new(std::sync::atomic::AtomicBool::new(false));
		let flag = reached.clone();
		let server = AgentToolsServer::start(Arc::new(move |_: &str| {
			flag.store(true, std::sync::atomic::Ordering::SeqCst);
			Some("{}".to_string())
		}))
		.expect("bind");

		for auth in [None, Some("Bearer wrong"), Some("Basic hunter2"), Some("")] {
			let (status, _) = request(server.port(), auth, r#"{"id":1}"#);
			assert_eq!(status, 401, "auth {auth:?} was let through");
		}
		assert!(!reached.load(std::sync::atomic::Ordering::SeqCst), "the handler ran anyway");
	}

	#[tokio::test]
	async fn the_scheme_is_case_insensitive_but_the_token_is_not() {
		let server = echo_server();
		let (ok, _) =
			request(server.port(), Some(&format!("bEaReR {}", server.token())), r#"{"id":1}"#);
		assert_eq!(ok, 200, "HTTP says the scheme is case-insensitive");
		let (bad, _) = request(
			server.port(),
			Some(&format!("Bearer {}", server.token().to_uppercase())),
			r#"{"id":1}"#,
		);
		assert_eq!(bad, 401, "the token itself is compared exactly");
	}

	#[tokio::test]
	async fn a_notification_is_accepted_with_no_body() {
		let server = echo_server();
		let bearer = format!("Bearer {}", server.token());
		let (status, body) = request(
			server.port(),
			Some(&bearer),
			r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
		);
		assert_eq!(status, 202);
		assert!(body.is_empty(), "{body}");
	}

	#[tokio::test]
	async fn one_connection_carries_a_whole_session() {
		// The CLI reuses the connection across `initialize`, `tools/list` and
		// every `tools/call`. A server that answered once and stopped reading
		// would look like a hang on the second call, not a failure on the first.
		let server = echo_server();
		let bearer = format!("Bearer {}", server.token());
		let mut s = StdStream::connect(("127.0.0.1", server.port())).expect("connect");
		for n in 1..=3 {
			let body = format!(r#"{{"id":{n},"method":"tools/list"}}"#);
			let req = format!(
				"POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: {bearer}\r\n\
				 Content-Length: {}\r\n\r\n{body}",
				body.len()
			);
			s.write_all(req.as_bytes()).unwrap();
			s.flush().unwrap();
			let (status, reply) = read_reply(&mut s);
			assert_eq!(status, 200, "request {n} on the same connection");
			assert!(reply.contains("echoed"), "request {n}: {reply}");
		}
	}

	#[tokio::test]
	async fn it_binds_loopback_and_advertises_itself_that_way() {
		let server = echo_server();
		assert_eq!(server.addr.ip().to_string(), "127.0.0.1");
		let config: serde_json::Value =
			serde_json::from_str(&server.mcp_config_arg()).expect("valid json");
		let entry = &config["mcpServers"][super::super::tools::SERVER_NAME];
		assert_eq!(entry["url"], format!("http://127.0.0.1:{}/mcp", server.port()));
		assert_eq!(entry["type"], "http");
	}

	#[tokio::test]
	async fn a_body_longer_than_it_claims_does_not_hang_the_next_request() {
		// `Content-Length` decides where one request ends and the next begins.
		// Reading one byte too many or too few desynchronises the connection for
		// good, which is the failure a hand-rolled parser is most likely to have.
		let server = echo_server();
		let bearer = format!("Bearer {}", server.token());
		let mut s = StdStream::connect(("127.0.0.1", server.port())).expect("connect");
		let first = r#"{"id":1,"m":"a"}"#;
		let second = r#"{"id":2,"m":"b"}"#;
		// Both requests written in one go, pipelined.
		let req = format!(
			"POST /mcp HTTP/1.1\r\nAuthorization: {bearer}\r\nContent-Length: {}\r\n\r\n{first}\
			 POST /mcp HTTP/1.1\r\nAuthorization: {bearer}\r\nContent-Length: {}\r\n\r\n{second}",
			first.len(),
			second.len()
		);
		s.write_all(req.as_bytes()).unwrap();
		s.flush().unwrap();
		for n in 1..=2 {
			let (status, reply) = read_reply(&mut s);
			assert_eq!(status, 200, "pipelined request {n}");
			assert!(reply.contains("echoed"), "pipelined request {n}: {reply}");
		}
	}
}
