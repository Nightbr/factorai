//! Reads and writes of a session's own rows that something outside the command
//! layer needs.
//!
//! Both callers are `TerminalManager`, and both exist for the same reason
//! `settings::claude_binary_override` does: the manager needs a database it
//! should not hold, so it takes callbacks and these are what they close over.
//! See its `session_cwd` and `session_worktree` fields.

use std::path::{Path, PathBuf};

use crate::agents::claude;
use crate::db::Db;
use crate::error::{AppError, AppResult};

/// The directories a session's transcript records it having run in, **newest
/// first** — its last `cwd` then its first. Usually the same path twice, hence
/// one entry; two when the agent moved into a worktree mid-session (F21).
///
/// **Swallows a read failure into `None`**, following
/// `settings::claude_binary_override`: this sits in front of a spawn, and a
/// database we cannot read has to mean "we know nothing about this session"
/// rather than "refuse to start it". The caller's own cwd is then used, which is
/// exactly the behaviour that predates this function.
///
/// `None` is also the ordinary answer for a session factorai just minted: there
/// is no transcript yet, so there is no row and nothing to recover.
pub fn recorded_cwds(db: &Db, session_id: &str) -> Vec<PathBuf> {
	let row: Option<(Option<String>, Option<String>)> = db
		.with(|conn| {
			Ok(conn
				.query_row(
					"SELECT last_cwd, cwd FROM sessions WHERE id = ?1",
					[session_id],
					|row| Ok((row.get(0)?, row.get(1)?)),
				)
				.ok())
		})
		.ok()
		.flatten();

	let Some((last, first)) = row else {
		return Vec::new();
	};
	// Newest first, and de-duplicated: the two are the same string for every
	// session that never moved, which is almost all of them.
	let mut out: Vec<PathBuf> = Vec::new();
	for candidate in [last, first].into_iter().flatten() {
		let path = PathBuf::from(candidate);
		if !out.contains(&path) {
			out.push(path);
		}
	}
	out
}

/// Record which checkout of its repository a session is working in (F21).
///
/// **Only the IDE bridge's signal path calls this**, after the path has been
/// validated against the repository's real worktree list — the table is a record
/// of what the agent said, and the validation is what makes it worth recording.
///
/// A failure is returned rather than swallowed, unlike the reads above: this one
/// is the durable half of a signal whose event is about to be emitted, and
/// emitting after a write that silently failed is how the renderer comes to show
/// a checkout the next reload disagrees with.
pub fn set_worktree(db: &Db, session_id: &str, path: &str, now_ms: i64) -> AppResult<()> {
	db.with(|conn| {
		conn.execute(
			"INSERT INTO session_worktrees(session_id, path, updated_at)
			 VALUES (?1, ?2, ?3)
			 ON CONFLICT(session_id) DO UPDATE SET path = excluded.path,
			                                       updated_at = excluded.updated_at",
			rusqlite::params![session_id, path, now_ms],
		)?;
		Ok(())
	})
}

/// Pin or unpin a session, and return the project whose list changed (F2,
/// migration 0015).
///
/// **The project id comes back rather than being looked up again by the caller**,
/// because the command has to emit `sessions:changed` for it and the join that
/// resolves it is the same one the write needs to have found a row at all. A
/// session that is not in the index is `NotFound`, mapped the way
/// [`delete`] maps it: only "no such row" is a missing session, and a locked
/// database must not be reported as one.
///
/// A project id of `None` means the session's store directory belongs to no
/// project in the workspace — the pin is written, and there is no list on screen
/// to tell about it.
///
/// Idempotent in both directions: `INSERT OR IGNORE` keeps the original
/// `pinned_at` when a row is pinned twice, so a double-click does not reset the
/// timestamp, and unpinning something unpinned deletes nothing.
pub fn set_pinned(
	db: &Db,
	session_id: &str,
	pinned: bool,
	now_ms: i64,
) -> AppResult<Option<String>> {
	db.with(|conn| {
		let project_id = conn
			.query_row(
				"SELECT d.project_id
				 FROM sessions s
				 JOIN discovered_projects d ON d.id = s.discovered_id
				 WHERE s.id = ?1",
				rusqlite::params![session_id],
				|row| row.get::<_, Option<String>>(0),
			)
			.map_err(|e| match e {
				rusqlite::Error::QueryReturnedNoRows => {
					AppError::NotFound(format!("no indexed session {session_id}"))
				}
				other => AppError::from(other),
			})?;
		if pinned {
			conn.execute(
				"INSERT OR IGNORE INTO session_pins(session_id, pinned_at) VALUES (?1, ?2)",
				rusqlite::params![session_id, now_ms],
			)?;
		} else {
			conn.execute("DELETE FROM session_pins WHERE session_id = ?1", [session_id])?;
		}
		Ok(project_id)
	})
}

/// Forget which checkout a session was working in (F21).
///
/// **The human's revert.** The badge's control is an undo of a move the agent
/// made automatically, so it has to remove the record and not merely stop
/// looking at it — otherwise the next read resolves straight back to the
/// checkout the human just left. The next signal writes it again, which is what
/// makes the revert an undo rather than a lock.
pub fn clear_worktree(db: &Db, session_id: &str) -> AppResult<()> {
	db.with(|conn| {
		conn.execute("DELETE FROM session_worktrees WHERE session_id = ?1", [session_id])?;
		Ok(())
	})
}

/// The checkout recorded for a session, if any.
///
/// **Not re-validated here.** A row is a record, not a guarantee: the checkout it
/// names can be removed while the row survives, so the caller checks it against
/// git and falls back. Doing that inside this function would put a `git` call
/// behind what reads like a column read.
pub fn worktree(db: &Db, session_id: &str) -> Option<String> {
	db.with(|conn| {
		let path: Option<String> = conn
			.query_row(
				"SELECT path FROM session_worktrees WHERE session_id = ?1",
				[session_id],
				|row| row.get(0),
			)
			.ok();
		Ok(path)
	})
	.ok()
	.flatten()
}

/// Delete a session: its transcript to the OS trash, its rows out of the index
/// (F2, ADR-0027). Returns the **workspace** project the session belonged to,
/// for the `sessions:changed` the caller emits — `None` when its store directory
/// is linked to no project in the workspace, which is the same `project_id IS
/// NULL` case search already filters on. There is no list to tell about then.
///
/// **The one write into an agent's store that is not fork.** ADR-0004 forbade
/// moving or deleting a transcript to stop factorai corrupting a file Claude
/// Code is reading; a delete the human asked for by name is not that failure
/// mode, and ADR-0027 amends the clause for it — as a *move* to the trash,
/// which is also the shape ADR-0004's own escape hatch describes.
///
/// **The trash refusing is an error, not a reason to unlink.** A store on a
/// filesystem with no trash directory, or a `$HOME` on a different mount from
/// `~/.claude`, both land here — and silently upgrading a recoverable delete to
/// a permanent one is precisely the surprise the decision exists to avoid.
///
/// **Files first, rows second.** The other order would leave a session missing
/// from every list while its transcript is still on disk, which the next scan
/// would then re-index — the row coming *back* a few seconds after you deleted
/// it. This order's failure is a row for a file that is gone, which the reap
/// already handles.
///
/// The live-PTY guard is here rather than only in the renderer because it is a
/// backend invariant: a killed process is the caller's job (ADR-0005 wants the
/// tab standing if the kill fails), but a transcript trashed out from under a
/// running `claude` is a corrupt session, which is the thing ADR-0004 protects.
pub fn delete(
	db: &Db,
	claude_dir: &Path,
	session_id: &str,
	is_live: bool,
) -> AppResult<Option<String>> {
	let (key, project_id, subagent_of) = db.with(|conn| {
		conn.query_row(
			"SELECT d.key, d.project_id, s.subagent_of
			 FROM sessions s
			 JOIN discovered_projects d ON d.id = s.discovered_id
			 WHERE s.id = ?1",
			rusqlite::params![session_id],
			|row| {
				Ok((
					row.get::<_, String>(0)?,
					row.get::<_, Option<String>>(1)?,
					row.get::<_, Option<String>>(2)?,
				))
			},
		)
		// Only "no such row" becomes NotFound. A mapping that swallowed every
		// error into it would report a locked or corrupt database as a session
		// that does not exist, and send the reader looking in the wrong place.
		.map_err(|e| match e {
			rusqlite::Error::QueryReturnedNoRows => {
				AppError::NotFound(format!("no indexed session {session_id}"))
			}
			other => AppError::from(other),
		})
	})?;

	// A sub-agent's transcript lives inside its parent's directory and its parent's
	// transcript still references it, so deleting one alone leaves a hole in a
	// conversation you can still read. The parent is what you delete.
	if subagent_of.is_some() {
		return Err(AppError::InvalidInput(format!(
			"{session_id} is a sub-agent transcript — delete the session that spawned it"
		)));
	}
	if is_live {
		return Err(AppError::InvalidInput(format!(
			"session {session_id} is still running — stop it first"
		)));
	}

	let transcript = claude::transcript_path_by_key(claude_dir, &key, session_id);
	// The sub-agent directory, `<store dir>/<id>/`, taken whole — Claude Code
	// nests `subagents/agent-*.jsonl` inside it. Absent for most sessions, since
	// nothing spawned an agent, which is why it is a separate optional move
	// rather than part of the one above. Built from the store key rather than by
	// stripping the transcript's extension: a session id is not guaranteed to be
	// free of dots, and `with_extension("")` on one that isn't takes a directory
	// name that never existed.
	let subagents = claude_dir.join("projects").join(&key).join(session_id);

	// Collected first so both go in one call: `trash::delete_all` is atomic per
	// item, but one call means one trash entry pair rather than two, and on macOS
	// one trip through Finder's API.
	let mut targets: Vec<PathBuf> = Vec::new();
	if transcript.exists() {
		targets.push(transcript);
	}
	if subagents.is_dir() {
		targets.push(subagents);
	}
	// **Not an error when there is nothing to move.** A row whose transcript has
	// already gone is exactly what the reap exists for, and the user's ask —
	// "get this row out of my list" — is still answerable. Falling over here
	// would leave the row permanently undeletable.
	if !targets.is_empty() {
		trash::delete_all(&targets).map_err(|e| {
			AppError::Io(format!("could not move {session_id}'s transcript to the trash: {e}"))
		})?;
	}

	drop_rows(db, session_id)?;
	Ok(project_id)
}

/// Drop one session's rows across the four tables that hold them, in one
/// transaction.
///
/// **The same four, in the same order, as `Indexer::reap_deleted`** — this is
/// that removal arriving by a different route, and two lists of tables that must
/// agree is one list waiting to drift. `session_worktrees` (F21) and
/// `session_routines` (F22) are here rather than cascading because neither has a
/// foreign key: both are written before the indexer has seen a transcript, so
/// their lifetime cannot hang off `sessions` (migrations 0007, 0013).
fn drop_rows(db: &Db, session_id: &str) -> AppResult<()> {
	db.with_mut(|conn| {
		let tx = conn.transaction()?;
		tx.execute("DELETE FROM messages_fts WHERE session_id = ?1", [session_id])?;
		tx.execute("DELETE FROM session_worktrees WHERE session_id = ?1", [session_id])?;
		tx.execute("DELETE FROM session_routines WHERE session_id = ?1", [session_id])?;
		tx.execute("DELETE FROM sessions WHERE id = ?1", [session_id])?;
		tx.commit()?;
		Ok(())
	})
}

#[cfg(test)]
mod tests {
	use super::*;
	use tempfile::TempDir;

	fn db() -> (TempDir, Db) {
		let tmp = TempDir::new().unwrap();
		let db = Db::open(&tmp.path().join("data")).expect("open db");
		(tmp, db)
	}

	/// Inserts the minimum a `sessions` row needs, through a discovery, since the
	/// FK on `discovered_id` is enforced. `last_cwd` defaults to `cwd` — the shape
	/// of a session that never moved.
	fn insert_session(db: &Db, session_id: &str, cwd: Option<&str>) {
		insert_session_moved(db, session_id, cwd, cwd)
	}

	fn insert_session_moved(db: &Db, session_id: &str, cwd: Option<&str>, last_cwd: Option<&str>) {
		// A discovery belongs to a profile since migration 0018 (F25), and the
		// column is NOT NULL — so the fixture seeds the one profile every install
		// has rather than inventing an id the foreign key would reject.
		let profile =
			crate::services::profiles::ensure_default(db, Path::new("/nonexistent-store"))
				.expect("seed the default profile");
		db.with(|conn| {
			conn.execute(
				"INSERT INTO discovered_projects(profile_id, key, real_path) VALUES (?1, ?2, ?2)",
				rusqlite::params![profile.id, session_id],
			)
			.unwrap();
			let discovered: i64 = conn
				.query_row("SELECT id FROM discovered_projects WHERE key = ?1", [session_id], |r| {
					r.get(0)
				})
				.unwrap();
			conn.execute(
				"INSERT INTO sessions(id, discovered_id, title, created_at, updated_at,
				                      turn_count, file_mtime, file_size, cwd, last_cwd)
				 VALUES (?1, ?2, '', 0, 0, 0, 0, 0, ?3, ?4)",
				rusqlite::params![session_id, discovered, cwd, last_cwd],
			)
			.unwrap();
			Ok(())
		})
		.unwrap();
	}

	#[test]
	fn a_session_that_never_moved_reports_one_directory() {
		let (_tmp, db) = db();
		insert_session(&db, "s1", Some("/repo/apps/web"));
		// Both columns hold the same string, and the caller should not have to
		// probe the same folder twice.
		assert_eq!(recorded_cwds(&db, "s1"), vec![PathBuf::from("/repo/apps/web")]);
	}

	#[test]
	fn a_session_that_moved_reports_where_it_ended_up_first() {
		let (_tmp, db) = db();
		// The shape the F21 bug was found in: started in the project, ended in a
		// worktree, and Claude took its store directory along — so the transcript
		// exists only under the second one.
		insert_session_moved(&db, "s1", Some("/repo"), Some("/repo/.claude/worktrees/fix"));
		assert_eq!(
			recorded_cwds(&db, "s1"),
			vec![PathBuf::from("/repo/.claude/worktrees/fix"), PathBuf::from("/repo")]
		);
	}

	#[test]
	fn a_row_with_no_cwd_reports_nothing() {
		let (_tmp, db) = db();
		insert_session(&db, "s1", None);
		assert!(recorded_cwds(&db, "s1").is_empty());
	}

	/// The store key `insert_session` writes is the session id itself, so a
	/// transcript for these rows lives at `<claude>/projects/<id>/<id>.jsonl`.
	fn transcript_of(claude_dir: &Path, session_id: &str) -> PathBuf {
		claude_dir.join("projects").join(session_id).join(format!("{session_id}.jsonl"))
	}

	#[test]
	fn deleting_drops_the_session_and_every_side_row_it_had() {
		let (tmp, db) = db();
		insert_session(&db, "s1", Some("/repo"));
		set_worktree(&db, "s1", "/wt/feature-x", 10).unwrap();
		db.with(|conn| {
			// Three columns, not four: migration 0004 dropped `project_id` from the
			// FTS table — a hit resolves its project through `sessions` now.
			conn.execute(
				"INSERT INTO messages_fts(session_id, role, body) VALUES ('s1', 'user', 'hello')",
				[],
			)?;
			Ok(())
		})
		.unwrap();

		// No transcript on disk, which is deliberate: it exercises every row this
		// removes without putting anything in the developer's trash. The move
		// itself is one call into `trash`; what is ours is which rows go.
		delete(&db, tmp.path(), "s1", false).unwrap();

		assert!(recorded_cwds(&db, "s1").is_empty(), "the sessions row should be gone");
		assert_eq!(worktree(&db, "s1"), None, "the F21 checkout record should go with it");
		let hits: i64 = db
			.with(|conn| {
				Ok(conn
					.query_row(
						"SELECT count(*) FROM messages_fts WHERE session_id = 's1'",
						[],
						|r| r.get(0),
					)
					.unwrap())
			})
			.unwrap();
		assert_eq!(hits, 0, "search must not still find a deleted session");
	}

	#[test]
	fn deleting_returns_the_project_whose_list_changed() {
		let (tmp, db) = db();
		insert_session(&db, "s1", Some("/repo"));
		db.with(|conn| {
			conn.execute(
				"INSERT INTO projects(id, real_path, display_name, opened_at)
				 VALUES ('p1', '/repo', 'repo', 0)",
				[],
			)?;
			conn.execute("UPDATE discovered_projects SET project_id = 'p1' WHERE key = 's1'", [])?;
			Ok(())
		})
		.unwrap();

		assert_eq!(delete(&db, tmp.path(), "s1", false).unwrap().as_deref(), Some("p1"));
	}

	#[test]
	fn a_session_in_no_workspace_project_has_no_list_to_tell() {
		let (tmp, db) = db();
		// `insert_session` leaves the discovery unlinked, which is the ordinary
		// state of a store directory for a folder nobody has added. Nothing is
		// listing it, so there is no `sessions:changed` to emit — and that is a
		// `None`, not a failure to delete.
		insert_session(&db, "s1", Some("/repo"));
		assert_eq!(delete(&db, tmp.path(), "s1", false).unwrap(), None);
	}

	#[test]
	fn a_row_whose_transcript_is_already_gone_still_deletes() {
		let (tmp, db) = db();
		insert_session(&db, "s1", Some("/repo"));
		// The reap's own case, arriving from the menu instead. Falling over here
		// would leave the row permanently undeletable — the user's ask is "get this
		// out of my list", and the list is the part we can still answer for.
		assert!(delete(&db, tmp.path(), "s1", false).is_ok());
		assert!(!transcript_of(tmp.path(), "s1").exists());
	}

	#[test]
	fn a_running_session_is_refused_rather_than_trashed_underneath() {
		let (tmp, db) = db();
		insert_session(&db, "s1", Some("/repo"));

		let err = delete(&db, tmp.path(), "s1", true).unwrap_err();
		assert!(matches!(err, AppError::InvalidInput(_)), "got {err:?}");
		// And nothing happened: a refused delete that took the row anyway would be
		// the invisible-agent state ADR-0005 forbids, wearing a different hat.
		assert_eq!(recorded_cwds(&db, "s1"), vec![PathBuf::from("/repo")]);
	}

	#[test]
	fn a_sub_agent_is_refused_because_its_file_belongs_to_its_parent() {
		let (tmp, db) = db();
		insert_session(&db, "parent", Some("/repo"));
		db.with(|conn| {
			let discovered: i64 = conn
				.query_row("SELECT id FROM discovered_projects WHERE key = 'parent'", [], |r| {
					r.get(0)
				})
				.unwrap();
			conn.execute(
				"INSERT INTO sessions(id, discovered_id, title, created_at, updated_at,
				                      turn_count, file_mtime, file_size, subagent_of)
				 VALUES ('agent-1', ?1, '', 0, 0, 0, 0, 0, 'parent')",
				rusqlite::params![discovered],
			)
			.unwrap();
			Ok(())
		})
		.unwrap();

		let err = delete(&db, tmp.path(), "agent-1", false).unwrap_err();
		assert!(matches!(err, AppError::InvalidInput(_)), "got {err:?}");
	}

	#[test]
	fn a_session_the_index_has_never_seen_is_not_found() {
		let (tmp, db) = db();
		let err = delete(&db, tmp.path(), "nope", false).unwrap_err();
		assert!(matches!(err, AppError::NotFound(_)), "got {err:?}");
	}

	#[test]
	fn a_worktree_round_trips_and_the_latest_signal_wins() {
		let (_tmp, db) = db();
		insert_session(&db, "s1", Some("/repo"));

		set_worktree(&db, "s1", "/wt/feature-x", 10).unwrap();
		assert_eq!(worktree(&db, "s1").as_deref(), Some("/wt/feature-x"));

		// The agent moved again. One row per session, not a history.
		set_worktree(&db, "s1", "/wt/hotfix", 20).unwrap();
		assert_eq!(worktree(&db, "s1").as_deref(), Some("/wt/hotfix"));
	}

	#[test]
	fn a_signal_lands_for_a_session_the_index_has_never_seen() {
		let (_tmp, db) = db();
		// **The case that shipped broken and was found by using it.** A brand-new
		// session has no `sessions` row — that table is derived from transcripts,
		// and the indexer writes a row only once Claude has written one. An agent
		// that runs `git worktree add` early signals before any of that, which is
		// exactly the case F21 exists for. Migration 0007 dropped the foreign key
		// that refused this.
		set_worktree(&db, "never-indexed", "/wt/feature-x", 10).unwrap();
		assert_eq!(worktree(&db, "never-indexed").as_deref(), Some("/wt/feature-x"));
	}

	#[test]
	fn clearing_forgets_the_checkout_so_the_next_read_falls_back() {
		let (_tmp, db) = db();
		insert_session(&db, "s1", Some("/repo"));
		set_worktree(&db, "s1", "/wt/feature-x", 10).unwrap();

		clear_worktree(&db, "s1").unwrap();
		assert_eq!(worktree(&db, "s1"), None);

		// An undo, not a lock: the agent can move it again.
		set_worktree(&db, "s1", "/wt/hotfix", 20).unwrap();
		assert_eq!(worktree(&db, "s1").as_deref(), Some("/wt/hotfix"));
	}

	#[test]
	fn clearing_a_session_that_never_signalled_is_not_an_error() {
		let (_tmp, db) = db();
		insert_session(&db, "s1", Some("/repo"));
		// The button is only drawn when there is something to revert, but a
		// double-click must not become an error dialog.
		clear_worktree(&db, "s1").unwrap();
	}

	#[test]
	fn a_session_with_no_signal_has_no_worktree() {
		let (_tmp, db) = db();
		insert_session(&db, "s1", Some("/repo"));
		assert_eq!(worktree(&db, "s1"), None);
	}

	#[test]
	fn an_unknown_session_is_none() {
		let (_tmp, db) = db();
		// The ordinary case for a session factorai just minted: no transcript, so
		// no row, so nothing to recover — and the caller's cwd is used.
		assert!(recorded_cwds(&db, "never-indexed").is_empty());
	}
}
