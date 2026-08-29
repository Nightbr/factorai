//! The routines command surface (F22, ADR-0026).
//!
//! Configuration only. Run state — `last_fire_at`, `last_run_at`,
//! `last_session_id` — is the runner's to write, and is deliberately not
//! reachable from here: a caller that could set it could rewrite whether
//! something ran.

use tauri::State;

use crate::error::AppResult;
use crate::models::{Routine, RoutineInput};
use crate::services::routines::{self, RunNowResult};
use crate::state::AppState;

/// A project's routines, oldest first.
#[tauri::command]
pub fn list_routines(state: State<'_, AppState>, project_id: String) -> AppResult<Vec<Routine>> {
	let now = crate::epoch_ms();
	state.db.with(|conn| routines::list(conn, &project_id, now))
}

/// Create a routine. Rejects a cron expression that cannot be parsed, so a
/// schedule that could never fire cannot be saved.
#[tauri::command]
pub fn create_routine(state: State<'_, AppState>, input: RoutineInput) -> AppResult<Routine> {
	let now = crate::epoch_ms();
	state.db.with(|conn| routines::create(conn, &input, now))
}

/// Rewrite a routine's configuration.
#[tauri::command]
pub fn update_routine(
	state: State<'_, AppState>,
	id: String,
	input: RoutineInput,
) -> AppResult<Routine> {
	let now = crate::epoch_ms();
	state.db.with(|conn| routines::update(conn, &id, &input, now))
}

/// Delete a routine. **Leaves a running session alone** (F22): the caller
/// confirms first, and killing an agent is never a side effect of editing a
/// schedule.
#[tauri::command]
pub fn delete_routine(state: State<'_, AppState>, id: String) -> AppResult<()> {
	state.db.with(|conn| routines::delete(conn, &id))
}

/// Stop, or resume, future fires. Never touches a live session.
#[tauri::command]
pub fn set_routine_enabled(state: State<'_, AppState>, id: String, enabled: bool) -> AppResult<()> {
	state.db.with(|conn| routines::set_enabled(conn, &id, enabled))
}

/// Fire now, through the runner's own path — including the overlap skip and the
/// concurrency cap, because a manual run that ignored those would be a second
/// set of rules for the same act.
///
/// **Always answers.** It returns what happened — `started` with the session id,
/// or `skipped` / `capped` / `failed` with the reason in the words the row will
/// show. A manual run that quietly did nothing was the first thing a user hit.
#[tauri::command]
pub fn run_routine_now(state: State<'_, AppState>, id: String) -> AppResult<RunNowResult> {
	let now = crate::epoch_ms();
	let routine = state.db.with(|conn| routines::get(conn, &id, now))?;
	Ok(state.routines.run_now(&routine, now))
}
