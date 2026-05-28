pub mod commands;
pub mod db;
pub mod error;
pub mod models;
pub mod services;
pub mod state;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::Manager;
use tracing::info;

use crate::db::Db;
use crate::services::indexer::{spawn_initial_scan, Indexer};
use crate::services::watcher;
use crate::state::AppState;

/// Resolve the Claude config directory. Honours `CLAUDE_HOME`, falls back to
/// `$HOME/.claude`. See specs/07-open-questions.md Q3.
fn claude_dir() -> PathBuf {
	if let Some(env) = std::env::var_os("CLAUDE_HOME") {
		return PathBuf::from(env);
	}
	dirs::home_dir().expect("no home dir").join(".claude")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	tracing_subscriber::fmt()
		.with_env_filter(
			tracing_subscriber::EnvFilter::try_from_default_env()
				.unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,factorai_lib=debug")),
		)
		.init();

	tauri::Builder::default()
		.plugin(tauri_plugin_shell::init())
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_fs::init())
		.plugin(tauri_plugin_process::init())
		.plugin(tauri_plugin_store::Builder::default().build())
		.setup(|app| {
			let data_dir = app
				.path()
				.app_data_dir()
				.expect("failed to resolve app_data_dir");
			let db = Db::open(&data_dir).expect("failed to open db");

			let cd = claude_dir();
			info!(?cd, ?data_dir, "factorai booting");

			let indexer = Arc::new(Indexer::for_app(db.clone(), cd.clone(), app.handle().clone()));

			app.manage(AppState {
				db,
				indexer: indexer.clone(),
				claude_dir: cd,
				data_dir,
			});

			spawn_initial_scan(indexer.clone());
			watcher::spawn(indexer);

			#[cfg(debug_assertions)]
			if let Some(window) = app.get_webview_window("main") {
				window.open_devtools();
			}
			Ok(())
		})
		.invoke_handler(tauri::generate_handler![
			commands::projects::list_projects,
			commands::projects::resolve_project_path,
			commands::projects::pin_project,
			commands::sessions::list_sessions,
			commands::sessions::get_session,
		])
		.run(tauri::generate_context!())
		.expect("error while running factorai");
}
