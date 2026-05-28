use std::path::{Path, PathBuf};
use std::sync::Arc;

use rusqlite::params;
use tauri::{AppHandle, Emitter};
use tracing::{debug, info, warn};

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::{IndexerPhase, IndexerProgress, SessionsChanged};
use crate::services::jsonl::{derive_title, flatten_message_text, EventIter};
use crate::services::path_encoding::display_name_for;

/// Owns the scan + (later) watcher. Cheap to clone (Arc internals).
#[derive(Clone)]
pub struct Indexer {
	db: Db,
	claude_dir: PathBuf,
	app: AppHandle,
}

impl Indexer {
	pub fn new(db: Db, claude_dir: PathBuf, app: AppHandle) -> Self {
		Self { db, claude_dir, app }
	}

	pub fn claude_dir(&self) -> &Path {
		&self.claude_dir
	}

	pub fn db(&self) -> &Db {
		&self.db
	}

	/// Scan every project / session under ~/.claude/projects/, upserting rows
	/// for anything new or changed. Emits `indexer:progress` along the way.
	pub fn full_scan(&self) -> AppResult<()> {
		let projects_dir = self.claude_dir.join("projects");
		if !projects_dir.exists() {
			info!(path = ?projects_dir, "claude projects dir does not exist; skipping scan");
			self.emit_progress(0, 0, IndexerPhase::Idle);
			return Ok(());
		}

		let project_dirs: Vec<PathBuf> = match std::fs::read_dir(&projects_dir) {
			Ok(rd) => rd
				.filter_map(Result::ok)
				.filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
				.map(|e| e.path())
				.collect(),
			Err(e) => {
				warn!(error = %e, "failed to read claude projects dir");
				return Err(AppError::Io(e.to_string()));
			}
		};

		info!(count = project_dirs.len(), "scanning projects");
		self.emit_progress(0, project_dirs.len() as u32, IndexerPhase::Scanning);

		let mut processed = 0u32;
		for project_path in &project_dirs {
			if let Err(e) = self.scan_project_dir(project_path) {
				warn!(?project_path, error = %e, "project scan failed");
			}
			processed += 1;
			self.emit_progress(processed, project_dirs.len() as u32, IndexerPhase::Parsing);
		}

		self.emit_progress(processed, project_dirs.len() as u32, IndexerPhase::Idle);
		info!("scan complete");
		Ok(())
	}

	/// Index one project directory. Public so the watcher can call it on
	/// targeted invalidation.
	pub fn scan_project_dir(&self, project_path: &Path) -> AppResult<()> {
		let encoded = match project_path.file_name().and_then(|s| s.to_str()) {
			Some(name) => name.to_string(),
			None => return Err(AppError::InvalidInput("project dir name not utf-8".into())),
		};

		let session_files: Vec<PathBuf> = match std::fs::read_dir(project_path) {
			Ok(rd) => rd
				.filter_map(Result::ok)
				.map(|e| e.path())
				.filter(|p| p.extension().is_some_and(|e| e == "jsonl"))
				.collect(),
			Err(_) => return Ok(()),
		};

		// Probe the first session for `cwd` to resolve the real path.
		let real_path = session_files
			.iter()
			.find_map(|p| first_cwd_from_session(p));

		let display_name = display_name_for(&encoded, real_path.as_deref());

		self.db.with_mut(|conn| {
			conn.execute(
				"INSERT INTO projects(id, real_path, display_name, session_count) VALUES(?1, ?2, ?3, 0)
				 ON CONFLICT(id) DO UPDATE SET
				   real_path = COALESCE(excluded.real_path, projects.real_path),
				   display_name = excluded.display_name",
				params![encoded, real_path, display_name],
			)?;
			Ok(())
		})?;

		let mut changed_ids: Vec<String> = Vec::new();
		for session_path in &session_files {
			match self.index_session_if_changed(&encoded, session_path) {
				Ok(Some(session_id)) => changed_ids.push(session_id),
				Ok(None) => {}
				Err(e) => warn!(path = ?session_path, error = %e, "session index failed"),
			}
		}

		// Refresh aggregates on `projects`.
		self.db.with(|conn| {
			conn.execute(
				"UPDATE projects SET
				   session_count = (SELECT COUNT(*) FROM sessions WHERE project_id = ?1),
				   last_session_at = (SELECT MAX(updated_at) FROM sessions WHERE project_id = ?1)
				 WHERE id = ?1",
				params![encoded],
			)?;
			Ok(())
		})?;

		if !changed_ids.is_empty() {
			let _ = self.app.emit(
				"sessions:changed",
				SessionsChanged { project_id: encoded.clone(), session_ids: changed_ids },
			);
		}

		Ok(())
	}

	/// Index one .jsonl. Returns the session id if it was reindexed (or
	/// newly indexed), `None` if the cached `(mtime, size)` already matched.
	pub fn index_session_if_changed(
		&self,
		project_id: &str,
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
		let mut title_from_event: Option<String> = None;

		for ev in EventIter::open(session_path)? {
			turn_count += 1;
			if let Some(ts) = parse_iso(&ev.timestamp) {
				first_ts.get_or_insert(ts);
				last_ts = Some(ts);
			}
			if cwd.is_none() {
				if let Some(c) = &ev.cwd {
					cwd = Some(c.clone());
				}
			}
			// Title hints
			if let Some(t) = ev.extra.get("title").and_then(|v| v.as_str()) {
				title_from_event = Some(t.to_string());
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
		let title = title_from_event
			.unwrap_or_else(|| derive_title(first_user_text.as_deref(), &session_id));

		self.db.with_mut(|conn| {
			let tx = conn.transaction()?;
			tx.execute(
				"INSERT INTO sessions(id, project_id, title, created_at, updated_at, turn_count, file_mtime, file_size, cwd)
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
					project_id,
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
					"INSERT INTO messages_fts(session_id, project_id, role, body) VALUES(?1, ?2, ?3, ?4)",
				)?;
				for (role, body) in &fts_rows {
					stmt.execute(params![session_id, project_id, role, body])?;
				}
			}
			tx.commit()?;
			Ok(())
		})?;

		Ok(Some(session_id))
	}

	fn emit_progress(&self, processed: u32, total: u32, phase: IndexerPhase) {
		let _ = self.app.emit(
			"indexer:progress",
			IndexerProgress { processed, total, phase },
		);
	}
}

/// Peek at the first event in a session file and return its `cwd`. Best
/// effort: any parse error → `None`.
fn first_cwd_from_session(path: &Path) -> Option<String> {
	EventIter::open(path).ok()?.find_map(|ev| ev.cwd)
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
