use std::path::PathBuf;
use std::sync::Arc;

use crate::db::Db;
use crate::services::ide::ui_state::UiState;
use crate::services::indexer::Indexer;
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
}
