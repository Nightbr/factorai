//! A loopback HTTP server for the viewer's media files (F7, ADR-0057).
//!
//! **Why this exists rather than a custom protocol.** ADR-0056 shipped media
//! over Tauri's `asset://` scheme, which answers Range correctly and needed no
//! server at all. It cannot work on Linux: WebKitGTK plays media through
//! GStreamer, whose resource loader never sees the scheme handler the WebView
//! registered, so `<video src="asset://…">` fails with `NETWORK_NO_SOURCE`
//! while `fetch()` of the very same URL returns the whole file. The full
//! measurement is in ADR-0057. An `http://127.0.0.1` URL is the one thing both
//! webviews will load, so this is the transport for both platforms rather than
//! a Linux branch.
//!
//! **What guards it.** Three things, in this order: the listener is bound to
//! `127.0.0.1` so nothing off this machine can reach it; every request carries
//! a per-run bearer token; and a URL names an **opaque id**, never a path, so
//! there is no traversal to attempt and no filesystem layout in the DOM. A file
//! is reachable only after `probe_media` has published it, which is to say only
//! after a human opened it in the viewer.
//!
//! **Why it is hand-rolled.** It answers `GET` with an optional `Range` and
//! nothing else — no routing, no keep-alive, no compression. That is a hundred
//! lines against a dependency the size of hyper, and the surface it does *not*
//! have is the point of a socket that is open while the app runs.

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, TcpListener as StdTcpListener};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tracing::{debug, warn};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

/// How much of a range we move per write. Large enough that a 2GB file is not
/// a million syscalls, small enough that one request never holds a buffer worth
/// noticing.
const CHUNK: usize = 64 * 1024;

/// The longest request head we will read before giving up. A media element
/// sends a handful of short headers; anything past this is not one of ours.
const MAX_HEAD: usize = 8 * 1024;

/// What a published file is reachable as.
type Published = Arc<Mutex<HashMap<String, Served>>>;

/// One published file: where it is, and what to call it on the way out.
#[derive(Clone)]
struct Served {
	path: PathBuf,
	/// The type the probe sniffed. **Sent back verbatim, and it matters**:
	/// WebKit picks its demuxer from the response type, and an
	/// `application/octet-stream` is a file it will not try to play.
	mime: String,
}

pub struct MediaServer {
	addr: SocketAddr,
	token: String,
	files: Published,
}

impl MediaServer {
	/// Bind and start serving.
	///
	/// Port 0, so the OS picks one and a second factorai cannot collide with
	/// this one — the same bargain the IDE bridge strikes for the same reason.
	/// The task runs on Tauri's runtime, so the listener dies with the process
	/// and there is no socket to leak on quit.
	pub fn start() -> AppResult<Self> {
		let std_listener = StdTcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
			.map_err(|e| AppError::Io(format!("binding the media server: {e}")))?;
		std_listener
			.set_nonblocking(true)
			.map_err(|e| AppError::Io(format!("media server socket: {e}")))?;
		let addr = std_listener
			.local_addr()
			.map_err(|e| AppError::Io(format!("media server socket: {e}")))?;

		let token = Uuid::new_v4().to_string();
		let files: Published = Arc::new(Mutex::new(HashMap::new()));

		let accept_token = token.clone();
		let accept_files = files.clone();
		tauri::async_runtime::spawn(async move {
			let listener = match TcpListener::from_std(std_listener) {
				Ok(l) => l,
				Err(e) => {
					warn!(error = %e, "media server could not adopt its listener");
					return;
				}
			};
			loop {
				let (stream, _) = match listener.accept().await {
					Ok(pair) => pair,
					Err(e) => {
						warn!(error = %e, "media server accept failed");
						continue;
					}
				};
				let token = accept_token.clone();
				let files = accept_files.clone();
				// One task per connection, and a failure in it is that
				// connection's alone: a request we could not answer must not
				// take the listener down with it.
				tauri::async_runtime::spawn(async move {
					if let Err(e) = serve(stream, &token, &files).await {
						debug!(error = %e, "media request ended early");
					}
				});
			}
		});

		debug!(port = addr.port(), "media server listening");
		Ok(Self { addr, token, files })
	}

	/// Publish one file and answer with the URL that fetches it.
	///
	/// Idempotent by path: opening the same video twice hands back the same id
	/// rather than growing the table with every reopen.
	pub fn publish(&self, path: &Path, mime: &str) -> String {
		let mut files = self.files.lock().expect("media table");
		let id = files
			.iter()
			.find(|(_, served)| served.path.as_path() == path)
			.map(|(id, _)| id.clone())
			.unwrap_or_else(|| {
				let id = Uuid::new_v4().to_string();
				files.insert(
					id.clone(),
					Served { path: path.to_path_buf(), mime: mime.to_string() },
				);
				id
			});
		format!("http://127.0.0.1:{}/m/{}?t={}", self.addr.port(), id, self.token)
	}

	#[cfg(test)]
	pub fn addr(&self) -> SocketAddr {
		self.addr
	}
}

/// Answer one connection: parse the head, check the token, serve the range.
async fn serve(stream: TcpStream, token: &str, files: &Published) -> std::io::Result<()> {
	let mut reader = BufReader::new(stream);
	let Some(head) = read_head(&mut reader).await? else {
		return Ok(());
	};
	let mut stream = reader.into_inner();

	let Some(request) = parse_request(&head) else {
		return respond_status(&mut stream, 400, "Bad Request").await;
	};
	// The token first, so a caller that cannot present one learns nothing about
	// whether the id it guessed exists.
	if request.token.as_deref() != Some(token) {
		return respond_status(&mut stream, 403, "Forbidden").await;
	}
	let served = files.lock().expect("media table").get(&request.id).cloned();
	let Some(served) = served else {
		return respond_status(&mut stream, 404, "Not Found").await;
	};

	let mut file = match tokio::fs::File::open(&served.path).await {
		Ok(f) => f,
		// The file was published and has since gone — an agent moved it under
		// the reader. A 404 is what the viewer turns into "it may have been
		// moved or deleted".
		Err(_) => return respond_status(&mut stream, 404, "Not Found").await,
	};
	let len = file.metadata().await?.len();

	let asked_for_a_range = request.range.is_some();
	let (start, end, status) = match request.range.and_then(|r| resolve_range(&r, len)) {
		Some((s, e)) => (s, e, 206),
		None if asked_for_a_range => {
			// A range we cannot satisfy is its own status, and saying so is what
			// stops the element retrying the same impossible ask.
			let head = format!(
				"HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{len}\r\n\
				 Content-Length: 0\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n"
			);
			stream.write_all(head.as_bytes()).await?;
			return stream.flush().await;
		}
		None => (0, len.saturating_sub(1), 200),
	};

	// An empty file has no byte to serve; `len - 1` would have wrapped.
	let count = if len == 0 { 0 } else { end - start + 1 };
	let mut head = String::new();
	head.push_str(if status == 206 {
		"HTTP/1.1 206 Partial Content\r\n"
	} else {
		"HTTP/1.1 200 OK\r\n"
	});
	// **The type the probe sniffed, not a generic one.** WebKit chooses its
	// demuxer from this header, and an `application/octet-stream` is a file it
	// declines to play at all.
	head.push_str(&format!("Content-Type: {}\r\n", served.mime));
	head.push_str("Accept-Ranges: bytes\r\n");
	// The token is the guard, not the origin: the renderer's origin differs
	// between `tauri://localhost` and the dev server, and no caller that cannot
	// present the token gets this far.
	head.push_str("Access-Control-Allow-Origin: *\r\n");
	head.push_str("Connection: close\r\n");
	if status == 206 {
		head.push_str(&format!("Content-Range: bytes {start}-{end}/{len}\r\n"));
	}
	head.push_str(&format!("Content-Length: {count}\r\n\r\n"));
	stream.write_all(head.as_bytes()).await?;

	if count > 0 {
		file.seek(std::io::SeekFrom::Start(start)).await?;
		let mut left = count;
		let mut buf = vec![0u8; CHUNK.min(count as usize)];
		while left > 0 {
			let want = buf.len().min(left as usize);
			let read = file.read(&mut buf[..want]).await?;
			if read == 0 {
				break;
			}
			stream.write_all(&buf[..read]).await?;
			left -= read as u64;
		}
	}
	stream.flush().await
}

/// One request, reduced to the three things this server acts on.
struct Request {
	id: String,
	token: Option<String>,
	range: Option<String>,
}

/// Read up to the blank line that ends the request head.
async fn read_head(reader: &mut BufReader<TcpStream>) -> std::io::Result<Option<String>> {
	let mut head = Vec::new();
	let mut byte = [0u8; 1];
	while !head.ends_with(b"\r\n\r\n") {
		if head.len() >= MAX_HEAD {
			return Ok(None);
		}
		if reader.read(&mut byte).await? == 0 {
			return Ok(None);
		}
		head.push(byte[0]);
	}
	Ok(String::from_utf8(head).ok())
}

/// `GET /m/<id>?t=<token>` and a `Range`, or `None` for anything else.
///
/// Deliberately strict: one method, one path shape. Everything this does not
/// recognise is a request that was not made by our own viewer.
fn parse_request(head: &str) -> Option<Request> {
	let mut lines = head.split("\r\n");
	let target = lines.next()?.strip_prefix("GET ")?.split(' ').next()?;
	let (path, query) = target.split_once('?').unwrap_or((target, ""));
	let id = path.strip_prefix("/m/")?;
	// An id is a uuid we minted. Anything with a separator in it is somebody
	// trying to turn this path into a filesystem one.
	if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
		return None;
	}
	let token = query.split('&').find_map(|pair| pair.strip_prefix("t=")).map(|t| t.to_string());
	let range = lines
		.find(|l| l.to_ascii_lowercase().starts_with("range:"))
		.and_then(|l| l.split_once(':'))
		.map(|(_, v)| v.trim().to_string());
	Some(Request { id: id.to_string(), token, range })
}

/// `bytes=a-b` against a file of `len`, as an inclusive pair, or `None` when it
/// cannot be satisfied.
///
/// Only a single range: a media element asks for one, and answering a multipart
/// request badly is worse than not offering it.
fn resolve_range(header: &str, len: u64) -> Option<(u64, u64)> {
	let spec = header.trim().strip_prefix("bytes=")?;
	if spec.contains(',') || len == 0 {
		return None;
	}
	let (from, to) = spec.split_once('-')?;
	let (start, end) = match (from.trim(), to.trim()) {
		// `bytes=-500` is the *last* 500 bytes, not the first.
		("", last) => {
			let n: u64 = last.parse().ok()?;
			(len.checked_sub(n.min(len))?, len - 1)
		}
		(first, "") => (first.parse().ok()?, len - 1),
		(first, last) => (first.parse().ok()?, last.parse::<u64>().ok()?.min(len - 1)),
	};
	if start > end || start >= len {
		return None;
	}
	Some((start, end))
}

async fn respond_status(stream: &mut TcpStream, code: u16, text: &str) -> std::io::Result<()> {
	let head = format!(
		"HTTP/1.1 {code} {text}\r\nContent-Length: 0\r\n\
		 Access-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n"
	);
	stream.write_all(head.as_bytes()).await?;
	stream.flush().await
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn reads_the_id_the_token_and_the_range() {
		let head = "GET /m/abc-123?t=secret HTTP/1.1\r\nHost: x\r\nRange: bytes=0-99\r\n\r\n";
		let r = parse_request(head).expect("parsed");
		assert_eq!(r.id, "abc-123");
		assert_eq!(r.token.as_deref(), Some("secret"));
		assert_eq!(r.range.as_deref(), Some("bytes=0-99"));
	}

	#[test]
	fn refuses_anything_that_is_not_our_one_shape() {
		// A path that is not `/m/<id>`, a method that is not GET, and an id
		// carrying a separator — the last is the only one that could ever have
		// become a filesystem path.
		assert!(parse_request("GET /etc/passwd HTTP/1.1\r\n\r\n").is_none());
		assert!(parse_request("POST /m/abc?t=x HTTP/1.1\r\n\r\n").is_none());
		assert!(parse_request("GET /m/../../etc/passwd?t=x HTTP/1.1\r\n\r\n").is_none());
		assert!(parse_request("GET /m/a%2Fb?t=x HTTP/1.1\r\n\r\n").is_none());
		assert!(parse_request("GET /m/?t=x HTTP/1.1\r\n\r\n").is_none());
	}

	#[test]
	fn a_request_with_no_token_parses_and_is_refused_later() {
		// Parsing and authorising are separate on purpose: `serve` answers 403
		// before it ever looks the id up, so a caller learns nothing about
		// which ids exist.
		let r = parse_request("GET /m/abc HTTP/1.1\r\n\r\n").expect("parsed");
		assert!(r.token.is_none());
	}

	#[test]
	fn resolves_the_three_range_spellings() {
		assert_eq!(resolve_range("bytes=0-99", 1000), Some((0, 99)));
		// Open-ended: to the last byte.
		assert_eq!(resolve_range("bytes=500-", 1000), Some((500, 999)));
		// Suffix: the *last* n bytes, which is the spelling a demuxer uses to
		// find a trailing index — an mp4 with its moov atom at the end.
		assert_eq!(resolve_range("bytes=-100", 1000), Some((900, 999)));
		// Clamped rather than refused: asking past the end is ordinary.
		assert_eq!(resolve_range("bytes=0-99999", 1000), Some((0, 999)));
	}

	#[test]
	fn refuses_a_range_it_cannot_satisfy() {
		assert_eq!(resolve_range("bytes=1000-1200", 1000), None);
		assert_eq!(resolve_range("bytes=900-100", 1000), None);
		assert_eq!(resolve_range("bytes=0-10", 0), None);
		// Multipart is not offered, and answering it badly would be worse.
		assert_eq!(resolve_range("bytes=0-10,20-30", 1000), None);
		assert_eq!(resolve_range("seconds=0-10", 1000), None);
	}

	#[tokio::test]
	async fn serves_a_published_file_and_guards_it_with_the_token() {
		use tokio::io::AsyncWriteExt as _;

		let dir = tempfile::tempdir().unwrap();
		let path = dir.path().join("clip.mp4");
		let body: Vec<u8> = (0..=255u8).cycle().take(4096).collect();
		std::fs::write(&path, &body).unwrap();

		let server = MediaServer::start().expect("start");
		let url = server.publish(&path, "video/mp4");
		let id = url.split("/m/").nth(1).unwrap().split('?').next().unwrap().to_string();
		let addr = server.addr();

		// The whole file, with the token.
		let (status, payload) = request(addr, &format!("/m/{id}?t={}", server.token), None).await;
		assert_eq!(status, 200);
		assert_eq!(payload, body);

		// One range out of the middle.
		let (status, payload) =
			request(addr, &format!("/m/{id}?t={}", server.token), Some("bytes=100-199")).await;
		assert_eq!(status, 206);
		assert_eq!(payload, body[100..=199]);

		// The wrong token, and no token, reach nothing.
		let (status, _) = request(addr, &format!("/m/{id}?t=nope"), None).await;
		assert_eq!(status, 403);
		let (status, _) = request(addr, &format!("/m/{id}"), None).await;
		assert_eq!(status, 403);

		// A well-formed id nobody published, with a good token.
		let (status, _) =
			request(addr, &format!("/m/{}?t={}", Uuid::new_v4(), server.token), None).await;
		assert_eq!(status, 404);

		// Publishing the same path twice is the same id, not a growing table.
		assert_eq!(server.publish(&path, "video/mp4"), url);

		// And a file that goes away after publishing is a 404, which is what the
		// viewer turns into "moved or deleted".
		std::fs::remove_file(&path).unwrap();
		let (status, _) = request(addr, &format!("/m/{id}?t={}", server.token), None).await;
		assert_eq!(status, 404);

		async fn request(addr: SocketAddr, target: &str, range: Option<&str>) -> (u16, Vec<u8>) {
			let mut s = TcpStream::connect(addr).await.unwrap();
			let mut req = format!("GET {target} HTTP/1.1\r\nHost: localhost\r\n");
			if let Some(r) = range {
				req.push_str(&format!("Range: {r}\r\n"));
			}
			req.push_str("\r\n");
			s.write_all(req.as_bytes()).await.unwrap();
			let mut raw = Vec::new();
			s.read_to_end(&mut raw).await.unwrap();
			let split = raw.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
			let head = String::from_utf8_lossy(&raw[..split]).to_string();
			let code = head.split(' ').nth(1).unwrap().parse().unwrap();
			(code, raw[split + 4..].to_vec())
		}
	}
}
