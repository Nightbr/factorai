use crate::error::AppResult;
use crate::models::{FileContents, GitCommitDetail, GitGraph, GitRev, GitStatus};
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

/// One page of the commit graph, lanes already assigned (F18).
///
/// A project that isn't in a repository is a **success** carrying
/// `repoRoot: null` and no commits, exactly as `git_status` is — the Graph tab
/// renders "Not a git repository" from it.
///
/// `offset` pages through a full re-walk rather than resuming a cursor, so lanes
/// are deterministic across pages. See `03-backend-rust.md` § `git`.
#[tauri::command]
pub fn git_graph(project_path: String, offset: usize, limit: usize) -> AppResult<GitGraph> {
	git::graph(&project_path, offset, limit)
}

/// Everything the detail pane shows for one commit, including the files it
/// touched (F18).
///
/// `None` when the SHA doesn't resolve — a row clicked after the branch it was on
/// was force-pushed is stale, not an error worth a toast.
#[tauri::command]
pub fn git_commit(project_path: String, sha: String) -> AppResult<Option<GitCommitDetail>> {
	git::commit_detail(&project_path, &sha)
}

/// One file's contents at an arbitrary commit — the left side of a commit's diff.
///
/// Separate from `git_blob` rather than widening `GitRev` to carry a SHA, which
/// would churn every existing caller of a hand-mirrored type for one new consumer.
#[tauri::command]
pub fn git_blob_at(
	path: String,
	commit: String,
	max_bytes: Option<usize>,
) -> AppResult<Option<FileContents>> {
	git::blob_at(&path, &commit, max_bytes)
}
