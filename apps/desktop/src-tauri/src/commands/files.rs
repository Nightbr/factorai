use crate::error::AppResult;
use crate::models::DirListing;
use crate::services::files;

/// List one directory for the project file tree. `root` is the project root,
/// used only to decide whether a symlink points out of the project.
///
/// Read-only, like everything else we do on disk (ADR-0004). Capped at
/// `services::files::MAX_ENTRIES` entries per call.
#[tauri::command]
pub fn list_dir(path: String, root: Option<String>) -> AppResult<DirListing> {
	files::list_dir(&path, root.as_deref())
}
