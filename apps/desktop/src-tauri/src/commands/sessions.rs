use std::path::PathBuf;

use rusqlite::params;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::{SearchHit, SessionEvent, SessionPage, SessionSummary};
use crate::services::jsonl::EventIter;
use crate::services::search;
use crate::state::AppState;

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
			"SELECT s.id, s.project_id, COALESCE(s.title, ''), s.created_at, s.updated_at,
			        s.turn_count, s.cwd, s.subagent_of
			 FROM sessions s
			 LEFT JOIN sessions p ON p.id = s.subagent_of
			 WHERE s.project_id = ?1
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

#[tauri::command]
pub fn get_session(
	state: State<'_, AppState>,
	session_id: String,
	offset: Option<usize>,
	limit: Option<usize>,
) -> AppResult<SessionPage> {
	let offset = offset.unwrap_or(0);
	let limit = limit.unwrap_or(100);

	let (project_id, parent_id, total) = lookup_project_and_total(&state, &session_id)?;

	let path = jsonl_path_for(&state.claude_dir, &project_id, parent_id.as_deref(), &session_id);
	let events: Vec<SessionEvent> = EventIter::open(&path)?
		.skip(offset)
		.take(limit)
		.collect();

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

	let (project_id, parent_id, total) = lookup_project_and_total(&state, &session_id)?;
	let offset = total.saturating_sub(limit);

	let path = jsonl_path_for(&state.claude_dir, &project_id, parent_id.as_deref(), &session_id);
	let events: Vec<SessionEvent> = EventIter::open(&path)?
		.skip(offset)
		.take(limit)
		.collect();

	Ok(SessionPage { id: session_id, events, offset, limit, total })
}

/// Full-text search across all indexed sessions (spec F4). `project_id`
/// optionally restricts to one project. Returns up to `limit` (default 200,
/// hard-capped at 200) ranked hits.
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

fn lookup_project_and_total(
	state: &State<'_, AppState>,
	session_id: &str,
) -> AppResult<(String, Option<String>, usize)> {
	state.db.with(|conn| {
		conn.query_row(
			"SELECT project_id, subagent_of, turn_count FROM sessions WHERE id = ?1",
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

/// Where a session's transcript lives. A sub-agent's is nested under its
/// parent's id: `<project>/<parent>/subagents/agent-*.jsonl`.
fn jsonl_path_for(
	claude_dir: &std::path::Path,
	project_id: &str,
	subagent_of: Option<&str>,
	session_id: &str,
) -> PathBuf {
	let project = claude_dir.join("projects").join(project_id);
	match subagent_of {
		Some(parent) => project.join(parent).join("subagents").join(format!("{session_id}.jsonl")),
		None => project.join(format!("{session_id}.jsonl")),
	}
}
