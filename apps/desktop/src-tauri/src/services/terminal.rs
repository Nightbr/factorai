//! Cross-platform PTY-backed terminal manager.
//!
//! One `TerminalHandle` per running process. The handle owns the PTY
//! master, the child handle, and a writer. A dedicated OS thread reads
//! bytes from the PTY and fans them out as `terminal:data` events
//! (base64-encoded — see ADR-0002 + specs/03-backend-rust.md).
//!
//! Kill-on-quit (ADR-0005) is wired through `kill_all()`, which is also
//! invoked from `Drop` as a last-ditch backstop.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use dashmap::DashMap;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::services::claude_cli::find_claude_binary;

pub type TerminalId = String;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalStatus {
	Running,
	Idle,
	WaitingInput,
	Stopped,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnOpts {
	/// If set, launches `claude --resume <id>` instead of a fresh session.
	pub resume_session_id: Option<String>,
	/// Working directory. Defaults to user $HOME when not provided.
	pub cwd: Option<String>,
	pub cols: u16,
	pub rows: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStatusDto {
	pub id: TerminalId,
	pub session_id: Option<String>,
	pub status: TerminalStatus,
	pub last_activity: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDataEvent {
	pub id: TerminalId,
	pub bytes_b64: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStatusEvent {
	pub id: TerminalId,
	pub status: TerminalStatus,
	pub last_activity: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitEvent {
	pub id: TerminalId,
	pub code: Option<i32>,
}

type DataCb = Arc<dyn Fn(TerminalDataEvent) + Send + Sync>;
type StatusCb = Arc<dyn Fn(TerminalStatusEvent) + Send + Sync>;
type ExitCb = Arc<dyn Fn(TerminalExitEvent) + Send + Sync>;

struct TerminalHandle {
	session_id: Option<String>,
	master: Mutex<Box<dyn MasterPty + Send>>,
	writer: Mutex<Box<dyn Write + Send>>,
	child: Mutex<Box<dyn Child + Send + Sync>>,
	status: Mutex<TerminalStatus>,
	last_activity: AtomicI64,
}

#[derive(Clone)]
pub struct TerminalManager {
	terminals: Arc<DashMap<TerminalId, Arc<TerminalHandle>>>,
	on_data: DataCb,
	on_status: StatusCb,
	on_exit: ExitCb,
	/// Override for tests. None → use `find_claude_binary()` at spawn time.
	binary_override: Option<PathBuf>,
}

impl TerminalManager {
	pub fn for_app(app: AppHandle) -> Self {
		let app_data = app.clone();
		let app_status = app.clone();
		let app_exit = app;
		Self {
			terminals: Arc::new(DashMap::new()),
			on_data: Arc::new(move |e| {
				let _ = app_data.emit("terminal:data", e);
			}),
			on_status: Arc::new(move |e| {
				let _ = app_status.emit("terminal:status", e);
			}),
			on_exit: Arc::new(move |e| {
				let _ = app_exit.emit("terminal:exit", e);
			}),
			binary_override: None,
		}
	}

	pub fn with_callbacks(on_data: DataCb, on_status: StatusCb, on_exit: ExitCb) -> Self {
		Self {
			terminals: Arc::new(DashMap::new()),
			on_data,
			on_status,
			on_exit,
			binary_override: None,
		}
	}

	/// Override the binary the manager will spawn. For tests only.
	#[cfg(test)]
	pub fn set_binary(&mut self, path: PathBuf) {
		self.binary_override = Some(path);
	}

	pub fn live_count(&self) -> usize {
		self.terminals.len()
	}

	pub fn list(&self) -> Vec<TerminalStatusDto> {
		self.terminals
			.iter()
			.map(|entry| {
				let h = entry.value();
				TerminalStatusDto {
					id: entry.key().clone(),
					session_id: h.session_id.clone(),
					status: *h.status.lock(),
					last_activity: h.last_activity.load(Ordering::Relaxed),
				}
			})
			.collect()
	}

	/// Spawn `claude` (or `claude --resume <id>`) in a PTY. Returns the
	/// new terminal id.
	pub fn spawn(&self, opts: SpawnOpts) -> AppResult<TerminalId> {
		self.spawn_with_argv(opts, None)
	}

	/// Internal: same as `spawn` but allows overriding argv for tests
	/// (e.g. invoking `/bin/sh -c "..."` instead of `claude`).
	fn spawn_with_argv(
		&self,
		opts: SpawnOpts,
		argv_override: Option<Vec<String>>,
	) -> AppResult<TerminalId> {
		let argv = match argv_override {
			Some(v) => v,
			None => {
				let bin = match &self.binary_override {
					Some(p) => p.clone(),
					None => find_claude_binary()?,
				};
				let mut v = vec![bin.to_string_lossy().to_string()];
				if let Some(sid) = &opts.resume_session_id {
					v.push("--resume".into());
					v.push(sid.clone());
				}
				v
			}
		};

		let mut cmd = CommandBuilder::new(&argv[0]);
		for a in argv.iter().skip(1) {
			cmd.arg(a);
		}
		let cwd_path = opts
			.cwd
			.as_deref()
			.map(PathBuf::from)
			.or_else(dirs::home_dir)
			.unwrap_or_else(|| PathBuf::from("/"));
		cmd.cwd(&cwd_path);
		// Inherit the parent env so PATH / TERM / HOME etc. are present.
		for (k, v) in std::env::vars_os() {
			cmd.env(k, v);
		}
		// xterm.js renders best as xterm-256color.
		cmd.env("TERM", "xterm-256color");

		let pty_system = native_pty_system();
		let pair = pty_system
			.openpty(PtySize {
				cols: opts.cols.max(20),
				rows: opts.rows.max(5),
				pixel_width: 0,
				pixel_height: 0,
			})
			.map_err(|e| AppError::Process(format!("openpty: {e}")))?;
		let child = pair
			.slave
			.spawn_command(cmd)
			.map_err(|e| AppError::Process(format!("spawn: {e}")))?;
		drop(pair.slave); // close slave end in the parent so EOF works
		let writer = pair
			.master
			.take_writer()
			.map_err(|e| AppError::Process(format!("take_writer: {e}")))?;
		let reader = pair
			.master
			.try_clone_reader()
			.map_err(|e| AppError::Process(format!("clone_reader: {e}")))?;

		let id = Uuid::new_v4().to_string();
		info!(%id, argv = ?argv, cwd = ?cwd_path, "spawned terminal");

		let handle = Arc::new(TerminalHandle {
			session_id: opts.resume_session_id.clone(),
			master: Mutex::new(pair.master),
			writer: Mutex::new(writer),
			child: Mutex::new(child),
			status: Mutex::new(TerminalStatus::Running),
			last_activity: AtomicI64::new(now_ms()),
		});

		self.terminals.insert(id.clone(), handle.clone());

		// Reader thread: pump PTY bytes → on_data event.
		spawn_reader(id.clone(), reader, handle.clone(), self.on_data.clone());
		// Wait thread: emit on_exit when the child terminates.
		spawn_waiter(id.clone(), handle.clone(), self.on_status.clone(), self.on_exit.clone(), self.terminals.clone());

		Ok(id)
	}

	pub fn write(&self, id: &str, data: &[u8]) -> AppResult<()> {
		let handle = self
			.terminals
			.get(id)
			.ok_or_else(|| AppError::NotFound(format!("terminal {id}")))?;
		let mut w = handle.writer.lock();
		w.write_all(data)
			.map_err(|e| AppError::Io(format!("terminal write: {e}")))?;
		handle.last_activity.store(now_ms(), Ordering::Relaxed);
		Ok(())
	}

	pub fn resize(&self, id: &str, cols: u16, rows: u16) -> AppResult<()> {
		let handle = self
			.terminals
			.get(id)
			.ok_or_else(|| AppError::NotFound(format!("terminal {id}")))?;
		handle
			.master
			.lock()
			.resize(PtySize { cols: cols.max(20), rows: rows.max(5), pixel_width: 0, pixel_height: 0 })
			.map_err(|e| AppError::Process(format!("resize: {e}")))?;
		Ok(())
	}

	pub fn kill(&self, id: &str) -> AppResult<()> {
		let handle = self
			.terminals
			.get(id)
			.ok_or_else(|| AppError::NotFound(format!("terminal {id}")))?;
		let mut child = handle.child.lock();
		// Best effort — child may already be gone.
		let _ = child.kill();
		Ok(())
	}

	/// Kill every live terminal. SIGTERM via `child.kill()`, then a 500ms
	/// grace period, then anything still alive gets force-killed by Drop.
	pub fn kill_all(&self) {
		let ids: Vec<TerminalId> = self.terminals.iter().map(|e| e.key().clone()).collect();
		debug!(count = ids.len(), "kill_all");
		for id in &ids {
			let _ = self.kill(id);
		}
		std::thread::sleep(Duration::from_millis(500));
		for id in &ids {
			if let Some(entry) = self.terminals.remove(id) {
				let (_, handle) = entry;
				let _ = handle.child.lock().kill();
			}
		}
	}
}

impl Drop for TerminalManager {
	fn drop(&mut self) {
		// Final backstop — only fires if this is the last Arc reference to
		// the inner DashMap. In production the manager lives in tauri::State
		// for the app lifetime, so this only meaningfully runs at process
		// teardown.
		if Arc::strong_count(&self.terminals) == 1 && !self.terminals.is_empty() {
			warn!("TerminalManager dropped with live PTYs — force-killing");
			let ids: Vec<TerminalId> = self.terminals.iter().map(|e| e.key().clone()).collect();
			for id in &ids {
				if let Some((_, handle)) = self.terminals.remove(id) {
					let _ = handle.child.lock().kill();
				}
			}
		}
	}
}

/// Flush window for batched PTY output. 16ms ≈ one display frame; the
/// renderer can't usefully consume bytes faster than that anyway, and
/// coalescing 100s of small reads into one event has a major effect on
/// IPC overhead when `claude --resume` is replaying a long history.
const FLUSH_WINDOW: Duration = Duration::from_millis(16);
/// Force-flush threshold — if the buffer crosses this size before the
/// window fires, emit immediately so the renderer doesn't fall behind.
const FLUSH_BYTES: usize = 32 * 1024;

fn spawn_reader(
	id: TerminalId,
	mut reader: Box<dyn Read + Send>,
	handle: Arc<TerminalHandle>,
	on_data: DataCb,
) {
	let buffer: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::with_capacity(FLUSH_BYTES)));
	let eof = Arc::new(AtomicBool::new(false));

	// Reader thread: blocking PTY reads → push into shared buffer.
	let buf_r = buffer.clone();
	let eof_r = eof.clone();
	let handle_r = handle.clone();
	let id_r = id.clone();
	std::thread::Builder::new()
		.name(format!("term-reader-{id}"))
		.spawn(move || {
			let mut tmp = [0u8; 8192];
			loop {
				match reader.read(&mut tmp) {
					Ok(0) => break,
					Ok(n) => {
						handle_r.last_activity.store(now_ms(), Ordering::Relaxed);
						buf_r.lock().extend_from_slice(&tmp[..n]);
					}
					Err(e) => {
						warn!(id = %id_r, error = %e, "terminal read error");
						break;
					}
				}
			}
			eof_r.store(true, Ordering::Release);
		})
		.expect("spawn term-reader thread");

	// Flusher thread: ticks every FLUSH_WINDOW, emits coalesced chunks.
	std::thread::Builder::new()
		.name(format!("term-flush-{id}"))
		.spawn(move || {
			loop {
				std::thread::sleep(FLUSH_WINDOW);
				let chunk = {
					let mut buf = buffer.lock();
					if buf.is_empty() {
						if eof.load(Ordering::Acquire) {
							break;
						}
						continue;
					}
					std::mem::take(&mut *buf)
				};
				emit_data(&id, &chunk, &on_data);
			}
			// One last drain after the reader signaled EOF.
			let chunk = std::mem::take(&mut *buffer.lock());
			if !chunk.is_empty() {
				emit_data(&id, &chunk, &on_data);
			}
		})
		.expect("spawn term-flush thread");
}

fn emit_data(id: &TerminalId, bytes: &[u8], on_data: &DataCb) {
	// Split very large chunks into FLUSH_BYTES-sized pieces so a single
	// emit doesn't pin the renderer with a multi-MB base64 string.
	for piece in bytes.chunks(FLUSH_BYTES) {
		let payload = TerminalDataEvent { id: id.clone(), bytes_b64: B64.encode(piece) };
		(on_data)(payload);
	}
}

fn spawn_waiter(
	id: TerminalId,
	handle: Arc<TerminalHandle>,
	on_status: StatusCb,
	on_exit: ExitCb,
	terminals: Arc<DashMap<TerminalId, Arc<TerminalHandle>>>,
) {
	std::thread::Builder::new()
		.name(format!("term-wait-{id}"))
		.spawn(move || {
			let exit_code = handle.child.lock().wait().ok().and_then(|s| s.exit_code().try_into().ok());
			{
				let mut st = handle.status.lock();
				*st = TerminalStatus::Stopped;
			}
			let last_activity = handle.last_activity.load(Ordering::Relaxed);
			(on_status)(TerminalStatusEvent { id: id.clone(), status: TerminalStatus::Stopped, last_activity });
			(on_exit)(TerminalExitEvent { id: id.clone(), code: exit_code });
			terminals.remove(&id);
		})
		.expect("spawn term-wait thread");
}

fn now_ms() -> i64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_millis() as i64)
		.unwrap_or(0)
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::sync::{Arc, Mutex as StdMutex};

	type DataLog = Arc<StdMutex<Vec<TerminalDataEvent>>>;
	type ExitLog = Arc<StdMutex<Vec<TerminalExitEvent>>>;

	fn make_manager() -> (TerminalManager, DataLog, ExitLog) {
		let data: DataLog = Arc::new(StdMutex::new(Vec::new()));
		let exit: ExitLog = Arc::new(StdMutex::new(Vec::new()));
		let dc = data.clone();
		let ec = exit.clone();
		let mgr = TerminalManager::with_callbacks(
			Arc::new(move |e| dc.lock().unwrap().push(e)),
			Arc::new(|_| {}),
			Arc::new(move |e| ec.lock().unwrap().push(e)),
		);
		(mgr, data, exit)
	}

	#[test]
	fn spawn_runs_and_streams_output() {
		let (mgr, data, exit) = make_manager();
		let id = mgr
			.spawn_with_argv(
				SpawnOpts { resume_session_id: None, cwd: None, cols: 80, rows: 24 },
				Some(vec![
					"/bin/sh".into(),
					"-c".into(),
					"echo HELLO_PTY".into(),
				]),
			)
			.expect("spawn");
		// Wait for the child to exit.
		for _ in 0..50 {
			std::thread::sleep(Duration::from_millis(50));
			if exit.lock().unwrap().iter().any(|e| e.id == id) {
				break;
			}
		}
		let chunks: Vec<String> = data
			.lock()
			.unwrap()
			.iter()
			.filter(|e| e.id == id)
			.map(|e| String::from_utf8_lossy(&B64.decode(&e.bytes_b64).unwrap_or_default()).into_owned())
			.collect();
		let merged = chunks.join("");
		assert!(merged.contains("HELLO_PTY"), "expected HELLO_PTY in stream, got: {merged}");
		assert!(
			exit.lock().unwrap().iter().any(|e| e.id == id),
			"expected exit event"
		);
	}

	#[test]
	fn write_input_reaches_child_process() {
		// Spawn a tiny shell script that reads one line and echoes it with a
		// recognisable prefix. Avoids `cat`'s line-buffer quirks.
		let (mgr, data, exit) = make_manager();
		let id = mgr
			.spawn_with_argv(
				SpawnOpts { resume_session_id: None, cwd: None, cols: 80, rows: 24 },
				Some(vec![
					"/bin/sh".into(),
					"-c".into(),
					"read line; echo \"GOT:$line\"".into(),
				]),
			)
			.expect("spawn");
		// Give the shell a moment to start its `read` loop.
		std::thread::sleep(Duration::from_millis(200));
		mgr.write(&id, b"hello\n").expect("write");

		for _ in 0..80 {
			std::thread::sleep(Duration::from_millis(50));
			if exit.lock().unwrap().iter().any(|e| e.id == id) {
				break;
			}
		}
		let merged = data
			.lock()
			.unwrap()
			.iter()
			.filter(|e| e.id == id)
			.map(|e| {
				String::from_utf8_lossy(&B64.decode(&e.bytes_b64).unwrap_or_default()).into_owned()
			})
			.collect::<Vec<_>>()
			.join("");
		assert!(
			merged.contains("GOT:hello"),
			"expected GOT:hello in stream, got: {merged:?}"
		);
	}

	#[test]
	fn kill_terminates_long_running_process() {
		let (mgr, _data, exit) = make_manager();
		let id = mgr
			.spawn_with_argv(
				SpawnOpts { resume_session_id: None, cwd: None, cols: 80, rows: 24 },
				Some(vec!["/bin/sh".into(), "-c".into(), "sleep 60".into()]),
			)
			.expect("spawn sleep");
		assert_eq!(mgr.live_count(), 1);
		mgr.kill(&id).expect("kill");
		// Waiter thread should emit the exit event within a couple of seconds.
		for _ in 0..40 {
			std::thread::sleep(Duration::from_millis(100));
			if exit.lock().unwrap().iter().any(|e| e.id == id) {
				return;
			}
		}
		panic!("kill did not produce an exit event in time");
	}

	#[test]
	fn list_reflects_live_terminals() {
		let (mgr, _data, _exit) = make_manager();
		let id = mgr
			.spawn_with_argv(
				SpawnOpts { resume_session_id: None, cwd: None, cols: 80, rows: 24 },
				Some(vec!["/bin/sh".into(), "-c".into(), "sleep 30".into()]),
			)
			.unwrap();
		let listing = mgr.list();
		assert_eq!(listing.len(), 1);
		assert_eq!(listing[0].id, id);
		assert_eq!(listing[0].status, TerminalStatus::Running);
		let _ = mgr.kill(&id);
	}

	#[test]
	fn kill_all_drops_every_terminal() {
		let (mgr, _data, _exit) = make_manager();
		for _ in 0..3 {
			mgr.spawn_with_argv(
				SpawnOpts { resume_session_id: None, cwd: None, cols: 80, rows: 24 },
				Some(vec!["/bin/sh".into(), "-c".into(), "sleep 30".into()]),
			)
			.unwrap();
		}
		assert_eq!(mgr.live_count(), 3);
		mgr.kill_all();
		// kill_all sleeps 500ms internally before removing; live_count is 0 after.
		assert_eq!(mgr.live_count(), 0);
	}
}
