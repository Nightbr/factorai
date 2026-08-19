use tauri::State;

use crate::error::AppResult;
use crate::services::ide::ui_state::UiSnapshot;
use crate::state::AppState;

/// Tell the backend what the renderer has on screen (F20).
///
/// Called on every change to the active session or the open file — both cheap,
/// both rare next to anything else crossing this boundary. It exists because
/// two of the IDE bridge's answers depend on the UI and Rust cannot see it:
/// `getOpenEditors` has to name real files, and an `openFile` for a session
/// that is not in front must mark its tab rather than take the window.
///
/// Fire-and-forget by design: a report that never arrives leaves the bridge
/// with a stale-but-honest picture — it will mark a tab that is actually in
/// front, which is a smaller failure than opening a viewer over the wrong
/// session.
#[tauri::command]
pub fn ide_report_ui(state: State<'_, AppState>, snapshot: UiSnapshot) -> AppResult<()> {
	state.ui.set(snapshot);
	Ok(())
}
