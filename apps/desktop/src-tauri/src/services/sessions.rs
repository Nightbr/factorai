//! Small reads of the `sessions` table that something outside the command layer
//! needs.
//!
//! Today there is exactly one, and it exists for the same reason
//! `settings::claude_binary_override` does: `TerminalManager` needs an answer
//! from a database it should not hold, so it takes a callback and this is what
//! the callback closes over. See its `session_cwd` field.

use std::path::PathBuf;

use crate::db::Db;

/// The cwd recorded in a session's transcript, as the indexer saw it.
///
/// **Swallows a read failure into `None`**, following
/// `settings::claude_binary_override`: this sits in front of a spawn, and a
/// database we cannot read has to mean "we know nothing about this session"
/// rather than "refuse to start it". The caller's own cwd is then used, which is
/// exactly the behaviour that predates this function.
///
/// `None` is also the ordinary answer for a session factorai just minted: there
/// is no transcript yet, so there is no row and nothing to recover.
pub fn recorded_cwd(db: &Db, session_id: &str) -> Option<PathBuf> {
	db.with(|conn| {
		let cwd: Option<String> = conn
			.query_row("SELECT cwd FROM sessions WHERE id = ?1", [session_id], |row| row.get(0))
			.ok()
			.flatten();
		Ok(cwd)
	})
	.ok()
	.flatten()
	.map(PathBuf::from)
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
	/// FK is enforced.
	fn insert_session(db: &Db, session_id: &str, cwd: Option<&str>) {
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
				                      turn_count, file_mtime, file_size, cwd)
				 VALUES (?1, ?2, '', 0, 0, 0, 0, 0, ?3)",
				rusqlite::params![session_id, discovered, cwd],
			)
			.unwrap();
			Ok(())
		})
		.unwrap();
	}

	#[test]
	fn recovers_the_recorded_cwd() {
		let (_tmp, db) = db();
		insert_session(&db, "s1", Some("/repo/apps/web"));
		assert_eq!(recorded_cwd(&db, "s1"), Some(PathBuf::from("/repo/apps/web")));
	}

	#[test]
	fn a_row_with_no_cwd_is_none_not_an_error() {
		let (_tmp, db) = db();
		insert_session(&db, "s1", None);
		assert_eq!(recorded_cwd(&db, "s1"), None);
	}

	#[test]
	fn an_unknown_session_is_none() {
		let (_tmp, db) = db();
		// The ordinary case for a session factorai just minted: no transcript, so
		// no row, so nothing to recover — and the caller's cwd is used.
		assert_eq!(recorded_cwd(&db, "never-indexed"), None);
	}
}
