//! Reads and writes of a session's own rows that something outside the command
//! layer needs.
//!
//! Both callers are `TerminalManager`, and both exist for the same reason
//! `settings::claude_binary_override` does: the manager needs a database it
//! should not hold, so it takes callbacks and these are what they close over.
//! See its `session_cwd` and `session_worktree` fields.

use std::path::PathBuf;

use crate::db::Db;
use crate::error::AppResult;

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
		db.with(|conn| {
			conn.execute(
				"INSERT INTO discovered_projects(agent, key, real_path) VALUES ('claude', ?1, ?1)",
				[session_id],
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
