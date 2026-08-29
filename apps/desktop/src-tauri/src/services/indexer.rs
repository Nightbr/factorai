use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use rusqlite::{params, Connection, OptionalExtension};
use tauri::{AppHandle, Emitter};
use tracing::{debug, info, warn};

use crate::agents::claude;
use crate::commands::projects::reconcile;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::{IndexerPhase, IndexerProgress, SessionsChanged};
use crate::services::jsonl::{derive_title, flatten_message_text, tool_use_paths, EventIter};

/// Which version of `index_session` wrote a `sessions` row.
///
/// **Bump this whenever the parse learns to extract something new**, and every
/// existing row is reparsed once on the next scan — see migration 0009 for why
/// a derived column cannot be backfilled any other way, and why the ad-hoc test
/// this replaced could not generalise.
///
/// 1 — `last_touched`, the last absolute path an agent's tools named (F21).
/// 2 — `touched_paths`, the same signal widened to shell commands and kept as a
///     list, because that harvest is loose enough that one value is mostly noise
///     (F21, migration 0010).
const PARSE_VERSION: i64 = 2;

/// How many recent paths a session keeps. See migration 0010 for why a list at
/// all, and why the number is not doing any selecting.
const TOUCHED_PATHS_KEPT: usize = 8;

pub type ProgressCb = Arc<dyn Fn(IndexerProgress) + Send + Sync>;
pub type ChangedCb = Arc<dyn Fn(SessionsChanged) + Send + Sync>;
/// The session ids that currently have a live PTY. Injected rather than read
/// from `TerminalManager` directly, for the same reason the emit callbacks are:
/// the indexer's tests build one without a Tauri runtime. Defaults to "nothing
/// is live", which is the right answer for a scan that has no terminals behind
/// it at all.
pub type LiveIdsCb = Arc<dyn Fn() -> HashSet<String> + Send + Sync>;

/// Owns the scan + watcher. Cheap to clone (Arc internals). Emit is wired
/// via callbacks so tests can construct an Indexer without a Tauri runtime.
///
/// **Parsing is gated on the workspace.** Discovery is cheap and global — we
/// list every directory in every agent's store — but only folders you added get
/// their transcripts read and tokenized. Search is scoped the same way, so
/// indexing anything else would be work no query can reach.
#[derive(Clone)]
pub struct Indexer {
	db: Db,
	claude_dir: PathBuf,
	on_progress: ProgressCb,
	on_changed: ChangedCb,
	live_ids: LiveIdsCb,
}

/// One agent directory that belongs to a folder in the workspace: everything
/// needed to index it, resolved once per scan.
struct LinkedDir {
	discovered_id: i64,
	project_id: String,
	agent: String,
	key: String,
}

impl LinkedDir {
	/// Where this directory lives. The only place the scan needs to know whose
	/// store it is reading — and so the one place a second agent adds a branch.
	/// Until then every row is Claude's, which `discover` guarantees.
	fn path(&self, claude_dir: &Path) -> PathBuf {
		debug_assert_eq!(self.agent, crate::agents::CLAUDE);
		claude_dir.join("projects").join(&self.key)
	}
}

impl Indexer {
	/// Build an indexer wired to a live Tauri AppHandle. Used in production.
	pub fn for_app(db: Db, claude_dir: PathBuf, app: AppHandle) -> Self {
		let app_progress = app.clone();
		let app_changed = app;
		Self {
			db,
			claude_dir,
			on_progress: Arc::new(move |p| {
				let _ = app_progress.emit("indexer:progress", p);
			}),
			on_changed: Arc::new(move |s| {
				let _ = app_changed.emit("sessions:changed", s);
			}),
			live_ids: Arc::new(HashSet::new),
		}
	}

	/// Teach the indexer which sessions are live, so the reap pass can spare
	/// them. A builder rather than a constructor argument because `setup()`
	/// builds the `TerminalManager` alongside this, and neither should have to
	/// know which is constructed first.
	pub fn with_live_ids(mut self, live_ids: LiveIdsCb) -> Self {
		self.live_ids = live_ids;
		self
	}

	/// Build an indexer with explicit emit callbacks. Useful for tests that
	/// want to capture or ignore events.
	pub fn with_callbacks(
		db: Db,
		claude_dir: PathBuf,
		on_progress: ProgressCb,
		on_changed: ChangedCb,
	) -> Self {
		Self { db, claude_dir, on_progress, on_changed, live_ids: Arc::new(HashSet::new) }
	}

	pub fn claude_dir(&self) -> &Path {
		&self.claude_dir
	}

	pub fn db(&self) -> &Db {
		&self.db
	}

	/// Discover what the agents' stores hold, link it to the workspace, then
	/// index every folder in the workspace.
	pub fn full_scan(&self) -> AppResult<()> {
		self.discover()?;
		self.refresh_missing()?;

		let dirs = self.db.with(|conn| linked_dirs(conn, None))?;
		info!(count = dirs.len(), "scanning workspace projects");
		self.emit_progress(0, dirs.len() as u32, IndexerPhase::Scanning);

		let mut processed = 0u32;
		for dir in &dirs {
			if let Err(e) = self.index_dir(dir) {
				warn!(key = %dir.key, error = %e, "project scan failed");
			}
			processed += 1;
			self.emit_progress(processed, dirs.len() as u32, IndexerPhase::Parsing);
		}

		self.emit_progress(processed, dirs.len() as u32, IndexerPhase::Idle);
		info!("scan complete");
		Ok(())
	}

	/// Index one workspace project — every agent directory linked to its folder.
	/// Called when a project is added, since nothing was parsed for it before.
	pub fn scan_project(&self, project_id: &str) -> AppResult<()> {
		self.discover()?;
		let dirs = self.db.with(|conn| linked_dirs(conn, Some(project_id)))?;
		self.emit_progress(0, dirs.len() as u32, IndexerPhase::Scanning);
		let mut processed = 0u32;
		for dir in &dirs {
			if let Err(e) = self.index_dir(dir) {
				warn!(key = %dir.key, error = %e, "project scan failed");
			}
			processed += 1;
			self.emit_progress(processed, dirs.len() as u32, IndexerPhase::Parsing);
		}
		self.emit_progress(processed, dirs.len() as u32, IndexerPhase::Idle);
		Ok(())
	}

	/// Record every directory each agent's store holds, and link it to the
	/// workspace folder it describes. No transcript is parsed in full here.
	pub fn discover(&self) -> AppResult<()> {
		let found = claude::discover(&self.claude_dir);
		self.db.with_mut(|conn| {
			let tx = conn.transaction()?;
			{
				let mut stmt = tx.prepare(
					"INSERT INTO discovered_projects(agent, key, real_path) VALUES(?1, ?2, ?3)
					 ON CONFLICT(agent, key) DO UPDATE SET
					   real_path = COALESCE(excluded.real_path, discovered_projects.real_path)",
				)?;
				for d in &found {
					stmt.execute(params![d.agent, d.key, d.real_path])?;
				}
			}
			reconcile(&tx)?;
			tx.commit()?;
			Ok(())
		})
	}

	/// Restate which workspace folders are gone from disk.
	///
	/// Once per scan rather than per `list_projects` call: that query is polled
	/// every 2s, and this answer changes when someone deletes a directory (F1).
	fn refresh_missing(&self) -> AppResult<()> {
		let rows: Vec<(String, String)> = self.db.with(|conn| {
			let mut stmt = conn.prepare("SELECT id, real_path FROM projects")?;
			let rows = stmt
				.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
				.collect::<rusqlite::Result<Vec<_>>>()?;
			Ok(rows)
		})?;
		self.db.with_mut(|conn| {
			let tx = conn.transaction()?;
			{
				let mut stmt = tx.prepare("UPDATE projects SET missing = ?2 WHERE id = ?1")?;
				for (id, real_path) in &rows {
					let missing = !Path::new(real_path).is_dir();
					stmt.execute(params![id, missing as i64])?;
				}
			}
			tx.commit()?;
			Ok(())
		})
	}

	/// Re-index one agent directory, addressed by its path on disk. The
	/// watcher's entry point: it sees a changed `.jsonl` and knows only which
	/// directory it sat in.
	///
	/// A directory that isn't linked to a workspace folder is skipped, which is
	/// how "new Claude activity in a project you never added" stays silent.
	pub fn scan_dir_path(&self, dir: &Path) -> AppResult<()> {
		let Some(key) = dir.file_name().and_then(|s| s.to_str()) else {
			return Err(AppError::InvalidInput("project dir name not utf-8".into()));
		};
		// A directory that appeared since the last scan has no row yet. Resolving
		// it here is what makes the *first* session in a freshly added folder show
		// up without waiting for a restart.
		if self.db.with(|conn| discovered_id_for(conn, key))?.is_none() {
			self.discover()?;
		}
		let linked = self.db.with(|conn| {
			let sql = format!("{LINKED_SELECT} AND d.key = ?1");
			Ok(conn.query_row(&sql, params![key], map_linked).optional()?)
		})?;
		match linked {
			Some(dir) => self.index_dir(&dir),
			None => {
				debug!(?dir, "ignoring activity outside the workspace");
				Ok(())
			}
		}
	}

	/// Parse every transcript in one linked directory that has changed since we
	/// last looked.
	fn index_dir(&self, dir: &LinkedDir) -> AppResult<()> {
		let session_files: Vec<PathBuf> = match std::fs::read_dir(dir.path(&self.claude_dir)) {
			Ok(rd) => rd
				.filter_map(Result::ok)
				.map(|e| e.path())
				.filter(|p| p.extension().is_some_and(|e| e == "jsonl"))
				.collect(),
			// Nothing below runs, the reap included. An unreadable directory and
			// an empty one are different answers, and only one of them may delete
			// rows — a store that has vanished (Claude uninstalled, CLAUDE_HOME
			// moved) must leave the index alone rather than empty it.
			Err(_) => return Ok(()),
		};

		// Every id this directory holds a transcript for, built as we go and
		// handed to the reap below. Sub-agents are in it too: their rows carry
		// the parent's `discovered_id`, so a set of top-level ids alone would
		// read every agent transcript as deleted.
		let mut on_disk: HashSet<String> = HashSet::new();

		let mut changed_ids: Vec<String> = Vec::new();
		for session_path in &session_files {
			if let Some(id) = session_path.file_stem().and_then(|s| s.to_str()) {
				on_disk.insert(id.to_string());
			}
			match self.index_session_if_changed(dir.discovered_id, session_path, None) {
				Ok(Some(session_id)) => changed_ids.push(session_id),
				Ok(None) => {}
				Err(e) => warn!(path = ?session_path, error = %e, "session index failed"),
			}
		}

		// Sub-agent transcripts: Claude Code writes each agent a session spawns
		// to <session-id>/subagents/agent-*.jsonl. Same JSONL shape, same
		// parsing — but marked `subagent_of` so the UI can nest them under
		// their parent and never try to resume one.
		//
		// They index against the *parent's* directory, `dir.discovered_id`: a
		// `subagents/` folder is part of a session, not a directory of the
		// store, which is the whole bug this replaced.
		for session_path in &session_files {
			if let Some(session_id) = session_path.file_stem().and_then(|s| s.to_str()) {
				for agent_path in subagent_files(session_path) {
					if let Some(id) = agent_path.file_stem().and_then(|s| s.to_str()) {
						on_disk.insert(id.to_string());
					}
					match self.index_session_if_changed(
						dir.discovered_id,
						&agent_path,
						Some(session_id),
					) {
						Ok(Some(agent_id)) => changed_ids.push(agent_id),
						Ok(None) => {}
						Err(e) => warn!(path = ?agent_path, error = %e, "sub-agent index failed"),
					}
				}
			}
		}

		if let Err(e) = self.reap_deleted(dir.discovered_id, &on_disk) {
			warn!(key = %dir.key, error = %e, "reap of deleted transcripts failed");
		}

		// No aggregate refresh here any more. `projects` carried `session_count`
		// and `last_session_at` columns when it was a mirror of the store; the
		// workspace table doesn't, and `PROJECT_SELECT` counts through
		// `discovered_projects` at query time instead — where the "sub-agents
		// don't count" rule now lives.

		if !changed_ids.is_empty() {
			(self.on_changed)(SessionsChanged {
				project_id: dir.project_id.clone(),
				session_ids: changed_ids,
			});
		}
		Ok(())
	}

	/// Drop the rows of one directory whose transcripts are no longer on disk,
	/// with their FTS entries, in one transaction.
	///
	/// `index_session_if_changed` only ever upserts, so nothing used to walk the
	/// other way and a deleted transcript stayed indexed forever — 147 rows
	/// against 80 files on the machine this was found on. The visible symptom is
	/// worse than a stale count: the row still has a title, so a search hit opens
	/// it, finds no transcript, and spawns `claude --session-id <id>` rather than
	/// `--resume`. That is exactly what ADR-0008 specifies, but the effect is
	/// that you click a 1721-turn conversation and land in an empty new session
	/// wearing its title.
	///
	/// Deliberately not a probe per read: the caller already holds the directory
	/// listing, so the answer is a set difference rather than a `stat` per row.
	///
	/// **A live session is exempt.** Rows only ever come from transcripts, so the
	/// ADR-0008 window — a session spawned but not yet messaged, which has no
	/// file — has no row to reap either. The case this guards is the other one:
	/// a transcript deleted out from under a session that is still running, where
	/// dropping the row would take the title off a tab the user is looking at.
	fn reap_deleted(
		&self,
		discovered_id: i64,
		on_disk: &HashSet<String>,
	) -> AppResult<Vec<String>> {
		let indexed: Vec<String> = self.db.with(|conn| {
			let mut stmt = conn.prepare("SELECT id FROM sessions WHERE discovered_id = ?1")?;
			let ids = stmt
				.query_map(params![discovered_id], |r| r.get::<_, String>(0))?
				.collect::<rusqlite::Result<Vec<_>>>()?;
			Ok(ids)
		})?;

		let live = (self.live_ids)();
		let gone: Vec<String> =
			indexed.into_iter().filter(|id| !on_disk.contains(id) && !live.contains(id)).collect();
		if gone.is_empty() {
			return Ok(gone);
		}

		self.db.with_mut(|conn| {
			let tx = conn.transaction()?;
			{
				let mut del_fts = tx.prepare("DELETE FROM messages_fts WHERE session_id = ?1")?;
				// F21's checkout record. This is what `ON DELETE CASCADE` used to do,
				// moved here when migration 0007 dropped the foreign key: the record
				// is keyed by an id we minted and has to be writable before the scan
				// has seen a transcript, so its lifetime cannot hang off `sessions`.
				// **This is the right place for it** — the reap already exempts live
				// sessions, which is the same guard the checkout needs.
				let mut del_wt =
					tx.prepare("DELETE FROM session_worktrees WHERE session_id = ?1")?;
				// F22's origin record, here for exactly the same reason and with the
				// same shape: no foreign key, because the runner writes it at spawn
				// and the `sessions` row does not exist yet (migration 0013).
				let mut del_rt =
					tx.prepare("DELETE FROM session_routines WHERE session_id = ?1")?;
				let mut del_row = tx.prepare("DELETE FROM sessions WHERE id = ?1")?;
				for id in &gone {
					del_fts.execute(params![id])?;
					del_wt.execute(params![id])?;
					del_rt.execute(params![id])?;
					del_row.execute(params![id])?;
				}
			}
			tx.commit()?;
			Ok(())
		})?;

		info!(count = gone.len(), discovered_id, "reaped sessions whose transcript is gone");
		Ok(gone)
	}

	/// Index one .jsonl. Returns the session id if it was reindexed (or
	/// newly indexed), `None` if the cached `(mtime, size)` already matched.
	/// `subagent_of` marks the file as a sub-agent transcript belonging to
	/// that parent session.
	pub fn index_session_if_changed(
		&self,
		discovered_id: i64,
		session_path: &Path,
		subagent_of: Option<&str>,
	) -> AppResult<Option<String>> {
		let session_id = match session_path.file_stem().and_then(|s| s.to_str()) {
			Some(name) => name.to_string(),
			None => return Err(AppError::InvalidInput("session filename not utf-8".into())),
		};

		let meta = std::fs::metadata(session_path)?;
		let mtime_ms = meta
			.modified()?
			.duration_since(std::time::UNIX_EPOCH)
			.map(|d| d.as_millis() as i64)
			.unwrap_or(0);
		let size = meta.len() as i64;

		let cached: Option<(i64, i64, i64)> = self.db.with(|conn| {
			Ok(conn
				.query_row(
					// The third column is not a fact about the file: it is "which
					// version of this function wrote the row".
					"SELECT file_mtime, file_size, parse_version FROM sessions WHERE id = ?1",
					params![session_id],
					|row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?)),
				)
				.ok())
		})?;
		// **A row written by an older parser is reparsed even when the file has not
		// changed** (F21, migration 0009). `ALTER TABLE ... ADD COLUMN` cannot fill
		// a column derived from the transcript, so without this a session keeps its
		// stale answer until it is next messaged — which for a finished session is
		// never, and finished sessions are most of them.
		//
		// It costs one reparse per pre-existing session per bump, and it cannot
		// loop: the row is written with `PARSE_VERSION` whatever the transcript
		// turned out to contain. That is what the version stamp buys over 0008's
		// `last_cwd IS NULL` test, which would never converge for a session that
		// legitimately has nothing to find.
		if let Some((cached_mtime, cached_size, parsed_with)) = cached {
			if (cached_mtime, cached_size) == (mtime_ms, size) && parsed_with >= PARSE_VERSION {
				return Ok(None);
			}
		}

		debug!(%session_id, "indexing session");
		let mut first_user_text: Option<String> = None;
		let mut first_ts: Option<i64> = None;
		let mut last_ts: Option<i64> = None;
		let mut turn_count: i64 = 0;
		let mut cwd: Option<String> = None;
		// Where the session *ended up*, as opposed to where it started (F21). Both
		// are kept because neither answers the other's question: `cwd` is what the
		// transcript's directory is derived from, and this is what tells us the
		// agent moved. Migration 0008 has why the churn in between is harmless.
		let mut last_cwd: Option<String> = None;
		// The recent absolute paths the agent's tools named (F21, migration 0010).
		// The signal for an agent that drives another checkout by absolute path and
		// so never moves its own cwd — the shape that reached a user on 2026-08-24,
		// twice, the second time through `Bash` alone.
		let mut touched_paths: Vec<String> = Vec::new();
		let mut fts_rows: Vec<(String, String)> = Vec::new(); // (role, body)
														// Two independent title sources, kept apart so precedence is decided once
														// at the end rather than by whichever line happens to come last in the
														// file: `/rename` always beats Claude's own auto-title.
		let mut custom_title: Option<String> = None;
		let mut ai_title: Option<String> = None;

		for ev in EventIter::open(session_path)? {
			turn_count += 1;
			if let Some(ts_str) = &ev.timestamp {
				if let Some(ts) = parse_iso(ts_str) {
					first_ts.get_or_insert(ts);
					last_ts = Some(ts);
				}
			}
			if let Some(c) = &ev.cwd {
				if cwd.is_none() {
					cwd = Some(c.clone());
				}
				last_cwd = Some(c.clone());
			}
			// Title hints, in the order Claude Code writes them:
			//
			// - `custom-title` is what `/rename` emits — a name the user chose, so
			//   it wins outright. Repeated renames each append a line; the last one
			//   is the current name.
			// - `ai-title` is Claude's own generated name, rewritten as the session
			//   develops.
			// - older versions used a top-level `title` field.
			match ev.event_type.as_str() {
				"custom-title" => {
					if let Some(t) = ev.extra.get("customTitle").and_then(|v| v.as_str()) {
						custom_title = Some(t.to_string());
					}
				}
				"ai-title" => {
					if let Some(t) = ev.extra.get("aiTitle").and_then(|v| v.as_str()) {
						ai_title = Some(t.to_string());
					}
				}
				_ => {
					if let Some(t) = ev.extra.get("title").and_then(|v| v.as_str()) {
						ai_title = Some(t.to_string());
					}
				}
			}
			if let Some(msg) = &ev.message {
				for path in tool_use_paths(&msg.content) {
					remember_touched(&mut touched_paths, path);
				}
				let text = flatten_message_text(&msg.content);
				if !text.is_empty() {
					if first_user_text.is_none() && msg.role == "user" {
						first_user_text = Some(text.clone());
					}
					fts_rows.push((msg.role.clone(), text));
				}
			}
		}

		// Stored as JSON rather than as a delimited string: a path can contain
		// anything except NUL, so any separator worth reading back is one a path
		// could carry.
		let touched_json = (!touched_paths.is_empty())
			.then(|| serde_json::to_string(&touched_paths))
			.transpose()?;

		let created_at = first_ts.unwrap_or(mtime_ms);
		let updated_at = last_ts.unwrap_or(mtime_ms);
		// A name you set yourself, else Claude's, else the first thing you said,
		// else the id. An empty `/rename` is treated as no name rather than as a
		// blank one.
		let title = custom_title
			.filter(|t| !t.trim().is_empty())
			.or(ai_title.filter(|t| !t.trim().is_empty()))
			.unwrap_or_else(|| derive_title(first_user_text.as_deref(), &session_id));

		self.db.with_mut(|conn| {
			let tx = conn.transaction()?;
			tx.execute(
				"INSERT INTO sessions(id, discovered_id, title, created_at, updated_at, turn_count, file_mtime, file_size, cwd, subagent_of, last_cwd, touched_paths, parse_version)
				 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
				 ON CONFLICT(id) DO UPDATE SET
				   title = excluded.title,
				   updated_at = excluded.updated_at,
				   turn_count = excluded.turn_count,
				   file_mtime = excluded.file_mtime,
				   file_size = excluded.file_size,
				   cwd = COALESCE(excluded.cwd, sessions.cwd),
				   subagent_of = excluded.subagent_of,
				   last_cwd = COALESCE(excluded.last_cwd, sessions.last_cwd),
				   touched_paths = COALESCE(excluded.touched_paths, sessions.touched_paths),
				   parse_version = excluded.parse_version",
				params![
					session_id,
					discovered_id,
					title,
					created_at,
					updated_at,
					turn_count,
					mtime_ms,
					size,
					cwd,
					subagent_of,
					last_cwd,
					touched_json,
					PARSE_VERSION,
				],
			)?;
			tx.execute("DELETE FROM messages_fts WHERE session_id = ?1", params![session_id])?;
			{
				let mut stmt = tx.prepare(
					"INSERT INTO messages_fts(session_id, role, body) VALUES(?1, ?2, ?3)",
				)?;
				for (role, body) in &fts_rows {
					stmt.execute(params![session_id, role, body])?;
				}
			}
			tx.commit()?;
			Ok(())
		})?;

		Ok(Some(session_id))
	}

	fn emit_progress(&self, processed: u32, total: u32, phase: IndexerPhase) {
		(self.on_progress)(IndexerProgress { processed, total, phase });
	}
}

/// Every agent directory whose folder is in the workspace.
const LINKED_SELECT: &str = "SELECT d.id, d.project_id, d.agent, d.key
	FROM discovered_projects d
	WHERE d.project_id IS NOT NULL";

fn map_linked(row: &rusqlite::Row<'_>) -> rusqlite::Result<LinkedDir> {
	Ok(LinkedDir {
		discovered_id: row.get(0)?,
		project_id: row.get(1)?,
		agent: row.get(2)?,
		key: row.get(3)?,
	})
}

fn linked_dirs(conn: &Connection, project_id: Option<&str>) -> AppResult<Vec<LinkedDir>> {
	let sql = match project_id {
		Some(_) => format!("{LINKED_SELECT} AND d.project_id = ?1"),
		None => LINKED_SELECT.to_string(),
	};
	let mut stmt = conn.prepare(&sql)?;
	let rows = match project_id {
		Some(id) => {
			stmt.query_map(params![id], map_linked)?.collect::<rusqlite::Result<Vec<_>>>()?
		}
		None => stmt.query_map([], map_linked)?.collect::<rusqlite::Result<Vec<_>>>()?,
	};
	Ok(rows)
}

fn discovered_id_for(conn: &Connection, key: &str) -> AppResult<Option<i64>> {
	Ok(conn
		.query_row("SELECT id FROM discovered_projects WHERE key = ?1", params![key], |r| {
			r.get::<_, i64>(0)
		})
		.optional()?)
}

/// The `agent-*.jsonl` transcripts under `<session>.jsonl`'s sibling
/// `subagents/` directory, if there is one. Claude Code creates it lazily —
/// most sessions never spawn an agent, so the directory usually doesn't
/// exist. Read errors are swallowed: a sub-agent row we miss this scan shows
/// up on the next one.
fn subagent_files(session_path: &Path) -> Vec<PathBuf> {
	let Some(dir) = session_path.parent() else { return Vec::new() };
	let sub_dir = dir.join(session_id_of(session_path)).join("subagents");
	match std::fs::read_dir(&sub_dir) {
		Ok(rd) => rd
			.filter_map(Result::ok)
			.map(|e| e.path())
			.filter(|p| {
				p.extension().is_some_and(|e| e == "jsonl")
					&& p.file_name()
						.and_then(|n| n.to_str())
						.is_some_and(|n| n.starts_with("agent-"))
			})
			.collect(),
		Err(_) => Vec::new(),
	}
}

fn session_id_of(session_path: &Path) -> &str {
	session_path.file_stem().and_then(|s| s.to_str()).unwrap_or_default()
}

/// The project directory a changed `.jsonl` belongs to, given the file's
/// path. Top-level transcripts map to their parent; a sub-agent transcript
/// at `<project>/<session>/subagents/agent-*.jsonl` maps to `<project>`.
/// `None` — watch and ignore — when the result isn't a direct child of
/// `projects_dir`, which is the only shape a project directory has. That
/// guard is what stops a stray `.jsonl` anywhere else in the tree from
/// manufacturing a project row named after its containing folder.
pub fn project_dir_for_event(path: &Path, projects_dir: &Path) -> Option<PathBuf> {
	let parent = path.parent()?;

	let project_dir = if parent.file_name().and_then(|n| n.to_str()) == Some("subagents") {
		// `subagents/` sits inside the session's own directory; the project
		// is two levels up from the file.
		parent.parent()?.parent()?
	} else {
		parent
	};

	if project_dir.parent() == Some(projects_dir) {
		Some(project_dir.to_path_buf())
	} else {
		None
	}
}

/// Record one path the agent's tools named, keeping the list most-recent-last
/// and bounded (F21, migration 0010).
///
/// **A repeat moves rather than duplicates.** A session in a worktree names the
/// same directory over and over, and eight copies of one path is a window one
/// entry wide — which would put us back to the single value the list replaced.
fn remember_touched(touched: &mut Vec<String>, path: &str) {
	if let Some(pos) = touched.iter().position(|p| p == path) {
		touched.remove(pos);
	}
	touched.push(path.to_string());
	if touched.len() > TOUCHED_PATHS_KEPT {
		touched.remove(0);
	}
}

fn parse_iso(s: &str) -> Option<i64> {
	chrono::DateTime::parse_from_rfc3339(s).ok().map(|dt| dt.timestamp_millis())
}

/// Spawn the indexer's initial full scan on a background thread.
pub fn spawn_initial_scan(indexer: Arc<Indexer>) {
	std::thread::Builder::new()
		.name("indexer-scan".into())
		.spawn(move || {
			if let Err(e) = indexer.full_scan() {
				warn!(error = %e, "indexer initial scan failed");
			}
		})
		.expect("failed to spawn indexer thread");
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn project_dir_for_event_maps_a_top_level_transcript() {
		let projects = Path::new("/home/a/.claude/projects");
		let p = Path::new("/home/a/.claude/projects/-code-foo/abc.jsonl");
		assert_eq!(
			project_dir_for_event(p, projects).as_deref(),
			Some(Path::new("/home/a/.claude/projects/-code-foo"))
		);
	}

	#[test]
	fn project_dir_for_event_walks_a_subagent_transcript_up_to_the_project() {
		let projects = Path::new("/home/a/.claude/projects");
		let p =
			Path::new("/home/a/.claude/projects/-code-foo/1111-2222/subagents/agent-3333.jsonl");
		assert_eq!(
			project_dir_for_event(p, projects).as_deref(),
			Some(Path::new("/home/a/.claude/projects/-code-foo"))
		);
	}

	#[test]
	fn project_dir_for_event_ignores_a_jsonl_outside_any_project_dir() {
		let projects = Path::new("/home/a/.claude/projects");
		// Deeper than any layout Claude writes: the session dir itself.
		let p = Path::new("/home/a/.claude/projects/-code-foo/1111-2222/stray.jsonl");
		assert_eq!(project_dir_for_event(p, projects), None);

		// And directly under projects_dir's parent would be `projects/`'s own
		// children only — a file one level too high has no project either.
		let too_high = Path::new("/home/a/.claude/projects/loose.jsonl");
		assert_eq!(project_dir_for_event(too_high, projects), None);
	}

	#[test]
	fn subagent_files_lists_agent_transcripts_for_a_session() {
		let tmp = tempfile::TempDir::new().unwrap();
		let project = tmp.path().join("-code-foo");
		std::fs::create_dir_all(&project).unwrap();
		let sid = "1111-2222";
		std::fs::write(project.join(format!("{sid}.jsonl")), "{}\n").unwrap();
		let subs = project.join(sid).join("subagents");
		std::fs::create_dir_all(&subs).unwrap();
		std::fs::write(subs.join("agent-aaa.jsonl"), "{}\n").unwrap();
		std::fs::write(subs.join("agent-bbb.jsonl"), "{}\n").unwrap();
		// Not agent-prefixed, and not .jsonl: neither is a sub-agent transcript.
		std::fs::write(subs.join("notes.txt"), "").unwrap();
		std::fs::write(subs.join("other.jsonl"), "{}\n").unwrap();

		let mut got: Vec<String> = subagent_files(&project.join(format!("{sid}.jsonl")))
			.iter()
			.filter_map(|p| p.file_name().and_then(|n| n.to_str()).map(String::from))
			.collect();
		got.sort();
		assert_eq!(got, vec!["agent-aaa.jsonl".to_string(), "agent-bbb.jsonl".to_string()]);
	}

	#[test]
	fn subagent_files_is_empty_when_the_dir_does_not_exist() {
		let tmp = tempfile::TempDir::new().unwrap();
		let project = tmp.path().join("-code-foo");
		std::fs::create_dir_all(&project).unwrap();
		let sid = "1111-2222";
		std::fs::write(project.join(format!("{sid}.jsonl")), "{}\n").unwrap();
		assert!(subagent_files(&project.join(format!("{sid}.jsonl"))).is_empty());
	}
}
