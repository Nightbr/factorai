use tauri::{AppHandle, Manager, State};

use crate::error::AppResult;
use crate::services::claude_cli::{check_cli, ClaudeCliStatus};
use crate::services::terminal::{SpawnOpts, TerminalStatusDto};
use crate::state::AppState;

#[tauri::command]
pub fn check_claude_cli() -> ClaudeCliStatus {
	check_cli()
}

/// The session id to open for a "new session" in this project.
///
/// factorai names its own sessions (ADR-0008) so the id exists before any
/// process does — the route, the xterm pool and the status store are all keyed
/// by it. Reuses a live, never-messaged session rather than starting a second
/// `claude` in the same project; see `TerminalManager::next_session_id`.
#[tauri::command]
pub fn start_session(state: State<'_, AppState>, project_id: String) -> String {
	state.terminals.next_session_id(&project_id)
}

#[tauri::command]
pub fn terminal_spawn(state: State<'_, AppState>, opts: SpawnOpts) -> AppResult<String> {
	state.terminals.spawn(opts)
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
