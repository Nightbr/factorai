use rusqlite::params;
use tauri::State;

use crate::agents::claude;
use crate::error::{AppError, AppResult};
use crate::models::{SearchHit, SessionEvent, SessionPage, SessionSummary};
use crate::services::jsonl::EventIter;
use crate::services::search;
use crate::state::AppState;

/// Sessions in one workspace project — every agent directory linked to its
/// folder, newest first.
#[tauri::command]
pub fn list_sessions(state: State<'_, AppState>, project_id: String) -> AppResult<Vec<SessionSummary>> {
	state.db.with(|conn| {
		let mut stmt = conn.prepare(
			"SELECT s.id, d.project_id, COALESCE(s.title, ''), s.created_at, s.updated_at, s.turn_count, s.cwd
			 FROM sessions s
			 JOIN discovered_projects d ON d.id = s.discovered_id
			 WHERE d.project_id = ?1
			 ORDER BY s.updated_at DESC",
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
	let limit = limit.unwrap_or(100);

	let (key, total) = lookup_store_key_and_total(&state, &session_id)?;
	let path = claude::transcript_path_by_key(&state.claude_dir, &key, &session_id);
	let events: Vec<SessionEvent> = EventIter::open(&path)?.skip(offset).take(limit).collect();

	Ok(SessionPage { id: session_id, events, offset, limit, total })
}

/// Read the **last** `limit` events from a session. Default 100. The
/// returned page's `offset` is the position of the first returned event
/// in the full sequence — handy for the frontend's "show earlier" paging.
#[tauri::command]
pub fn get_session_tail(
	state: State<'_, AppState>,
	session_id: String,
	limit: Option<usize>,
) -> AppResult<SessionPage> {
	let limit = limit.unwrap_or(100);

	let (key, total) = lookup_store_key_and_total(&state, &session_id)?;
	let offset = total.saturating_sub(limit);

	let path = claude::transcript_path_by_key(&state.claude_dir, &key, &session_id);
	let events: Vec<SessionEvent> = EventIter::open(&path)?.skip(offset).take(limit).collect();

	Ok(SessionPage { id: session_id, events, offset, limit, total })
}

/// Full-text search across the workspace (spec F4). `project_id` optionally
/// restricts to one project. Returns up to `limit` (default 200, hard-capped at
/// 200) ranked hits.
///
/// Scoped to folders you have added, because indexing is: a project outside the
/// workspace was never parsed, so there is nothing of it to find. Reaching it
/// means adding the folder, which re-parses it with progress.
#[tauri::command]
pub fn search_sessions(
	state: State<'_, AppState>,
	query: String,
	project_id: Option<String>,
	limit: Option<usize>,
) -> AppResult<Vec<SearchHit>> {
	let limit = limit.unwrap_or(200);
	state
		.db
		.with(|conn| search::search(conn, &query, project_id.as_deref(), limit))
}

/// The agent store directory a session's transcript lives in, plus its event
/// count. The key is what was recorded when the session was indexed, so it is
/// exact — never a re-encode of a path.
fn lookup_store_key_and_total(
	state: &State<'_, AppState>,
	session_id: &str,
) -> AppResult<(String, usize)> {
	state.db.with(|conn| {
		conn.query_row(
			"SELECT d.key, s.turn_count
			 FROM sessions s
			 JOIN discovered_projects d ON d.id = s.discovered_id
			 WHERE s.id = ?1",
			params![session_id],
			|row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize)),
		)
		.map_err(|_| AppError::NotFound(format!("session {session_id}")))
	})
}
