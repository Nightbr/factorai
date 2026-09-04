use std::path::PathBuf;
use std::sync::Arc;

use crate::db::Db;
use crate::services::file_watch::FileWatch;
use crate::services::ide::ui_state::UiState;
use crate::services::indexer::Indexer;
use crate::services::routines::Runner as RoutineRunner;
use crate::services::terminal::TerminalManager;

/// Application state shared across Tauri commands. Constructed in
/// `setup()`.
pub struct AppState {
	pub db: Db,
	pub indexer: Arc<Indexer>,
	pub terminals: TerminalManager,
	pub claude_dir: PathBuf,
	pub data_dir: PathBuf,
	/// What the renderer has on screen, reported by it so each session's IDE
	/// bridge can answer honestly instead of guessing (F20).
	pub ui: Arc<UiState>,
	/// The routine scheduler (F22). Held so `run_routine_now` fires through the
	/// same path the tick does, rather than growing a second one.
	pub routines: Arc<RoutineRunner>,
	/// The filesystem watcher's roots, one per profile (F25). Held so a profile
	/// write can ask for a reconcile — a new profile's transcripts are noticed by
	/// something watching its directory, and nothing else can arrange that.
	pub watch: Arc<crate::services::watcher::Control>,
	/// The watch on whatever file the viewer has open (F7). One at a time, and
	/// the renderer owns its lifetime — it watches on open and releases on
	/// close, so an app with no viewer open holds no watch at all.
	pub file_watch: Arc<FileWatch>,
}
