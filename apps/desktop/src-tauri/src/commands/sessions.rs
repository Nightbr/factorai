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
			// Sub-agent rows sort directly under their parent: groups are
			// ordered by the *parent's* recency (a sub-agent is part of the
			// work its parent session was), the parent leads its group, and
			// siblings order among themselves by recency. An orphaned
			// sub-agent (parent transcript deleted) keeps its marking but
			// sorts as its own group — the LEFT JOIN leaves `p` NULL and
			// COALESCE falls back to its own updated_at.
			"SELECT s.id, d.project_id, COALESCE(s.title, ''), s.created_at, s.updated_at,
			        s.turn_count, s.cwd, s.subagent_of
			 FROM sessions s
			 JOIN discovered_projects d ON d.id = s.discovered_id
			 LEFT JOIN sessions p ON p.id = s.subagent_of
			 WHERE d.project_id = ?1
			 ORDER BY COALESCE(p.updated_at, s.updated_at) DESC,
			          (s.subagent_of IS NULL) DESC,
			          s.updated_at DESC",
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
					subagent_of: row.get(7)?,
				})
			})?
			.collect::<rusqlite::Result<Vec<_>>>()?;
		Ok(rows)
	})
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

	let (key, parent_id, total) = lookup_store_key_and_total(&state, &session_id)?;
	let offset = total.saturating_sub(limit);

	let path = transcript_path(&state.claude_dir, &key, parent_id.as_deref(), &session_id);
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

/// The agent store directory a session's transcript lives in, the parent
/// session if it is a sub-agent run, and its event count. The key is what was
/// recorded when the session was indexed, so it is exact — never a re-encode
/// of a path.
fn lookup_store_key_and_total(
	state: &State<'_, AppState>,
	session_id: &str,
) -> AppResult<(String, Option<String>, usize)> {
	state.db.with(|conn| {
		conn.query_row(
			"SELECT d.key, s.subagent_of, s.turn_count
			 FROM sessions s
			 JOIN discovered_projects d ON d.id = s.discovered_id
			 WHERE s.id = ?1",
			params![session_id],
			|row| {
				Ok((
					row.get::<_, String>(0)?,
					row.get::<_, Option<String>>(1)?,
					row.get::<_, i64>(2)? as usize,
				))
			},
		)
		.map_err(|_| AppError::NotFound(format!("session {session_id}")))
	})
}

/// Where a session's transcript lives, addressed by the store directory we
/// recorded for it. A sub-agent's is nested under its parent's id:
/// `<store dir>/<parent>/subagents/agent-*.jsonl`.
fn transcript_path(
	claude_dir: &std::path::Path,
	key: &str,
	subagent_of: Option<&str>,
	session_id: &str,
) -> std::path::PathBuf {
	match subagent_of {
		Some(parent) => claude::subagent_transcript_path(claude_dir, key, parent, session_id),
		None => claude::transcript_path_by_key(claude_dir, key, session_id),
	}
}
