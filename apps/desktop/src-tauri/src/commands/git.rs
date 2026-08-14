use crate::error::AppResult;
use crate::models::{FileContents, GitRev, GitStatus};
use crate::services::git;

/// Repository state for the Changes tab and the tree's decorations (F13).
///
/// A project that isn't in a repository is a **success** carrying
/// `repoRoot: null` — the panel renders "Not a git repository" rather than
/// toasting an error at someone whose project simply isn't versioned.
///
/// Read-only, like everything else we do on disk (ADR-0004, ADR-0009).
#[tauri::command]
pub fn git_status(project_path: String) -> AppResult<GitStatus> {
	git::status(&project_path)
}

/// One file's contents at `head` or `index`, for the left side of a diff.
///
/// `None` when the path doesn't exist at that revision: an added file has no
/// HEAD side, a deleted one has no worktree side. Both are ordinary rows in the
/// Changes list, so neither is an error.
#[tauri::command]
pub fn git_blob(
	path: String,
	rev: GitRev,
	max_bytes: Option<usize>,
) -> AppResult<Option<FileContents>> {
	git::blob(&path, rev, max_bytes)
}
