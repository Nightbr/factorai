use std::path::PathBuf;

use rusqlite::params;
use tauri::State;

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::Project;
use crate::services::path_encoding::{display_name_for, encode_path};
use crate::state::AppState;

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> AppResult<Vec<Project>> {
	state.db.with(|conn| {
		let mut stmt = conn.prepare(
			"SELECT id, real_path, display_name, last_session_at, session_count, pinned
			 FROM projects
			 ORDER BY pinned DESC, COALESCE(last_session_at, 0) DESC, display_name ASC",
		)?;
		let rows = stmt
			.query_map([], |row| {
				Ok(Project {
					id: row.get(0)?,
					real_path: row.get(1)?,
					display_name: row.get(2)?,
					last_session_at: row.get(3)?,
					session_count: row.get(4)?,
					pinned: row.get::<_, i64>(5)? != 0,
				})
			})?
			.collect::<rusqlite::Result<Vec<_>>>()?;
		Ok(rows)
	})
}

/// Add a folder as a project, whether or not Claude has ever run in it (F1).
///
/// The id is the **same encoding Claude Code uses** for `~/.claude/projects/`,
/// which is the whole point: when a session is finally started here, the
/// indexer's upsert lands on this row instead of creating a second one for the
/// same folder. That also makes adding an already-known project a no-op that
/// returns what is already there, so the button can't produce duplicates.
///
/// `display_name` and `pinned` are deliberately left alone on conflict — the
/// former is the indexer's to derive, and clobbering the latter would silently
/// unpin a project by re-adding it.
#[tauri::command]
pub fn add_project(state: State<'_, AppState>, path: String) -> AppResult<Project> {
	add_project_in(&state.db, &path)
}

/// The body of [`add_project`], taking the database directly so the
/// reconciliation with the indexer can be tested without a Tauri app.
pub fn add_project_in(db: &Db, path: &str) -> AppResult<Project> {
	let raw = PathBuf::from(path);
	if !raw.is_absolute() {
		return Err(AppError::InvalidInput(format!("not an absolute path: {path}")));
	}
	// Canonicalize before encoding: `/home/me/../me/code` and a symlinked path
	// each encode to an id the indexer would never produce, so the row would
	// never be reconciled with the sessions that eventually appear.
	let dir = raw
		.canonicalize()
		.map_err(|e| AppError::Io(format!("{path}: {e}")))?;
	if !dir.is_dir() {
		return Err(AppError::InvalidInput(format!("not a directory: {path}")));
	}

	let id = encode_path(&dir);
	let real_path = dir.to_string_lossy().to_string();
	let display_name = display_name_for(&id, Some(&real_path));

	db.with_mut(|conn| {
		conn.execute(
			"INSERT INTO projects(id, real_path, display_name, session_count) VALUES(?1, ?2, ?3, 0)
			 ON CONFLICT(id) DO UPDATE SET real_path = excluded.real_path",
			params![id, real_path, display_name],
		)?;
		Ok(())
	})?;

	db.with(|conn| {
		let project = conn.query_row(
			"SELECT id, real_path, display_name, last_session_at, session_count, pinned
			 FROM projects WHERE id = ?1",
			params![id],
			|row| {
				Ok(Project {
					id: row.get(0)?,
					real_path: row.get(1)?,
					display_name: row.get(2)?,
					last_session_at: row.get(3)?,
					session_count: row.get(4)?,
					pinned: row.get::<_, i64>(5)? != 0,
				})
			},
		)?;
		Ok(project)
	})
}

#[tauri::command]
pub fn resolve_project_path(state: State<'_, AppState>, id: String) -> AppResult<Option<String>> {
	state.db.with(|conn| {
		let path: Option<String> = conn
			.query_row("SELECT real_path FROM projects WHERE id = ?1", params![id], |row| row.get(0))
			.ok()
			.flatten();
		Ok(path)
	})
}

#[tauri::command]
pub fn pin_project(state: State<'_, AppState>, id: String, pinned: bool) -> AppResult<()> {
	state.db.with(|conn| {
		conn.execute(
			"UPDATE projects SET pinned = ?2 WHERE id = ?1",
			params![id, pinned as i64],
		)?;
		Ok(())
	})
}
