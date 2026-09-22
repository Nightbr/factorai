//! What the window has to say about itself (F7, ADR-0059).

use tauri::State;

use crate::state::AppState;

/// The one sentence owed to a reader whose view was reloaded under them, or
/// `None` — which is the answer almost every boot gets.
///
/// **Asked on every boot, answered once per crash.** The renderer cannot be
/// told at the moment it happens, because at that moment it is the thing that
/// died: an event emitted into a dead web process reaches nobody, and one
/// emitted after the reload races the listener being registered. So the notice
/// waits here until something asks for it, which makes the renderer's side a
/// plain boot-time read with no timing in it at all.
///
/// Synchronous: it takes a lock, reads an `Option` and drops it. There is
/// nothing here to put on the blocking pool (PERF-07).
#[tauri::command]
pub fn webview_crash_notice(state: State<'_, AppState>) -> Option<String> {
	state.webview_health.take_notice()
}
