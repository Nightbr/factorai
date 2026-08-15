use crate::error::AppResult;
use crate::models::{DirListing, FileContents, ImageContents};
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

/// Read one file for the viewer. `max_bytes` defaults to
/// `services::files::DEFAULT_MAX_BYTES`; the UI passes `None` explicitly when
/// the user asks to see an oversized file anyway.
#[tauri::command]
pub fn read_file(path: String, max_bytes: Option<usize>) -> AppResult<FileContents> {
	files::read_file(&path, max_bytes)
}

/// Read one image as base64 for the viewer (F7). Rejects anything whose magic
/// bytes aren't a displayable format, so the caller falls back to the binary
/// card instead of rendering a broken image.
#[tauri::command]
pub fn read_image(path: String, max_bytes: Option<usize>) -> AppResult<ImageContents> {
	files::read_image(&path, max_bytes)
}
