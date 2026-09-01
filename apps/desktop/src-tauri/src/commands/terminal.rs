use tauri::{AppHandle, Manager, State};

use crate::commands::projects::project_path;
use crate::error::AppResult;
use crate::services::terminal::{ShellSpawnOpts, SpawnOpts, TerminalStatusDto};
use crate::state::AppState;

/// The session id to open for a "new session" in this project.
///
/// factorai names its own sessions (ADR-0008) so the id exists before any
/// process does — the route, the xterm pool and the status store are all keyed
/// by it. Reuses a live, never-messaged session rather than starting a second
/// `claude` in the same project; see `TerminalManager::next_session_id`.
///
/// Takes the project's folder as well as its id, because "has this session been
/// messaged" is answered by probing the transcript, and a uuid says nothing
/// about where that is.
#[tauri::command]
pub fn start_session(state: State<'_, AppState>, project_id: String) -> AppResult<String> {
	let folder = state.db.with(|conn| project_path(conn, &project_id))?;
	Ok(state.terminals.next_session_id(&project_id, &folder))
}

/// Spawn the PTY for a session.
///
/// **Also where a routine's fire becomes a run** (F22, ADR-0030). This is the
/// one place in the app a PTY comes into existence, so it is the only honest
/// answer to *did the session start* — and ADR-0026 § 7 asks for the fire to be
/// recorded exactly then. `mark_started` finds no claim for every session a
/// human started, which is all of them but a routine's.
#[tauri::command]
pub fn terminal_spawn(state: State<'_, AppState>, opts: SpawnOpts) -> AppResult<String> {
	let session_id = opts.session_id.clone();
	let terminal_id = state.terminals.spawn(opts)?;
	state.routines.mark_started(&session_id, crate::epoch_ms());
	Ok(terminal_id)
}

/// Open a shell in the footer under a session (F23).
///
/// Separate from `terminal_spawn` rather than a flag on it, because the two
/// share only the PTY: this one runs no transcript probe, stands up no IDE
/// bridge and no agent tool server, and never marks a routine started. See
/// `TerminalManager::spawn_shell` and ADR-0031.
#[tauri::command]
pub fn shell_spawn(state: State<'_, AppState>, opts: ShellSpawnOpts) -> AppResult<String> {
	state.terminals.spawn_shell(opts)
}

/// Kill every shell in one session's footer.
///
/// The renderer calls this when it closes a session: a shell's whole lifetime
/// is the footer it is drawn in. Killing the agent is still the caller's own
/// `terminal_kill`, on the id it already holds.
#[tauri::command]
pub fn shell_kill_for_session(state: State<'_, AppState>, session_id: String) -> AppResult<()> {
	state.terminals.kill_shells_for_session(&session_id);
	Ok(())
}

#[tauri::command]
pub fn terminal_write(state: State<'_, AppState>, id: String, data: String) -> AppResult<()> {
	state.terminals.write(&id, data.as_bytes())
}

#[tauri::command]
pub fn terminal_resize(
	state: State<'_, AppState>,
	id: String,
	cols: u16,
	rows: u16,
) -> AppResult<()> {
	state.terminals.resize(&id, cols, rows)
}

#[tauri::command]
pub fn terminal_kill(state: State<'_, AppState>, id: String) -> AppResult<()> {
	state.terminals.kill(&id)
}

#[tauri::command]
pub fn terminal_list(state: State<'_, AppState>) -> Vec<TerminalStatusDto> {
	state.terminals.list()
}

/// User confirmed the quit dialog after the close-requested intercept.
/// Kill every live PTY and tell Tauri to exit. See ADR-0005.
#[tauri::command]
pub fn app_quit_confirmed(app: AppHandle) -> AppResult<()> {
	if let Some(state) = app.try_state::<AppState>() {
		state.terminals.kill_all();
	}
	app.exit(0);
	Ok(())
}
