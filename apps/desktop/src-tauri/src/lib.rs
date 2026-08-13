pub mod commands;
pub mod db;
pub mod error;
pub mod models;
pub mod services;
pub mod state;

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::json;
use tauri::{Emitter, Manager, WindowEvent};
use tracing::info;

use crate::db::Db;
use crate::services::indexer::{spawn_initial_scan, Indexer};
use crate::services::terminal::TerminalManager;
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
			let terminals = TerminalManager::for_app(app.handle().clone(), cd.clone());

			app.manage(AppState {
				db,
				indexer: indexer.clone(),
				terminals,
				claude_dir: cd,
				data_dir,
			});

			spawn_initial_scan(indexer.clone());
			watcher::spawn(indexer);

			// Devtools is opt-in via FACTORAI_DEVTOOLS=1 so screenshot-driven
			// QA captures aren't cluttered by the inspector pane.
			#[cfg(debug_assertions)]
			if std::env::var("FACTORAI_DEVTOOLS").as_deref() == Ok("1") {
				if let Some(window) = app.get_webview_window("main") {
					window.open_devtools();
				}
			}
			Ok(())
		})
		.on_window_event(|window, event| {
			if let WindowEvent::CloseRequested { api, .. } = event {
				if let Some(state) = window.try_state::<AppState>() {
					let live = state.terminals.live_count();
					if live > 0 {
						api.prevent_close();
						// Emit via the AppHandle, NOT `window.emit`: in Tauri v2 the
						// `Window` from `on_window_event` emits to window-level
						// listeners, but the frontend's `listen()` is registered on
						// the webview, so `window.emit` never reaches it. The app
						// handle broadcasts to the webview. Without this the quit
						// confirm dialog never appeared and the close button did
						// nothing while sessions were live.
						let _ = window
							.app_handle()
							.emit("app:quit-requested", json!({ "liveCount": live }));
					}
				}
			}
		})
		.invoke_handler(tauri::generate_handler![
			commands::projects::list_projects,
			commands::projects::resolve_project_path,
			commands::projects::pin_project,
			commands::sessions::list_sessions,
			commands::sessions::get_session,
			commands::sessions::get_session_tail,
			commands::sessions::search_sessions,
			commands::files::list_dir,
			commands::files::read_file,
			commands::terminal::check_claude_cli,
			commands::terminal::start_session,
			commands::terminal::terminal_spawn,
			commands::terminal::terminal_write,
			commands::terminal::terminal_resize,
			commands::terminal::terminal_kill,
			commands::terminal::terminal_list,
			commands::terminal::app_quit_confirmed,
		])
		.run(tauri::generate_context!())
		.expect("error while running factorai");
}
