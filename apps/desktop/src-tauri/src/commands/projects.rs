//! The workspace: the folders you added, and the acts of adding and removing
//! them. See specs/05-features.md F1 and ADR-0011.
//!
//! Nothing here writes `discovered_projects.agent`/`key`/`real_path` — those
//! belong to the scan. What these commands own is membership: which folders are
//! in the workspace, and the `project_id` link that follows from it.

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

use crate::agents::{self, claude};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::{ImportCandidate, Project};
use crate::state::AppState;

/// Columns and aggregates for one workspace row, shared by every query that
/// returns a [`Project`] so the shape can't drift between them.
const PROJECT_SELECT: &str = "SELECT p.id, p.real_path, p.display_name, p.pinned, p.missing,
	-- Sub-agents don't count: the number answers how many sessions the project
	-- has, and an agent run on a session's behalf is part of that session
	-- rather than another one. Last activity is not filtered the same way --
	-- an agent working is the project being worked on.
	(SELECT COUNT(*) FROM sessions s
	   JOIN discovered_projects d ON d.id = s.discovered_id
	  WHERE d.project_id = p.id AND s.subagent_of IS NULL),
	(SELECT MAX(s.updated_at) FROM sessions s
	   JOIN discovered_projects d ON d.id = s.discovered_id
	  WHERE d.project_id = p.id)
	FROM projects p";

fn map_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
	Ok(Project {
		id: row.get(0)?,
		real_path: row.get(1)?,
		display_name: row.get(2)?,
		pinned: row.get::<_, i64>(3)? != 0,
		missing: row.get::<_, i64>(4)? != 0,
		session_count: row.get(5)?,
		last_session_at: row.get(6)?,
	})
}

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> AppResult<Vec<Project>> {
	state.db.with(list_projects_in)
}

pub fn list_projects_in(conn: &Connection) -> AppResult<Vec<Project>> {
	let sql = format!("{PROJECT_SELECT} ORDER BY p.pinned DESC, 7 DESC, p.display_name ASC");
	let mut stmt = conn.prepare(&sql)?;
	let rows = stmt
		.query_map([], map_project)?
		.collect::<rusqlite::Result<Vec<_>>>()?;
	Ok(rows)
}

/// Add a folder to the workspace, whether or not any agent has ever run in it.
///
/// Idempotent by canonical path: adding a folder that is already open returns
/// the row that is already there, so neither the picker nor the import dialog
/// can produce duplicates. That guarantee used to come from the shared path
/// encoding; it is now the `real_path` UNIQUE constraint doing the same job
/// without borrowing another program's naming scheme.
///
/// `display_name` and `pinned` are left alone on conflict — re-adding a project
/// must not silently rename or unpin it.
#[tauri::command]
pub fn add_project(state: State<'_, AppState>, path: String) -> AppResult<Project> {
	let project = add_project_in(&state.db, &path)?;
	// Indexing is gated on the workspace, so a folder with history is unsearchable
	// until now. Scan it on a background thread: a store with thousands of turns
	// would otherwise block the command, and `indexer:progress` already exists to
	// say what's happening.
	let indexer = state.indexer.clone();
	let id = project.id.clone();
	std::thread::Builder::new()
		.name("index-added-project".into())
		.spawn(move || {
			if let Err(e) = indexer.scan_project(&id) {
				tracing::warn!(project = %id, error = %e, "indexing a newly added project failed");
			}
		})
		.expect("failed to spawn indexing thread");
	Ok(project)
}

/// The body of [`add_project`], taking the database directly so the workspace
/// rules can be tested without a Tauri app.
pub fn add_project_in(db: &Db, path: &str) -> AppResult<Project> {
	let raw = PathBuf::from(path);
	if !raw.is_absolute() {
		return Err(AppError::InvalidInput(format!("not an absolute path: {path}")));
	}
	// Canonicalize so `/home/me/../me/code`, a trailing slash and a symlink all
	// land on one row.
	//
	// A folder that is *gone* can't be canonicalized, and whether that's an
	// error depends on why you're asking. From the picker it is: you can only
	// have browsed to a folder that exists, so a path that doesn't is a typo or
	// a race, and F1 says so under the section header. From the import list it
	// is not: the folder was deleted but every transcript survives, the row is
	// dimmed rather than hidden, and opening it to read that history is the
	// whole point.
	//
	// One rule covers both without a flag the caller can get wrong: a missing
	// folder is admissible **only if an agent already has history for it**.
	// That is exactly the set the import list can offer, and it excludes a
	// mistyped path, which no store has ever heard of.
	let (dir, missing) = match raw.canonicalize() {
		Ok(d) => {
			if !d.is_dir() {
				return Err(AppError::InvalidInput(format!("not a directory: {path}")));
			}
			(d, false)
		}
		Err(_) => {
			if !db.with(|conn| any_history_for(conn, path))? {
				return Err(AppError::NotFound(format!("no such directory: {path}")));
			}
			(raw, true)
		}
	};

	let real_path = dir.to_string_lossy().to_string();
	let display_name = agents::display_name_for_path(&real_path);
	let id = uuid::Uuid::new_v4().to_string();
	let now = chrono::Utc::now().timestamp_millis();

	db.with_mut(|conn| {
		let tx = conn.transaction()?;
		tx.execute(
			"INSERT INTO projects(id, real_path, display_name, missing, opened_at)
			 VALUES(?1, ?2, ?3, ?4, ?5)
			 ON CONFLICT(real_path) DO UPDATE SET missing = excluded.missing",
			params![id, real_path, display_name, missing as i64, now],
		)?;
		reconcile(&tx)?;
		tx.commit()?;
		Ok(())
	})?;

	db.with(|conn| project_by_path(conn, &real_path))
}

/// Remove a folder from the workspace.
///
/// Nothing on disk is touched — ADR-0004 holds, the transcripts are still
/// Claude's. What goes is the membership row and, with it, this project's place
/// in the index: search is scoped to the workspace, so keeping the rows would
/// mean carrying an index no query can read. Adding the folder back re-parses
/// it, with progress, from the transcripts that never moved.
#[tauri::command]
pub fn remove_project(state: State<'_, AppState>, id: String) -> AppResult<()> {
	remove_project_in(&state.db, &id)
}

pub fn remove_project_in(db: &Db, id: &str) -> AppResult<()> {
	db.with_mut(|conn| {
		let tx = conn.transaction()?;
		// Order matters: `discovered_projects.project_id` is ON DELETE SET NULL,
		// so once the project row goes there is no way back to its sessions.
		tx.execute(
			"DELETE FROM messages_fts WHERE session_id IN (
			   SELECT s.id FROM sessions s
			     JOIN discovered_projects d ON d.id = s.discovered_id
			    WHERE d.project_id = ?1)",
			params![id],
		)?;
		tx.execute(
			"DELETE FROM sessions WHERE discovered_id IN (
			   SELECT id FROM discovered_projects WHERE project_id = ?1)",
			params![id],
		)?;
		tx.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
		tx.commit()?;
		Ok(())
	})
}

/// Folders an agent has worked in, for the import dialog (F1).
///
/// Read straight from the store rather than from the index, because the index
/// only covers the workspace — the whole point of the dialog is to show you
/// what *isn't* in it yet.
#[tauri::command]
pub fn list_import_candidates(state: State<'_, AppState>) -> AppResult<Vec<ImportCandidate>> {
	let claude_dir = state.claude_dir.clone();
	let open_paths: Vec<String> = state.db.with(|conn| {
		let mut stmt = conn.prepare("SELECT real_path FROM projects")?;
		let rows = stmt
			.query_map([], |r| r.get::<_, String>(0))?
			.collect::<rusqlite::Result<Vec<_>>>()?;
		Ok(rows)
	})?;

	let mut out: Vec<ImportCandidate> = claude::discover(&claude_dir)
		.into_iter()
		.filter_map(|d| {
			// A directory whose folder we could not identify has nothing to
			// import: the workspace is keyed by folder, and we don't know which
			// one this is. Listing it would offer an action that cannot work.
			let real_path = d.real_path?;
			let dir = claude_dir.join("projects").join(&d.key);
			let (session_count, last_activity_at) = claude::dir_stats(&dir);
			Some(ImportCandidate {
				agent: d.agent.to_string(),
				key: d.key,
				display_name: agents::display_name_for_path(&real_path),
				missing: !Path::new(&real_path).is_dir(),
				already_open: open_paths.iter().any(|p| p == &real_path),
				real_path,
				session_count,
				last_activity_at,
			})
		})
		.collect();

	// Newest first, which is what "is this the one I mean" usually turns on.
	// Folders with no activity at all sort last rather than first.
	out.sort_by(|a, b| {
		b.last_activity_at
			.cmp(&a.last_activity_at)
			.then_with(|| a.display_name.cmp(&b.display_name))
	});
	Ok(out)
}

#[tauri::command]
pub fn resolve_project_path(state: State<'_, AppState>, id: String) -> AppResult<Option<String>> {
	state.db.with(|conn| {
		Ok(conn
			.query_row("SELECT real_path FROM projects WHERE id = ?1", params![id], |row| {
				row.get::<_, String>(0)
			})
			.optional()?)
	})
}

#[tauri::command]
pub fn pin_project(state: State<'_, AppState>, id: String, pinned: bool) -> AppResult<()> {
	state.db.with(|conn| {
		conn.execute(
			"UPDATE projects SET pinned = ?2 WHERE id = ?1",
			params![id, pinned as i64],
		)?;
		Ok(())
	})
}

/// Link every discovered directory to the workspace folder it describes.
///
/// The join is on canonical path and nothing else: an agent's own naming scheme
/// is its business. Exact match only — a session recorded in `/repo/apps/web`
/// belongs to `/repo/apps/web`, not to `/repo`, even when only the latter is
/// open. Rolling up to the nearest open ancestor was considered and rejected:
/// it turns every session lookup into a prefix scan and needs a tie-break rule
/// the moment both a folder and its parent are open.
pub fn reconcile(conn: &Connection) -> AppResult<()> {
	conn.execute(
		"UPDATE discovered_projects
		    SET project_id = (SELECT p.id FROM projects p WHERE p.real_path = discovered_projects.real_path)
		  WHERE real_path IS NOT NULL",
		[],
	)?;
	// A directory whose folder we never identified can't belong to anything.
	conn.execute(
		"UPDATE discovered_projects SET project_id = NULL WHERE real_path IS NULL",
		[],
	)?;
	Ok(())
}

/// Does any agent's store hold transcripts for this exact folder? The test that
/// separates "the folder was deleted" from "that path never existed".
fn any_history_for(conn: &Connection, real_path: &str) -> AppResult<bool> {
	Ok(conn
		.query_row(
			"SELECT 1 FROM discovered_projects WHERE real_path = ?1",
			params![real_path],
			|_| Ok(true),
		)
		.optional()?
		.unwrap_or(false))
}

fn project_by_path(conn: &Connection, real_path: &str) -> AppResult<Project> {
	let sql = format!("{PROJECT_SELECT} WHERE p.real_path = ?1");
	conn.query_row(&sql, params![real_path], map_project)
		.map_err(|_| AppError::NotFound(format!("project at {real_path}")))
}

/// The folder a project points at, for the commands that need to touch disk.
pub fn project_path(conn: &Connection, id: &str) -> AppResult<PathBuf> {
	conn.query_row("SELECT real_path FROM projects WHERE id = ?1", params![id], |r| {
		r.get::<_, String>(0)
	})
	.map(PathBuf::from)
	.map_err(|_| AppError::NotFound(format!("project {id}")))
}
