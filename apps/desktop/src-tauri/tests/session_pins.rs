//! A pinned session leads its project's list whatever recency says (F2,
//! migration 0015).
//!
//! Three properties, and the second is the one that is easy to get wrong: the
//! sort key is the *group's* pin, not the row's. `groupSessions` in the renderer
//! nests and never sorts, so a pinned parent whose sub-agents were left in
//! recency order would be drawn with rows nested under a session they do not
//! belong to.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use factorai_lib::commands::projects::add_project_in;
use factorai_lib::commands::sessions::list_sessions_in;
use factorai_lib::db::Db;
use factorai_lib::services::indexer::Indexer;
use factorai_lib::services::sessions::set_pinned;
use rusqlite::params;
use tempfile::TempDir;

fn open_db(tmp: &Path) -> Db {
	Db::open(&tmp.join("data")).expect("open db")
}

fn make_indexer(db: Db, claude_dir: PathBuf) -> Indexer {
	Indexer::with_callbacks(db, claude_dir, Arc::new(|_| {}), Arc::new(|_| {}))
}

/// One transcript under `~/.claude/projects/<encoded>/`, timestamped so the
/// tests can order sessions by recency without sleeping.
fn write_session(claude_dir: &Path, cwd: &Path, session_id: &str, stamp: &str) {
	let encoded = format!("-{}", cwd.to_string_lossy().trim_start_matches('/').replace('/', "-"));
	let dir = claude_dir.join("projects").join(&encoded);
	std::fs::create_dir_all(&dir).expect("mkdir project");
	let cwd = cwd.to_string_lossy();
	std::fs::write(
		dir.join(format!("{session_id}.jsonl")),
		format!(
			r#"{{"type":"user","uuid":"u1","timestamp":"{stamp}","cwd":"{cwd}","message":{{"role":"user","content":"hello"}}}}"#
		),
	)
	.expect("write session");
}

/// A sub-agent transcript, which lives nested under the session that spawned it.
fn write_subagent(claude_dir: &Path, cwd: &Path, parent: &str, agent_id: &str, stamp: &str) {
	let encoded = format!("-{}", cwd.to_string_lossy().trim_start_matches('/').replace('/', "-"));
	let dir = claude_dir.join("projects").join(&encoded).join(parent).join("subagents");
	std::fs::create_dir_all(&dir).expect("mkdir subagents");
	let cwd = cwd.to_string_lossy();
	std::fs::write(
		dir.join(format!("{agent_id}.jsonl")),
		format!(
			r#"{{"type":"user","uuid":"u1","timestamp":"{stamp}","cwd":"{cwd}","message":{{"role":"user","content":"go"}}}}"#
		),
	)
	.expect("write subagent");
}

const OLD: &str = "11111111-1111-4111-8111-111111111111";
const NEW: &str = "22222222-2222-4222-8222-222222222222";
const AGENT: &str = "agent-33333333-3333-4333-8333-333333333333";

/// A project with two sessions — `OLD` touched first, `NEW` last — and a
/// sub-agent under `OLD`.
fn fixture(tmp: &Path) -> (Db, String) {
	let claude = tmp.join("claude");
	let cwd = tmp.join("repo");
	std::fs::create_dir_all(&cwd).expect("mkdir repo");
	// Canonicalised so the encoded transcript path and the added project resolve
	// to the same real path — on macOS the temp dir sits behind the
	// `/var -> /private/var` symlink, and a raw cwd leaves the two disagreeing so
	// the scan links nothing.
	let cwd = cwd.canonicalize().expect("canonicalize repo");
	write_session(&claude, &cwd, OLD, "2026-01-01T00:00:00Z");
	write_session(&claude, &cwd, NEW, "2026-02-01T00:00:00Z");
	write_subagent(&claude, &cwd, OLD, AGENT, "2026-01-01T00:00:05Z");

	let db = open_db(tmp);
	let project = add_project_in(&db, cwd.to_str().unwrap()).expect("add project");
	make_indexer(db.clone(), claude).full_scan().expect("scan");
	(db, project.id)
}

fn ids(db: &Db, project_id: &str) -> Vec<String> {
	db.with(|conn| list_sessions_in(conn, project_id))
		.expect("list sessions")
		.into_iter()
		.map(|s| s.id)
		.collect()
}

#[test]
fn a_pinned_session_leads_the_list_even_when_it_is_the_stalest() {
	let tmp = TempDir::new().unwrap();
	let (db, project_id) = fixture(tmp.path());

	// Recency alone: the newer session first, then the older one with its agent.
	assert_eq!(ids(&db, &project_id), vec![NEW.to_string(), OLD.to_string(), AGENT.to_string()]);

	let changed = set_pinned(&db, OLD, true, 1_700_000_000_000).expect("pin");
	assert_eq!(
		changed.as_deref(),
		Some(project_id.as_str()),
		"the project whose list changed comes back, for the event the command emits"
	);

	// **The sub-agent travels with its pinned parent.** Its own row is unpinned —
	// `pinned` is the row's own bit — and it still sorts inside the group.
	let sessions = db.with(|conn| list_sessions_in(conn, &project_id)).expect("list");
	let order: Vec<&str> = sessions.iter().map(|s| s.id.as_str()).collect();
	assert_eq!(order, vec![OLD, AGENT, NEW]);
	assert!(sessions[0].pinned, "the pinned session says so on the wire");
	assert!(!sessions[1].pinned, "a sub-agent is never pinned itself");
	assert!(!sessions[2].pinned);

	// Unpinning puts recency back, and is idempotent.
	set_pinned(&db, OLD, false, 1_700_000_001_000).expect("unpin");
	set_pinned(&db, OLD, false, 1_700_000_002_000).expect("unpin again");
	assert_eq!(ids(&db, &project_id), vec![NEW.to_string(), OLD.to_string(), AGENT.to_string()]);
}

#[test]
fn pinning_twice_keeps_the_first_timestamp() {
	// A double-click must not reset "since when", which is the only thing
	// `pinned_at` is for.
	let tmp = TempDir::new().unwrap();
	let (db, _project_id) = fixture(tmp.path());

	set_pinned(&db, OLD, true, 1_700_000_000_000).expect("pin");
	set_pinned(&db, OLD, true, 1_700_000_999_000).expect("pin again");

	let at: i64 = db
		.with(|conn| {
			Ok(conn.query_row(
				"SELECT pinned_at FROM session_pins WHERE session_id = ?1",
				params![OLD],
				|r| r.get(0),
			)?)
		})
		.expect("read pin");
	assert_eq!(at, 1_700_000_000_000);
}

#[test]
fn deleting_the_session_row_takes_its_pin_with_it() {
	// The foreign key is the whole of a pin's lifetime — `delete_session` and the
	// indexer's reap both remove the `sessions` row, and neither knows about this
	// table. `PRAGMA foreign_keys` is ON per connection, which is what makes the
	// cascade real rather than decorative.
	let tmp = TempDir::new().unwrap();
	let (db, _project_id) = fixture(tmp.path());
	set_pinned(&db, OLD, true, 1_700_000_000_000).expect("pin");

	db.with_mut(|conn| {
		conn.execute("DELETE FROM sessions WHERE id = ?1", params![OLD])?;
		Ok(())
	})
	.expect("delete session row");

	let pins: i64 = db
		.with(|conn| Ok(conn.query_row("SELECT COUNT(*) FROM session_pins", [], |r| r.get(0))?))
		.expect("count pins");
	assert_eq!(pins, 0);
}

#[test]
fn a_session_that_is_not_indexed_cannot_be_pinned() {
	// The renderer draws live-but-unindexed rows from its own store (ADR-0008).
	// A pin there would be a mark you believe you made on a row that has nowhere
	// to keep it, so it is an error rather than a silent no-op.
	let tmp = TempDir::new().unwrap();
	let (db, _project_id) = fixture(tmp.path());

	let err = set_pinned(&db, "44444444-4444-4444-8444-444444444444", true, 1_700_000_000_000)
		.expect_err("no such session");
	assert!(format!("{err}").contains("no indexed session"), "got {err}");
}
