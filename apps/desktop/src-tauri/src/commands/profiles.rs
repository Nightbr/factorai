//! The profiles command surface (F25, ADR-0036).
//!
//! Thin over `services::profiles`, and every write goes through that module's
//! announcing layer — the same shape `commands::routines` uses, for the same
//! reason: the indexer has to hear about a new profile to scan it, and no
//! renderer can do that on its behalf.
//!
//! **There is no command that writes a credential or reads one.** Creating a
//! profile makes an empty directory; the CLI fills it and asks the user to log
//! in on first run.

use tauri::State;

use crate::error::AppResult;
use crate::models::{Profile, ProfileInput};
use crate::services::profiles;
use crate::state::AppState;

/// Every profile, default first.
#[tauri::command]
pub fn list_profiles(state: State<'_, AppState>) -> AppResult<Vec<Profile>> {
	state.db.with(profiles::list)
}

/// Create a profile, making its config directory if it is missing.
///
/// Two things happen after the row lands, and neither is something a renderer
/// could arrange for itself: the watcher takes on the new store's directory, and
/// a scan reads whatever is already in it. A profile pointed at an existing
/// `~/.claude-work` has history from the first moment, and waiting for a restart
/// to see it would look like the import silently failed.
#[tauri::command]
pub fn create_profile(
	state: State<'_, AppState>,
	app: tauri::AppHandle,
	input: ProfileInput,
) -> AppResult<Profile> {
	let profile = profiles::create_and_announce(&state.db, &app, &input, crate::epoch_ms())?;
	state.watch.rearm();
	crate::services::indexer::spawn_initial_scan(state.indexer.clone());
	Ok(profile)
}

#[tauri::command]
pub fn rename_profile(
	state: State<'_, AppState>,
	app: tauri::AppHandle,
	id: String,
	name: String,
) -> AppResult<Profile> {
	profiles::rename_and_announce(&state.db, &app, &id, &name)
}

/// Promote a profile to its agent's default, demoting the previous one.
#[tauri::command]
pub fn set_default_profile(
	state: State<'_, AppState>,
	app: tauri::AppHandle,
	id: String,
) -> AppResult<Profile> {
	profiles::set_default_and_announce(&state.db, &app, &id)
}

/// Delete a profile. Removes the row and nothing on disk, and refuses while
/// the profile is its agent's default.
///
/// The watcher is told so it lets go of a directory nothing indexes any more.
/// No scan: the profile's discoveries and their sessions went with the row, and
/// there is nothing left to read.
#[tauri::command]
pub fn delete_profile(
	state: State<'_, AppState>,
	app: tauri::AppHandle,
	id: String,
) -> AppResult<()> {
	profiles::delete_and_announce(&state.db, &app, &id)?;
	state.watch.rearm();
	Ok(())
}

/// Point a project at a profile, or clear the assignment with `null` so it
/// falls back to the agent's default.
///
/// **Applies to new sessions.** The config directory is read at spawn, so a
/// session already running keeps the identity it started under — and a session
/// that has already written a transcript keeps resuming under the profile that
/// holds it, whatever this says.
///
/// Announces on `projects` rather than `profiles:changed`: what changed is a
/// project's setting, and the sidebar is what draws it.
#[tauri::command]
pub fn set_project_profile(
	state: State<'_, AppState>,
	project_id: String,
	profile_id: Option<String>,
) -> AppResult<()> {
	state.db.with(|conn| profiles::assign(conn, &project_id, profile_id.as_deref()))
}

/// Where to put a profile called `name`, for the create form to pre-fill.
///
/// A command rather than a string built in the renderer, because the answer
/// starts at `$HOME` and the renderer has no honest way to know it — under
/// Tauri it would have to ask a plugin for the same thing.
#[tauri::command]
pub fn suggest_profile_dir(name: String) -> String {
	profiles::suggested_dir(&name).to_string_lossy().into_owned()
}
