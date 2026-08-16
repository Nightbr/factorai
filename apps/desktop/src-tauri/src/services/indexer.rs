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
use crate::services::jsonl::{derive_title, flatten_message_text, EventIter};

pub type ProgressCb = Arc<dyn Fn(IndexerProgress) + Send + Sync>;
pub type ChangedCb = Arc<dyn Fn(SessionsChanged) + Send + Sync>;

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
		}
	}

	/// Build an indexer with explicit emit callbacks. Useful for tests that
	/// want to capture or ignore events.
	pub fn with_callbacks(
		db: Db,
		claude_dir: PathBuf,
		on_progress: ProgressCb,
		on_changed: ChangedCb,
	) -> Self {
		Self { db, claude_dir, on_progress, on_changed }
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
			Ok(conn
				.query_row(&sql, params![key], map_linked)
				.optional()?)
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
			Err(_) => return Ok(()),
		};

		let mut changed_ids: Vec<String> = Vec::new();
		for session_path in &session_files {
			match self.index_session_if_changed(dir.discovered_id, session_path) {
				Ok(Some(session_id)) => changed_ids.push(session_id),
				Ok(None) => {}
				Err(e) => warn!(path = ?session_path, error = %e, "session index failed"),
			}
		}

		if !changed_ids.is_empty() {
			(self.on_changed)(SessionsChanged {
				project_id: dir.project_id.clone(),
				session_ids: changed_ids,
			});
		}
		Ok(())
	}

	/// Index one .jsonl. Returns the session id if it was reindexed (or
	/// newly indexed), `None` if the cached `(mtime, size)` already matched.
	pub fn index_session_if_changed(
		&self,
		discovered_id: i64,
		session_path: &Path,
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

		let cached: Option<(i64, i64)> = self.db.with(|conn| {
			Ok(conn
				.query_row(
					"SELECT file_mtime, file_size FROM sessions WHERE id = ?1",
					params![session_id],
					|row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
				)
				.ok())
		})?;
		if cached == Some((mtime_ms, size)) {
			return Ok(None);
		}

		debug!(%session_id, "indexing session");
		let mut first_user_text: Option<String> = None;
		let mut first_ts: Option<i64> = None;
		let mut last_ts: Option<i64> = None;
		let mut turn_count: i64 = 0;
		let mut cwd: Option<String> = None;
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
			if cwd.is_none() {
				if let Some(c) = &ev.cwd {
					cwd = Some(c.clone());
				}
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
				let text = flatten_message_text(&msg.content);
				if !text.is_empty() {
					if first_user_text.is_none() && msg.role == "user" {
						first_user_text = Some(text.clone());
					}
					fts_rows.push((msg.role.clone(), text));
				}
			}
		}

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
				"INSERT INTO sessions(id, discovered_id, title, created_at, updated_at, turn_count, file_mtime, file_size, cwd)
				 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
				 ON CONFLICT(id) DO UPDATE SET
				   title = excluded.title,
				   updated_at = excluded.updated_at,
				   turn_count = excluded.turn_count,
				   file_mtime = excluded.file_mtime,
				   file_size = excluded.file_size,
				   cwd = COALESCE(excluded.cwd, sessions.cwd)",
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
		Some(id) => stmt.query_map(params![id], map_linked)?.collect::<rusqlite::Result<Vec<_>>>()?,
		None => stmt.query_map([], map_linked)?.collect::<rusqlite::Result<Vec<_>>>()?,
	};
	Ok(rows)
}

fn discovered_id_for(conn: &Connection, key: &str) -> AppResult<Option<i64>> {
	Ok(conn
		.query_row(
			"SELECT id FROM discovered_projects WHERE key = ?1",
			params![key],
			|r| r.get::<_, i64>(0),
		)
		.optional()?)
}

fn parse_iso(s: &str) -> Option<i64> {
	chrono::DateTime::parse_from_rfc3339(s)
		.ok()
		.map(|dt| dt.timestamp_millis())
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
