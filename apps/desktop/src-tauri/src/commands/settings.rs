use tauri::State;

use crate::error::AppResult;
use crate::models::SettingKey;
use crate::services::claude_cli::{check_cli, ClaudeCliStatus};
use crate::services::settings;
use crate::state::AppState;

/// One setting's value, or `null` when it has never been set (F11).
#[tauri::command]
pub fn get_setting(state: State<'_, AppState>, key: SettingKey) -> AppResult<Option<String>> {
	state.db.with(|conn| settings::get(conn, key))
}

/// Write one setting. `null` deletes the row, which is how the Claude section
/// clears an override and goes back to auto-detection — an empty string would
/// be a *set* value that happens to be empty, and would break the probe.
#[tauri::command]
pub fn set_setting(
	state: State<'_, AppState>,
	key: SettingKey,
	value: Option<String>,
) -> AppResult<()> {
	state.db.with(|conn| settings::set(conn, key, value.as_deref()))
}

/// Where `claude` is and what version it reports — **honouring the override**.
///
/// Takes `AppState` for that reason alone: this command and the spawn path have
/// to agree, or the settings page reports "not installed" for a binary sessions
/// are starting from perfectly well.
#[tauri::command]
pub fn check_claude_cli(state: State<'_, AppState>) -> ClaudeCliStatus {
	check_cli(settings::claude_binary_override(&state.db).as_deref())
}

/// Probe one path *as if* it were the override, without saving it (F11).
///
/// The settings page's override field validates on blur through this: the point
/// of checking a path before you depend on it is not writing it. Deliberately
/// not a fallback probe — a typo must come back `installed: false` rather than
/// quietly reporting the binary the three tiers would have found anyway, which
/// would show a tick beside a path that does not work.
#[tauri::command]
pub fn validate_claude_binary(path: String) -> ClaudeCliStatus {
	check_cli(Some(std::path::Path::new(&path)))
}
