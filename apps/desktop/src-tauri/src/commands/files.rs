use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::error::AppResult;
use crate::models::{DirListing, FileContents, ImageContents, PathKind, PdfContents};
use crate::services::files;
use crate::state::AppState;

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

/// Read one PDF as base64 for the viewer (F7). Rejects anything that doesn't
/// start `%PDF-`, so the caller falls back to the binary card instead of handing
/// pdf.js bytes it will only fail to parse.
#[tauri::command]
pub fn read_pdf(path: String, max_bytes: Option<usize>) -> AppResult<PdfContents> {
	files::read_pdf(&path, max_bytes)
}

/// Classify a batch of paths for the terminal's link provider (F19): file,
/// directory, or missing, in the order asked.
///
/// One call per hovered terminal line rather than one per candidate, and it
/// never errors — see `services::files::path_kinds` for why "missing" is the
/// only failure this question has.
#[tauri::command]
pub fn path_kinds(paths: Vec<String>) -> Vec<PathKind> {
	files::path_kinds(&paths)
}

/// `file:changed` — the file the viewer has open is no longer what the renderer
/// read (F7).
///
/// Carries the path and nothing else. The contents come back through
/// `read_file` / `read_image` / `read_pdf` like any other read, so this event
/// cannot disagree with what a reopen would show, and a 40MB file does not
/// travel over the event channel to be thrown away when the viewer has moved on.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangedEvent {
	pub path: String,
}

/// Watch the file the viewer just opened, so an edit made while it is on screen
/// shows up without the reader having to close and reopen it (F7).
///
/// Replaces whatever was being watched — there is one viewer and one watch. The
/// renderer is the one that knows when a file stops being open, so it calls
/// `unwatch_file` on close; nothing here expires on its own.
#[tauri::command]
pub fn watch_file(app: AppHandle, state: State<'_, AppState>, path: String) -> AppResult<()> {
	let emit_path = path.clone();
	state.file_watch.watch(std::path::Path::new(&path), move || {
		// `AppHandle::emit`, not `Window::emit` — a window-scoped emit does not
		// reach the JS listeners (see the terminal manager for the same note).
		let _ = app.emit("file:changed", FileChangedEvent { path: emit_path.clone() });
	})
}

/// Release the watch on `path`, if that is the one running.
///
/// Named rather than bare so a late cleanup cannot kill a live watch: the
/// renderer's close and its next open are two calls, and only their order
/// distinguishes "stop watching the file I closed" from "stop watching the file
/// I just opened".
#[tauri::command]
pub fn unwatch_file(state: State<'_, AppState>, path: String) -> bool {
	state.file_watch.unwatch(std::path::Path::new(&path))
}
