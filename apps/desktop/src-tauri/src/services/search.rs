//! Full-text search over indexed session messages (M3 / spec F4).
//!
//! Queries the `messages_fts` FTS5 table populated by the indexer. Hits
//! identify a *session* — the FTS index stores no per-event position, and the
//! session view is terminal-only, so there is nothing to navigate *to within*
//! a session. Results are JOINed against `sessions` for a human title.

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
	let tokens: Vec<String> = query
		.split_whitespace()
		.map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
		.collect();
	if tokens.is_empty() {
		None
	} else {
		Some(tokens.join(" "))
	}
}

/// Run a full-text search. `project_id` optionally restricts to one project.
/// `limit` is clamped to `[1, MAX_HITS]`.
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

	// Column 3 of messages_fts is `body` → snippet target. bm25() ascending
	// puts the best matches first. The FTS table is named in full (not
	// aliased) so the bm25()/snippet() auxiliary functions resolve cleanly.
	let select = "SELECT messages_fts.session_id, messages_fts.project_id, \
		COALESCE(sessions.title, ''), messages_fts.role, \
		snippet(messages_fts, 3, '', '', '…', 16) \
		FROM messages_fts \
		LEFT JOIN sessions ON sessions.id = messages_fts.session_id \
		WHERE messages_fts MATCH ?1";

	let map = |row: &rusqlite::Row<'_>| {
		Ok(SearchHit {
			session_id: row.get(0)?,
			project_id: row.get(1)?,
			title: row.get(2)?,
			role: row.get(3)?,
			snippet: row.get(4)?,
		})
	};

	let mut hits = Vec::new();
	match project_id {
		Some(pid) => {
			let sql = format!(
				"{select} AND messages_fts.project_id = ?2 ORDER BY bm25(messages_fts) LIMIT ?3"
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

	fn setup() -> Connection {
		let conn = Connection::open_in_memory().unwrap();
		conn.execute_batch(
			"CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT);
			 CREATE VIRTUAL TABLE messages_fts USING fts5(
				session_id UNINDEXED, project_id UNINDEXED, role, body,
				tokenize = 'porter unicode61');",
		)
		.unwrap();
		conn.execute(
			"INSERT INTO sessions(id, title) VALUES('s1', 'Refactor the indexer')",
			[],
		)
		.unwrap();
		conn.execute("INSERT INTO sessions(id, title) VALUES('s2', NULL)", [])
			.unwrap();
		let rows = [
			("s1", "p1", "user", "please refactor the sqlite indexer for speed"),
			("s1", "p1", "assistant", "I rewrote the indexer to batch inserts"),
			("s2", "p2", "user", "how does the terminal pty work on linux"),
		];
		for (sid, pid, role, body) in rows {
			conn.execute(
				"INSERT INTO messages_fts(session_id, project_id, role, body) VALUES(?1,?2,?3,?4)",
				params![sid, pid, role, body],
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
	fn finds_matches_and_joins_title() {
		let conn = setup();
		let hits = search(&conn, "indexer", None, 50).unwrap();
		assert_eq!(hits.len(), 2, "two messages mention 'indexer'");
		assert!(hits.iter().all(|h| h.session_id == "s1"));
		assert!(hits.iter().all(|h| h.title == "Refactor the indexer"));
		assert!(hits.iter().any(|h| h.snippet.contains("indexer")));
	}

	#[test]
	fn project_filter_restricts_results() {
		let conn = setup();
		assert!(!search(&conn, "the", Some("p1"), 50).unwrap().is_empty());
		let p2 = search(&conn, "terminal", Some("p2"), 50).unwrap();
		assert_eq!(p2.len(), 1);
		assert_eq!(p2[0].session_id, "s2");
		assert_eq!(p2[0].title, "", "NULL title coalesces to empty string");
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
