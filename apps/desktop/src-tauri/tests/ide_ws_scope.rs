//! The IDE bridge's security boundary, driven through the socket
//! (F20, ADR-0017 § 3).
//!
//! ADR-0017 calls for this as a test rather than a comment, and names the
//! reason: any process on the machine can reach a loopback port, so getting
//! this wrong turns a developer tool into a local file oracle. It is also the
//! kind of wrong that nobody reports, because the feature keeps working.
//!
//! Two layers are exercised here, and they are not equally important.
//!
//! - **The token** is checked during the handshake, so an unauthorised client
//!   never reaches a WebSocket. It authenticates *a process running as this
//!   user*, which is weaker than it sounds — the token sits in a file that user
//!   can read.
//! - **The path scope** is the layer the design actually leans on, and its
//!   unit tests live beside the function. What is added here is the property
//!   that matters at this level: the scope is anchored to the session's own
//!   project, so one session's bridge cannot reach another session's files.
//!
//! The third layer, the loopback bind, is asserted on the address the listener
//! actually bound rather than by failing to reach it from elsewhere — see that
//! test for why the obvious version of it was vacuous.

use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::sync::Arc;
use std::time::Duration;

use factorai_lib::services::ide::lockfile;
use factorai_lib::services::ide::scope::resolve_within;
use factorai_lib::services::ide::server::IdeServer;
use tempfile::TempDir;

/// A bridge over a throwaway `~/.claude` and a throwaway project, plus the
/// handler's inbox so a test can assert what actually arrived.
struct Harness {
	_claude: TempDir,
	project: TempDir,
	server: IdeServer,
	seen: Arc<parking_lot::Mutex<Vec<String>>>,
	/// Every attach/detach edge, in order, for the badge the header draws.
	clients: Arc<parking_lot::Mutex<Vec<bool>>>,
}

fn harness() -> Harness {
	let claude = TempDir::new().unwrap();
	let project = TempDir::new().unwrap();
	let seen = Arc::new(parking_lot::Mutex::new(Vec::new()));
	let clients = Arc::new(parking_lot::Mutex::new(Vec::new()));

	let sink = seen.clone();
	let edges = clients.clone();
	let server = IdeServer::start(
		claude.path(),
		project.path().to_str().unwrap(),
		Arc::new(move |text: &str| {
			sink.lock().push(text.to_string());
			Some(format!("echo:{text}"))
		}),
		Arc::new(move |connected| edges.lock().push(connected)),
	)
	.expect("bridge starts");

	Harness { _claude: claude, project, server, seen, clients }
}

/// Open a WebSocket to the bridge with whatever authorization header is given.
/// `None` sends no header at all, which is a different rejection path from a
/// wrong one and has to be covered separately.
fn connect(
	port: u16,
	token: Option<&str>,
) -> Result<
	tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<TcpStream>>,
	tungstenite::Error,
> {
	connect_offering(port, token, None).map(|(socket, _)| socket)
}

/// Connect, optionally offering a subprotocol, and keep the handshake response
/// so a test can read what was selected.
fn connect_offering(
	port: u16,
	token: Option<&str>,
	protocols: Option<&str>,
) -> Result<
	(
		tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<TcpStream>>,
		tungstenite::handshake::client::Response,
	),
	tungstenite::Error,
> {
	use tungstenite::client::IntoClientRequest;

	let mut request = format!("ws://127.0.0.1:{port}").into_client_request().unwrap();
	if let Some(token) = token {
		request.headers_mut().insert("x-claude-code-ide-authorization", token.parse().unwrap());
	}
	if let Some(protocols) = protocols {
		request.headers_mut().insert("sec-websocket-protocol", protocols.parse().unwrap());
	}
	tungstenite::connect(request)
}

#[test]
fn the_right_token_gets_in_and_its_messages_are_delivered() {
	let h = harness();

	let mut ws = connect(h.server.port(), Some(h.server.token())).expect("authorised client");
	ws.send(tungstenite::Message::Text("hello".into())).unwrap();
	let reply = ws.read().unwrap();

	assert_eq!(reply.into_text().unwrap().as_str(), "echo:hello");
	assert_eq!(h.seen.lock().as_slice(), ["hello"]);
}

#[test]
fn a_wrong_token_never_becomes_a_websocket() {
	let h = harness();

	let err = connect(h.server.port(), Some("not-the-token")).expect_err("must be refused");

	// Refused during the handshake, so there is an HTTP response rather than a
	// socket that later misbehaves.
	match err {
		tungstenite::Error::Http(res) => assert_eq!(res.status(), 401),
		other => panic!("expected a 401, got {other:?}"),
	}
	assert!(h.seen.lock().is_empty(), "nothing may reach the handler");
}

#[test]
fn no_token_at_all_is_refused_the_same_way() {
	// Distinct from the wrong-token path: a missing header must not read as an
	// empty string that happens to compare equal to an empty secret.
	let h = harness();

	let err = connect(h.server.port(), None).expect_err("must be refused");

	match err {
		tungstenite::Error::Http(res) => assert_eq!(res.status(), 401),
		other => panic!("expected a 401, got {other:?}"),
	}
	assert!(h.seen.lock().is_empty());
}

#[test]
fn one_sessions_token_does_not_open_another_sessions_bridge() {
	// The point of a port per session: the tokens are independent, so a client
	// that legitimately holds one cannot walk to the other.
	let a = harness();
	let b = harness();

	assert_ne!(a.server.token(), b.server.token());
	assert!(connect(b.server.port(), Some(a.server.token())).is_err());
}

#[test]
fn the_bridge_binds_loopback_and_nothing_wider() {
	// A one-character change from 127.0.0.1 to 0.0.0.0 would put this on the
	// network and look identical in review and in every other test here.
	//
	// Asserted on the bound address rather than by failing to reach the port
	// from another interface. That was the first version and it was **vacuous
	// on the machine it was written on**: this host's name resolves to
	// 127.0.1.1, which is itself loopback, so there was no routable address to
	// try and the check passed by never running. A test that is silent when
	// there is nothing to test looks exactly like a test that passed.
	let h = harness();

	assert!(h.server.local_addr().ip().is_loopback(), "the bridge must not be routable");
	assert!(
		TcpStream::connect_timeout(
			&SocketAddr::from((Ipv4Addr::LOCALHOST, h.server.port())),
			Duration::from_secs(2),
		)
		.is_ok(),
		"and loopback must still reach it"
	);
}

#[test]
fn the_lockfile_appears_while_the_bridge_is_up_and_is_gone_when_it_stops() {
	let claude = TempDir::new().unwrap();
	let project = TempDir::new().unwrap();

	let port = {
		let server = IdeServer::start(
			claude.path(),
			project.path().to_str().unwrap(),
			Arc::new(|_: &str| None),
			Arc::new(|_| {}),
		)
		.unwrap();
		let port = server.port();

		let lock = lockfile::read(&lockfile::path_for(claude.path(), port))
			.expect("the handle is on disk while we are listening");
		assert!(lock.is_ours());
		assert_eq!(lock.pid, std::process::id());
		assert_eq!(lock.workspace_folders, vec![project.path().to_str().unwrap().to_string()]);
		assert_eq!(lock.auth_token, server.token());

		port
	};

	assert!(
		!lockfile::path_for(claude.path(), port).exists(),
		"dropping the bridge must not leave a handle pointing at a dead port"
	);
}

#[test]
fn the_scope_is_anchored_to_this_sessions_project_and_not_its_neighbour() {
	// The layer that actually matters, asserted at the level this file is
	// about: two bridges, two projects, and neither can name the other's files.
	let a = harness();
	let b = harness();

	let a_file = a.project.path().join("mine.txt");
	std::fs::write(&a_file, "").unwrap();

	assert!(resolve_within(a.project.path(), a_file.to_str().unwrap()).is_ok());
	assert!(
		resolve_within(b.project.path(), a_file.to_str().unwrap()).is_err(),
		"a bridge must not resolve a path belonging to another session's project"
	);
}

/// **The regression this file exists for as much as the auth ones.**
///
/// The CLI builds its socket as `new WebSocket(url, { protocols: ["mcp"], … })`.
/// A client that offers a subprotocol and is handed a handshake without one may
/// treat the connection as unusable — and this one does, resetting immediately
/// after a *successful* handshake. From the server's side that looks like a
/// connection that opened and vanished with nothing sent, which is what it
/// looked like for the first run against the real binary.
///
/// Every other test here passed while this was broken, because our own client
/// never asked for a subprotocol.
#[test]
fn the_mcp_subprotocol_is_echoed_when_the_client_offers_it() {
	let h = harness();

	let (_ws, response) =
		connect_offering(h.server.port(), Some(h.server.token()), Some("mcp")).expect("connects");

	assert_eq!(
		response.headers().get("sec-websocket-protocol").and_then(|v| v.to_str().ok()),
		Some("mcp"),
	);
}

#[test]
fn a_subprotocol_is_not_invented_when_none_was_offered() {
	// The same violation in the other direction: selecting one the client never
	// asked for breaks a client that is happy without any.
	let h = harness();

	let (_ws, response) =
		connect_offering(h.server.port(), Some(h.server.token()), None).expect("connects");

	assert!(response.headers().get("sec-websocket-protocol").is_none());
}

#[test]
fn a_subprotocol_list_containing_mcp_is_matched() {
	// Clients may offer several, comma-separated.
	let h = harness();

	let (_ws, response) =
		connect_offering(h.server.port(), Some(h.server.token()), Some("other, mcp"))
			.expect("connects");

	assert_eq!(
		response.headers().get("sec-websocket-protocol").and_then(|v| v.to_str().ok()),
		Some("mcp"),
	);
}

/// The header's connected dot is the only place an open port is visible, so
/// both edges have to be right — and the closing one is the easy half to lose.
#[test]
fn attaching_and_detaching_are_both_reported() {
	let h = harness();

	{
		let mut ws = connect(h.server.port(), Some(h.server.token())).expect("connects");
		ws.send(tungstenite::Message::Text("hi".into())).unwrap();
		let _ = ws.read().unwrap();
		assert_eq!(h.clients.lock().as_slice(), [true], "attached, and not yet detached");
		ws.close(None).unwrap();
		let _ = ws.read();
	}

	// The guard fires however the connection ends, which is the point of it
	// being a guard: a client that vanishes must not leave the header claiming
	// it is still there.
	for _ in 0..50 {
		if h.clients.lock().len() > 1 {
			break;
		}
		std::thread::sleep(Duration::from_millis(20));
	}
	assert_eq!(h.clients.lock().as_slice(), [true, false]);
}

#[test]
fn a_refused_client_never_counts_as_attached() {
	// The badge means "Claude is here", not "something knocked".
	let h = harness();

	assert!(connect(h.server.port(), Some("wrong")).is_err());

	assert!(h.clients.lock().is_empty());
}
