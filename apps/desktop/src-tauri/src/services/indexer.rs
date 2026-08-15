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

pub type ProgressCb = Arc<dyn Fn(IndexerProgress) + Send + Sync>;
pub type ChangedCb = Arc<dyn Fn(SessionsChanged) + Send + Sync>;

/// Owns the scan + watcher. Cheap to clone (Arc internals). Emit is wired
/// via callbacks so tests can construct an Indexer without a Tauri runtime.
#[derive(Clone)]
pub struct Indexer {
	db: Db,
	claude_dir: PathBuf,
	on_progress: ProgressCb,
	on_changed: ChangedCb,
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
		// Stat here, once per scan, rather than per `list_projects` — that query
		// is polled every 2s and this answer changes about as often as someone
		// deletes a directory. A path we never learned is *not* missing: unknown
		// and gone are different states and only one of them is worth saying.
		let missing = real_path.as_deref().is_some_and(|p| !Path::new(p).exists());

		self.db.with_mut(|conn| {
			conn.execute(
				"INSERT INTO projects(id, real_path, display_name, session_count, missing)
				 VALUES(?1, ?2, ?3, 0, ?4)
				 ON CONFLICT(id) DO UPDATE SET
				   real_path = COALESCE(excluded.real_path, projects.real_path),
				   display_name = excluded.display_name,
				   missing = excluded.missing",
				params![encoded, real_path, display_name, missing as i64],
			)?;
			Ok(())
		})?;

		let mut changed_ids: Vec<String> = Vec::new();
		for session_path in &session_files {
			match self.index_session_if_changed(&encoded, session_path, None) {
				Ok(Some(session_id)) => changed_ids.push(session_id),
				Ok(None) => {}
				Err(e) => warn!(path = ?session_path, error = %e, "session index failed"),
			}
		}

		// Sub-agent transcripts: Claude Code writes each agent a session spawns
		// to <session-id>/subagents/agent-*.jsonl. Same JSONL shape, same
		// parsing — but marked `subagent_of` so the UI can nest them under
		// their parent and never try to resume one.
		for session_path in &session_files {
			if let Some(session_id) = session_path.file_stem().and_then(|s| s.to_str()) {
				for agent_path in subagent_files(session_path) {
					match self.index_session_if_changed(&encoded, &agent_path, Some(session_id)) {
						Ok(Some(agent_id)) => changed_ids.push(agent_id),
						Ok(None) => {}
						Err(e) => warn!(path = ?agent_path, error = %e, "sub-agent index failed"),
					}
				}
			}
		}

		// Refresh aggregates on `projects`. Sub-agents don't count: the count
		// answers "how many sessions does this project have", and an agent run
		// on a session's behalf is part of that session, not another one.
		self.db.with(|conn| {
			conn.execute(
				"UPDATE projects SET
				   session_count = (SELECT COUNT(*) FROM sessions WHERE project_id = ?1 AND subagent_of IS NULL),
				   last_session_at = (SELECT MAX(updated_at) FROM sessions WHERE project_id = ?1)
				 WHERE id = ?1",
				params![encoded],
			)?;
			Ok(())
		})?;

		if !changed_ids.is_empty() {
			(self.on_changed)(SessionsChanged {
				project_id: encoded.clone(),
				session_ids: changed_ids,
			});
		}

		Ok(())
	}

	/// Index one .jsonl. Returns the session id if it was reindexed (or
	/// newly indexed), `None` if the cached `(mtime, size)` already matched.
	/// `subagent_of` marks the file as a sub-agent transcript belonging to
	/// that parent session.
	pub fn index_session_if_changed(
		&self,
		project_id: &str,
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
				"INSERT INTO sessions(id, project_id, title, created_at, updated_at, turn_count, file_mtime, file_size, cwd, subagent_of)
				 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
				 ON CONFLICT(id) DO UPDATE SET
				   title = excluded.title,
				   updated_at = excluded.updated_at,
				   turn_count = excluded.turn_count,
				   file_mtime = excluded.file_mtime,
				   file_size = excluded.file_size,
				   cwd = COALESCE(excluded.cwd, sessions.cwd),
				   subagent_of = excluded.subagent_of",
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
					subagent_of,
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
		(self.on_progress)(IndexerProgress { processed, total, phase });
	}
}

/// Peek at the first event in a session file and return its `cwd`. Best
/// effort: any parse error → `None`.
fn first_cwd_from_session(path: &Path) -> Option<String> {
	EventIter::open(path).ok()?.find_map(|ev| ev.cwd)
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
		let p = Path::new("/home/a/.claude/projects/-code-foo/1111-2222/subagents/agent-3333.jsonl");
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
