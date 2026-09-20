//! The Tauri command surface, one module per domain.
//!
//! **A synchronous command runs on the main thread**, which is also the thread
//! painting the window and pumping every event, so anything that spawns a
//! process, walks a directory tree, parses a transcript or waits on a socket
//! belongs on the blocking pool instead — [`off_main`]. ADR-0035 made every
//! libgit2 read `async` for that reason after a graph walk froze the whole
//! application for ten seconds; PERF-07 (`specs/10-performance.md`) did the
//! same for the rest of them.

use crate::error::{AppError, AppResult};

pub mod files;
pub mod git;
pub mod ide;
pub mod profiles;
pub mod projects;
pub mod routines;
pub mod sessions;
pub mod settings;
pub mod sidebar;
pub mod sops;
pub mod terminal;

/// Run one piece of blocking work off the main thread and wait for it.
///
/// `spawn_blocking` rather than a plain `async fn`: the work inside is
/// synchronous — libgit2, `std::fs`, SQLite, a child process — and an `async fn`
/// that blocks would hold a runtime worker exactly as badly as it held the main
/// thread.
///
/// A command that takes `State` cannot move it across the boundary, so the
/// shape at every call site is the same: clone what the work needs out of the
/// state first, then hand the closure the clones. `AppState`'s handles are all
/// cheap to clone for this reason.
///
/// A task that panics surfaces as `Process`, which the renderer already knows
/// how to toast; it never takes the window down with it.
pub async fn off_main<T, F>(work: F) -> AppResult<T>
where
	F: FnOnce() -> AppResult<T> + Send + 'static,
	T: Send + 'static,
{
	tauri::async_runtime::spawn_blocking(work)
		.await
		.map_err(|e| AppError::Process(format!("background task failed: {e}")))?
}
