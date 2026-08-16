//! Cross-platform PTY-backed terminal manager.
//!
//! One `TerminalHandle` per running process. The handle owns the PTY
//! master, the child handle, and a writer. A dedicated OS thread reads
//! bytes from the PTY and fans them out as `terminal:data` events
//! (base64-encoded — see ADR-0002 + specs/03-backend-rust.md).
//!
//! Kill-on-quit (ADR-0005) is wired through `kill_all()`, which is also
//! invoked from `Drop` as a last-ditch backstop.

use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use dashmap::DashMap;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::agents::claude;
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
	/// The session this PTY runs. factorai always names the session — for an
	/// existing one that is Claude's id, for a new one an id we minted (see
	/// `next_session_id` and ADR-0008). Whether it becomes `--resume` or
	/// `--session-id` is decided by `session_flag`, not by the caller.
	pub session_id: String,
	/// The workspace project this session belongs to. Used for grouping — the
	/// status dots, `next_session_id`'s reuse rule — and nothing else. It says
	/// nothing about where the transcript lives; `cwd` does.
	pub project_id: String,
	/// Working directory: the project's folder. Defaults to user $HOME when not
	/// provided. Also what the transcript path is derived from, since that is
	/// exactly what Claude encodes to name its own directory.
	pub cwd: Option<String>,
	pub cols: u16,
	pub rows: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStatusDto {
	pub id: TerminalId,
	pub session_id: String,
	pub project_id: String,
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
	session_id: String,
	project_id: String,
	master: Mutex<Box<dyn MasterPty + Send>>,
	writer: Mutex<Box<dyn Write + Send>>,
	/// A killer cloned from the child at spawn time. We deliberately do NOT
	/// store the `Child` itself here: the waiter thread owns it and blocks on
	/// `wait()` for the process's entire lifetime. If we held the `Child`
	/// behind a `Mutex` (as we once did), every `kill()` would block on that
	/// lock until the process exited on its own — deadlocking the caller.
	/// Since `terminal_kill` is a synchronous Tauri command it runs on the
	/// main thread, so that deadlock froze the whole GUI on terminal open
	/// (StrictMode's spawn-race kill) and on quit (`kill_all`). A `ChildKiller`
	/// signals the process without touching the waiter's `Child`.
	killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
	status: Mutex<TerminalStatus>,
	last_activity: AtomicI64,
}

#[derive(Clone)]
pub struct TerminalManager {
	terminals: Arc<DashMap<TerminalId, Arc<TerminalHandle>>>,
	on_data: DataCb,
	on_status: StatusCb,
	on_exit: ExitCb,
	/// Claude's config dir, for locating session transcripts. Spawn decisions
	/// read the filesystem rather than the index, so they can't go stale.
	claude_dir: PathBuf,
	/// Override for tests. None → use `find_claude_binary()` at spawn time.
	binary_override: Option<PathBuf>,
}

impl TerminalManager {
	pub fn for_app(app: AppHandle, claude_dir: PathBuf) -> Self {
		let app_data = app.clone();
		let app_status = app.clone();
		let app_exit = app;
		Self {
			terminals: Arc::new(DashMap::new()),
			claude_dir,
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

	pub fn with_callbacks(
		claude_dir: PathBuf,
		on_data: DataCb,
		on_status: StatusCb,
		on_exit: ExitCb,
	) -> Self {
		Self {
			terminals: Arc::new(DashMap::new()),
			on_data,
			on_status,
			on_exit,
			claude_dir,
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

	/// The session ids with a PTY behind them right now. The indexer's reap
	/// pass takes this so it never drops the row of a session you are watching,
	/// whatever happened to its transcript on disk.
	pub fn live_session_ids(&self) -> HashSet<String> {
		self.terminals.iter().map(|e| e.value().session_id.clone()).collect()
	}

	pub fn list(&self) -> Vec<TerminalStatusDto> {
		self.terminals
			.iter()
			.map(|entry| {
				let h = entry.value();
				TerminalStatusDto {
					id: entry.key().clone(),
					session_id: h.session_id.clone(),
					project_id: h.project_id.clone(),
					status: *h.status.lock(),
					last_activity: h.last_activity.load(Ordering::Relaxed),
				}
			})
			.collect()
	}

	/// The session id a "new session" click in `project_id` should land on.
	///
	/// A live session with no transcript on disk has never been messaged, so
	/// it is indistinguishable from the one the user is asking for — hand it
	/// back instead of piling a second `claude` onto the same project. Only
	/// when there is no such session is a fresh id minted.
	///
	/// Deciding here rather than in the frontend is what lets both entry
	/// points behave identically: the sidebar's per-project button fires on
	/// projects whose session list was never fetched, so TypeScript cannot
	/// answer "has this been messaged" without a round trip anyway. This also
	/// can't race the indexer's 1s debounce, because it reads the transcript
	/// directly rather than the index.
	pub fn next_session_id(&self, project_id: &str, folder: &Path) -> String {
		for entry in self.terminals.iter() {
			let h = entry.value();
			if h.project_id == project_id
				&& !claude::transcript_path(&self.claude_dir, folder, &h.session_id).exists()
			{
				return h.session_id.clone();
			}
		}
		Uuid::new_v4().to_string()
	}

	/// Spawn `claude` for a session in a PTY. Returns the new terminal id.
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
		// Resolved before argv, because the transcript probe that decides
		// `--resume` vs `--session-id` is keyed by the folder Claude will run in.
		let cwd_path = opts
			.cwd
			.as_deref()
			.map(PathBuf::from)
			.or_else(dirs::home_dir)
			.unwrap_or_else(|| PathBuf::from("/"));

		let argv = match argv_override {
			Some(v) => v,
			None => {
				let bin = match &self.binary_override {
					Some(p) => p.clone(),
					None => find_claude_binary()?,
				};
				let mut v = vec![bin.to_string_lossy().to_string()];
				v.push(session_flag(&self.claude_dir, &cwd_path, &opts.session_id).into());
				v.push(opts.session_id.clone());
				v
			}
		};

		let mut cmd = CommandBuilder::new(&argv[0]);
		for a in argv.iter().skip(1) {
			cmd.arg(a);
		}
		// `CommandBuilder::cwd` does NOT fail on a directory that isn't there —
		// the child simply starts somewhere else, which for us was $HOME. That is
		// silent misfiling: "new session" on a project whose folder has since been
		// deleted would create the session under the $HOME project instead, and
		// the click and the result would disagree. Refuse instead; the renderer
		// prints the error in the terminal pane.
		if !cwd_path.is_dir() {
			return Err(AppError::NotFound(format!(
				"working directory {} does not exist",
				cwd_path.display()
			)));
		}
		cmd.cwd(&cwd_path);
		// `CommandBuilder::new` already seeded the child with our environment, so
		// PATH / HOME / SSH_AUTH_SOCK are present. What is left is to take back
		// whatever the AppImage runtime pushed in front of it, which belongs to
		// this process and not to a shell in the user's project — as removals,
		// because an omitted key keeps its inherited value. See
		// `services::child_env`; outside an AppImage this is empty.
		crate::services::child_env::changes_for_current_env().apply_to(&mut cmd);
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
		// Clone a killer now, before the child is moved into the waiter thread.
		// See `TerminalHandle::killer` for why the child isn't shared.
		let killer = child.clone_killer();
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
			session_id: opts.session_id.clone(),
			project_id: opts.project_id.clone(),
			master: Mutex::new(pair.master),
			writer: Mutex::new(writer),
			killer: Mutex::new(killer),
			status: Mutex::new(TerminalStatus::Running),
			last_activity: AtomicI64::new(now_ms()),
		});

		self.terminals.insert(id.clone(), handle.clone());

		// Reader thread: pump PTY bytes → on_data event.
		spawn_reader(id.clone(), reader, handle.clone(), self.on_data.clone());
		// Wait thread: owns the child and blocks on `wait()`; emits on_exit
		// when it terminates. Owning (not sharing) the child is what keeps
		// `kill()` from blocking — see `TerminalHandle::killer`.
		spawn_waiter(id.clone(), child, handle.clone(), self.on_status.clone(), self.on_exit.clone(), self.terminals.clone());

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
		// Signal via the killer, not the child — the waiter thread owns the
		// child and is parked in `wait()`. Best effort: it may already be gone.
		let _ = handle.killer.lock().kill();
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
				let _ = handle.killer.lock().kill();
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
					let _ = handle.killer.lock().kill();
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
	mut child: Box<dyn Child + Send + Sync>,
	handle: Arc<TerminalHandle>,
	on_status: StatusCb,
	on_exit: ExitCb,
	terminals: Arc<DashMap<TerminalId, Arc<TerminalHandle>>>,
) {
	std::thread::Builder::new()
		.name(format!("term-wait-{id}"))
		.spawn(move || {
			// This thread exclusively owns `child`; nothing else can touch it,
			// so blocking here for the process's whole life holds no shared lock.
			let exit_code = child.wait().ok().and_then(|s| s.exit_code().try_into().ok());
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

/// The flag that carries a session id into `claude`.
///
/// The two are mutually exclusive and both fail loudly when given the wrong
/// kind of id: `--resume` on an unknown id finds no conversation, and
/// `--session-id` on a known one exits with "Session ID … is already in use"
/// (both verified against the installed CLI). The transcript on disk is the
/// only authority on which kind an id is.
///
/// Probing per spawn — rather than remembering how a session started — is
/// what makes restart correct in every case. A session created new and then
/// messaged has a transcript, so it resumes; one abandoned before its first
/// message has none, so it claims its id again.
///
/// Addressed by the **folder**, not by a project id. A project id is a uuid now
/// and says nothing about where Claude writes; the folder is exactly what
/// Claude encodes to name its directory, and it is the one thing we have for a
/// project Claude has never run in — which is precisely the case that needs
/// `--session-id`.
fn session_flag(claude_dir: &Path, folder: &Path, session_id: &str) -> &'static str {
	if claude::transcript_path(claude_dir, folder, session_id).exists() {
		"--resume"
	} else {
		"--session-id"
	}
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
		make_manager_in(PathBuf::from("/nonexistent-claude-dir"))
	}

	fn make_manager_in(claude_dir: PathBuf) -> (TerminalManager, DataLog, ExitLog) {
		let data: DataLog = Arc::new(StdMutex::new(Vec::new()));
		let exit: ExitLog = Arc::new(StdMutex::new(Vec::new()));
		let dc = data.clone();
		let ec = exit.clone();
		let mgr = TerminalManager::with_callbacks(
			claude_dir,
			Arc::new(move |e| dc.lock().unwrap().push(e)),
			Arc::new(|_| {}),
			Arc::new(move |e| ec.lock().unwrap().push(e)),
		);
		(mgr, data, exit)
	}

	/// SpawnOpts for a test that overrides argv — the ids are carried into the
	/// handle but never reach a command line.
	fn opts(cols: u16, rows: u16) -> SpawnOpts {
		SpawnOpts {
			session_id: "11111111-2222-3333-4444-555555555555".into(),
			project_id: "11111111-aaaa-4bbb-8ccc-dddddddddddd".into(),
			cwd: None,
			cols,
			rows,
		}
	}

	/// Create the transcript `session_flag` probes for, in the store directory
	/// Claude would use for `folder`.
	fn write_transcript(claude_dir: &Path, folder: &str, session_id: &str) {
		let path = claude::transcript_path(claude_dir, Path::new(folder), session_id);
		std::fs::create_dir_all(path.parent().unwrap()).unwrap();
		std::fs::write(&path, "{}\n").unwrap();
	}

	#[test]
	fn spawn_runs_and_streams_output() {
		let (mgr, data, exit) = make_manager();
		let id = mgr
			.spawn_with_argv(
				opts(80, 24),
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
				opts(80, 24),
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
				opts(80, 24),
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
				opts(80, 24),
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
	fn spawn_refuses_a_cwd_that_does_not_exist() {
		let (mgr, _d, _e) = make_manager();
		let mut o = opts(80, 24);
		o.cwd = Some("/definitely/not/a/directory".into());
		let err = mgr
			.spawn_with_argv(o, Some(vec!["/bin/sh".into(), "-c".into(), "true".into()]))
			.expect_err("a missing cwd must not spawn");
		// portable-pty starts the child elsewhere rather than failing, so without
		// this guard a new session in a deleted project folder would be filed
		// under $HOME's project instead of the one that was clicked.
		assert!(
			matches!(err, AppError::NotFound(_)),
			"expected NotFound, got {err:?}"
		);
		assert_eq!(mgr.live_count(), 0, "nothing should have been spawned");
	}

	#[test]
	fn session_flag_claims_an_id_with_no_transcript() {
		let tmp = tempfile::TempDir::new().unwrap();
		// Nothing on disk: this session does not exist yet, so the id is ours to
		// claim. `--resume` here would fail with "no conversation found". This is
		// also the shape of a folder Claude has never run in — no store directory
		// exists for it at all, and the probe still answers correctly.
		assert_eq!(
			session_flag(
				tmp.path(),
				Path::new("/tmp/proj"),
				"11111111-2222-3333-4444-555555555555"
			),
			"--session-id"
		);
	}

	#[test]
	fn session_flag_resumes_an_id_with_a_transcript() {
		let tmp = tempfile::TempDir::new().unwrap();
		let sid = "11111111-2222-3333-4444-555555555555";
		write_transcript(tmp.path(), "/tmp/proj", sid);
		// Claude rejects `--session-id` on an id it already knows ("already in
		// use"), so an existing transcript must flip us to `--resume`. This is
		// the case that makes Restart correct after the first message.
		assert_eq!(session_flag(tmp.path(), Path::new("/tmp/proj"), sid), "--resume");
	}

	#[test]
	fn session_flag_is_scoped_per_folder() {
		let tmp = tempfile::TempDir::new().unwrap();
		let sid = "11111111-2222-3333-4444-555555555555";
		write_transcript(tmp.path(), "/tmp/other", sid);
		// Same session id, different folder — not our transcript.
		assert_eq!(session_flag(tmp.path(), Path::new("/tmp/proj"), sid), "--session-id");
	}

	#[test]
	fn next_session_id_mints_a_fresh_uuid_when_nothing_is_live() {
		let tmp = tempfile::TempDir::new().unwrap();
		let (mgr, _d, _e) = make_manager_in(tmp.path().to_path_buf());
		let a = mgr.next_session_id("proj", Path::new("/tmp/proj"));
		let b = mgr.next_session_id("proj", Path::new("/tmp/proj"));
		assert_ne!(a, b, "each call with nothing to reuse is a new session");
		assert_eq!(a.len(), 36, "expected a uuid, got {a}");
	}

	#[test]
	fn next_session_id_reuses_a_live_session_with_no_transcript() {
		let tmp = tempfile::TempDir::new().unwrap();
		let (mgr, _d, _e) = make_manager_in(tmp.path().to_path_buf());
		let mut o = opts(80, 24);
		o.project_id = "proj".into();
		let session = o.session_id.clone();
		mgr.spawn_with_argv(o, Some(vec!["/bin/sh".into(), "-c".into(), "sleep 30".into()]))
			.unwrap();

		// Live, never messaged → the click lands on it rather than a second claude.
		assert_eq!(mgr.next_session_id("proj", Path::new("/tmp/proj")), session);
		// A different project must not borrow it.
		assert_ne!(mgr.next_session_id("elsewhere", Path::new("/tmp/elsewhere")), session);
		mgr.kill_all();
	}

	#[test]
	fn next_session_id_skips_a_live_session_that_has_been_messaged() {
		let tmp = tempfile::TempDir::new().unwrap();
		let (mgr, _d, _e) = make_manager_in(tmp.path().to_path_buf());
		let mut o = opts(80, 24);
		o.project_id = "proj".into();
		let session = o.session_id.clone();
		write_transcript(tmp.path(), "/tmp/proj", &session);
		mgr.spawn_with_argv(o, Some(vec!["/bin/sh".into(), "-c".into(), "sleep 30".into()]))
			.unwrap();

		// It has real content, so "new session" must not hijack it.
		assert_ne!(mgr.next_session_id("proj", Path::new("/tmp/proj")), session);
		mgr.kill_all();
	}

	#[test]
	fn kill_all_drops_every_terminal() {
		let (mgr, _data, _exit) = make_manager();
		for _ in 0..3 {
			mgr.spawn_with_argv(
				opts(80, 24),
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
