//! Integration tests for the indexer. Each test builds a synthetic Claude
//! home directory in a tempdir, runs a scan, and asserts the SQLite state.
//!
//! Since ADR-0011 the scan only parses folders that are **in the workspace**,
//! so every fixture here adds the folder first. That is not ceremony — it is
//! the behaviour under test in `a_scan_never_adds_a_project_you_did_not_ask_for`
//! over in `add_project_integration.rs`. The folders are real directories under
//! the tempdir rather than invented paths like `/Users/alice/…`, because adding
//! one now canonicalizes it.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use factorai_lib::commands::projects::{add_project_in, list_projects_in};
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

/// A real folder under the tempdir, canonicalized the way `add_project` will.
fn make_folder(tmp: &Path, name: &str) -> PathBuf {
	let dir = tmp.join("code").join(name);
	std::fs::create_dir_all(&dir).expect("mkdir folder");
	dir.canonicalize().expect("canonicalize")
}

/// Claude's store directory for a folder.
fn store_dir(claude_dir: &Path, cwd: &Path) -> PathBuf {
	let encoded = format!("-{}", cwd.to_string_lossy().trim_start_matches('/').replace('/', "-"));
	let dir = claude_dir.join("projects").join(encoded);
	std::fs::create_dir_all(&dir).expect("mkdir store");
	dir
}

/// Construct a fake Claude home with one project and one session, and put the
/// folder in the workspace. Returns (claude_dir, cwd, store_dir, session_id).
fn fixture_one_session(tmp: &Path, db: &Db) -> (PathBuf, PathBuf, PathBuf, String) {
	let claude_dir = tmp.join(".claude");
	let cwd = make_folder(tmp, "foo");
	let project_dir = store_dir(&claude_dir, &cwd);

	let session_id = "11111111-2222-3333-4444-555555555555";
	let cwd_str = cwd.to_string_lossy();
	let user_msg = format!(
		r#"{{"type":"user","uuid":"u1","timestamp":"2026-01-01T00:00:00Z","cwd":"{cwd_str}","message":{{"role":"user","content":"Help me with React hooks"}}}}"#
	);
	let assistant_msg = format!(
		r#"{{"type":"assistant","uuid":"a1","parentUuid":"u1","timestamp":"2026-01-01T00:00:05Z","cwd":"{cwd_str}","message":{{"role":"assistant","content":[{{"type":"text","text":"Sure, here's a useEffect example"}}]}}}}"#
	);
	write_session(&project_dir, session_id, &[&user_msg, &assistant_msg]);
	add_project_in(db, cwd.to_str().unwrap()).expect("add project");
	(claude_dir, cwd, project_dir, session_id.to_string())
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

/// Rows and FTS entries for one session id, as the reap tests read them back.
fn counts(db: &Db, session_id: &str) -> (i64, i64) {
	db.with(|conn| {
		let rows: i64 = conn.query_row(
			"SELECT COUNT(*) FROM sessions WHERE id = ?1",
			params![session_id],
			|r| r.get(0),
		)?;
		let fts: i64 = conn.query_row(
			"SELECT COUNT(*) FROM messages_fts WHERE session_id = ?1",
			params![session_id],
			|r| r.get(0),
		)?;
		Ok((rows, fts))
	})
	.expect("counts")
}

/// The one project row, as `list_projects` would return it.
fn only_project(db: &Db) -> factorai_lib::models::Project {
	let mut all = db
		.with(factorai_lib::commands::projects::list_projects_in)
		.expect("list");
	assert_eq!(all.len(), 1, "expected exactly one project");
	all.remove(0)
}

#[test]
fn scan_indexes_the_sessions_of_a_folder_in_the_workspace() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let (claude_dir, cwd, _store, session_id) = fixture_one_session(tmp.path(), &db);
	let (indexer, _changes) = make_indexer(db.clone(), claude_dir);

	indexer.full_scan().expect("scan");

	let project = only_project(&db);
	assert_eq!(project.real_path, cwd.to_str().unwrap());
	assert_eq!(project.display_name, "foo");
	assert_eq!(project.session_count, 1);

	db.with(|conn| {
		let (title, turn_count, session_cwd): (String, i64, Option<String>) = conn
			.query_row(
				"SELECT title, turn_count, cwd FROM sessions WHERE id = ?1",
				params![&session_id],
				|row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
			)
			.expect("session row");
		assert_eq!(title, "Help me with React hooks");
		assert_eq!(turn_count, 2);
		assert_eq!(session_cwd.as_deref(), cwd.to_str());
		Ok(())
	})
	.unwrap();
}

#[test]
fn fts_rows_inserted_for_indexed_messages() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let (claude_dir, _cwd, _store, session_id) = fixture_one_session(tmp.path(), &db);
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
	let db = open_db(tmp.path());
	let (claude_dir, _cwd, _store, _sid) = fixture_one_session(tmp.path(), &db);
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

	assert_eq!(only_project(&db).session_count, 1);
}

/// The `sessions:changed` payload carries the **workspace** project id, since
/// that is what the renderer keys its caches by. A store directory name would
/// invalidate nothing.
#[test]
fn sessions_changed_names_the_workspace_project() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let (claude_dir, _cwd, _store, _sid) = fixture_one_session(tmp.path(), &db);
	let (indexer, changes) = make_indexer(db.clone(), claude_dir);

	indexer.full_scan().expect("scan");

	let expected = only_project(&db).id;
	let seen = changes.lock().unwrap();
	assert_eq!(seen.len(), 1);
	assert_eq!(seen[0].project_id, expected);
}

#[test]
fn appending_to_session_triggers_reindex() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let (claude_dir, _cwd, store, session_id) = fixture_one_session(tmp.path(), &db);
	let (indexer, _) = make_indexer(db.clone(), claude_dir);

	indexer.full_scan().expect("first scan");

	// Append another assistant turn.
	let path = store.join(format!("{session_id}.jsonl"));
	let current = std::fs::read_to_string(&path).unwrap();
	let next = format!(
		"{current}\n{}",
		r#"{"type":"assistant","uuid":"a2","parentUuid":"a1","timestamp":"2026-01-01T00:00:10Z","message":{"role":"assistant","content":"second reply"}}"#
	);
	std::fs::write(&path, next).unwrap();
	// Sleep briefly so mtime differs from the prior scan on coarse filesystems.
	std::thread::sleep(std::time::Duration::from_millis(20));
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
	let db = open_db(tmp.path());
	let claude_dir = tmp.path().join(".claude");
	let cwd = make_folder(tmp.path(), "malformed");
	let project_dir = store_dir(&claude_dir, &cwd);

	let session_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
	let cwd_str = cwd.to_string_lossy();
	let good = format!(
		r#"{{"type":"user","uuid":"u1","timestamp":"2026-01-01T00:00:00Z","cwd":"{cwd_str}","message":{{"role":"user","content":"hi"}}}}"#
	);
	let bad = r#"{this is not valid json"#;
	let good2 = r#"{"type":"assistant","uuid":"a1","timestamp":"2026-01-01T00:00:01Z","message":{"role":"assistant","content":"reply"}}"#;
	write_session(&project_dir, session_id, &[&good, bad, good2]);
	add_project_in(&db, cwd.to_str().unwrap()).expect("add");

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

/// Pinning is a workspace decision, and the scan has no business touching it.
///
/// Under the old model this was a live risk: the indexer upserted the very row
/// that held the pin, so one careless column in that `ON CONFLICT` cleared
/// every pin in the sidebar. It now writes a different table entirely, and this
/// test is what keeps that true (specs/05-features.md F1).
#[test]
fn a_pinned_project_stays_pinned_across_a_rescan() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let (claude_dir, _cwd, _store, _sid) = fixture_one_session(tmp.path(), &db);
	let (indexer, _changes) = make_indexer(db.clone(), claude_dir);
	indexer.full_scan().expect("first scan");

	let id = only_project(&db).id;
	db.with(|conn| {
		conn.execute("UPDATE projects SET pinned = 1 WHERE id = ?1", params![&id])?;
		Ok(())
	})
	.expect("pin");

	indexer.full_scan().expect("second scan");

	assert!(only_project(&db).pinned, "re-scanning must not clear a pin");
}

/// `list_projects` orders pinned first, and only then by recency — the sidebar
/// leans on this for its pinned block.
#[test]
fn pinned_projects_sort_ahead_of_more_recent_ones() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let old = make_folder(tmp.path(), "old");
	let new = make_folder(tmp.path(), "new");

	let old_id = add_project_in(&db, old.to_str().unwrap()).expect("add old").id;
	add_project_in(&db, new.to_str().unwrap()).expect("add new");

	// Give each a session, so recency is a real ordering signal, then pin the
	// staler one.
	db.with_mut(|conn| {
		conn.execute("UPDATE projects SET pinned = 1 WHERE id = ?1", params![&old_id])?;
		conn.execute(
			"INSERT INTO sessions(id, discovered_id, title, created_at, updated_at, file_mtime, file_size)
			 SELECT 's-' || d.id, d.id, 't', 0, CASE WHEN d.project_id = ?1 THEN 100 ELSE 900 END, 0, 0
			 FROM discovered_projects d",
			params![&old_id],
		)?;
		Ok(())
	})
	.expect("seed");

	let ordered: Vec<String> = db
		.with(factorai_lib::commands::projects::list_projects_in)
		.expect("list")
		.into_iter()
		.map(|p| p.display_name)
		.collect();

	// The stale-but-pinned project wins over the freshly-used one.
	assert_eq!(ordered, vec!["old".to_string(), "new".to_string()]);
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
	let db = open_db(tmp.path());
	let claude_dir = tmp.path().join(".claude");
	let cwd = make_folder(tmp.path(), "renamed");
	let project_dir = store_dir(&claude_dir, &cwd);
	let session_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
	let cwd_str = cwd.to_string_lossy();

	write_session(
		&project_dir,
		session_id,
		&[
			&format!(r#"{{"type":"user","uuid":"u1","timestamp":"2026-01-01T00:00:00Z","cwd":"{cwd_str}","message":{{"role":"user","content":"first thing I said"}}}}"#),
			// Claude names it, then the user renames it, then Claude renames it
			// again — which happens, and must not win.
			&format!(r#"{{"type":"ai-title","aiTitle":"Some generated name","sessionId":"{session_id}"}}"#),
			&format!(r#"{{"type":"custom-title","customTitle":"Deploy storybook in staging","sessionId":"{session_id}"}}"#),
			&format!(r#"{{"type":"ai-title","aiTitle":"A later generated name","sessionId":"{session_id}"}}"#),
		],
	);
	add_project_in(&db, cwd.to_str().unwrap()).expect("add");

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
	let db = open_db(tmp.path());
	let claude_dir = tmp.path().join(".claude");
	let cwd = make_folder(tmp.path(), "twice");
	let project_dir = store_dir(&claude_dir, &cwd);
	let session_id = "11112222-3333-4444-5555-666677778888";
	let cwd_str = cwd.to_string_lossy();

	write_session(
		&project_dir,
		session_id,
		&[
			&format!(r#"{{"type":"user","uuid":"u1","timestamp":"2026-01-01T00:00:00Z","cwd":"{cwd_str}","message":{{"role":"user","content":"hello"}}}}"#),
			&format!(r#"{{"type":"custom-title","customTitle":"First name","sessionId":"{session_id}"}}"#),
			&format!(r#"{{"type":"custom-title","customTitle":"Second name","sessionId":"{session_id}"}}"#),
		],
	);
	add_project_in(&db, cwd.to_str().unwrap()).expect("add");

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
	let db = open_db(tmp.path());
	let claude_dir = tmp.path().join(".claude");
	let cwd = make_folder(tmp.path(), "blank");
	let project_dir = store_dir(&claude_dir, &cwd);
	let session_id = "99998888-7777-6666-5555-444433332222";
	let cwd_str = cwd.to_string_lossy();

	write_session(
		&project_dir,
		session_id,
		&[
			&format!(r#"{{"type":"user","uuid":"u1","timestamp":"2026-01-01T00:00:00Z","cwd":"{cwd_str}","message":{{"role":"user","content":"what I actually asked"}}}}"#),
			&format!(r#"{{"type":"custom-title","customTitle":"   ","sessionId":"{session_id}"}}"#),
		],
	);
	add_project_in(&db, cwd.to_str().unwrap()).expect("add");

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

// ── Reaping transcripts that are gone ────────────────────────────────────────
//
// The index used to be upsert-only, so a deleted transcript stayed in it
// forever: 147 rows against 80 files on the machine this was found on, and a
// search hit that opened an empty new session wearing a long conversation's
// title (ADR-0008 — no transcript means `--session-id`, not `--resume`).

#[test]
fn a_deleted_transcript_is_reaped_from_the_index() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let (claude_dir, _cwd, store, session_id) = fixture_one_session(tmp.path(), &db);
	let (indexer, _) = make_indexer(db.clone(), claude_dir);

	indexer.full_scan().expect("first scan");
	assert_eq!(counts(&db, &session_id), (1, 2), "indexed before the delete");

	std::fs::remove_file(store.join(format!("{session_id}.jsonl"))).expect("rm transcript");
	indexer.full_scan().expect("second scan");

	assert_eq!(
		counts(&db, &session_id),
		(0, 0),
		"the row and its fts entries both go"
	);
	assert_eq!(only_project(&db).session_count, 0);
}

/// A sub-agent transcript is reaped on the same terms — and, more importantly,
/// is *not* reaped while it is still there. Agent rows carry their parent's
/// `discovered_id`, so a reap that only knew about top-level transcripts would
/// delete every one of them on the first scan.
#[test]
fn subagent_rows_survive_a_reap_and_go_when_their_file_does() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let (claude_dir, cwd, project_dir, session_id) = fixture_one_session(tmp.path(), &db);
	let events = subagent_events(cwd.to_str().unwrap());
	let refs: Vec<&str> = events.iter().map(String::as_str).collect();
	let agent_path = write_subagent(&project_dir, &session_id, "agent-1111", &refs);

	let (indexer, _) = make_indexer(db.clone(), claude_dir);
	indexer.full_scan().expect("first scan");
	indexer.full_scan().expect("second scan");
	assert_eq!(
		counts(&db, "agent-1111"),
		(1, 2),
		"a live sub-agent transcript must survive every scan"
	);

	std::fs::remove_file(&agent_path).expect("rm agent transcript");
	indexer.full_scan().expect("third scan");
	assert_eq!(counts(&db, "agent-1111"), (0, 0));
	assert_eq!(counts(&db, &session_id).0, 1, "the parent is untouched");
}

/// An unreadable directory and an empty one are different answers, and only one
/// of them may delete. This is the case that turns a reap into data loss: the
/// whole store going away — Claude uninstalled, `CLAUDE_HOME` pointed
/// elsewhere — must leave the index alone rather than empty it.
#[test]
fn a_vanished_store_reaps_nothing() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let (claude_dir, _cwd, store, session_id) = fixture_one_session(tmp.path(), &db);
	let (indexer, _) = make_indexer(db.clone(), claude_dir);

	indexer.full_scan().expect("first scan");
	std::fs::remove_dir_all(&store).expect("rm store dir");
	indexer.full_scan().expect("second scan");

	assert_eq!(
		counts(&db, &session_id),
		(1, 2),
		"a store we could not read is not a store with nothing in it"
	);
}

/// A session with a PTY behind it keeps its row even if the transcript goes,
/// so a tab you are watching does not lose its title. (The ADR-0008 window —
/// spawned but never messaged — needs no exemption: rows only come from
/// transcripts, so there is nothing to reap yet.)
#[test]
fn a_live_session_is_exempt_from_the_reap() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let (claude_dir, _cwd, store, session_id) = fixture_one_session(tmp.path(), &db);
	let live_id = session_id.clone();
	let (indexer, _) = make_indexer(db.clone(), claude_dir);
	let indexer = indexer.with_live_ids(Arc::new(move || HashSet::from([live_id.clone()])));

	indexer.full_scan().expect("first scan");
	std::fs::remove_file(store.join(format!("{session_id}.jsonl"))).expect("rm transcript");
	indexer.full_scan().expect("second scan");

	assert_eq!(counts(&db, &session_id), (1, 2), "a live session keeps its row");
}

// ── Sub-agent transcripts ────────────────────────────────────────────────────
//
// Claude Code writes each agent a session spawns to
// <session-id>/subagents/agent-*.jsonl inside the project directory. These
// mirror the shapes observed in a real ~/.claude/projects tree.

/// Write a sub-agent transcript under a parent session, with the shapes a
/// real agent file carries: `isSidechain: true` on every event, an `agentId`
/// matching the filename.
fn write_subagent(
	project_dir: &Path,
	parent_id: &str,
	agent_name: &str,
	lines: &[&str],
) -> PathBuf {
	let dir = project_dir.join(parent_id).join("subagents");
	std::fs::create_dir_all(&dir).expect("mkdir subagents");
	let path = dir.join(format!("{agent_name}.jsonl"));
	std::fs::write(&path, lines.join("\n")).expect("write subagent");
	path
}

/// The events a sub-agent transcript opens with, taken from a real file.
fn subagent_events(cwd: &str) -> Vec<String> {
	vec![
		format!(
			r#"{{"parentUuid":null,"isSidechain":true,"promptId":"p1","agentId":"agent-1111","type":"user","timestamp":"2026-08-15T19:02:00Z","cwd":"{cwd}","message":{{"role":"user","content":"Explore the repo"}}}}"#
		),
		format!(
			r#"{{"parentUuid":"u1","isSidechain":true,"agentId":"agent-1111","type":"assistant","timestamp":"2026-08-15T19:03:00Z","cwd":"{cwd}","message":{{"role":"assistant","content":[{{"type":"text","text":"Found it"}}]}}}}"#
		),
	]
}

/// A sub-agent transcript is indexed as a session row under the real project,
/// marked `subagent_of` — and never manufactures a project named after its
/// containing folder.
#[test]
fn subagent_transcripts_are_indexed_under_their_real_project() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let (claude_dir, cwd, project_dir, session_id) = fixture_one_session(tmp.path(), &db);

	let events = subagent_events(cwd.to_str().unwrap());
	let refs: Vec<&str> = events.iter().map(String::as_str).collect();
	write_subagent(&project_dir, &session_id, "agent-1111", &refs);

	let (indexer, _) = make_indexer(db.clone(), claude_dir);
	indexer.full_scan().expect("scan");

	db.with(|conn| {
		// The agent row exists, under the discovery its parent belongs to, and
		// marked. Same directory, not one of its own: that a `subagents/` folder
		// is part of a session rather than a store directory is the whole point.
		let (discovered_id, subagent_of): (i64, Option<String>) = conn
			.query_row(
				"SELECT discovered_id, subagent_of FROM sessions WHERE id = 'agent-1111'",
				[],
				|row| Ok((row.get(0)?, row.get(1)?)),
			)
			.expect("subagent row");
		let parent_discovered: i64 = conn
			.query_row(
				"SELECT discovered_id FROM sessions WHERE id = ?1",
				params![&session_id],
				|row| row.get(0),
			)
			.unwrap();
		assert_eq!(discovered_id, parent_discovered);
		assert_eq!(subagent_of.as_deref(), Some(session_id.as_str()));

		// No discovery — and so no project — was manufactured for the folder the
		// agent transcript sits in.
		let discovered: i64 = conn
			.query_row("SELECT COUNT(*) FROM discovered_projects", [], |row| row.get(0))
			.unwrap();
		assert_eq!(discovered, 1, "the subagent dir must not become a store directory");

		// The project's own count excludes the agent, read through the query the
		// sidebar actually uses.
		let projects = list_projects_in(conn).expect("list projects");
		assert_eq!(projects.len(), 1);
		assert_eq!(
			projects[0].session_count, 1,
			"sub-agents do not count as project sessions"
		);
		Ok(())
	})
	.unwrap();
}

/// The FTS index covers sub-agent transcripts too — search hits inside an
/// agent run land on the agent's row, which the UI can open read-only.
#[test]
fn subagent_messages_are_searchable() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let (claude_dir, cwd, project_dir, session_id) = fixture_one_session(tmp.path(), &db);

	let events = subagent_events(cwd.to_str().unwrap());
	let refs: Vec<&str> = events.iter().map(String::as_str).collect();
	write_subagent(&project_dir, &session_id, "agent-1111", &refs);

	let (indexer, _) = make_indexer(db.clone(), claude_dir);
	indexer.full_scan().expect("scan");

	db.with(|conn| {
		let hits: i64 = conn
			.query_row(
				"SELECT COUNT(*) FROM messages_fts WHERE session_id = 'agent-1111' AND messages_fts MATCH 'Explore'",
				[],
				|row| row.get(0),
			)
			.unwrap();
		assert_eq!(hits, 1);
		Ok(())
	})
	.unwrap();
}

/// A stray `.jsonl` in the session's own directory (not under `subagents/`)
/// is not a transcript layout Claude writes; the watcher's mapping ignores
/// it rather than manufacturing a project for the session dir.
#[test]
fn a_jsonl_outside_subagents_does_not_become_a_project() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let (claude_dir, _cwd, project_dir, session_id) = fixture_one_session(tmp.path(), &db);
	let session_dir = project_dir.join(&session_id);
	std::fs::create_dir_all(&session_dir).expect("mkdir session dir");
	std::fs::write(session_dir.join("stray.jsonl"), "{}\n").expect("write stray");

	let (indexer, _) = make_indexer(db.clone(), claude_dir);
	indexer.full_scan().expect("scan");

	db.with(|conn| {
		let discovered: i64 = conn
			.query_row("SELECT COUNT(*) FROM discovered_projects", [], |row| row.get(0))
			.unwrap();
		assert_eq!(discovered, 1, "no new store directory from a stray jsonl");
		let projects = list_projects_in(conn).expect("list projects");
		assert_eq!(projects.len(), 1, "no new project from a stray jsonl");
		Ok(())
	})
	.unwrap();
}
