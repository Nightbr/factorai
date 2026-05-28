use std::path::PathBuf;

use rusqlite::params;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::{SessionEvent, SessionPage, SessionSummary};
use crate::services::jsonl::EventIter;
use crate::state::AppState;

#[tauri::command]
pub fn list_sessions(state: State<'_, AppState>, project_id: String) -> AppResult<Vec<SessionSummary>> {
	state.db.with(|conn| {
		let mut stmt = conn.prepare(
			"SELECT id, project_id, COALESCE(title, ''), created_at, updated_at, turn_count, cwd
			 FROM sessions
			 WHERE project_id = ?1
			 ORDER BY updated_at DESC",
		)?;
		let rows = stmt
			.query_map(params![project_id], |row| {
				Ok(SessionSummary {
					id: row.get(0)?,
					project_id: row.get(1)?,
					title: row.get(2)?,
					created_at: row.get(3)?,
					updated_at: row.get(4)?,
					turn_count: row.get(5)?,
					cwd: row.get(6)?,
				})
			})?
			.collect::<rusqlite::Result<Vec<_>>>()?;
		Ok(rows)
	})
}

#[tauri::command]
pub fn get_session(
	state: State<'_, AppState>,
	session_id: String,
	offset: Option<usize>,
	limit: Option<usize>,
) -> AppResult<SessionPage> {
	let offset = offset.unwrap_or(0);
	let limit = limit.unwrap_or(500);

	// Look up project + total turn_count from the cache.
	let (project_id, total) = state.db.with(|conn| {
		conn.query_row(
			"SELECT project_id, turn_count FROM sessions WHERE id = ?1",
			params![session_id],
			|row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize)),
		)
		.map_err(|_| AppError::NotFound(format!("session {session_id}")))
	})?;

	let path = jsonl_path_for(&state.claude_dir, &project_id, &session_id);
	let events: Vec<SessionEvent> = EventIter::open(&path)?
		.skip(offset)
		.take(limit)
		.collect();

	Ok(SessionPage { id: session_id, events, offset, limit, total })
}

fn jsonl_path_for(claude_dir: &std::path::Path, project_id: &str, session_id: &str) -> PathBuf {
	claude_dir.join("projects").join(project_id).join(format!("{session_id}.jsonl"))
}
