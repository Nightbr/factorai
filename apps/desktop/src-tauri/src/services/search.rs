//! Full-text search over indexed session messages (M3 / spec F4).
//!
//! Queries the `messages_fts` FTS5 table populated by the indexer. Hits
//! identify a *session* — the FTS index stores no per-event position, and the
//! session view is terminal-only, so there is nothing to navigate *to within*
//! a session. Results are JOINed against `sessions` for a human title and
//! against `projects` for the project the session belongs to — "which
//! conversation was that" is usually half of "in which codebase".

use rusqlite::{params, Connection};

use crate::error::AppResult;
use crate::models::SearchHit;

/// Hard cap on returned hits regardless of the requested limit.
const MAX_HITS: usize = 200;

/// Turn free-text into a safe FTS5 MATCH expression.
///
/// Each whitespace-separated token becomes a quoted phrase, so FTS5
/// metacharacters (`*` `:` `"` `^` `-` `(` `)` `NEAR` …) are matched literally
/// and can never raise a `fts5: syntax error`. Returns `None` when the query
/// has no usable tokens (empty / whitespace-only), which the caller maps to an
/// empty result set.
pub fn build_match(query: &str) -> Option<String> {
	let tokens: Vec<String> =
		query.split_whitespace().map(|t| format!("\"{}\"", t.replace('"', "\"\""))).collect();
	if tokens.is_empty() {
		None
	} else {
		Some(tokens.join(" "))
	}
}

/// Run a full-text search across the workspace. `project_id` optionally
/// restricts to one project. `limit` is clamped to `[1, MAX_HITS]`.
///
/// The project a hit belongs to is resolved through `sessions` →
/// `discovered_projects` → `projects` rather than stored on the FTS row. A
/// workspace id is not stable across a remove and a re-add, and an index full
/// of ids that no longer resolve is worse than one indexed join. Resolving it
/// live is also what keeps a renamed project's name right in old hits.
///
/// The joins are inner, which is also what scopes the search: a session whose
/// directory has no `project_id` isn't in the workspace, and its rows never
/// reach a result. Indexing is gated the same way, so in practice there are no
/// such rows — the join is the belt to that braces.
pub fn search(
	conn: &Connection,
	query: &str,
	project_id: Option<&str>,
	limit: usize,
) -> AppResult<Vec<SearchHit>> {
	let Some(match_expr) = build_match(query) else {
		return Ok(Vec::new());
	};
	let limit = limit.clamp(1, MAX_HITS) as i64;

	// **Column 1 of messages_fts is `body`** → snippet target. It was column 2
	// until ADR-0053 made the index external content over `messages`, which took
	// `session_id` out of the index entirely: the columns are `role`, `body`.
	// The session id and the role come from `messages`, joined on the rowid the
	// index reads through. bm25() ascending puts the best matches first. The FTS
	// table is named in full (not aliased) so the bm25()/snippet() auxiliary
	// functions resolve cleanly.
	let select = "SELECT messages.session_id, discovered_projects.project_id, \
		projects.display_name, projects.real_path, \
		COALESCE(sessions.title, ''), messages.role, \
		snippet(messages_fts, 1, '', '', '…', 16), COALESCE(profiles.agent, 'claude') \
		FROM messages_fts \
		JOIN messages ON messages.id = messages_fts.rowid \
		JOIN sessions ON sessions.id = messages.session_id \
		JOIN discovered_projects ON discovered_projects.id = sessions.discovered_id \
		LEFT JOIN profiles ON profiles.id = discovered_projects.profile_id \
		JOIN projects ON projects.id = discovered_projects.project_id \
		WHERE messages_fts MATCH ?1 AND discovered_projects.project_id IS NOT NULL";

	let map = |row: &rusqlite::Row<'_>| {
		Ok(SearchHit {
			session_id: row.get(0)?,
			project_id: row.get(1)?,
			project_name: row.get(2)?,
			project_path: row.get(3)?,
			title: row.get(4)?,
			role: row.get(5)?,
			snippet: row.get(6)?,
			agent: row.get(7)?,
		})
	};

	let mut hits = Vec::new();
	match project_id {
		Some(pid) => {
			let sql = format!(
				"{select} AND discovered_projects.project_id = ?2 ORDER BY bm25(messages_fts) LIMIT ?3"
			);
			let mut stmt = conn.prepare(&sql)?;
			let rows = stmt.query_map(params![match_expr, pid, limit], map)?;
			for r in rows {
				hits.push(r?);
			}
		}
		None => {
			let sql = format!("{select} ORDER BY bm25(messages_fts) LIMIT ?2");
			let mut stmt = conn.prepare(&sql)?;
			let rows = stmt.query_map(params![match_expr, limit], map)?;
			for r in rows {
				hits.push(r?);
			}
		}
	}
	Ok(hits)
}

#[cfg(test)]
mod tests {
	use super::*;

	/// Three sessions: two in workspace project `p1`, one in `p2`, and one in a
	/// directory nobody has added — `d3` has no `project_id`, which is what the
	/// scoping test needs. `projects` carries the two workspace rows a hit is
	/// labelled from.
	fn setup() -> Connection {
		let conn = Connection::open_in_memory().unwrap();
		conn.execute_batch(
			"CREATE TABLE projects (id TEXT PRIMARY KEY, real_path TEXT, display_name TEXT);
			 CREATE TABLE discovered_projects (id INTEGER PRIMARY KEY, project_id TEXT, profile_id TEXT);
			 CREATE TABLE profiles (id TEXT PRIMARY KEY, agent TEXT);
			 CREATE TABLE sessions (id TEXT PRIMARY KEY, discovered_id INTEGER, title TEXT);
			 CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL,
				role TEXT NOT NULL, body TEXT NOT NULL);
			 CREATE INDEX idx_messages_session ON messages(session_id);
			 CREATE VIRTUAL TABLE messages_fts USING fts5(
				role, body, content = 'messages', content_rowid = 'id',
				tokenize = 'porter unicode61');
			 CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
				INSERT INTO messages_fts(rowid, role, body) VALUES (new.id, new.role, new.body);
			 END;
			 INSERT INTO projects(id, real_path, display_name)
			   VALUES('p1', '/home/dev/factorai', 'factorai'),
			         ('p2', '/home/dev/orchard', 'orchard');
			 INSERT INTO discovered_projects(id, project_id) VALUES(1,'p1'),(2,'p2'),(3,NULL);
			 INSERT INTO sessions(id, discovered_id, title)
			   VALUES('s1', 1, 'Refactor the indexer'),
			         ('s2', 2, NULL),
			         ('s3', 3, 'Never added');",
		)
		.unwrap();
		let rows = [
			("s1", "user", "please refactor the sqlite indexer for speed"),
			("s1", "assistant", "I rewrote the indexer to batch inserts"),
			("s2", "user", "how does the terminal pty work on linux"),
			("s3", "user", "an indexer conversation in a folder nobody added"),
		];
		for (sid, role, body) in rows {
			conn.execute(
				"INSERT INTO messages(session_id, role, body) VALUES(?1,?2,?3)",
				params![sid, role, body],
			)
			.unwrap();
		}
		conn
	}

	#[test]
	fn build_match_quotes_tokens_and_handles_empty() {
		assert_eq!(build_match("hello world"), Some("\"hello\" \"world\"".into()));
		assert_eq!(build_match("   "), None);
		assert_eq!(build_match(""), None);
		// metacharacters are neutralised, embedded quotes doubled
		assert_eq!(build_match("a*b"), Some("\"a*b\"".into()));
		assert_eq!(build_match("say \"hi\""), Some("\"say\" \"\"\"hi\"\"\"".into()));
	}

	#[test]
	fn finds_matches_and_joins_title_and_project() {
		let conn = setup();
		let hits = search(&conn, "indexer", None, 50).unwrap();
		assert_eq!(hits.len(), 2, "two messages mention 'indexer' inside the workspace");
		assert!(hits.iter().all(|h| h.session_id == "s1"));
		assert!(hits.iter().all(|h| h.title == "Refactor the indexer"));
		assert!(hits.iter().all(|h| h.project_id == "p1"));
		// The hit says which codebase it came from, not just which session.
		assert!(hits.iter().all(|h| h.project_name == "factorai"));
		assert!(hits.iter().all(|h| h.project_path == "/home/dev/factorai"));
		assert!(hits.iter().any(|h| h.snippet.contains("indexer")));
	}

	#[test]
	fn a_session_outside_the_workspace_is_never_a_hit() {
		let conn = setup();
		// s3 says "indexer" too, in a directory with no project_id. Search is
		// scoped to folders you added, so it must not surface.
		let hits = search(&conn, "indexer", None, 50).unwrap();
		assert!(
			hits.iter().all(|h| h.session_id != "s3"),
			"an unadded folder's sessions are unreachable from search"
		);
	}

	#[test]
	fn project_filter_restricts_results() {
		let conn = setup();
		assert!(!search(&conn, "the", Some("p1"), 50).unwrap().is_empty());
		let p2 = search(&conn, "terminal", Some("p2"), 50).unwrap();
		assert_eq!(p2.len(), 1);
		assert_eq!(p2[0].session_id, "s2");
		assert_eq!(p2[0].title, "", "NULL title coalesces to empty string");
		assert_eq!(p2[0].project_name, "orchard");
		assert_eq!(p2[0].project_path, "/home/dev/orchard");
		// a term only present in p1 returns nothing when filtered to p2
		assert!(search(&conn, "refactor", Some("p2"), 50).unwrap().is_empty());
	}

	#[test]
	fn empty_query_returns_empty_without_error() {
		let conn = setup();
		assert!(search(&conn, "   ", None, 50).unwrap().is_empty());
	}

	#[test]
	fn metacharacters_do_not_error() {
		let conn = setup();
		// These would be FTS syntax errors if passed unquoted.
		for q in ["*", "\"", "a:b", "foo AND", "NEAR(", "-bad", "x^2"] {
			let r = search(&conn, q, None, 50);
			assert!(r.is_ok(), "query {q:?} should not error, got {r:?}");
		}
	}

	#[test]
	fn limit_is_clamped() {
		let conn = setup();
		assert!(search(&conn, "the", None, 1).unwrap().len() <= 1);
		// over-large limit is capped, not rejected
		assert!(search(&conn, "the", None, 10_000).is_ok());
	}
}
