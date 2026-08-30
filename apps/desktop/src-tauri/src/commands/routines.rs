//! The routines command surface (F22, ADR-0026).
//!
//! Configuration only. Run state — `last_fire_at`, `last_run_at`,
//! `last_session_id` — is the runner's to write, and is deliberately not
//! reachable from here: a caller that could set it could rewrite whether
//! something ran.
//!
//! **Every write goes through `services::routines`'s announcing layer**, which
//! is the same one the IDE bridge's tools use (ADR-0028). The renderer still
//! invalidates its own query after its own mutation; what the shared path buys
//! is that a write from the *other* caller reaches an open list at all.
//!
//! `author` is `None` from here by definition — this is the human at the
//! editor. A bridge write passes its session id instead, and that difference is
//! the whole of a routine's provenance.

use tauri::State;

use crate::error::AppResult;
use crate::models::{Routine, RoutineInput};
use crate::services::routines::{self, RoutinePatch, RunNowResult};
use crate::state::AppState;

/// A project's routines, oldest first.
#[tauri::command]
pub fn list_routines(state: State<'_, AppState>, project_id: String) -> AppResult<Vec<Routine>> {
	let now = crate::epoch_ms();
	state.db.with(|conn| routines::list(conn, &project_id, now))
}

/// Create a routine. Rejects a cron expression that cannot be parsed or can
/// never fire again, so a schedule that would silently do nothing cannot be
/// saved — and refuses past the per-project cap.
#[tauri::command]
pub fn create_routine(
	state: State<'_, AppState>,
	app: tauri::AppHandle,
	input: RoutineInput,
) -> AppResult<Routine> {
	let now = crate::epoch_ms();
	routines::create_and_announce(&state.db, &app, &input, None, now)
}

/// Rewrite a routine's configuration.
///
/// **Full replacement**, and the editor is why: it is a form holding every
/// field, so sending all of them is the honest write. It reaches the shared
/// patch path as a patch with nothing left out.
#[tauri::command]
pub fn update_routine(
	state: State<'_, AppState>,
	app: tauri::AppHandle,
	id: String,
	input: RoutineInput,
) -> AppResult<Routine> {
	let now = crate::epoch_ms();
	routines::update_and_announce(&state.db, &app, &id, &RoutinePatch::whole(&input), None, now)
}

/// Delete a routine. **Leaves a running session alone** (F22): the caller
/// confirms first, and killing an agent is never a side effect of editing a
/// schedule.
#[tauri::command]
pub fn delete_routine(
	state: State<'_, AppState>,
	app: tauri::AppHandle,
	id: String,
) -> AppResult<()> {
	let now = crate::epoch_ms();
	routines::delete_and_announce(&state.db, &app, &id, now)
}

/// Stop, or resume, future fires. Never touches a live session.
#[tauri::command]
pub fn set_routine_enabled(
	state: State<'_, AppState>,
	app: tauri::AppHandle,
	id: String,
	enabled: bool,
) -> AppResult<()> {
	let now = crate::epoch_ms();
	routines::update_and_announce(
		&state.db,
		&app,
		&id,
		&RoutinePatch::just_enabled(enabled),
		None,
		now,
	)?;
	Ok(())
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
