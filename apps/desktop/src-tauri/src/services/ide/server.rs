//! One WebSocket server per session, and the two checks that guard it
//! (F20, ADR-0017 §§ 2–4).
//!
//! **The port is the session identity.** factorai runs many PTYs against one
//! project, so neither the connecting pid nor the workspace folder would tell
//! two sessions apart — but a request arriving on this socket can only have
//! come from the session whose environment carries this port.
//!
//! What is here is the transport and the door: bind, advertise, authenticate,
//! and hand whole messages to a `handler`. What the messages *mean* is the MCP
//! layer's problem and arrives next; injecting the handler keeps that seam
//! testable without a protocol and this testable without one either.

use std::net::{Ipv4Addr, SocketAddr, TcpListener as StdTcpListener};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::header::{HeaderValue, SEC_WEBSOCKET_PROTOCOL};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, warn};

use super::lockfile::{self, Lockfile};
use crate::error::{AppError, AppResult};

/// The header the CLI sends its token in. Lower-case because `http::HeaderMap`
/// lookups are case-insensitive but the constant should not invite a
/// case-sensitive rewrite.
const AUTH_HEADER: &str = "x-claude-code-ide-authorization";

/// The subprotocol the CLI asks for, and **it has to be answered**.
///
/// It builds its socket as `new WebSocket(url, { protocols: ["mcp"], … })`. A
/// client that offers a subprotocol and gets a handshake back without one is
/// entitled to treat the connection as unusable, and this one does: it resets
/// immediately, having completed the handshake, so from our side it looks like
/// a connection that opened and vanished with nothing sent.
///
/// **Found by the conformance pass, not by a test.** Every unit test here
/// passed while this was broken, because our own client never asked for a
/// subprotocol — which is exactly the gap ADR-0017 says only a run against the
/// real binary can close.
const MCP_SUBPROTOCOL: &str = "mcp";

/// Turns one request message into an optional reply. `None` for a
/// notification, which by definition is not answered.
pub type Handler = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;

/// Called `true` when a client completes the handshake and `false` when that
/// connection ends.
///
/// Handshake rather than the `ide_connected` notification, even though the
/// latter is what the CLI *says*: only the socket knows when a client goes
/// away, so taking both edges from the same place is the only way the two
/// cannot disagree. A client that authenticates and then says nothing is still
/// attached, which is what the badge claims.
pub type OnClient = Arc<dyn Fn(bool) + Send + Sync>;

/// How many outbound notifications may queue before the slowest connection
/// starts losing the oldest.
///
/// These are user gestures — "send this file to Claude" — so the queue only
/// fills if the socket has stopped draining, which means the client is gone or
/// wedged. Dropping the oldest is right for that: a mention nobody can receive
/// is not worth stalling the app over, and `broadcast` tells the reader it
/// lagged so it can say so.
const OUTBOUND_QUEUE: usize = 64;

/// A live bridge for one session. Dropping it takes the lockfile and the
/// listener with it.
pub struct IdeServer {
	addr: SocketAddr,
	token: String,
	/// Notifications waiting to go out to whoever is attached.
	outbound: broadcast::Sender<String>,
	/// Is a client attached right now?
	///
	/// The events are enough for a renderer that was listening; this is for one
	/// that was not. A reload throws the renderer's state away while every PTY —
	/// and every bridge — carries on, so without something to ask at boot the
	/// header would claim Claude had gone. `terminal_list` exists for exactly
	/// that reason on the PTY side; this is its counterpart.
	attached: Arc<AtomicBool>,
	claude_dir: PathBuf,
	task: tauri::async_runtime::JoinHandle<()>,
}

impl IdeServer {
	/// Bind, advertise, and start accepting.
	///
	/// **The listener is bound synchronously**, before anything is written or
	/// spawned. Two reasons: the port has to be known to name the lockfile, and
	/// a bind failure has to reach the caller as an error rather than
	/// disappearing into a task nobody awaits. Port 0 lets the OS choose, so
	/// nothing here can collide with a second factorai or a previous run.
	///
	/// Order matters on the way up too: the socket is listening before the
	/// lockfile exists, so the CLI's TCP probe can never find a handle pointing
	/// at nothing.
	pub fn start(
		claude_dir: &Path,
		workspace_root: &str,
		handler: Handler,
		on_client: OnClient,
	) -> AppResult<Self> {
		let std_listener = StdTcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
			.map_err(|e| AppError::Io(format!("binding the ide bridge: {e}")))?;
		std_listener
			.set_nonblocking(true)
			.map_err(|e| AppError::Io(format!("ide bridge socket: {e}")))?;
		let addr = std_listener
			.local_addr()
			.map_err(|e| AppError::Io(format!("ide bridge socket: {e}")))?;
		let port = addr.port();

		let lock = Lockfile::new(workspace_root);
		let token = lock.auth_token.clone();
		lockfile::write(claude_dir, port, &lock)?;

		// The caller's callback, plus the flag a late-arriving renderer reads.
		// Wrapped here so the two can never disagree about the same edge.
		let attached = Arc::new(AtomicBool::new(false));
		let flag = attached.clone();
		let on_client: OnClient = Arc::new(move |connected| {
			flag.store(connected, Ordering::Relaxed);
			(on_client)(connected);
		});

		let (outbound, _) = broadcast::channel(OUTBOUND_QUEUE);
		let accept_outbound = outbound.clone();

		let accept_token = token.clone();
		let task = tauri::async_runtime::spawn(async move {
			let listener = match TcpListener::from_std(std_listener) {
				Ok(l) => l,
				Err(e) => {
					warn!(error = %e, "ide bridge could not adopt its listener");
					return;
				}
			};
			accept_loop(listener, accept_token, handler, on_client, accept_outbound).await;
		});

		debug!(%port, %workspace_root, "ide bridge listening");
		Ok(Self { addr, token, outbound, attached, claude_dir: claude_dir.to_path_buf(), task })
	}

	pub fn port(&self) -> u16 {
		self.addr.port()
	}

	/// Where the listener actually bound. Exposed so a test can assert the
	/// address rather than infer it: reaching the port from another interface is
	/// not a check that can be made reliably — a host whose hostname resolves to
	/// `127.0.1.1` has no routable address to try, and the assertion silently
	/// passes by never running.
	pub fn local_addr(&self) -> SocketAddr {
		self.addr
	}

	/// The session's bearer token. Exposed for tests and for nothing else —
	/// production reads it out of the lockfile it just wrote.
	pub fn token(&self) -> &str {
		&self.token
	}

	/// Is a client attached right now? For a renderer asking at boot, which
	/// missed every event that got us here.
	pub fn is_attached(&self) -> bool {
		self.attached.load(Ordering::Relaxed)
	}

	/// Push one JSON-RPC notification to whoever is attached.
	///
	/// **Silently does nothing when nobody is**, and that is the caller's cue
	/// rather than an error to propagate: `broadcast::send` fails only when
	/// there are no receivers, which is exactly "Claude is not connected to this
	/// session". The UI already knows that state — it is what the header badge
	/// is about — so the command checks it up front and this stays infallible.
	pub fn notify(&self, message: String) {
		let _ = self.outbound.send(message);
	}
}

impl Drop for IdeServer {
	fn drop(&mut self) {
		// Lockfile first: it is what other processes can see. A handle to a
		// socket that is about to close is worse than a closed socket with no
		// handle, and the CLI probes before it trusts either way.
		lockfile::remove(&self.claude_dir, self.port());
		self.task.abort();
		debug!(port = self.port(), "ide bridge stopped");
	}
}

async fn accept_loop(
	listener: TcpListener,
	token: String,
	handler: Handler,
	on_client: OnClient,
	outbound: broadcast::Sender<String>,
) {
	loop {
		let Ok((stream, peer)) = listener.accept().await else {
			// A failed accept is usually the listener going away with us.
			return;
		};
		let token = token.clone();
		let handler = handler.clone();
		let on_client = on_client.clone();
		let rx = outbound.subscribe();
		tauri::async_runtime::spawn(async move {
			if let Err(e) = serve(stream, token, handler, on_client, rx).await {
				debug!(%peer, error = %e, "ide bridge connection ended");
			}
		});
	}
}

// `clippy::result_large_err` fires on the handshake callback below, whose
// `Result<Response, ErrorResponse>` is tungstenite's `Callback` trait signature
// rather than ours. Boxing the error — clippy's suggestion — would not typecheck
// against the trait, and the value is constructed at most once per rejected
// connection. Allowed here rather than repo-wide so the lint keeps applying
// everywhere it is about our own types.
#[allow(clippy::result_large_err)]
async fn serve(
	stream: tokio::net::TcpStream,
	token: String,
	handler: Handler,
	on_client: OnClient,
	mut outbound: broadcast::Receiver<String>,
) -> Result<(), tokio_tungstenite::tungstenite::Error> {
	// The token is checked *during* the handshake, so an unauthorised client
	// never reaches a WebSocket at all — it gets a 401 and a closed socket.
	let check = |req: &Request, res: Response| -> Result<Response, ErrorResponse> {
		let presented = req.headers().get(AUTH_HEADER).and_then(|v| v.to_str().ok()).unwrap_or("");
		if tokens_match(presented, &token) {
			let mut res = res;
			// Echoed only when it was offered. Selecting a subprotocol the client
			// never asked for is the same protocol violation in the other
			// direction, and would break a client that is happy without one.
			if offers_mcp(req) {
				res.headers_mut()
					.insert(SEC_WEBSOCKET_PROTOCOL, HeaderValue::from_static(MCP_SUBPROTOCOL));
			}
			return Ok(res);
		}
		warn!("ide bridge rejected a connection with a bad or missing token");
		let mut err = ErrorResponse::new(None);
		*err.status_mut() = StatusCode::UNAUTHORIZED;
		Err(err)
	};

	let ws = accept_hdr_async(stream, check).await?;

	// Attached from here to the end of this function, however it ends. `Attached`
	// reports `false` from its `Drop`, so an error return, a panic and a clean
	// close all clear the badge — a client that vanished must not leave the
	// header claiming it is still there.
	let _attached = Attached::new(on_client);

	// Split so a push from the app and a message from the client can be waited on
	// together. Without this the socket only speaks when spoken to, and a
	// notification would sit until the CLI happened to ask something.
	let (mut sink, mut stream) = ws.split();

	loop {
		tokio::select! {
			incoming = stream.next() => {
				let Some(message) = incoming else { break };
				match message? {
					Message::Text(text) => {
						if let Some(reply) = handler(&text) {
							sink.send(Message::Text(reply.into())).await?;
						}
					}
					// The CLI speaks JSON text. Binary is not part of the protocol,
					// and answering something we did not understand is worse than
					// silence.
					Message::Binary(_) => debug!("ide bridge ignored a binary frame"),
					Message::Close(_) => break,
					// tungstenite answers pings itself.
					_ => {}
				}
			}
			push = outbound.recv() => {
				match push {
					Ok(text) => sink.send(Message::Text(text.into())).await?,
					// The queue overflowed, so this connection missed some. Say so
					// rather than pretend: a dropped mention is a file the human
					// thinks they sent.
					Err(broadcast::error::RecvError::Lagged(n)) => {
						warn!(dropped = n, "ide bridge could not keep up; notifications were lost");
					}
					Err(broadcast::error::RecvError::Closed) => break,
				}
			}
		}
	}
	Ok(())
}

/// Did the client offer the `mcp` subprotocol?
///
/// A client may send several, comma-separated, and may repeat the header — the
/// spec allows both spellings, so both are read rather than the convenient one.
fn offers_mcp(req: &Request) -> bool {
	req.headers()
		.get_all(SEC_WEBSOCKET_PROTOCOL)
		.iter()
		.filter_map(|v| v.to_str().ok())
		.flat_map(|v| v.split(','))
		.any(|p| p.trim().eq_ignore_ascii_case(MCP_SUBPROTOCOL))
}

/// Holds the "a client is attached" signal for the life of one connection.
///
/// A guard rather than a pair of calls because there are four ways out of the
/// read loop — a close frame, a protocol error, the socket dying, the task being
/// aborted at teardown — and only one of them is the one anybody writes the
/// matching call after.
struct Attached(OnClient);

impl Attached {
	fn new(on_client: OnClient) -> Self {
		(on_client)(true);
		Self(on_client)
	}
}

impl Drop for Attached {
	fn drop(&mut self) {
		(self.0)(false);
	}
}

/// Compare in time independent of how much of the token matched.
///
/// Length is allowed to leak: it is fixed and public. This is not the boundary
/// the design leans on — [`super::scope`] is — but a token check that returns
/// early on the first wrong byte is a needless gift, and the whole-length
/// version costs nothing.
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
	use super::*;

	#[test]
	fn a_token_matches_only_itself() {
		assert!(tokens_match("abc", "abc"));
		assert!(!tokens_match("abc", "abd"));
		assert!(!tokens_match("", "abc"));
		assert!(!tokens_match("abc", ""));
		// A prefix must not pass — the loop runs to the end, but only because
		// the lengths are compared first.
		assert!(!tokens_match("ab", "abc"));
		assert!(!tokens_match("abcd", "abc"));
	}
}
