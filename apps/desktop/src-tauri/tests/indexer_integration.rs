//! Integration tests for the indexer. Each test builds a synthetic Claude
//! home directory in a tempdir, runs a scan, and asserts the SQLite state.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use factorai_lib::db::Db;
use factorai_lib::models::SessionsChanged;
use factorai_lib::services::indexer::Indexer;
use rusqlite::params;
use tempfile::TempDir;

/// Write a synthetic .jsonl session file with the given event JSON strings,
/// one per line. Returns the file path.
fn write_session(project_dir: &Path, session_id: &str, lines: &[&str]) -> PathBuf {
	let path = project_dir.join(format!("{session_id}.jsonl"));
	std::fs::write(&path, lines.join("\n")).expect("write session");
	path
}

/// Construct a fake Claude home with one project and one session.
/// Returns (claude_dir, encoded_project_id, session_id).
fn fixture_one_session(tmp: &Path, cwd: &str) -> (PathBuf, String, String) {
	let claude_dir = tmp.join(".claude");
	let projects_dir = claude_dir.join("projects");
	let encoded = cwd.trim_start_matches('/').replace('/', "-");
	let encoded = format!("-{encoded}");
	let project_dir = projects_dir.join(&encoded);
	std::fs::create_dir_all(&project_dir).expect("mkdir project");

	let session_id = "11111111-2222-3333-4444-555555555555";
	let user_msg = format!(
		r#"{{"type":"user","uuid":"u1","timestamp":"2026-01-01T00:00:00Z","cwd":"{cwd}","message":{{"role":"user","content":"Help me with React hooks"}}}}"#
	);
	let assistant_msg = format!(
		r#"{{"type":"assistant","uuid":"a1","parentUuid":"u1","timestamp":"2026-01-01T00:00:05Z","cwd":"{cwd}","message":{{"role":"assistant","content":[{{"type":"text","text":"Sure, here's a useEffect example"}}]}}}}"#
	);
	write_session(&project_dir, session_id, &[&user_msg, &assistant_msg]);
	(claude_dir, encoded, session_id.to_string())
}

fn make_indexer(db: Db, claude_dir: PathBuf) -> (Indexer, Arc<Mutex<Vec<SessionsChanged>>>) {
	let changes: Arc<Mutex<Vec<SessionsChanged>>> = Arc::new(Mutex::new(Vec::new()));
	let changes_clone = changes.clone();
	let idx = Indexer::with_callbacks(
		db,
		claude_dir,
		Arc::new(|_| {}),
		Arc::new(move |s| changes_clone.lock().unwrap().push(s)),
	);
	(idx, changes)
}

fn open_db(tmp: &Path) -> Db {
	Db::open(&tmp.join("data")).expect("open db")
}

#[test]
fn scan_creates_project_and_session_rows() {
	let tmp = TempDir::new().unwrap();
	let (claude_dir, encoded, session_id) =
		fixture_one_session(tmp.path(), "/Users/alice/code/foo");
	let db = open_db(tmp.path());
	let (indexer, _changes) = make_indexer(db.clone(), claude_dir);

	indexer.full_scan().expect("scan");

	db.with(|conn| {
		let (real_path, display_name, session_count): (Option<String>, String, i64) = conn
			.query_row(
				"SELECT real_path, display_name, session_count FROM projects WHERE id = ?1",
				params![&encoded],
				|row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
			)
			.expect("project row");
		assert_eq!(real_path.as_deref(), Some("/Users/alice/code/foo"));
		assert_eq!(display_name, "foo");
		assert_eq!(session_count, 1);

		let (title, turn_count, cwd): (String, i64, Option<String>) = conn
			.query_row(
				"SELECT title, turn_count, cwd FROM sessions WHERE id = ?1",
				params![&session_id],
				|row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
			)
			.expect("session row");
		assert_eq!(title, "Help me with React hooks");
		assert_eq!(turn_count, 2);
		assert_eq!(cwd.as_deref(), Some("/Users/alice/code/foo"));
		Ok(())
	})
	.unwrap();
}

#[test]
fn fts_rows_inserted_for_indexed_messages() {
	let tmp = TempDir::new().unwrap();
	let (claude_dir, _encoded, session_id) =
		fixture_one_session(tmp.path(), "/Users/alice/code/foo");
	let db = open_db(tmp.path());
	let (indexer, _) = make_indexer(db.clone(), claude_dir);

	indexer.full_scan().expect("scan");

	db.with(|conn| {
		let count: i64 = conn
			.query_row(
				"SELECT COUNT(*) FROM messages_fts WHERE session_id = ?1",
				params![&session_id],
				|row| row.get(0),
			)
			.unwrap();
		assert_eq!(count, 2, "expected 2 fts rows (user + assistant)");

		// Search by content.
		let hits: i64 = conn
			.query_row(
				"SELECT COUNT(*) FROM messages_fts WHERE messages_fts MATCH 'React'",
				[],
				|row| row.get(0),
			)
			.unwrap();
		assert_eq!(hits, 1);
		Ok(())
	})
	.unwrap();
}

#[test]
fn unchanged_session_is_skipped_on_rescan() {
	let tmp = TempDir::new().unwrap();
	let (claude_dir, encoded, _) = fixture_one_session(tmp.path(), "/Users/alice/code/foo");
	let db = open_db(tmp.path());
	let (indexer, changes) = make_indexer(db.clone(), claude_dir);

	indexer.full_scan().expect("first scan");
	let after_first = changes.lock().unwrap().len();
	assert_eq!(after_first, 1, "first scan reports one changed session");

	indexer.full_scan().expect("second scan");
	let after_second = changes.lock().unwrap().len();
	assert_eq!(
		after_second, after_first,
		"rescan with unchanged files should emit no further sessions:changed"
	);

	// Aggregate refresh still ran (no harm), but session_count stays 1.
	db.with(|conn| {
		let n: i64 = conn
			.query_row(
				"SELECT session_count FROM projects WHERE id = ?1",
				params![&encoded],
				|row| row.get(0),
			)
			.unwrap();
		assert_eq!(n, 1);
		Ok(())
	})
	.unwrap();
}

#[test]
fn appending_to_session_triggers_reindex() {
	let tmp = TempDir::new().unwrap();
	let (claude_dir, encoded, session_id) =
		fixture_one_session(tmp.path(), "/Users/alice/code/foo");
	let db = open_db(tmp.path());
	let (indexer, _) = make_indexer(db.clone(), claude_dir.clone());

	indexer.full_scan().expect("first scan");

	// Append another assistant turn.
	let project_dir = claude_dir.join("projects").join(&encoded);
	let path = project_dir.join(format!("{session_id}.jsonl"));
	let current = std::fs::read_to_string(&path).unwrap();
	let next = format!(
		"{current}\n{}",
		r#"{"type":"assistant","uuid":"a2","parentUuid":"a1","timestamp":"2026-01-01T00:00:10Z","message":{"role":"assistant","content":"second reply"}}"#
	);
	// Bump mtime by writing through std (filesystems update mtime on write).
	std::fs::write(&path, next).unwrap();
	// Sleep briefly so mtime differs from the prior scan on coarse filesystems.
	std::thread::sleep(std::time::Duration::from_millis(20));
	// Touch by writing the same content again — guarantees the mtime change.
	let again = std::fs::read_to_string(&path).unwrap();
	std::fs::write(&path, again).unwrap();

	indexer.full_scan().expect("second scan");

	db.with(|conn| {
		let n: i64 = conn
			.query_row(
				"SELECT turn_count FROM sessions WHERE id = ?1",
				params![&session_id],
				|row| row.get(0),
			)
			.unwrap();
		assert_eq!(n, 3, "reindex should reflect appended event");
		Ok(())
	})
	.unwrap();
}

#[test]
fn missing_claude_projects_dir_is_handled() {
	let tmp = TempDir::new().unwrap();
	// No projects dir created.
	let db = open_db(tmp.path());
	let (indexer, _) = make_indexer(db, tmp.path().join("nonexistent_claude_home"));
	// Should return Ok(()), not panic.
	indexer.full_scan().expect("scan handles missing dir");
}

#[test]
fn malformed_jsonl_line_is_skipped_not_fatal() {
	let tmp = TempDir::new().unwrap();
	let claude_dir = tmp.path().join(".claude");
	let project_dir = claude_dir.join("projects").join("-tmp-test");
	std::fs::create_dir_all(&project_dir).unwrap();

	let session_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
	let good = r#"{"type":"user","uuid":"u1","timestamp":"2026-01-01T00:00:00Z","message":{"role":"user","content":"hi"}}"#;
	let bad = r#"{this is not valid json"#;
	let good2 = r#"{"type":"assistant","uuid":"a1","timestamp":"2026-01-01T00:00:01Z","message":{"role":"assistant","content":"reply"}}"#;
	write_session(&project_dir, session_id, &[good, bad, good2]);

	let db = open_db(tmp.path());
	let (indexer, _) = make_indexer(db.clone(), claude_dir);
	indexer.full_scan().expect("scan");

	db.with(|conn| {
		let n: i64 = conn
			.query_row(
				"SELECT turn_count FROM sessions WHERE id = ?1",
				params![&session_id],
				|row| row.get(0),
			)
			.unwrap();
		assert_eq!(n, 2, "two valid events, malformed line skipped");
		Ok(())
	})
	.unwrap();
}

/// Pinning is stored in the projects table, and a later scan must not undo it.
///
/// The upsert on re-scan sets `real_path` and `display_name` only — if it ever
/// grows to rewrite the whole row, every pin in the sidebar silently clears on
/// the next file change (specs/05-features.md F1).
#[test]
fn a_pinned_project_stays_pinned_across_a_rescan() {
	let tmp = TempDir::new().unwrap();
	let (claude_dir, encoded, _session_id) =
		fixture_one_session(tmp.path(), "/Users/alice/code/foo");
	let db = open_db(tmp.path());
	let (indexer, _changes) = make_indexer(db.clone(), claude_dir.clone());
	indexer.full_scan().expect("first scan");

	db.with(|conn| {
		conn.execute("UPDATE projects SET pinned = 1 WHERE id = ?1", params![&encoded])?;
		Ok(())
	})
	.expect("pin");

	// A second scan re-runs the same upsert against an existing row.
	indexer.full_scan().expect("second scan");

	db.with(|conn| {
		let pinned: i64 = conn
			.query_row("SELECT pinned FROM projects WHERE id = ?1", params![&encoded], |row| {
				row.get(0)
			})
			.expect("project row");
		assert_eq!(pinned, 1, "re-scanning must not clear a pin");
		Ok(())
	})
	.expect("read back");
}

/// Hiding, like pinning, is stored on the row and must survive a rescan. The
/// user hid the project; a background scan noticing its files still exist is
/// not a reason to overrule that (specs/05-features.md F1).
#[test]
fn a_hidden_project_stays_hidden_across_a_rescan() {
	let tmp = TempDir::new().unwrap();
	let (claude_dir, encoded, _session_id) =
		fixture_one_session(tmp.path(), "/Users/alice/code/foo");
	let db = open_db(tmp.path());
	let (indexer, _changes) = make_indexer(db.clone(), claude_dir.clone());
	indexer.full_scan().expect("first scan");

	db.with(|conn| {
		conn.execute("UPDATE projects SET hidden = 1 WHERE id = ?1", params![&encoded])?;
		Ok(())
	})
	.expect("hide");

	indexer.full_scan().expect("second scan");

	db.with(|conn| {
		let hidden: i64 = conn
			.query_row("SELECT hidden FROM projects WHERE id = ?1", params![&encoded], |row| {
				row.get(0)
			})
			.expect("project row");
		assert_eq!(hidden, 1, "re-scanning must not clear a hidden flag");
		Ok(())
	})
	.expect("read back");
}

/// `list_projects` orders pinned first, and only then by recency — the sidebar
/// leans on this for its pinned block.
#[test]
fn pinned_projects_sort_ahead_of_more_recent_ones() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());

	db.with(|conn| {
		conn.execute(
			"INSERT INTO projects(id, real_path, display_name, last_session_at, session_count, pinned)
			 VALUES('-old', '/code/old', 'old', 100, 1, 1),
			       ('-new', '/code/new', 'new', 900, 1, 0)",
			[],
		)?;
		Ok(())
	})
	.expect("seed");

	let ordered: Vec<String> = db
		.with(|conn| {
			let mut stmt = conn.prepare(
				"SELECT id FROM projects
				 ORDER BY pinned DESC, COALESCE(last_session_at, 0) DESC, display_name ASC",
			)?;
			let rows = stmt
				.query_map([], |row| row.get::<_, String>(0))?
				.collect::<rusqlite::Result<Vec<_>>>()?;
			Ok(rows)
		})
		.expect("query");

	// The stale-but-pinned project wins over the freshly-used one.
	assert_eq!(ordered, vec!["-old".to_string(), "-new".to_string()]);
}

/// `/rename` writes a `custom-title` line; that name is the user's own choice
/// and outranks Claude's generated `ai-title`, whatever order they appear in
/// (specs/05-features.md F2).
///
/// Record shapes taken from real session files, not invented:
///   {"type":"ai-title","aiTitle":"…","sessionId":"…"}
///   {"type":"custom-title","customTitle":"…","sessionId":"…"}
#[test]
fn a_renamed_session_keeps_the_name_the_user_chose() {
	let tmp = TempDir::new().unwrap();
	let claude_dir = tmp.path().join(".claude");
	let project_dir = claude_dir.join("projects").join("-code-foo");
	std::fs::create_dir_all(&project_dir).unwrap();
	let session_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

	write_session(
		&project_dir,
		session_id,
		&[
			r#"{"type":"user","uuid":"u1","timestamp":"2026-01-01T00:00:00Z","cwd":"/code/foo","message":{"role":"user","content":"first thing I said"}}"#,
			// Claude names it, then the user renames it, then Claude renames it
			// again — which happens, and must not win.
			&format!(r#"{{"type":"ai-title","aiTitle":"Some generated name","sessionId":"{session_id}"}}"#),
            &format!(r#"{{"type":"custom-title","customTitle":"Deploy storybook in staging","sessionId":"{session_id}"}}"#),
			&format!(r#"{{"type":"ai-title","aiTitle":"A later generated name","sessionId":"{session_id}"}}"#),
		],
	);

	let db = open_db(tmp.path());
	let (indexer, _changes) = make_indexer(db.clone(), claude_dir);
	indexer.full_scan().expect("scan");

	db.with(|conn| {
		let title: String = conn
			.query_row("SELECT title FROM sessions WHERE id = ?1", params![session_id], |row| {
				row.get(0)
			})
			.expect("session row");
		assert_eq!(title, "Deploy storybook in staging");
		Ok(())
	})
	.expect("read back");
}

/// The most recent rename wins — renaming twice leaves the second name.
#[test]
fn the_latest_rename_is_the_one_that_shows() {
	let tmp = TempDir::new().unwrap();
	let claude_dir = tmp.path().join(".claude");
	let project_dir = claude_dir.join("projects").join("-code-foo");
	std::fs::create_dir_all(&project_dir).unwrap();
	let session_id = "11112222-3333-4444-5555-666677778888";

	write_session(
		&project_dir,
		session_id,
		&[
			r#"{"type":"user","uuid":"u1","timestamp":"2026-01-01T00:00:00Z","cwd":"/code/foo","message":{"role":"user","content":"hello"}}"#,
			&format!(r#"{{"type":"custom-title","customTitle":"First name","sessionId":"{session_id}"}}"#),
			&format!(r#"{{"type":"custom-title","customTitle":"Second name","sessionId":"{session_id}"}}"#),
		],
	);

	let db = open_db(tmp.path());
	let (indexer, _changes) = make_indexer(db.clone(), claude_dir);
	indexer.full_scan().expect("scan");

	db.with(|conn| {
		let title: String = conn
			.query_row("SELECT title FROM sessions WHERE id = ?1", params![session_id], |row| {
				row.get(0)
			})
			.expect("session row");
		assert_eq!(title, "Second name");
		Ok(())
	})
	.expect("read back");
}

/// An empty rename is not a name: fall through rather than showing a blank row.
#[test]
fn an_empty_custom_title_falls_back_instead_of_blanking_the_row() {
	let tmp = TempDir::new().unwrap();
	let claude_dir = tmp.path().join(".claude");
	let project_dir = claude_dir.join("projects").join("-code-foo");
	std::fs::create_dir_all(&project_dir).unwrap();
	let session_id = "99998888-7777-6666-5555-444433332222";

	write_session(
		&project_dir,
		session_id,
		&[
			r#"{"type":"user","uuid":"u1","timestamp":"2026-01-01T00:00:00Z","cwd":"/code/foo","message":{"role":"user","content":"what I actually asked"}}"#,
			&format!(r#"{{"type":"custom-title","customTitle":"   ","sessionId":"{session_id}"}}"#),
		],
	);

	let db = open_db(tmp.path());
	let (indexer, _changes) = make_indexer(db.clone(), claude_dir);
	indexer.full_scan().expect("scan");

	db.with(|conn| {
		let title: String = conn
			.query_row("SELECT title FROM sessions WHERE id = ?1", params![session_id], |row| {
				row.get(0)
			})
			.expect("session row");
		assert_eq!(title, "what I actually asked");
		Ok(())
	})
	.expect("read back");
}
