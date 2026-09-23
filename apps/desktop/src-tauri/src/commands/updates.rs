//! The update check, run here rather than through the plugin's JS `check()`
//! because that one cannot be given an endpoint, and the channel is exactly a
//! choice of endpoint (F14, ADR-0064).
//!
//! Only the *check* moved. The `Update` it finds goes into the webview's
//! resource table under the plugin's own type, and the renderer wraps the id in
//! the plugin's JS `Update` — so download, signature verification and install
//! are still the plugin's commands, unchanged.

use serde::Serialize;
use tauri::{Manager, ResourceId, State, Url, Webview};
use tauri_plugin_updater::UpdaterExt;

use crate::error::{AppError, AppResult};
use crate::services::updates;
use crate::state::AppState;

/// What the plugin's JS `Update` constructor takes, field for field. Mirrors
/// `@factorai/types` `UpdateMetadata`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
	rid: ResourceId,
	current_version: String,
	version: String,
	// Absent rather than `null`: the JS constructor's fields are optional
	// strings, and `null` is not one.
	#[serde(skip_serializing_if = "Option::is_none")]
	date: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	body: Option<String>,
	raw_json: serde_json::Value,
}

/// Mirrors `@factorai/types` `UpdateCheck`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
	/// The channel that was asked — what About and the crash report name.
	channel: &'static str,
	/// `None` when that channel has nothing newer than this build. Leaving alpha
	/// for stable lands here until stable overtakes the alpha that is running:
	/// the comparator is the plugin's default `update > current`, never a
	/// downgrade (ADR-0064 consequence 1).
	update: Option<UpdateMetadata>,
}

/// Look for an update on the channel the setting names.
#[tauri::command]
pub async fn check_update(webview: Webview, state: State<'_, AppState>) -> AppResult<UpdateCheck> {
	let channel = updates::channel(&state.db);
	let endpoint = Url::parse(channel.endpoint())
		.map_err(|e| AppError::InvalidInput(format!("update endpoint: {e}")))?;
	let updater = webview
		.updater_builder()
		.endpoints(vec![endpoint])
		.and_then(|builder| builder.build())
		.map_err(|e| AppError::Process(format!("updater: {e}")))?;
	let found =
		updater.check().await.map_err(|e| AppError::Process(format!("update check: {e}")))?;

	let update = found.map(|update| {
		// The manifest's own string rather than re-formatting the parsed date:
		// nothing on screen shows it, and it saves a dependency on `time`.
		let date = update.raw_json.get("pub_date").and_then(|v| v.as_str()).map(str::to_owned);
		UpdateMetadata {
			current_version: update.current_version.clone(),
			version: update.version.clone(),
			date,
			body: update.body.clone(),
			raw_json: update.raw_json.clone(),
			rid: webview.resources_table().add(update),
		}
	});

	Ok(UpdateCheck { channel: channel.as_str(), update })
}
