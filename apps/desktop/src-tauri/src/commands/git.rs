use crate::error::{AppError, AppResult};
use crate::models::{FileContents, GitCommitDetail, GitGraph, GitRev, GitStatus, GitWorktree};
use crate::services::git;

/// Runs one libgit2 read on the blocking pool and waits for it.
///
/// **Every command in this module is `async` for this one reason** (ADR-0035): a
/// synchronous Tauri command runs on the main thread, and that thread is also
/// the one painting the window and pumping every other event. A status walk is
/// tens of milliseconds every three seconds; a graph walk of a large history is
/// seconds — and for that long nothing in the app moved, not even the terminal.
/// `spawn_blocking` rather than plain `async`, because libgit2 is synchronous C
/// and would otherwise block a runtime worker the same way.
///
/// A task that panics surfaces as `Process`, which the renderer already knows
/// how to toast; it never takes the window down with it.
async fn off_main<T, F>(work: F) -> AppResult<T>
where
	F: FnOnce() -> AppResult<T> + Send + 'static,
	T: Send + 'static,
{
	tauri::async_runtime::spawn_blocking(work)
		.await
		.map_err(|e| AppError::Process(format!("git task failed: {e}")))?
}

/// Repository state for the Changes tab and the tree's decorations (F13).
///
/// A project that isn't in a repository is a **success** carrying
/// `repoRoot: null` — the panel renders "Not a git repository" rather than
/// toasting an error at someone whose project simply isn't versioned.
///
/// Read-only, like everything else we do on disk (ADR-0004, ADR-0009).
#[tauri::command]
pub async fn git_status(project_path: String) -> AppResult<GitStatus> {
	off_main(move || git::status(&project_path)).await
}

/// One file's contents at `head` or `index`, for the left side of a diff.
///
/// `None` when the path doesn't exist at that revision: an added file has no
/// HEAD side, a deleted one has no worktree side. Both are ordinary rows in the
/// Changes list, so neither is an error.
#[tauri::command]
pub async fn git_blob(
	path: String,
	rev: GitRev,
	max_bytes: Option<usize>,
) -> AppResult<Option<FileContents>> {
	off_main(move || git::blob(&path, rev, max_bytes)).await
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
pub async fn git_graph(project_path: String, offset: usize, limit: usize) -> AppResult<GitGraph> {
	off_main(move || git::graph(&project_path, offset, limit)).await
}

/// Everything the detail pane shows for one commit, including the files it
/// touched (F18).
///
/// `None` when the SHA doesn't resolve — a row clicked after the branch it was on
/// was force-pushed is stale, not an error worth a toast.
#[tauri::command]
pub async fn git_commit(project_path: String, sha: String) -> AppResult<Option<GitCommitDetail>> {
	off_main(move || git::commit_detail(&project_path, &sha)).await
}

/// One file's contents at an arbitrary commit — the left side of a commit's diff.
///
/// Separate from `git_blob` rather than widening `GitRev` to carry a SHA, which
/// would churn every existing caller of a hand-mirrored type for one new consumer.
#[tauri::command]
pub async fn git_blob_at(
	path: String,
	commit: String,
	max_bytes: Option<usize>,
) -> AppResult<Option<FileContents>> {
	off_main(move || git::blob_at(&path, &commit, max_bytes)).await
}

/// Every checkout of the repository this project sits in — the main working tree
/// and every linked worktree (F21).
///
/// **Not filtered.** A locked, prunable or missing checkout is a row with those
/// flags set, because a checkout hidden from the list is one the human cannot
/// reason about when a session resolves to it. An empty vector means "not a
/// repository", the same success `git_status` reports as `repoRoot: None`.
#[tauri::command]
pub async fn git_worktrees(project_path: String) -> AppResult<Vec<GitWorktree>> {
	off_main(move || git::worktrees(&project_path)).await
}
