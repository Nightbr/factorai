//! The workspace: the folders you added, and the acts of adding and removing
//! them. See specs/05-features.md F1 and ADR-0011.
//!
//! Nothing here writes `discovered_projects.agent`/`key`/`real_path` — those
//! belong to the scan. What these commands own is membership: which folders are
//! in the workspace, the `project_id` link that follows from it, and the order
//! the user dragged them into.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

use crate::agents::{self, claude};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::{ImportCandidate, Project};
use crate::services::git;
use crate::state::AppState;

/// Columns and aggregates for one workspace row, shared by every query that
/// returns a [`Project`] so the shape can't drift between them.
const PROJECT_SELECT: &str = "SELECT p.id, p.real_path, p.display_name, p.sort_order, p.missing,
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
		sort_order: row.get(3)?,
		missing: row.get::<_, i64>(4)? != 0,
		session_count: row.get(5)?,
		last_session_at: row.get(6)?,
	})
}

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> AppResult<Vec<Project>> {
	state.db.with(list_projects_in)
}

/// Every project, in the order the user put them in.
///
/// The renderer sorts too — it owns the `Name` and `Recent` views, and its
/// `Manual` view reads `sort_order` rather than trusting this array — so the
/// ORDER BY here is not load-bearing for the sidebar. It stays because it costs
/// nothing, because it makes this command's output meaningful to any other
/// caller, and because it turns a drift between the two rules into a visible bug
/// rather than a silent one.
///
/// **The `display_name` tiebreak is doing real work.** Ordinals go sparse:
/// `remove_project` leaves a hole and `add_project` writes `MIN(sort_order) - 1`
/// rather than renumbering the table, so two rows can briefly share a value.
/// Without the tiebreak the list order between them would be whatever SQLite
/// felt like, which is a sidebar that reshuffles on a poll.
pub fn list_projects_in(conn: &Connection) -> AppResult<Vec<Project>> {
	let sql = format!("{PROJECT_SELECT} ORDER BY p.sort_order, p.display_name ASC");
	let mut stmt = conn.prepare(&sql)?;
	let rows = stmt.query_map([], map_project)?.collect::<rusqlite::Result<Vec<_>>>()?;
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
/// `display_name` and `sort_order` are left alone on conflict — re-adding a
/// project must not silently rename it or move it in the sidebar.
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
		// **A new project lands at the top.** `add_project` already navigates you
		// to the project you just added (F1), and sending you to a row below the
		// fold is the wrong end of the list.
		//
		// `MIN(sort_order) - 1` rather than renumbering the table: one scalar read
		// instead of an UPDATE over every row, and negative ordinals are fine —
		// `reorder_projects` rewrites the whole list densely the next time anything
		// is dragged. On an empty workspace this is -1, which is as good a first
		// ordinal as 0.
		tx.execute(
			"INSERT INTO projects(id, real_path, display_name, missing, opened_at, sort_order)
			 VALUES(?1, ?2, ?3, ?4, ?5,
			        (SELECT COALESCE(MIN(sort_order), 0) - 1 FROM projects))
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
		let rows =
			stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
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

/// Write the whole project order at once (F1, roadmap item 28).
///
/// **One command for the whole list, not a per-row "move up".** A move-up
/// command looks cheaper and isn't: it leaves gaps, it races the sidebar's 2s
/// refetch, and it has no way to notice that the list it is moving a row within
/// is not the list the user was looking at.
///
/// **Strict on a stale set.** If `ids` is not exactly the set of project ids in
/// the table, nothing is written and this is an error. The renderer's `onError`
/// invalidates the query and the list snaps back to what is true. A project
/// added or removed between the render and the drop is the case this exists for:
/// applying a partial order to a list the user never saw is worse than doing
/// nothing and saying so.
#[tauri::command]
pub fn reorder_projects(state: State<'_, AppState>, ids: Vec<String>) -> AppResult<()> {
	reorder_projects_in(&state.db, &ids)
}

/// The body of [`reorder_projects`], taking the database directly so the rule
/// can be tested without a Tauri app.
pub fn reorder_projects_in(db: &Db, ids: &[String]) -> AppResult<()> {
	db.with_mut(|conn| {
		let tx = conn.transaction()?;

		let mut stmt = tx.prepare("SELECT id FROM projects")?;
		let existing: HashSet<String> =
			stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<_>>()?;
		drop(stmt);

		// Set equality, both directions, and a length check for the duplicate
		// case — `["a", "a"]` against a one-row table has the right set and the
		// wrong list, and it would write the same ordinal twice.
		let incoming: HashSet<&String> = ids.iter().collect();
		if incoming.len() != ids.len() || existing.len() != ids.len() {
			return Err(AppError::InvalidInput(format!(
				"reorder_projects: got {} ids for {} projects",
				ids.len(),
				existing.len()
			)));
		}
		if let Some(unknown) = ids.iter().find(|id| !existing.contains(*id)) {
			return Err(AppError::InvalidInput(format!(
				"reorder_projects: no such project {unknown}"
			)));
		}

		// Dense from zero, so the ordinals stay small and readable and any gap
		// left by a removal is repaired by the next drag.
		let mut stmt = tx.prepare("UPDATE projects SET sort_order = ?2 WHERE id = ?1")?;
		for (index, id) in ids.iter().enumerate() {
			stmt.execute(params![id, index as i64])?;
		}
		drop(stmt);

		tx.commit()?;
		Ok(())
	})
}

/// Link every discovered directory to the workspace folder it describes.
///
/// **Two passes, and the order is the compatibility story.** Exact path first,
/// exactly as it always was; the repository roll-up only ever touches what the
/// first pass left unlinked.
pub fn reconcile(conn: &Connection) -> AppResult<()> {
	// Pass 1 — exact canonical path, and nothing else: an agent's own naming
	// scheme is its business. A session recorded in `/repo/apps/web` belongs to
	// `/repo/apps/web`, not to `/repo`, even when only the latter is open.
	// Rolling up to the nearest open *ancestor* was considered and rejected
	// (ADR-0011): it turns every session lookup into a prefix scan and needs a
	// tie-break the moment both a folder and its parent are open.
	conn.execute(
		"UPDATE discovered_projects
		    SET project_id = (SELECT p.id FROM projects p WHERE p.real_path = discovered_projects.real_path)
		  WHERE real_path IS NOT NULL",
		[],
	)?;
	// A directory whose folder we never identified can't belong to anything.
	conn.execute("UPDATE discovered_projects SET project_id = NULL WHERE real_path IS NULL", [])?;
	link_worktrees(conn)
}

/// Pass 2 — a directory that is a **checkout of a project's repository** belongs
/// to that project (F21, ADR-0019 § 1).
///
/// This is what makes a session the agent ran in `git worktree add`'s directory
/// appear under the project you actually added, instead of becoming a project
/// you never asked for. It is **not** the prefix scan ADR-0011 turned down: a
/// checkout is neither an ancestor nor a descendant of the project, so this is
/// membership in a set git enumerates, behind an exact-match rule that still
/// wins. Someone who added `~/wt/feature-x` as its own project keeps its
/// sessions there.
///
/// **Exact checkout match, not containment**, which keeps it symmetric with pass
/// 1: a session recorded in a *subdirectory* of a checkout does not roll up, for
/// the same reason one in a subdirectory of the project does not.
///
/// The git reads happen inside the caller's transaction. Short and bounded — one
/// `.git/worktrees` listing per project, and projects are counted in tens — but
/// worth knowing about before anything heavier is added here.
fn link_worktrees(conn: &Connection) -> AppResult<()> {
	let mut stmt = conn.prepare(
		"SELECT id, real_path FROM discovered_projects
		  WHERE project_id IS NULL AND real_path IS NOT NULL",
	)?;
	let unlinked: Vec<(i64, String)> =
		stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
	drop(stmt);
	if unlinked.is_empty() {
		return Ok(());
	}

	let mut stmt = conn.prepare("SELECT id, real_path FROM projects")?;
	let projects: Vec<(String, String)> =
		stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
	drop(stmt);

	// checkout path → project id. First project wins if two of them somehow share
	// a repository — which happens when the main checkout *and* a worktree are
	// both added, and in that case pass 1 has already claimed the rows that
	// matter, so the tie is between two answers that are both defensible.
	let mut owner: HashMap<PathBuf, String> = HashMap::new();
	for (project_id, real_path) in &projects {
		for checkout in git::worktree_paths(real_path) {
			owner.entry(checkout).or_insert_with(|| project_id.clone());
		}
	}
	if owner.is_empty() {
		return Ok(());
	}

	let mut stmt = conn.prepare("UPDATE discovered_projects SET project_id = ?2 WHERE id = ?1")?;
	for (id, real_path) in unlinked {
		let canonical =
			std::fs::canonicalize(&real_path).unwrap_or_else(|_| PathBuf::from(&real_path));
		if let Some(project_id) = owner.get(&canonical) {
			stmt.execute(params![id, project_id])?;
		}
	}
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
