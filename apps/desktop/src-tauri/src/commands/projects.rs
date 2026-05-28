use rusqlite::params;
use tauri::State;

use crate::error::AppResult;
use crate::models::Project;
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
