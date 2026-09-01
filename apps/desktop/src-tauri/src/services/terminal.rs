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
use crate::services::agent_tools::{self, AgentTools, AgentToolsServer};
use crate::services::claude_cli::find_claude_binary;
use crate::services::ide::protocol::{self, Mcp, Mention};
use crate::services::ide::scope;
use crate::services::ide::server::IdeServer;
use crate::services::ide::ui_state::UiState;
use crate::services::osc_title::TitleScanner;

pub type TerminalId = String;

/// What a PTY *is*, which is not the same question as what it is doing.
///
/// Everything in factorai was a Claude session until F23, and three passes over
/// the handle map still mean "session" when they say "terminal": the new-session
/// reuse rule, the set of ids the indexer must not reap, and the `OSC 0` status
/// parse. A shell has a session id only because it is drawn under one — it is
/// not that session, and it is not any session — so it is excluded from all
/// three by kind rather than by a name check.
///
/// See `specs/05-features.md` § F23 and ADR-0031.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalKind {
	/// A `claude` process. The session id names a real transcript.
	Agent,
	/// The user's own shell, in the footer under a session (F23). The session
	/// id says which footer it is drawn in, and nothing more.
	Shell,
}

/// What a session is doing, derived from Claude's own terminal title — see
/// `services::osc_title`, `specs/05-features.md` § F10 and ADR-0015.
///
/// Three variants because three is what the source honestly supports. There is
/// no `Idle`: nothing distinguishes "alive with nothing pending" from "stopped
/// and waiting for you". `Running` was renamed `Working` in the same change,
/// because its meaning narrowed rather than stayed put — a live PTY sitting at
/// the prompt used to be `Running` and is now `WaitingInput`, and a silent
/// redefinition would have left every existing reader subtly wrong.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalStatus {
	/// Claude is doing something.
	Working,
	/// Claude has stopped; it is the human's turn.
	WaitingInput,
	/// The process is gone.
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
	/// A first message for the agent, appended to argv (F22, ADR-0026 § 4).
	///
	/// `None` for every human-started session, which is every caller but a
	/// routine fire. It is argv rather than a write into the PTY because a write
	/// races the CLI's own startup and lands in a trust dialog when it loses,
	/// and bracketed paste makes it a quoting problem as well.
	#[serde(default)]
	pub initial_prompt: Option<String>,
}

/// What the footer needs to open a shell (F23).
///
/// Deliberately not `SpawnOpts` with a flag on it. Half that struct is about a
/// Claude session — the transcript probe that chooses `--resume`, the routine's
/// first prompt — and none of it means anything here; a shared struct would
/// make every one of those fields a question a shell has to answer.
///
/// `cwd` is required rather than optional, unlike an agent's: the caller knows
/// which checkout the footer is under (F21) and there is no transcript to fall
/// back to.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellSpawnOpts {
	/// The session whose footer this shell is drawn in. It says which shells die
	/// with which session, and nothing else — see [`TerminalKind`].
	pub session_id: String,
	pub project_id: String,
	pub cwd: String,
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
	/// Agent or shell (F23). The renderer keys `bySession` by session id, and a
	/// shell shares its footer session's id — so a boot adoption that did not
	/// know the difference would file a shell over the agent it is drawn under.
	pub kind: TerminalKind,
	/// The last title a shell set for itself, so a reload can label its chip
	/// without waiting for the next one. Always `None` for an agent, whose
	/// titles are a status rather than a name.
	pub title: Option<String>,
	/// Where this terminal is running. A shell chip that outlives its process
	/// respawns here (F23).
	pub cwd: String,
}

/// The title a **shell** terminal set for itself, which is what its chip is
/// labelled with (F23).
///
/// Not emitted for an agent terminal: there the same bytes decide a status
/// instead (F10, ADR-0015), and Claude's title is a spinner frame rather than a
/// name anybody wants on a chip.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalTitleEvent {
	pub id: TerminalId,
	pub title: String,
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

/// The agent asked us to show a file (F20). `frontmost` is already decided
/// here, from whether this session is the one in front — the renderer obeys
/// rather than re-deciding, so one rule lives in one place.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeOpenFileEvent {
	pub session_id: String,
	pub path: String,
	pub line: Option<u32>,
	/// True: open the viewer. False: mark the tab and leave the human alone.
	pub frontmost: bool,
}

/// The checkout a session is working in, after a bridge signal (F21).
///
/// Emitted **after** the row is written, never before: the renderer's job is to
/// render a fact, and an event that arrives ahead of its row is a fact the next
/// reload disagrees with.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionWorktreeEvent {
	pub session_id: String,
	pub path: String,
	/// The checkout's own branch, for the header badge. `None` on a detached
	/// HEAD, exactly as `GitStatus::branch` is.
	pub branch: Option<String>,
}

/// Where this session's bridge stands (F20).
///
/// **The header shows nothing while this is healthy.** A badge for a working
/// bridge is a label that is always on, which is a label you stop reading; the
/// only thing worth a pixel is the case where the agent *cannot* open a file.
/// So `error` is what the UI draws and `connected` is for the log.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeStatusEvent {
	pub session_id: String,
	pub connected: bool,
	/// Why the bridge is unusable for this session, in words a human can act
	/// on. `None` means there is nothing wrong to report.
	pub error: Option<String>,
}

/// A session's bridge, or the reason it hasn't got one.
///
/// The failure is kept rather than logged and forgotten: a session whose bridge
/// never bound is one where every `openFile` will silently do nothing, and the
/// only honest thing is to say so in the header.
enum IdeSlot {
	Running(IdeServer),
	Failed(String),
	/// No bridge was ever attempted — a shell terminal (F23).
	///
	/// Distinct from `Failed` because the header reports a failure to the user:
	/// "the agent cannot open files" is news when a bridge did not bind, and a
	/// lie about a terminal that has no agent in it.
	None,
}

impl IdeSlot {
	fn server(&self) -> Option<&IdeServer> {
		match self {
			Self::Running(s) => Some(s),
			Self::Failed(_) | Self::None => None,
		}
	}

	fn error(&self) -> Option<String> {
		match self {
			Self::Running(_) | Self::None => None,
			Self::Failed(reason) => Some(reason.clone()),
		}
	}
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
type TitleCb = Arc<dyn Fn(TerminalTitleEvent) + Send + Sync>;
type IdeOpenCb = Arc<dyn Fn(IdeOpenFileEvent) + Send + Sync>;
type IdeStatusCb = Arc<dyn Fn(IdeStatusEvent) + Send + Sync>;
/// Asks for the user's configured `claude` path, once per spawn (F11).
type BinaryOverrideCb = Arc<dyn Fn() -> Option<PathBuf> + Send + Sync>;
/// Answers "where does this session's transcript say it was running?" — see
/// `TerminalManager::session_cwd`.
/// The directories a session is recorded as having run in, **newest first**.
/// Usually one; two when the agent moved (F21).
type SessionCwdCb = Arc<dyn Fn(&str) -> Vec<PathBuf> + Send + Sync>;
type WorktreeCb = Arc<dyn Fn(SessionWorktreeEvent) + Send + Sync>;

/// Reading and writing which checkout a session is working in (F21).
///
/// A pair of closures for the reason `session_cwd` is one: the manager needs the
/// `session_worktrees` table and should not hold a database. Absent in
/// `with_callbacks`, where a signal is still emitted but not remembered — which
/// is the shape every test runs in.
pub type WorktreeGet = Arc<dyn Fn(&str) -> Option<PathBuf> + Send + Sync>;
pub type WorktreeSet = Arc<dyn Fn(&str, &Path) + Send + Sync>;

#[derive(Clone)]
pub struct WorktreeStore {
	pub get: WorktreeGet,
	pub set: WorktreeSet,
}

/// Reading and writing a project's routines, for the bridge's tool group
/// (F22 slice 3, ADR-0028).
///
/// The same shape and the same reason as [`WorktreeStore`]: the manager needs
/// answers from a database it should not hold. Absent in `with_callbacks`,
/// where the tools are still advertised — they are advertised unconditionally —
/// and answer that routines are unavailable, which is the state every test runs
/// in.
///
/// **The author is a parameter, not a field.** Each closure takes the session
/// making the write, because that is what the row records and the one thing the
/// bridge knows that `lib.rs` does not.
pub type RoutineList = Arc<dyn Fn(&str) -> AppResult<Vec<crate::models::Routine>> + Send + Sync>;
pub type RoutineCreate = Arc<
	dyn Fn(&crate::models::RoutineInput, &str) -> AppResult<crate::models::Routine> + Send + Sync,
>;
pub type RoutineUpdate = Arc<
	dyn Fn(
			&str,
			&crate::services::routines::RoutinePatch,
			&str,
		) -> AppResult<crate::models::Routine>
		+ Send
		+ Sync,
>;

#[derive(Clone)]
pub struct RoutineStore {
	pub list: RoutineList,
	/// `&str` is the session id to record as the author.
	pub create: RoutineCreate,
	/// Routine id, the change, and the session id to record as the last hand.
	pub update: RoutineUpdate,
}

struct TerminalHandle {
	session_id: String,
	project_id: String,
	/// Agent or shell (F23). Read by the three passes that would otherwise
	/// mistake a footer shell for a session — see [`TerminalKind`].
	kind: TerminalKind,
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
	/// The last `OSC 0` title, for a shell only (F23). Held so a renderer that
	/// reloads can label the chip from `terminal_list` instead of waiting for
	/// the shell to retitle itself, which it may not do until you press Enter.
	title: Mutex<Option<String>>,
	last_activity: AtomicI64,
	/// The directory this session runs in, and the root every IDE-bridge path is
	/// checked against. Kept on the handle because the bridge's scope has to
	/// outlive the spawn call that computed it.
	cwd: PathBuf,
	/// This session's IDE bridge (F20), held so its lifetime is the PTY's:
	/// dropping the handle drops the server, which removes the lockfile and
	/// stops the listener — so the reaping ADR-0017 promises rides on the
	/// teardown ADR-0005 already guarantees, rather than on a second one that
	/// could be forgotten. Carries the reason instead when it failed to start.
	ide: IdeSlot,
	/// This session's agent tool server (F22 slice 3, ADR-0029), held for the
	/// same reason and with the same lifetime: dropping the handle stops the
	/// listener. `None` when it could not bind — the session then runs without
	/// factorai's own tools rather than not at all.
	///
	/// Never read after the spawn that created it. Its port and token left in
	/// the child's argv, and its `Drop` is the teardown.
	#[allow(dead_code)]
	agent_tools: Option<AgentToolsServer>,
}

#[derive(Clone)]
pub struct TerminalManager {
	terminals: Arc<DashMap<TerminalId, Arc<TerminalHandle>>>,
	on_data: DataCb,
	on_status: StatusCb,
	on_exit: ExitCb,
	on_title: TitleCb,
	/// Claude's config dir, for locating session transcripts. Spawn decisions
	/// read the filesystem rather than the index, so they can't go stale.
	claude_dir: PathBuf,
	/// Override for tests. None → resolve the binary at spawn time.
	///
	/// A test seam, deliberately *not* overloaded to carry the user's F11
	/// setting: that one arrives through `user_binary` below, so a test that
	/// pins a fake `claude` and a user who pinned a real one stay two separate
	/// facts.
	binary_override: Option<PathBuf>,
	/// The user's configured binary path, read at **spawn time** (F11).
	///
	/// A callback rather than a value because it is a setting that can change
	/// while the app runs, and resolving it per spawn is what makes "running
	/// sessions are unaffected, the next one uses the new path" true without
	/// anything having to invalidate a cache. Same shape as the indexer's
	/// `live_ids`, and for the same reason: the manager needs an answer from a
	/// database it should not hold.
	user_binary: Option<BinaryOverrideCb>,
	/// The cwd the index recorded for a session, read at **spawn time**.
	///
	/// Same shape and same reason as `user_binary`: the manager needs an answer
	/// from a database it should not hold. What it buys is `resume_cwd` below —
	/// a session whose transcript lives somewhere other than the folder the
	/// caller named has to be spawned where the transcript is, or `session_flag`
	/// claims an id Claude already knows and the conversation is lost.
	session_cwd: Option<SessionCwdCb>,
	/// Which checkout each session is working in (F21). `None` means a signal is
	/// still emitted but not remembered.
	worktree_store: Option<WorktreeStore>,
	/// A project's routines, for the bridge's tool group (F22 slice 3).
	/// `None` leaves the tools advertised but answering that they are
	/// unavailable — see [`RoutineStore`].
	routine_store: Option<RoutineStore>,
	on_worktree: WorktreeCb,
	/// What the renderer has on screen, for the bridge's answers (F20).
	ui: Arc<UiState>,
	on_ide_open: IdeOpenCb,
	on_ide_status: IdeStatusCb,
}

impl TerminalManager {
	pub fn for_app(app: AppHandle, claude_dir: PathBuf, ui: Arc<UiState>) -> Self {
		let app_data = app.clone();
		let app_status = app.clone();
		let app_exit = app.clone();
		let app_ide = app.clone();
		let app_ide_status = app.clone();
		let app_title = app.clone();
		let app_worktree = app;
		Self {
			terminals: Arc::new(DashMap::new()),
			claude_dir,
			ui,
			on_ide_open: Arc::new(move |e| {
				let _ = app_ide.emit("ide:open-file", e);
			}),
			on_ide_status: Arc::new(move |e| {
				let _ = app_ide_status.emit("ide:status", e);
			}),
			on_data: Arc::new(move |e| {
				let _ = app_data.emit("terminal:data", e);
			}),
			on_status: Arc::new(move |e| {
				let _ = app_status.emit("terminal:status", e);
			}),
			on_exit: Arc::new(move |e| {
				let _ = app_exit.emit("terminal:exit", e);
			}),
			on_title: Arc::new(move |e| {
				let _ = app_title.emit("terminal:title", e);
			}),
			binary_override: None,
			user_binary: None,
			session_cwd: None,
			worktree_store: None,
			routine_store: None,
			on_worktree: Arc::new(move |e| {
				let _ = app_worktree.emit("session:worktree", e);
			}),
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
			// A no-op rather than a fourth parameter: a title only names a
			// shell chip, and no test that predates F23 has one. `set_title_cb`
			// is how a test that wants them asks, matching `set_ide_status_cb`.
			on_title: Arc::new(|_| {}),
			claude_dir,
			binary_override: None,
			user_binary: None,
			session_cwd: None,
			worktree_store: None,
			routine_store: None,
			on_worktree: Arc::new(|_| {}),
			ui: Arc::new(UiState::default()),
			on_ide_open: Arc::new(|_| {}),
			on_ide_status: Arc::new(|_| {}),
		}
	}

	/// Where to read a session's recorded cwd from, per spawn. Wired to the
	/// `sessions` table in `lib.rs`; `resume_cwd` is what it is for.
	pub fn with_session_cwd(mut self, cb: SessionCwdCb) -> Self {
		self.session_cwd = Some(cb);
		self
	}

	/// Where to read and write a session's checkout (F21). Wired to
	/// `session_worktrees` in `lib.rs`.
	pub fn with_worktree_store(mut self, store: WorktreeStore) -> Self {
		self.worktree_store = Some(store);
		self
	}

	/// Where the bridge's routine tools read and write (F22 slice 3, ADR-0028).
	/// Wired to the `routines` table in `lib.rs`.
	pub fn with_routine_store(mut self, store: RoutineStore) -> Self {
		self.routine_store = Some(store);
		self
	}

	/// Where to read the user's configured binary path from, per spawn (F11).
	/// Wired to the `settings` table in `lib.rs`.
	pub fn with_user_binary(mut self, cb: BinaryOverrideCb) -> Self {
		self.user_binary = Some(cb);
		self
	}

	/// Override the binary the manager will spawn. For tests only.
	#[cfg(test)]
	pub fn set_binary(&mut self, path: PathBuf) {
		self.binary_override = Some(path);
	}

	/// Watch the bridge's attach/detach edges. For tests only — production wires
	/// this to a Tauri event in `for_app`.
	#[cfg(test)]
	pub fn set_ide_status_cb(&mut self, cb: IdeStatusCb) {
		self.on_ide_status = cb;
	}

	/// Watch shell terminals' titles (F23). For tests only, same as above.
	#[cfg(test)]
	pub fn set_title_cb(&mut self, cb: TitleCb) {
		self.on_title = cb;
	}

	pub fn live_count(&self) -> usize {
		self.terminals.len()
	}

	/// How many live PTYs have Claude *working* in them right now.
	///
	/// This is the count the quit guard asks about, and it is deliberately
	/// narrower than `live_count` (ADR-0020): a session parked at its prompt has
	/// nothing in flight to lose, so quitting it is not a question. `live_count`
	/// stays the count of what quitting *kills*, which is still all of them.
	pub fn working_count(&self) -> usize {
		self.terminals
			.iter()
			.filter(|e| e.value().kind == TerminalKind::Agent)
			.filter(|e| *e.value().status.lock() == TerminalStatus::Working)
			.count()
	}

	/// The session ids with a PTY behind them right now. The indexer's reap
	/// pass takes this so it never drops the row of a session you are watching,
	/// whatever happened to its transcript on disk.
	pub fn live_session_ids(&self) -> HashSet<String> {
		self.terminals
			.iter()
			.filter(|e| e.value().kind == TerminalKind::Agent)
			.map(|e| e.value().session_id.clone())
			.collect()
	}

	/// Hand files to one session's agent as `at_mentioned` notifications (F20).
	///
	/// Scope-checked per path against that session's own project, the same way
	/// `openFile` is on the way in. The direction of travel does not change the
	/// boundary — a renderer bug that offered a path outside the project would
	/// otherwise leak its name to the agent.
	///
	/// Loud on failure, unlike the rest of the bridge: this is a gesture the
	/// human just made and is watching for, so "nothing happened" has to be
	/// something they can see rather than a line in a log.
	pub fn mention(&self, session_id: &str, mentions: &[Mention]) -> AppResult<()> {
		let entry =
			self.terminals.iter().find(|e| e.value().session_id == session_id).ok_or_else(
				|| AppError::NotFound(format!("session {session_id} is not running")),
			)?;
		let handle = entry.value();

		let Some(server) = handle.ide.server() else {
			return Err(AppError::InvalidInput(
				"this session has no editor bridge, so there is nothing to send to".into(),
			));
		};
		if !server.is_attached() {
			return Err(AppError::InvalidInput(
				"Claude is not connected to this session yet".into(),
			));
		}

		// **The same scope the bridge's own answers use** (F21), not the cwd alone.
		// The human can browse a worktree in the panel and send a file from it, and
		// a boundary that refuses the files the tree is showing turns the gesture
		// into an error in exactly the case the feature exists for.
		let mut roots = vec![handle.cwd.clone()];
		roots.extend(crate::services::git::worktree_paths(&handle.cwd.to_string_lossy()));
		for mention in mentions {
			let path = scope::resolve_within_any(&roots, &mention.path)?;
			server.notify(protocol::at_mentioned(&path, mention));
		}
		Ok(())
	}

	/// Re-announce every bridge's current state (F20).
	///
	/// For a renderer that just reloaded: it threw its state away, every bridge
	/// carried on, and without this the header would say Claude had gone from a
	/// session it is still driving. The same hole `terminal_list` fills for
	/// PTYs.
	///
	/// **Re-emitted rather than returned**, and that is what makes it correct
	/// rather than merely convenient. A returned list has to be merged with the
	/// events that arrive while the call is in flight, and there is no way to
	/// tell a stale entry from a fresh one — `adoptLive` carries that problem
	/// deliberately because a PTY really can be born mid-request. Here the state
	/// only ever changes by an event, so replaying it down the same channel puts
	/// every update in one ordered queue and there is nothing to reconcile.
	pub fn resync_ide_status(&self) {
		for entry in self.terminals.iter() {
			let handle = entry.value();
			(self.on_ide_status)(IdeStatusEvent {
				session_id: handle.session_id.clone(),
				connected: handle.ide.server().is_some_and(IdeServer::is_attached),
				error: handle.ide.error(),
			});
		}
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
					kind: h.kind,
					title: h.title.lock().clone(),
					cwd: h.cwd.to_string_lossy().into_owned(),
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
			if h.kind == TerminalKind::Agent
				&& h.project_id == project_id
				&& !claude::transcript_path(&self.claude_dir, folder, &h.session_id).exists()
			{
				return h.session_id.clone();
			}
		}
		Uuid::new_v4().to_string()
	}

	/// Stand up this session's **agent tool server** (F22 slice 3, ADR-0029).
	///
	/// The sibling of `start_bridge`, and separate from it for a reason that is
	/// not ours: the CLI registers the bridge under the hardcoded key `ide` and
	/// caps that server's model-visible tools at two names, so a tool we want an
	/// agent to call cannot live there. This is a plain MCP server under a plain
	/// name, handed to the session through `--mcp-config` at spawn.
	///
	/// **The project and the author are bound here**, because this is the only
	/// layer that knows which session and which project the server belongs to.
	/// Binding them in a closure is what makes it impossible for a tool argument
	/// to name another project or another author; the store itself takes both as
	/// parameters and has no opinion.
	fn start_agent_tools(
		&self,
		session_id: &str,
		project_id: &str,
		cwd: &Path,
	) -> AppResult<AgentToolsServer> {
		let store = self.routine_store.clone();
		let author = session_id.to_string();
		let unavailable =
			|| AppError::InvalidInput("routines are not available for this session".to_string());
		let list_store = store.clone();
		let create_store = store.clone();
		let update_author = author.clone();
		let routines = agent_tools::Routines {
			project_id: project_id.to_string(),
			// The folder rather than the project's display name: it is what the
			// session can check against its own `pwd`, and it cannot go stale
			// against a name the human renamed in the sidebar.
			project_path: cwd.to_string_lossy().into_owned(),
			list: Arc::new(move |project_id| {
				let s = list_store.as_ref().ok_or_else(unavailable)?;
				(s.list)(project_id)
			}),
			create: Arc::new(move |input| {
				let s = create_store.as_ref().ok_or_else(unavailable)?;
				(s.create)(input, &author)
			}),
			update: Arc::new(move |id, patch| {
				let s = store.as_ref().ok_or_else(unavailable)?;
				(s.update)(id, patch, &update_author)
			}),
		};
		let tools = AgentTools::new(routines);
		AgentToolsServer::start(Arc::new(move |text| tools.handle(text)))
	}

	/// Stand up this session's IDE bridge (F20).
	///
	/// The two answers that depend on the UI are resolved here rather than in
	/// the protocol, because this is the only layer that knows which session it
	/// is: `openFile` on a session that is not in front marks its tab instead of
	/// taking the window, and `getOpenEditors` reports what the viewer is
	/// actually showing rather than a stub.
	fn start_bridge(&self, session_id: &str, cwd: &Path) -> AppResult<IdeServer> {
		let ui_for_open = self.ui.clone();
		let ui_for_editors = self.ui.clone();
		let on_open = self.on_ide_open.clone();
		let session = session_id.to_string();

		// **The path scope, and it is derived from git rather than from anything the
		// client sends** (ADR-0019 § 2). Recomputed on every resolve, so a worktree
		// the agent created a second ago is inside it — which a set captured here
		// at connect time would refuse.
		let scope_cwd = cwd.to_path_buf();
		let checkouts: Arc<dyn Fn() -> Vec<PathBuf> + Send + Sync> =
			Arc::new(move || crate::services::git::worktree_paths(&scope_cwd.to_string_lossy()));

		// The signal path: persist first, then emit. A renderer told about a
		// checkout that was never written would disagree with itself on reload.
		let signal_session = session_id.to_string();
		let signal_store = self.worktree_store.as_ref().map(|s| s.set.clone());
		let on_worktree = self.on_worktree.clone();
		let signal: Arc<dyn Fn(&Path) + Send + Sync> = Arc::new(move |checkout: &Path| {
			if let Some(set) = &signal_store {
				set(&signal_session, checkout);
			}
			(on_worktree)(SessionWorktreeEvent {
				session_id: signal_session.clone(),
				path: checkout.to_string_lossy().into_owned(),
				branch: crate::services::git::worktrees(&checkout.to_string_lossy()).ok().and_then(
					|wts| {
						let target = std::fs::canonicalize(checkout)
							.unwrap_or_else(|_| checkout.to_path_buf());
						wts.into_iter()
							.find(|w| Path::new(&w.path) == target)
							.and_then(|w| w.branch)
					},
				),
			});
		});

		let current_session = session_id.to_string();
		let current_store = self.worktree_store.as_ref().map(|s| s.get.clone());
		let current_cwd = cwd.to_path_buf();
		// `None` when the panel is simply showing this session's own cwd, so
		// `getWorkspaceFolders` reports a `viewing` line only when there is
		// something to report.
		let current: Arc<dyn Fn() -> Option<PathBuf> + Send + Sync> = Arc::new(move || {
			let recorded = current_store.as_ref().and_then(|get| get(&current_session))?;
			(recorded != current_cwd).then_some(recorded)
		});

		let mcp = Mcp::new(
			cwd.to_path_buf(),
			protocol::Worktrees { checkouts, signal, current },
			Arc::new(move |req| {
				// The agent may ask not to be intrusive, and the human may be
				// looking at something else. Either is enough to mark rather than
				// open, and the renderer is told the outcome rather than asked to
				// work it out again.
				let frontmost = req.make_frontmost && ui_for_open.is_active(&session);
				(on_open)(IdeOpenFileEvent {
					session_id: session.clone(),
					path: req.path.to_string_lossy().into_owned(),
					line: req.line,
					frontmost,
				});
				frontmost
			}),
			Arc::new(move || ui_for_editors.open_files()),
		);

		let on_status = self.on_ide_status.clone();
		let status_session = session_id.to_string();

		IdeServer::start(
			&self.claude_dir,
			&cwd.to_string_lossy(),
			Arc::new(move |text| mcp.handle(text)),
			Arc::new(move |connected| {
				(on_status)(IdeStatusEvent {
					session_id: status_session.clone(),
					connected,
					error: None,
				});
			}),
		)
	}

	/// Where this session has to be spawned for `--resume` to mean anything.
	///
	/// **Claude keys its store by cwd**, so a session's transcript lives under
	/// `encode_path(the folder it ran in)`. `session_flag` probes for it there;
	/// spawn a session somewhere else and the probe misses, we claim
	/// `--session-id` for an id Claude already knows, and the conversation is
	/// either refused or silently replaced by an empty one. The caller cannot
	/// avoid this on its own: the renderer learns a session's recorded cwd from a
	/// query that resolves *after* the terminal mounts, so by the time it knows,
	/// the spawn has happened.
	///
	/// `None` unless the recorded folder **actually holds this transcript**, which
	/// is a deliberately narrower test than "the index has a cwd for it". The
	/// recorded folder is worth preferring over the caller's precisely because the
	/// transcript is there; if it isn't — the folder moved, the store was cleaned,
	/// the row is stale — then it buys nothing and would only move the session
	/// somewhere the caller did not ask for. Falling through to `opts.cwd` is the
	/// behaviour that predates this method.
	fn resume_cwd(&self, session_id: &str) -> Option<PathBuf> {
		// Both recorded directories are tried, newest first. An agent that moves
		// into a worktree mid-session takes Claude's store directory with it, so
		// the transcript can exist *only* under where it ended up — and resuming
		// from where it started would then miss the probe and claim an id Claude
		// already knows (F21, migration 0008).
		self.session_cwd.as_ref()?(session_id)
			.into_iter()
			.find(|dir| claude::transcript_path(&self.claude_dir, dir, session_id).exists())
	}

	/// Spawn `claude` for a session in a PTY. Returns the new terminal id.
	pub fn spawn(&self, opts: SpawnOpts) -> AppResult<TerminalId> {
		self.spawn_with_argv(opts, None)
	}

	/// Spawn the user's own shell in the footer under a session (F23).
	///
	/// **Bare `$SHELL`, no flags.** A PTY with no arguments is already an
	/// interactive shell, so `~/.zshrc` is sourced the way it is in any terminal
	/// emulator; `-l` would re-source the profile and hand this shell a
	/// different environment from the agent above it, which is the one thing a
	/// shell sitting beside an agent must not have. `child_env` supplies the
	/// login-shell `PATH` for both.
	///
	/// The session id is carried for one purpose — which footer this belongs to,
	/// so closing that session kills its shells — and [`TerminalKind::Shell`]
	/// keeps it out of every pass that would read it as a session (ADR-0031).
	pub fn spawn_shell(&self, opts: ShellSpawnOpts) -> AppResult<TerminalId> {
		let shell = crate::services::shell_path::user_shell();
		let id = self.spawn_inner(
			SpawnOpts {
				session_id: opts.session_id,
				project_id: opts.project_id,
				cwd: Some(opts.cwd),
				cols: opts.cols,
				rows: opts.rows,
				initial_prompt: None,
			},
			Some(vec![shell.to_string_lossy().into_owned()]),
			TerminalKind::Shell,
		)?;

		// **Name the chip before the shell has said anything.** A chip labelled
		// from `OSC 0` has no label at all until the prompt sets one, and a shell
		// that never sets one — `sh`, or a bare `PS1` — would stay nameless for
		// its whole life. The basename is the fallback F23 specifies, and it goes
		// through the same path a real title does so there is one way a chip is
		// named rather than two.
		if let Some(name) = shell.file_name().map(|n| n.to_string_lossy().into_owned()) {
			if let Some(handle) = self.terminals.get(&id).map(|e| e.value().clone()) {
				set_title(&id, &handle, name, &self.on_title);
			}
		}
		Ok(id)
	}

	/// The command line for a session: the binary, the flag the transcript probe
	/// chose, the id, and — for a routine fire — the prompt.
	///
	/// Split out from `spawn_with_argv` so the argv is assertable without a PTY,
	/// which is the only part of a spawn a test can check cheaply and the part
	/// that decides whether a session resumes or starts over.
	fn argv_for(
		&self,
		opts: &SpawnOpts,
		cwd_path: &Path,
		tools: Option<&AgentToolsServer>,
	) -> AppResult<Vec<String>> {
		let bin = match &self.binary_override {
			Some(p) => p.clone(),
			None => {
				let configured = self.user_binary.as_ref().and_then(|cb| cb());
				find_claude_binary(configured.as_deref())?
			}
		};
		let mut v = vec![bin.to_string_lossy().to_string()];
		// **factorai's own tools, registered by name** (ADR-0029). Inline JSON
		// rather than a file, because the config dies with the session and a file
		// would have to survive a `SIGKILL` to be cleaned up.
		//
		// **Never `--strict-mcp-config`**: that would make ours the only MCP
		// servers this session has, silently dropping every one the user
		// configured. Merging is the entire point.
		if let Some(tools) = tools {
			v.push("--mcp-config".into());
			v.push(tools.mcp_config_arg());
		}
		v.push(session_flag(&self.claude_dir, cwd_path, &opts.session_id).into());
		v.push(opts.session_id.clone());
		// One positional argument, whichever flag the probe chose: the CLI takes a
		// prompt the same way in both cases, so a routine firing into a session it
		// has run before resumes *and* says something.
		if let Some(prompt) = opts.initial_prompt.as_ref().filter(|p| !p.is_empty()) {
			v.push(prompt.clone());
		}
		Ok(v)
	}

	/// Internal: same as `spawn` but allows overriding argv for tests
	/// (e.g. invoking `/bin/sh -c "..."` instead of `claude`).
	fn spawn_with_argv(
		&self,
		opts: SpawnOpts,
		argv_override: Option<Vec<String>>,
	) -> AppResult<TerminalId> {
		self.spawn_inner(opts, argv_override, TerminalKind::Agent)
	}

	/// The one place a PTY comes into existence, for both kinds.
	///
	/// A shell takes the same cwd resolution, the same `child_env` diff and the
	/// same reader/waiter threads as an agent, and differs in four places, all
	/// guarded by `kind`: no transcript probe, no IDE bridge, no agent tool
	/// server, and a title that names it rather than deciding a status.
	fn spawn_inner(
		&self,
		opts: SpawnOpts,
		argv_override: Option<Vec<String>>,
		kind: TerminalKind,
	) -> AppResult<TerminalId> {
		// Resolved before argv, because the transcript probe that decides
		// `--resume` vs `--session-id` is keyed by the folder Claude will run in.
		//
		// **A shell never consults the transcript.** `resume_cwd` answers "where
		// did Claude write this session's transcript", which for a shell is a
		// question about a *different* process that happens to share its id: a
		// session whose agent moved into a worktree would otherwise drag the
		// footer's shell there too, ignoring the directory the caller asked for.
		let cwd_path = match kind {
			TerminalKind::Agent => self.resume_cwd(&opts.session_id),
			TerminalKind::Shell => None,
		}
		.or_else(|| opts.cwd.as_deref().map(PathBuf::from))
		.or_else(dirs::home_dir)
		.unwrap_or_else(|| PathBuf::from("/"));

		// **Started before argv, because its port goes into argv.** A failure is
		// logged and dropped, the same rule the bridge follows: a session without
		// factorai's own tools is every session before this landed, whereas
		// refusing to spawn `claude` because a socket would not bind trades the
		// whole feature for one of its conveniences.
		// Shells get neither this nor the IDE bridge below: both exist to let an
		// *agent* reach back into factorai, and a shell has no model in it to
		// hand a tool to. Standing them up anyway would put two more listeners
		// and two more lockfiles behind every `ls`.
		let agent_tools = match kind {
			TerminalKind::Shell => None,
			TerminalKind::Agent => {
				match self.start_agent_tools(&opts.session_id, &opts.project_id, &cwd_path) {
					Ok(server) => Some(server),
					Err(e) => {
						warn!(error = %e, "agent tool server did not start; the session runs without it");
						None
					}
				}
			}
		};

		let argv = match argv_override {
			Some(v) => v,
			None => self.argv_for(&opts, &cwd_path, agent_tools.as_ref())?,
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
		// HOME / SSH_AUTH_SOCK / LANG and the rest are present, and this is a
		// diff over that rather than a hand-built environment. Two things about
		// ours are wrong for a session: `PATH` is a GUI process's, with no
		// Homebrew and no version-manager shims in it, and under an AppImage the
		// runtime's private directories are in front of everything. Both are
		// fixed here, in the one place a child is spawned — see
		// `services::child_env`.
		crate::services::child_env::changes_for_current_env().apply_to(&mut cmd);
		// xterm.js renders best as xterm-256color.
		cmd.env("TERM", "xterm-256color");

		// **The IDE bridge (F20), and it must never be able to break a session.**
		// A failure here is logged and dropped: a session with no editor attached
		// is exactly what every session was until this landed, whereas refusing to
		// spawn `claude` because a socket would not bind would trade the whole
		// feature for one of its conveniences.
		//
		// The port goes into the child's environment, which is also what makes the
		// CLI *look*: `CLAUDE_CODE_SSE_PORT` being set is by itself enough to turn
		// its auto-connect on, and it pins which lockfile is chosen when a VS Code
		// is open on the same machine — the CLI otherwise connects only when
		// exactly one candidate matches.
		let ide = match kind {
			// See the note on `agent_tools` above: no model, no bridge. It also
			// keeps `CLAUDE_CODE_SSE_PORT` out of the shell's environment, so a
			// `claude` the user starts *by hand* in that shell is not silently
			// bound to the footer it was typed in.
			TerminalKind::Shell => IdeSlot::None,
			TerminalKind::Agent => match self.start_bridge(&opts.session_id, &cwd_path) {
				Ok(server) => {
					cmd.env("CLAUDE_CODE_SSE_PORT", server.port().to_string());
					IdeSlot::Running(server)
				}
				Err(e) => {
					warn!(error = %e, "ide bridge did not start; the session runs without one");
					IdeSlot::Failed(e.to_string())
				}
			},
		};

		let pty_system = native_pty_system();
		let pair = pty_system
			.openpty(PtySize {
				cols: opts.cols.max(20),
				rows: opts.rows.max(5),
				pixel_width: 0,
				pixel_height: 0,
			})
			.map_err(|e| AppError::Process(format!("openpty: {e}")))?;
		let child =
			pair.slave.spawn_command(cmd).map_err(|e| AppError::Process(format!("spawn: {e}")))?;
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
			kind,
			master: Mutex::new(pair.master),
			writer: Mutex::new(writer),
			killer: Mutex::new(killer),
			// `Working` until the first title says otherwise, which takes about
			// 300ms. A spawning session genuinely is doing something — resolving
			// MCP servers, replaying a transcript — and this is also what the
			// dot did before F10, so a launch looks no different than it used to.
			//
			// A shell is never anything else: it has no status, and
			// `working_count` skips it by kind rather than by value, so this
			// records only that the process exists.
			status: Mutex::new(TerminalStatus::Working),
			title: Mutex::new(None),
			last_activity: AtomicI64::new(now_ms()),
			cwd: cwd_path.clone(),
			ide,
			agent_tools,
		});

		self.terminals.insert(id.clone(), handle.clone());

		// A bridge that never bound is announced immediately: every `openFile`
		// for this session will silently do nothing, and the header is the only
		// place that can say so. A healthy one announces nothing — there is no
		// news in "it worked".
		if let Some(reason) = handle.ide.error() {
			(self.on_ide_status)(IdeStatusEvent {
				session_id: opts.session_id.clone(),
				connected: false,
				error: Some(reason),
			});
		}

		// Reader thread: pump PTY bytes → on_data event, and derive status from
		// the OSC 0 titles in that same stream (F10).
		spawn_reader(
			id.clone(),
			reader,
			handle.clone(),
			self.on_data.clone(),
			self.on_status.clone(),
			self.on_title.clone(),
		);
		// Wait thread: owns the child and blocks on `wait()`; emits on_exit
		// when it terminates. Owning (not sharing) the child is what keeps
		// `kill()` from blocking — see `TerminalHandle::killer`.
		spawn_waiter(
			id.clone(),
			child,
			handle.clone(),
			self.on_status.clone(),
			self.on_exit.clone(),
			self.terminals.clone(),
		);

		Ok(id)
	}

	pub fn write(&self, id: &str, data: &[u8]) -> AppResult<()> {
		let handle =
			self.terminals.get(id).ok_or_else(|| AppError::NotFound(format!("terminal {id}")))?;
		let mut w = handle.writer.lock();
		w.write_all(data).map_err(|e| AppError::Io(format!("terminal write: {e}")))?;
		handle.last_activity.store(now_ms(), Ordering::Relaxed);
		Ok(())
	}

	pub fn resize(&self, id: &str, cols: u16, rows: u16) -> AppResult<()> {
		let handle =
			self.terminals.get(id).ok_or_else(|| AppError::NotFound(format!("terminal {id}")))?;
		handle
			.master
			.lock()
			.resize(PtySize {
				cols: cols.max(20),
				rows: rows.max(5),
				pixel_width: 0,
				pixel_height: 0,
			})
			.map_err(|e| AppError::Process(format!("resize: {e}")))?;
		Ok(())
	}

	pub fn kill(&self, id: &str) -> AppResult<()> {
		let handle =
			self.terminals.get(id).ok_or_else(|| AppError::NotFound(format!("terminal {id}")))?;
		// Signal via the killer, not the child — the waiter thread owns the
		// child and is parked in `wait()`. Best effort: it may already be gone.
		let _ = handle.killer.lock().kill();
		Ok(())
	}

	/// Kill every live terminal. SIGTERM via `child.kill()`, then a 500ms
	/// grace period, then anything still alive gets force-killed by Drop.
	/// Kill every shell drawn in one session's footer (F23).
	///
	/// Called when that session is closed, which is the whole of a shell's
	/// lifetime rule: a shell dies with the footer it lives in. Agents are left
	/// alone — closing a session kills its agent through `terminal_kill` on the
	/// id the renderer already holds, and doing it twice from here would race
	/// that path for no gain.
	pub fn kill_shells_for_session(&self, session_id: &str) {
		let ids: Vec<TerminalId> = self
			.terminals
			.iter()
			.filter(|e| {
				let h = e.value();
				h.kind == TerminalKind::Shell && h.session_id == session_id
			})
			.map(|e| e.key().clone())
			.collect();
		debug!(count = ids.len(), session_id, "kill shells for session");
		for id in &ids {
			let _ = self.kill(id);
		}
	}

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
	on_status: StatusCb,
	on_title: TitleCb,
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
			// Scanning here rather than in the flusher because this is where
			// bytes first exist, and because the scanner has to be stateful
			// anyway: a read boundary can fall inside an escape sequence.
			let mut titles = TitleScanner::default();
			loop {
				match reader.read(&mut tmp) {
					Ok(0) => break,
					Ok(n) => {
						handle_r.last_activity.store(now_ms(), Ordering::Relaxed);
						// One stream, two readings of the same `OSC 0`. For an
						// agent the title is Claude's state (F10, ADR-0015); for
						// a shell it is a name for its chip, and classifying it
						// would report the user's prompt as Claude working.
						match handle_r.kind {
							TerminalKind::Agent => {
								if let Some(next) = titles.push(&tmp[..n]) {
									set_status(&id_r, &handle_r, next, &on_status);
								}
							}
							TerminalKind::Shell => {
								if let Some(next) = titles.push_title(&tmp[..n]) {
									set_title(&id_r, &handle_r, next, &on_title);
								}
							}
						}
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

/// Record a status the title implied, and emit only on a real change.
///
/// Only on a change because the title reasserts itself constantly — the spinner
/// alone is a frame every 960ms — and an event per frame would be a stream of
/// IPC saying nothing, plus a React render each time.
///
/// **`Stopped` is terminal.** The waiter sets it when the process exits, and a
/// final chunk of buffered output can still be read after that; without this
/// guard a trailing title would resurrect a dead session to `WaitingInput` and
/// leave a dot on a terminal that no longer exists.
fn set_status(
	id: &TerminalId,
	handle: &Arc<TerminalHandle>,
	next: TerminalStatus,
	on_status: &StatusCb,
) {
	{
		let mut st = handle.status.lock();
		if *st == next || *st == TerminalStatus::Stopped {
			return;
		}
		*st = next;
	}
	let last_activity = handle.last_activity.load(Ordering::Relaxed);
	(on_status)(TerminalStatusEvent { id: id.clone(), status: next, last_activity });
}

/// Record a shell's new title and announce it, if it actually changed (F23).
///
/// Guarded the same way `set_status` is, and for the same reason: a prompt that
/// re-emits its title on every keystroke would otherwise cross the bridge once
/// per character to say nothing new.
fn set_title(id: &TerminalId, handle: &Arc<TerminalHandle>, next: String, on_title: &TitleCb) {
	{
		let mut t = handle.title.lock();
		if t.as_deref() == Some(next.as_str()) {
			return;
		}
		*t = Some(next.clone());
	}
	(on_title)(TerminalTitleEvent { id: id.clone(), title: next });
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
			(on_status)(TerminalStatusEvent {
				id: id.clone(),
				status: TerminalStatus::Stopped,
				last_activity,
			});
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
			initial_prompt: None,
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
				Some(vec!["/bin/sh".into(), "-c".into(), "echo HELLO_PTY".into()]),
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
			.map(|e| {
				String::from_utf8_lossy(&B64.decode(&e.bytes_b64).unwrap_or_default()).into_owned()
			})
			.collect();
		let merged = chunks.join("");
		assert!(merged.contains("HELLO_PTY"), "expected HELLO_PTY in stream, got: {merged}");
		assert!(exit.lock().unwrap().iter().any(|e| e.id == id), "expected exit event");
	}

	/// The end of the chain `services::shell_path` starts: a session's `PATH` is
	/// the login shell's, and it survives all the way into a real PTY child.
	///
	/// Asserting on the child rather than on `EnvChanges` is the point, for the
	/// same reason `child_env`'s own regression test drives a `CommandBuilder`:
	/// the bug being guarded against is not a wrong rule, it is a right rule
	/// that never reaches the process. Drop the `changes_for_current_env` call
	/// above and this is the test that notices — a hook's bare `bash` and an MCP
	/// server's `npx` become unresolvable, and nothing else here fails.
	///
	/// **The expectation is the login shell's `PATH` with AppImage entries
	/// filtered out**, and the filter is written here rather than borrowed from
	/// `child_env` so this stays a check and not a tautology. It is not
	/// hypothetical on the machine this is developed on: the login shell is
	/// started from inside the release app, so its answer arrives carrying ten
	/// `.mount_*` entries from two different mounts, and this test failed on
	/// exactly those when the strip was widened to catch them.
	#[test]
	fn a_child_runs_with_the_login_shell_path() {
		let (mgr, data, exit) = make_manager();
		let id = mgr
			.spawn_with_argv(
				opts(80, 24),
				// A marker, because the PTY stream also carries whatever the
				// shell itself decides to say.
				Some(vec!["/bin/sh".into(), "-c".into(), "printf 'PATH_IS[%s]' \"$PATH\"".into()]),
			)
			.expect("spawn");
		for _ in 0..50 {
			std::thread::sleep(Duration::from_millis(50));
			if exit.lock().unwrap().iter().any(|e| e.id == id) {
				break;
			}
		}
		let merged: String = data
			.lock()
			.unwrap()
			.iter()
			.filter(|e| e.id == id)
			.map(|e| {
				String::from_utf8_lossy(&B64.decode(&e.bytes_b64).unwrap_or_default()).into_owned()
			})
			.collect();

		let login = crate::services::shell_path::child_path();
		let login = login.to_string_lossy();
		let is_appimage = |e: &&str| e.contains("/.mount_");
		// Mirrors `child_env`: a value with nothing to strip is passed through
		// byte for byte, and only a rebuilt one also loses its empty entries.
		let wanted = if login.split(':').any(|e| is_appimage(&e)) {
			login
				.split(':')
				.filter(|e| !e.is_empty() && !is_appimage(e))
				.collect::<Vec<_>>()
				.join(":")
		} else {
			login.to_string()
		};
		let expected = format!("PATH_IS[{wanted}]");
		assert!(merged.contains(&expected), "expected {expected} in stream, got: {merged}");
		// The half the exact match cannot state on a machine that has no mounts
		// to strip: whatever arrives, none of it points into a squashfs.
		assert!(!merged.contains("/.mount_"), "an AppImage mount reached the child: {merged}");
	}

	#[test]
	fn write_input_reaches_child_process() {
		// Spawn a tiny shell script that reads one line and echoes it with a
		// recognisable prefix. Avoids `cat`'s line-buffer quirks.
		let (mgr, data, exit) = make_manager();
		let id = mgr
			.spawn_with_argv(
				opts(80, 24),
				Some(vec!["/bin/sh".into(), "-c".into(), "read line; echo \"GOT:$line\"".into()]),
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
		assert!(merged.contains("GOT:hello"), "expected GOT:hello in stream, got: {merged:?}");
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
		// `Working` from spawn until a title says otherwise — and `/bin/sh` never
		// writes one, so it stays there. See `TerminalHandle`'s initial status.
		assert_eq!(listing[0].status, TerminalStatus::Working);
		// A freshly spawned session counts as working, so quitting on top of one
		// still asks.
		assert_eq!(mgr.working_count(), 1);
		let _ = mgr.kill(&id);
	}

	/// The status a title implies has to reach the event, through a real PTY.
	///
	/// `osc_title`'s own tests cover the parse exhaustively over fixtures. This
	/// one covers the wiring — reader thread → scanner → `set_status` → callback
	/// — because every one of those fixture tests still passes with the scanner
	/// never called from the reader at all. That is the same failure this module
	/// has shipped once already: a right rule that never reaches the process
	/// (see `a_child_runs_with_the_login_shell_path`).
	#[test]
	fn a_title_written_by_a_real_child_moves_the_status() {
		let statuses: Arc<StdMutex<Vec<TerminalStatusEvent>>> = Arc::new(StdMutex::new(Vec::new()));
		let sc = statuses.clone();
		let mgr = TerminalManager::with_callbacks(
			PathBuf::from("/nonexistent-claude-dir"),
			Arc::new(|_| {}),
			Arc::new(move |e| sc.lock().unwrap().push(e)),
			Arc::new(|_| {}),
		);

		// The idle title, exactly as the CLI writes it: OSC 0, U+2733, BEL.
		let id = mgr
			.spawn_with_argv(
				opts(80, 24),
				Some(vec![
					"/bin/sh".into(),
					"-c".into(),
					"printf '\\033]0;\\342\\234\\263 Claude Code\\007'; sleep 30".into(),
				]),
			)
			.unwrap();

		// Poll rather than sleep a fixed time: the read is fast but scheduling
		// is not, and a fixed sleep is how this becomes the flaky test.
		let deadline = std::time::Instant::now() + Duration::from_secs(5);
		let got = loop {
			if let Some(e) =
				statuses.lock().unwrap().iter().find(|e| e.status == TerminalStatus::WaitingInput)
			{
				break Some(e.id.clone());
			}
			if std::time::Instant::now() > deadline {
				break None;
			}
			std::thread::sleep(Duration::from_millis(25));
		};

		// The quit guard's whole question, asked here because this is the only
		// test with a real title moving a real handle's status (ADR-0020): the PTY
		// is still live, and nothing is working in it.
		assert_eq!(mgr.live_count(), 1, "the PTY is still there");
		assert_eq!(mgr.working_count(), 0, "a session at its prompt is not working");

		let _ = mgr.kill(&id);
		assert_eq!(got.as_deref(), Some(id.as_str()), "no waiting_input event for the title");
	}

	/// SpawnOpts for a shell test — same shape, a session id it does not own.
	fn shell_opts(session_id: &str) -> SpawnOpts {
		SpawnOpts {
			session_id: session_id.into(),
			project_id: "11111111-aaaa-4bbb-8ccc-dddddddddddd".into(),
			cwd: None,
			cols: 80,
			rows: 24,
			initial_prompt: None,
		}
	}

	/// The three passes that mean "session" when they say "terminal" (F23,
	/// ADR-0031). A shell carries a session id so its footer can find it, and
	/// every one of these would otherwise read that id as a session: the sidebar
	/// would show a live row for a shell, the indexer would refuse to reap a
	/// transcript that no longer exists, and "new session" would hand the user
	/// the shell's id to run `claude --resume` against.
	#[test]
	fn a_shell_is_never_mistaken_for_a_session() {
		let (mgr, _d, _e) = make_manager();
		let shell_session = "99999999-8888-7777-6666-555555555555";
		let id = mgr
			.spawn_inner(
				shell_opts(shell_session),
				Some(vec!["/bin/sh".into(), "-c".into(), "sleep 30".into()]),
				TerminalKind::Shell,
			)
			.expect("spawn");

		assert_eq!(mgr.live_count(), 1, "the PTY exists and quitting will kill it");
		assert_eq!(mgr.working_count(), 0, "a shell is never work in progress (ADR-0020)");
		assert!(mgr.live_session_ids().is_empty(), "a shell pins no session against the reaper");
		assert_ne!(
			mgr.next_session_id("11111111-aaaa-4bbb-8ccc-dddddddddddd", Path::new("/tmp")),
			shell_session,
			"new session must never be handed a shell's id"
		);

		let _ = mgr.kill(&id);
	}

	/// The same bytes, read two ways (F10 vs F23). A shell that titles itself
	/// with Claude's own idle marker — the worst case, and one `starship` or a
	/// stray `printf` can produce — must name its chip and leave the session's
	/// status alone.
	#[test]
	fn a_shells_title_names_it_and_never_moves_a_status() {
		let statuses: Arc<StdMutex<Vec<TerminalStatusEvent>>> = Arc::new(StdMutex::new(Vec::new()));
		let titles: Arc<StdMutex<Vec<TerminalTitleEvent>>> = Arc::new(StdMutex::new(Vec::new()));
		let sc = statuses.clone();
		let tc = titles.clone();
		let mut mgr = TerminalManager::with_callbacks(
			PathBuf::from("/nonexistent-claude-dir"),
			Arc::new(|_| {}),
			Arc::new(move |e| sc.lock().unwrap().push(e)),
			Arc::new(|_| {}),
		);
		mgr.set_title_cb(Arc::new(move |e| tc.lock().unwrap().push(e)));

		let id = mgr
			.spawn_inner(
				shell_opts("99999999-8888-7777-6666-555555555555"),
				Some(vec![
					"/bin/sh".into(),
					"-c".into(),
					"printf '\\033]0;\\342\\234\\263 ~/dev/factorai\\007'; sleep 30".into(),
				]),
				TerminalKind::Shell,
			)
			.unwrap();

		// Poll, for the reason `a_title_written_by_a_real_child_moves_the_status`
		// polls: the read is fast, the scheduler is not.
		let deadline = std::time::Instant::now() + Duration::from_secs(5);
		let got = loop {
			if let Some(e) = titles.lock().unwrap().first() {
				break Some(e.title.clone());
			}
			if std::time::Instant::now() > deadline {
				break None;
			}
			std::thread::sleep(Duration::from_millis(25));
		};

		let status_events = statuses.lock().unwrap().len();
		let _ = mgr.kill(&id);

		assert_eq!(got.as_deref(), Some("\u{2733} ~/dev/factorai"), "the chip's label");
		assert_eq!(status_events, 0, "a shell's title must not be classified as Claude's state");
	}

	/// A shell's whole lifetime is the footer it is drawn in (F23).
	#[test]
	fn closing_a_session_kills_its_shells_and_nothing_else() {
		let (mgr, _d, _e) = make_manager();
		let mine = "99999999-8888-7777-6666-555555555555";
		let other = "12121212-3434-5656-7878-909090909090";
		let sleep = || Some(vec!["/bin/sh".into(), "-c".into(), "sleep 30".into()]);

		let agent = mgr.spawn_inner(shell_opts(mine), sleep(), TerminalKind::Agent).unwrap();
		let ours = mgr.spawn_inner(shell_opts(mine), sleep(), TerminalKind::Shell).unwrap();
		let theirs = mgr.spawn_inner(shell_opts(other), sleep(), TerminalKind::Shell).unwrap();
		assert_eq!(mgr.live_count(), 3);

		mgr.kill_shells_for_session(mine);

		// `kill` signals; the waiter thread removes the entry when the process
		// actually goes. Poll for that rather than assuming it has happened —
		// the same reason the title tests poll.
		let deadline = std::time::Instant::now() + Duration::from_secs(5);
		let live: HashSet<TerminalId> = loop {
			let live: HashSet<TerminalId> = mgr.list().into_iter().map(|t| t.id).collect();
			if !live.contains(&ours) || std::time::Instant::now() > deadline {
				break live;
			}
			std::thread::sleep(Duration::from_millis(25));
		};
		assert!(!live.contains(&ours), "the session's own shell dies with it");
		assert!(live.contains(&agent), "the agent is killed by its own path, not this one");
		assert!(live.contains(&theirs), "another session's shells are untouched");

		mgr.kill_all();
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
		assert!(matches!(err, AppError::NotFound(_)), "expected NotFound, got {err:?}");
		assert_eq!(mgr.live_count(), 0, "nothing should have been spawned");
	}

	/// A manager whose index says this session ran in `recorded`.
	fn make_manager_recording(claude_dir: PathBuf, recorded: PathBuf) -> TerminalManager {
		let (mgr, _d, _e) = make_manager_in(claude_dir);
		mgr.with_session_cwd(Arc::new(move |_| vec![recorded.clone()]))
	}

	#[test]
	fn resume_cwd_prefers_the_folder_the_transcript_is_actually_in() {
		let store = tempfile::TempDir::new().unwrap();
		let work = tempfile::TempDir::new().unwrap();
		let sid = "11111111-2222-3333-4444-555555555555";
		write_transcript(store.path(), &work.path().to_string_lossy(), sid);

		let mgr = make_manager_recording(store.path().to_path_buf(), work.path().to_path_buf());
		// The whole point: the caller would have said "the project root", and the
		// transcript is somewhere else. Spawning where the caller said turns
		// `--resume` into `--session-id` on an id Claude already knows.
		assert_eq!(mgr.resume_cwd(sid), Some(work.path().to_path_buf()));
	}

	#[test]
	fn resume_cwd_ignores_a_recorded_folder_with_no_transcript_in_it() {
		let store = tempfile::TempDir::new().unwrap();
		let work = tempfile::TempDir::new().unwrap();
		// Row exists, transcript does not — the folder moved, or the store was
		// cleaned. Preferring it would move the session somewhere the caller did
		// not ask for and buy nothing, so the caller's cwd has to win.
		let mgr = make_manager_recording(store.path().to_path_buf(), work.path().to_path_buf());
		assert_eq!(mgr.resume_cwd("11111111-2222-3333-4444-555555555555"), None);
	}

	#[test]
	fn resume_cwd_takes_the_folder_the_transcript_is_in_when_the_session_moved() {
		let store = tempfile::TempDir::new().unwrap();
		let started = tempfile::TempDir::new().unwrap();
		let moved_to = tempfile::TempDir::new().unwrap();
		let sid = "11111111-2222-3333-4444-555555555555";
		// Claude took its store directory along, so the transcript exists only
		// under where the session ended up (F21).
		write_transcript(store.path(), &moved_to.path().to_string_lossy(), sid);

		let (mgr, _d, _e) = make_manager_in(store.path().to_path_buf());
		let ended = moved_to.path().to_path_buf();
		let began = started.path().to_path_buf();
		let mgr = mgr.with_session_cwd(Arc::new(move |_| vec![ended.clone(), began.clone()]));

		assert_eq!(mgr.resume_cwd(sid), Some(moved_to.path().to_path_buf()));
	}

	#[test]
	fn resume_cwd_falls_back_to_where_the_session_started() {
		let store = tempfile::TempDir::new().unwrap();
		let started = tempfile::TempDir::new().unwrap();
		let moved_to = tempfile::TempDir::new().unwrap();
		let sid = "11111111-2222-3333-4444-555555555555";
		// The ordinary shape: the agent `cd`'d somewhere transient, and the store
		// directory never moved. Newest-first must not become newest-only.
		write_transcript(store.path(), &started.path().to_string_lossy(), sid);

		let (mgr, _d, _e) = make_manager_in(store.path().to_path_buf());
		let ended = moved_to.path().to_path_buf();
		let began = started.path().to_path_buf();
		let mgr = mgr.with_session_cwd(Arc::new(move |_| vec![ended.clone(), began.clone()]));

		assert_eq!(mgr.resume_cwd(sid), Some(started.path().to_path_buf()));
	}

	#[test]
	fn resume_cwd_is_none_with_no_index_to_ask() {
		let store = tempfile::TempDir::new().unwrap();
		let (mgr, _d, _e) = make_manager_in(store.path().to_path_buf());
		// No callback wired at all — every test manager above this point, and the
		// behaviour that predates `session_cwd`. `resume_cwd` returns `None`, so
		// `opts.cwd` is used.
		assert_eq!(mgr.resume_cwd("11111111-2222-3333-4444-555555555555"), None);
	}

	#[test]
	fn spawn_runs_in_the_recorded_folder_not_the_one_it_was_given() {
		let store = tempfile::TempDir::new().unwrap();
		let work = tempfile::TempDir::new().unwrap();
		let given = tempfile::TempDir::new().unwrap();
		let sid = "11111111-2222-3333-4444-555555555555";
		write_transcript(store.path(), &work.path().to_string_lossy(), sid);

		let mgr = make_manager_recording(store.path().to_path_buf(), work.path().to_path_buf());
		let mut o = opts(80, 24);
		o.cwd = Some(given.path().to_string_lossy().into());
		let id = mgr
			.spawn_with_argv(o, Some(vec!["/bin/sh".into(), "-c".into(), "sleep 30".into()]))
			.unwrap();

		// Copied out, and the guard dropped, *before* `kill_all` — a DashMap read
		// guard held across it deadlocks on the same shard.
		let spawned_in = mgr.terminals.get(&id).map(|h| h.cwd.clone()).unwrap();
		mgr.kill_all();
		assert_eq!(spawned_in, work.path().to_path_buf());
	}

	/// A routine's prompt is one positional argument after the id, on whichever
	/// branch the transcript probe chose (F22, ADR-0026 § 4).
	#[test]
	fn an_initial_prompt_becomes_one_positional_argument() {
		let tmp = tempfile::TempDir::new().unwrap();
		let (mut mgr, _data, _exit) = make_manager();
		mgr.set_binary(PathBuf::from("/bin/echo"));
		let mut o = opts(80, 24);
		o.cwd = Some(tmp.path().to_string_lossy().to_string());
		o.initial_prompt = Some("Triage the inbox".into());
		let argv = mgr.argv_for(&o, tmp.path(), None).expect("argv");
		assert_eq!(argv[0], "/bin/echo");
		assert_eq!(argv[1], "--session-id");
		assert_eq!(argv[2], o.session_id);
		assert_eq!(argv[3], "Triage the inbox");

		// An empty prompt is not an argument: it would be an empty first message.
		o.initial_prompt = Some(String::new());
		assert_eq!(mgr.argv_for(&o, tmp.path(), None).unwrap().len(), 3);
		o.initial_prompt = None;
		assert_eq!(mgr.argv_for(&o, tmp.path(), None).unwrap().len(), 3);
	}

	#[test]
	fn the_agent_tool_server_is_registered_by_name_in_argv() {
		// **The whole point of the flag** (ADR-0029): the CLI hardcodes the IDE
		// bridge's server key to `ide` and shows the model two of its tools, so
		// factorai's own tools have to arrive under a name of their own. If this
		// argument stops being passed, every tool in `agent_tools` becomes
		// invisible to the agent while every unit test in it still passes.
		let tmp = tempfile::TempDir::new().unwrap();
		let (mut mgr, _data, _exit) = make_manager();
		mgr.set_binary(PathBuf::from("/bin/echo"));
		let o = opts(80, 24);
		let tools = AgentToolsServer::start(Arc::new(|_| None)).expect("bind");

		let argv = mgr.argv_for(&o, tmp.path(), Some(&tools)).expect("argv");
		let at = argv.iter().position(|a| a == "--mcp-config").expect("--mcp-config is passed");
		let config: serde_json::Value = serde_json::from_str(&argv[at + 1]).expect("valid json");
		let server = &config["mcpServers"][crate::services::agent_tools::SERVER_NAME];

		assert_ne!(
			crate::services::agent_tools::SERVER_NAME,
			"ide",
			"a server named `ide` is the one the CLI caps at two tools"
		);
		assert_eq!(server["type"], "http", "ws-ide is refused from --mcp-config");
		assert!(
			server["url"].as_str().unwrap().starts_with("http://127.0.0.1:"),
			"loopback only: {server}"
		);
		assert_eq!(
			server["headers"]["Authorization"],
			format!("Bearer {}", tools.token()),
			"the session's own token, not a shared one"
		);
		// **Merging, never replacing.** `--strict-mcp-config` would drop every
		// MCP server the user configured for themselves.
		assert!(!argv.iter().any(|a| a == "--strict-mcp-config"), "{argv:?}");
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

	/// The resync path (F20), which exists for a renderer that reloaded: it
	/// threw its state away while every bridge carried on.
	///
	/// Driven through a real spawn and a real client, because the thing that
	/// could break is the iteration — a bridge that is attached but not reported
	/// leaves the header saying Claude has gone from a session it is driving,
	/// and nothing else would notice.
	#[test]
	fn resync_re_announces_a_bridge_that_has_a_client_on_it() {
		use tungstenite::client::IntoClientRequest;

		let claude_dir = tempfile::tempdir().unwrap();
		let (mut mgr, _data, _exit) = make_manager_in(claude_dir.path().to_path_buf());

		let seen: Arc<StdMutex<Vec<IdeStatusEvent>>> = Arc::new(StdMutex::new(Vec::new()));
		let sink = seen.clone();
		mgr.set_ide_status_cb(Arc::new(move |e| sink.lock().unwrap().push(e)));

		// `sleep` rather than `echo`: the PTY has to outlive the assertions, or
		// the handle — and the bridge with it — is gone before we look.
		mgr.spawn_with_argv(
			opts(80, 24),
			Some(vec!["/bin/sh".into(), "-c".into(), "sleep 5".into()]),
		)
		.expect("spawn");

		// The port is in the lockfile, which is the only place production reads
		// it from either.
		let dir = crate::services::ide::lockfile::dir(claude_dir.path());
		let entry = std::fs::read_dir(&dir)
			.expect("the bridge wrote its handle")
			.flatten()
			.next()
			.expect("exactly one lockfile");
		let port: u16 = entry
			.path()
			.file_stem()
			.unwrap()
			.to_string_lossy()
			.parse()
			.expect("the filename is the port");
		let lock = crate::services::ide::lockfile::read(&entry.path()).unwrap();

		// Nothing attached yet: resync must say so rather than say nothing.
		mgr.resync_ide_status();
		{
			let events = seen.lock().unwrap();
			assert_eq!(events.len(), 1);
			assert!(!events[0].connected, "no client has connected yet");
		}
		seen.lock().unwrap().clear();

		let mut request = format!("ws://127.0.0.1:{port}").into_client_request().unwrap();
		request
			.headers_mut()
			.insert("x-claude-code-ide-authorization", lock.auth_token.parse().unwrap());
		let (_ws, _) = tungstenite::connect(request).expect("a client attaches");

		// The attach edge is asynchronous, so wait for it rather than racing it.
		for _ in 0..100 {
			if seen.lock().unwrap().iter().any(|e| e.connected) {
				break;
			}
			std::thread::sleep(Duration::from_millis(20));
		}
		seen.lock().unwrap().clear();

		mgr.resync_ide_status();

		let events = seen.lock().unwrap();
		assert_eq!(events.len(), 1, "one announcement per bridge");
		assert!(events[0].connected, "a bridge with a client on it must say so");
		assert_eq!(events[0].session_id, opts(80, 24).session_id);
	}
}
