use tauri::State;

use crate::agents;
use crate::commands::off_main;
use crate::error::AppError;
use crate::error::AppResult;
use crate::models::SettingKey;
use crate::services::agent_cli::{self, ClaudeCliStatus};
use crate::services::{profiles, settings};
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

/// Where an agent's binary is and what version it reports — **honouring the
/// override** (F11, F30).
///
/// Takes `AppState` for that reason alone: this command and the spawn path have
/// to agree, or the settings page reports "not installed" for a binary sessions
/// are starting from perfectly well.
///
/// Off the main thread (PERF-07): the probe runs `<bin> --version` with a
/// two-second timeout, and may first ask a login shell for a `PATH`.
#[tauri::command]
pub async fn check_agent_cli(
	state: State<'_, AppState>,
	agent: String,
) -> AppResult<ClaudeCliStatus> {
	let desc = descriptor(&agent)?;
	let db = state.db.clone();
	off_main(move || {
		let status =
			agent_cli::check_agent_cli(desc, settings::binary_override(&db, desc.id).as_deref());
		// **A found agent gets its default profile** (F30 § "Storage"), seeded at
		// its ambient directory the first time the probe says it is here — so an
		// install without Codex has no Codex row to explain, and one with it has
		// something for the project menu and the picker to name.
		if status.installed && desc.id != agents::CLAUDE {
			let dir = agents::ambient_dir(desc);
			if let Err(e) = profiles::ensure_default_for(&db, desc.id, &dir) {
				tracing::warn!(error = %e, agent = desc.id, "could not seed the default profile");
			}
		}
		Ok(status)
	})
	.await
}

/// `check_agent_cli` for Claude — kept one release for the renderer that
/// predates F30.
#[tauri::command]
pub async fn check_claude_cli(state: State<'_, AppState>) -> AppResult<ClaudeCliStatus> {
	check_agent_cli(state, agents::CLAUDE.into()).await
}

fn descriptor(agent: &str) -> AppResult<&'static agents::AgentDescriptor> {
	agents::descriptor(agent)
		.ok_or_else(|| AppError::InvalidInput(format!("unknown agent {agent}")))
}

/// Probe one path *as if* it were the override, without saving it (F11).
///
/// The settings page's override field validates on blur through this: the point
/// of checking a path before you depend on it is not writing it. Deliberately
/// not a fallback probe — a typo must come back `installed: false` rather than
/// quietly reporting the binary the three tiers would have found anyway, which
/// would show a tick beside a path that does not work.
///
/// Off the main thread for the same reason as `check_claude_cli`: it is the
/// same probe, and it runs on every blur of the override field.
#[tauri::command]
pub async fn validate_agent_binary(agent: String, path: String) -> AppResult<ClaudeCliStatus> {
	let desc = descriptor(&agent)?;
	off_main(move || Ok(agent_cli::check_agent_cli(desc, Some(std::path::Path::new(&path))))).await
}

/// `validate_agent_binary` for Claude — kept one release for the renderer that
/// predates F30.
#[tauri::command]
pub async fn validate_claude_binary(path: String) -> AppResult<ClaudeCliStatus> {
	validate_agent_binary(agents::CLAUDE.into(), path).await
}
