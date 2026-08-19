use tauri::State;
use tracing::debug;

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

/// Ask every bridge to re-announce whether Claude is on it (F20).
///
/// Called once at boot, beside `terminal_list` and for the same reason: a
/// renderer reload keeps every PTY and every bridge alive while throwing the
/// renderer's own state away, so without this the header would report Claude
/// gone from a session it is very much still driving.
///
/// Returns nothing on purpose — the answers come back as `ide:status` events,
/// through the same listener that handles live ones, so a change racing this
/// call lands in order behind it instead of having to be merged with it.
#[tauri::command]
pub fn ide_resync(state: State<'_, AppState>) -> AppResult<()> {
	// Logged because "did the renderer ask?" is the first question when the
	// header disagrees with reality, and a reload is invisible from this side
	// otherwise.
	debug!("renderer asked the ide bridges to re-announce");
	state.terminals.resync_ide_status();
	Ok(())
}
