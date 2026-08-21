pub mod agents;
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
		// Copying an image needs a route the webview can't provide: WebKitGTK
		// implements `navigator.clipboard.writeText` but not `ClipboardItem`, so
		// the viewer's copy button hands RGBA to this instead (F7).
		.plugin(tauri_plugin_clipboard_manager::init())
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_fs::init())
		.plugin(tauri_plugin_process::init())
		.plugin(tauri_plugin_updater::Builder::new().build())
		.setup(|app| {
			let data_dir = app.path().app_data_dir().expect("failed to resolve app_data_dir");
			let db = Db::open(&data_dir).expect("failed to open db");

			let cd = claude_dir();
			info!(?cd, ?data_dir, "factorai booting");

			// Ask the user's login shell what their PATH is, on its own thread.
			// A GUI process has never run an rc file, so ours has no Homebrew and
			// no version-manager shims in it, and a session handed that PATH
			// cannot run a hook, an stdio MCP server or a statusline command. Off
			// the main thread because the answer costs a shell startup and the
			// window must not wait on `~/.zshrc`. See `services::shell_path`.
			services::shell_path::warm();

			// Anything we left behind last time. A SIGKILL leaves an IDE lockfile
			// pointing at a port nothing is listening on, which is ADR-0005's
			// orphan problem on a surface where it is inert rather than dangerous
			// — the CLI probes before it trusts one. It still matters: the CLI
			// auto-connects only when exactly one candidate matches, and our own
			// litter is the easiest way to stop being that one. Only our entries,
			// and only those whose process is gone (ADR-0017).
			let swept = services::ide::lockfile::sweep(&cd, services::ide::lockfile::pid_is_alive);
			if swept > 0 {
				info!(swept, "removed stale ide lockfiles from a previous run");
			}

			// What the renderer has on screen, for the IDE bridge's answers. Held
			// by the manager (each session's bridge reads it) and by AppState (the
			// command that writes it), so it is one shared cell rather than two
			// that can disagree.
			let ui = Arc::new(services::ide::ui_state::UiState::default());

			// Terminals first: the indexer's reap pass asks them what is live
			// before it deletes the row of a session whose transcript is gone.
			// The binary override is read per spawn, out of the `settings` table
			// (F11) — so editing it changes the next session without touching the
			// ones already running, and `claude_cli` keeps no database of its own.
			let settings_db = db.clone();
			// The recorded cwd is read per spawn for the same reason and out of the
			// same database: a session's transcript lives under the folder Claude
			// ran in, and spawning it anywhere else turns a resume into a new
			// conversation. See `TerminalManager::resume_cwd`.
			let session_db = db.clone();
			let terminals = TerminalManager::for_app(app.handle().clone(), cd.clone(), ui.clone())
				.with_user_binary(Arc::new(move || {
					services::settings::claude_binary_override(&settings_db)
				}))
				.with_session_cwd(Arc::new(move |session_id| {
					services::sessions::recorded_cwd(&session_db, session_id)
				}));
			let live = terminals.clone();
			let indexer = Arc::new(
				Indexer::for_app(db.clone(), cd.clone(), app.handle().clone())
					.with_live_ids(Arc::new(move || live.live_session_ids())),
			);

			app.manage(AppState {
				db,
				indexer: indexer.clone(),
				terminals,
				claude_dir: cd,
				data_dir,
				ui,
			});

			spawn_initial_scan(indexer.clone());
			watcher::spawn(indexer);

			// A dev build says so in its title, because that is the only part of
			// it the window switcher, the dock and `wmctrl -l` can see — and the
			// release factorai runs beside it all day with live Claude sessions
			// in it. The header shows the same marker (components/layout/
			// DevBadge.tsx) for when the window itself is in front of you.
			#[cfg(debug_assertions)]
			if let Some(window) = app.get_webview_window("main") {
				let _ = window.set_title("factorai DEV");
			}

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
			commands::projects::add_project,
			commands::projects::remove_project,
			commands::projects::list_import_candidates,
			commands::projects::resolve_project_path,
			commands::projects::pin_project,
			commands::sessions::list_sessions,
			commands::sessions::get_session_tail,
			commands::sessions::search_sessions,
			commands::files::list_dir,
			commands::files::read_file,
			commands::files::read_image,
			commands::files::read_pdf,
			commands::files::path_kinds,
			commands::ide::ide_report_ui,
			commands::ide::ide_resync,
			commands::ide::ide_mention,
			commands::git::git_status,
			commands::git::git_blob,
			commands::git::git_graph,
			commands::git::git_commit,
			commands::git::git_blob_at,
			commands::settings::get_setting,
			commands::settings::set_setting,
			commands::settings::check_claude_cli,
			commands::settings::validate_claude_binary,
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
