use rusqlite::params;
use tauri::{Emitter, State};

use crate::agents::claude;
use crate::error::{AppError, AppResult};
use crate::models::{SearchHit, SessionEvent, SessionPage, SessionSummary};
use crate::services::jsonl::EventIter;
use crate::services::search;
use crate::state::AppState;

/// Sessions in one workspace project — every agent directory linked to its
/// folder, newest first.
#[tauri::command]
pub fn list_sessions(
	state: State<'_, AppState>,
	project_id: String,
) -> AppResult<Vec<SessionSummary>> {
	state.db.with(|conn| list_sessions_in(conn, &project_id))
}

/// The body of [`list_sessions`], against a connection rather than the managed
/// state — the shape `projects::list_projects_in` already uses, and what lets a
/// test assert on real rows without a Tauri runtime.
pub fn list_sessions_in(
	conn: &rusqlite::Connection,
	project_id: &str,
) -> AppResult<Vec<SessionSummary>> {
	let mut stmt = conn.prepare(
		// Sub-agent rows sort directly under their parent: groups are
		// ordered by the *parent's* recency (a sub-agent is part of the
		// work its parent session was), the parent leads its group, and
		// siblings order among themselves by recency. An orphaned
		// sub-agent (parent transcript deleted) keeps its marking but
		// sorts as its own group — the LEFT JOIN leaves `p` NULL and
		// COALESCE falls back to its own updated_at.
		// `w.path` is the checkout the agent last signalled (F21). Joined here
		// rather than fetched per session: the renderer needs it for every row
		// it draws — the sidebar's checkout mark — and on first paint, before
		// any `session:worktree` event has had a reason to fire.
		// `sr.routine_id` and the routine's name are the origin marker (F22).
		// Joined for the same reason `w.path` is: every row that draws it needs
		// it, including on first paint. `LEFT JOIN routines` rather than a
		// second lookup, and the name can be NULL for a live row — deleting a
		// routine nulls the link instead of cascading, so a session it started
		// keeps its icon and loses only the name.
		// `pin` is the row's own pin and `ppin` its parent's (F2, migration 0015).
		// **Two joins because the sort key is the group's pin, not the row's**: a
		// pinned parent has to take its sub-agents with it, or the list nests rows
		// that are no longer under the session they belong to. `groupSessions` in
		// the renderer nests and never sorts, deliberately, so ordering the group
		// is this query's job — the same reason the parent-recency key below is
		// here rather than there.
		"SELECT s.id, d.project_id, COALESCE(s.title, ''), s.created_at, s.updated_at,
		        s.turn_count, s.cwd, s.subagent_of, w.path, s.last_cwd, s.touched_paths,
		        sr.routine_id, r.name, sr.created_at, pin.session_id IS NOT NULL
		 FROM sessions s
		 JOIN discovered_projects d ON d.id = s.discovered_id
		 LEFT JOIN sessions p ON p.id = s.subagent_of
		 LEFT JOIN session_worktrees w ON w.session_id = s.id
		 LEFT JOIN session_routines sr ON sr.session_id = s.id
		 LEFT JOIN routines r ON r.id = sr.routine_id
		 LEFT JOIN session_pins pin ON pin.session_id = s.id
		 LEFT JOIN session_pins ppin ON ppin.session_id = s.subagent_of
		 WHERE d.project_id = ?1
		 ORDER BY (COALESCE(ppin.session_id, pin.session_id) IS NULL),
		          COALESCE(p.updated_at, s.updated_at) DESC,
		          (s.subagent_of IS NULL) DESC,
		          s.updated_at DESC",
	)?;
	let rows = stmt
		.query_map(params![project_id], |row| {
			Ok(SessionSummary {
				id: row.get(0)?,
				project_id: row.get(1)?,
				title: row.get(2)?,
				created_at: row.get(3)?,
				updated_at: row.get(4)?,
				turn_count: row.get(5)?,
				// **Resolved for the renderer, raw in the table** (F21). Every path
				// in `git_worktrees` has been through `fs::canonicalize`, and the
				// renderer decides which checkout a session is in by comparing these
				// against those — so a path that reaches the same file by a
				// different name resolves to no checkout at all and the panel sits
				// silently on the project. A tool's absolute path can carry `..`,
				// and a shell's own idea of its directory is the *logical* one, which
				// keeps whatever symlink you walked through.
				//
				// It cannot be done at write time: `resume_cwd` probes for a
				// transcript at `encode_path(cwd)`, and `claude` encoded the path it
				// was given, not its resolved twin. Canonicalising the stored value
				// would make that probe miss for exactly the moved sessions it
				// exists for.
				cwd: resolved(row.get(6)?),
				subagent_of: row.get(7)?,
				worktree: row.get(8)?,
				last_cwd: resolved(row.get(9)?),
				touched_paths: touched(row.get(10)?),
				routine_id: row.get(11)?,
				routine_name: row.get(12)?,
				routine_started_at: row.get(13)?,
				pinned: row.get(14)?,
			})
		})?
		.collect::<rusqlite::Result<Vec<_>>>()?;
	Ok(rows)
}

/// A path as the filesystem really names it, or unchanged if it cannot say.
///
/// A path that no longer exists is left alone rather than dropped: it is still
/// the honest record of where the session ran, and every consumer of these
/// fields already treats a path it cannot match as "no checkout".
fn resolved(path: Option<String>) -> Option<String> {
	Some(canonical(path?))
}

/// The stored `touched_paths` JSON as a list the renderer can compare (F21,
/// migration 0010).
///
/// **A column that will not parse yields no paths rather than an error.** It is
/// a derived cache of a guess at another program's schema, and the parse
/// version stamp rewrites it on the next scan — failing a whole project's
/// session list over it would trade a wrong panel root for no panel at all.
fn touched(stored: Option<String>) -> Vec<String> {
	stored
		.and_then(|json| serde_json::from_str::<Vec<String>>(&json).ok())
		.unwrap_or_default()
		.into_iter()
		.map(canonical)
		.collect()
}

/// One path as the filesystem really names it, or unchanged if it cannot say.
fn canonical(path: String) -> String {
	std::fs::canonicalize(&path).map(|p| p.to_string_lossy().to_string()).unwrap_or(path)
}

/// Read the **last** `limit` events from a session. Default 100. The
/// returned page's `offset` is the position of the first returned event
/// in the full sequence — handy for the frontend's "show earlier" paging.
#[tauri::command]
pub fn get_session_tail(
	state: State<'_, AppState>,
	session_id: String,
	limit: Option<usize>,
) -> AppResult<SessionPage> {
	let limit = limit.unwrap_or(100);

	let (key, parent_id, total) = lookup_store_key_and_total(&state, &session_id)?;
	let offset = total.saturating_sub(limit);

	let path = transcript_path(&state.claude_dir, &key, parent_id.as_deref(), &session_id);
	let events: Vec<SessionEvent> = EventIter::open(&path)?.skip(offset).take(limit).collect();

	Ok(SessionPage { id: session_id, events, offset, limit, total })
}

/// Where a session's transcript file is, as an absolute path.
///
/// For the sidebar row's `Copy transcript path` (F2): the file is what you feed
/// back to another agent, `jq`, or a bug report, and hunting it by hand means
/// knowing Claude's directory encoding. Addressed by the recorded store key,
/// like every other read here, so a sub-agent's nested path is right too.
///
/// **The path is returned whether or not the file is still there.** It is the
/// answer to "where does this session live", and a transcript that has been
/// moved or trashed since the last scan is exactly the case someone is copying
/// the path to investigate.
#[tauri::command]
pub fn session_transcript_path(
	state: State<'_, AppState>,
	session_id: String,
) -> AppResult<String> {
	let (key, parent_id, _) = lookup_store_key_and_total(&state, &session_id)?;
	let path = transcript_path(&state.claude_dir, &key, parent_id.as_deref(), &session_id);
	Ok(path.to_string_lossy().to_string())
}

/// Full-text search across the workspace (spec F4). `project_id` optionally
/// restricts to one project. Returns up to `limit` (default 200, hard-capped at
/// 200) ranked hits.
///
/// Scoped to folders you have added, because indexing is: a project outside the
/// workspace was never parsed, so there is nothing of it to find. Reaching it
/// means adding the folder, which re-parses it with progress.
#[tauri::command]
pub fn search_sessions(
	state: State<'_, AppState>,
	query: String,
	project_id: Option<String>,
	limit: Option<usize>,
) -> AppResult<Vec<SearchHit>> {
	let limit = limit.unwrap_or(200);
	state.db.with(|conn| search::search(conn, &query, project_id.as_deref(), limit))
}

/// The agent store directory a session's transcript lives in, the parent
/// session if it is a sub-agent run, and its event count. The key is what was
/// recorded when the session was indexed, so it is exact — never a re-encode
/// of a path.
fn lookup_store_key_and_total(
	state: &State<'_, AppState>,
	session_id: &str,
) -> AppResult<(String, Option<String>, usize)> {
	state.db.with(|conn| {
		conn.query_row(
			"SELECT d.key, s.subagent_of, s.turn_count
			 FROM sessions s
			 JOIN discovered_projects d ON d.id = s.discovered_id
			 WHERE s.id = ?1",
			params![session_id],
			|row| {
				Ok((
					row.get::<_, String>(0)?,
					row.get::<_, Option<String>>(1)?,
					row.get::<_, i64>(2)? as usize,
				))
			},
		)
		.map_err(|_| AppError::NotFound(format!("session {session_id}")))
	})
}

/// Forget which checkout a session was working in (F21).
///
/// **The human's revert**, and the only write to `session_worktrees` that does
/// not come from the bridge. The badge's control undoes a move the agent made by
/// itself, so it removes the record rather than merely ignoring it — otherwise
/// the next read resolves straight back. The next signal writes it again.
///
/// Idempotent: reverting a session that never signalled is a no-op, not an
/// error. The control is only drawn when there is something to revert, and a
/// double-click must not become a dialog.
#[tauri::command]
pub fn clear_session_worktree(state: State<'_, AppState>, session_id: String) -> AppResult<()> {
	crate::services::sessions::clear_worktree(&state.db, &session_id)
}

/// Root this session's panel on a checkout the **human** chose (F21).
///
/// The picker beside the header's branch badge. It writes the same row the
/// bridge's signal path writes, deliberately: a pick and a signal answer the
/// same question, and a second table would need a precedence rule between two
/// records of one fact. What keeps a pick from being undone by the next
/// `openFile` is a flag in the renderer's store, not a second row here — the
/// pick is in force for as long as you are looking at it, and a reload resolves
/// it from this row like any other.
///
/// **Validated against the project's own repository, not against the path
/// alone.** `worktree_paths` discovers from whatever it is handed, so checking
/// `path` against its own repository would accept any checkout of any repository
/// on the machine — a renderer bug, or a malformed call, could then root the
/// panel outside the project the route names. The renderer only ever offers this
/// project's checkouts; this is the half that does not trust it.
///
/// A path that is not a checkout of that repository — or is one whose directory
/// has since gone — is `InvalidInput`, which is the same line
/// `services/ide/protocol.rs` draws for `setWorktree`.
#[tauri::command]
pub fn set_session_worktree(
	state: State<'_, AppState>,
	session_id: String,
	project_path: String,
	path: String,
) -> AppResult<()> {
	let wanted = std::fs::canonicalize(&path).unwrap_or_else(|_| std::path::PathBuf::from(&path));
	if !crate::services::git::worktree_paths(&project_path).contains(&wanted) {
		return Err(AppError::InvalidInput(format!(
			"{path} is not a checkout of the repository at {project_path}"
		)));
	}
	crate::services::sessions::set_worktree(
		&state.db,
		&session_id,
		&wanted.to_string_lossy(),
		crate::epoch_ms(),
	)
}

/// Pin or unpin a session, then `sessions:changed` for its project (F2,
/// migration 0015).
///
/// A pin exempts a session from recency: it sits above the rest of its project's
/// list in the sidebar and on the project page, where it cannot be pushed below
/// the fold by whatever you touched most recently.
///
/// **Only an indexed session can be pinned.** A session spawned but never
/// messaged has no transcript and so no row (ADR-0008), and the renderer draws
/// those rows from its own store — they are already at the top of the list by the
/// live-first rule, so there is nothing a pin would buy. `NotFound` rather than a
/// silent no-op, because a pin that quietly did not happen is a mark you would
/// believe you had made.
///
/// The event rather than a return value, for the reason `delete_session` gives:
/// every list on screen is a `list_sessions` too, and the one you clicked in is
/// not the only one that just became wrong.
#[tauri::command]
pub fn set_session_pinned(
	app: tauri::AppHandle,
	state: State<'_, AppState>,
	session_id: String,
	pinned: bool,
) -> AppResult<()> {
	let project_id =
		crate::services::sessions::set_pinned(&state.db, &session_id, pinned, crate::epoch_ms())?;
	if let Some(project_id) = project_id {
		let _ = app.emit(
			"sessions:changed",
			crate::models::SessionsChanged { project_id, session_ids: vec![session_id] },
		);
	}
	Ok(())
}

/// Delete a session (F2, ADR-0027): its transcript to the OS trash, its rows out
/// of the index, then `sessions:changed` for the project it belonged to.
///
/// **Not a kill.** The renderer stops a running session first and this refuses
/// while one is running, which is the division `useRemoveProject` already draws:
/// a kill that fails has to leave the tab standing so you can see and stop the
/// process yourself, and a backend that killed silently would take that away
/// (ADR-0005). What the guard here protects is the other half — a transcript
/// moved out from under a `claude` that is still writing to it is the corruption
/// ADR-0004 exists to prevent.
///
/// **The guard is a plain check, and the caller waits.** `TerminalManager::kill`
/// signals and returns; the entry leaves the map on the *waiter* thread once
/// `child.wait()` comes back, so a `terminal_kill` → `delete_session` pair
/// arrives here microseconds apart with the session still live. `useDeleteSession`
/// waits for `terminal:exit` before calling, which is where a wait belongs:
/// every command in this crate is synchronous and therefore on the main thread,
/// and three seconds of sleep here would be three seconds of frozen window.
///
/// The event rather than a return value the caller re-broadcasts: every other
/// list on screen is a `list_sessions` too, and the one you clicked in is not
/// the only one that is now wrong.
#[tauri::command]
pub fn delete_session(
	app: tauri::AppHandle,
	state: State<'_, AppState>,
	session_id: String,
) -> AppResult<()> {
	let is_live = state.terminals.live_session_ids().contains(&session_id);
	let project_id =
		crate::services::sessions::delete(&state.db, &state.claude_dir, &session_id, is_live)?;

	// Same shape the indexer emits, so `useSessionsSync` needs nothing new: the
	// project whose list changed, and the ids that changed in it. `None` means
	// the session's store directory belongs to no project in the workspace —
	// nothing is listing it, so there is nothing to tell.
	if let Some(project_id) = project_id {
		let _ = app.emit(
			"sessions:changed",
			crate::models::SessionsChanged { project_id, session_ids: vec![session_id] },
		);
	}
	Ok(())
}

/// Where a session's transcript lives, addressed by the store directory we
/// recorded for it. A sub-agent's is nested under its parent's id:
/// `<store dir>/<parent>/subagents/agent-*.jsonl`.
fn transcript_path(
	claude_dir: &std::path::Path,
	key: &str,
	subagent_of: Option<&str>,
	session_id: &str,
) -> std::path::PathBuf {
	match subagent_of {
		Some(parent) => claude::subagent_transcript_path(claude_dir, key, parent, session_id),
		None => claude::transcript_path_by_key(claude_dir, key, session_id),
	}
}
