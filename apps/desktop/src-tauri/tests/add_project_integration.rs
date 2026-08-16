//! Integration tests for the workspace: adding a folder, removing it, and what
//! the scan is and isn't allowed to do behind your back (F1, ADR-0011).
//!
//! The interesting properties are all about **ownership**. A project row is a
//! record of a decision, so the indexer must never create one; and a removal
//! must survive the next scan, which is precisely what the old
//! mirror-the-directory model could not manage.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use factorai_lib::commands::projects::{add_project_in, list_projects_in, remove_project_in};
use factorai_lib::db::Db;
use factorai_lib::services::indexer::Indexer;
use rusqlite::params;
use tempfile::TempDir;

fn open_db(tmp: &Path) -> Db {
	Db::open(&tmp.join("data")).expect("open db")
}

fn make_indexer(db: Db, claude_dir: PathBuf) -> Indexer {
	Indexer::with_callbacks(db, claude_dir, Arc::new(|_| {}), Arc::new(|_| {}))
}

/// A `~/.claude/projects/<encoded>/<session>.jsonl` for `cwd`, as Claude would
/// leave behind after a session there.
fn write_claude_session(claude_dir: &Path, cwd: &Path, session_id: &str) {
	let encoded = format!("-{}", cwd.to_string_lossy().trim_start_matches('/').replace('/', "-"));
	let project_dir = claude_dir.join("projects").join(&encoded);
	std::fs::create_dir_all(&project_dir).expect("mkdir project");
	let cwd = cwd.to_string_lossy();
	std::fs::write(
		project_dir.join(format!("{session_id}.jsonl")),
		format!(
			r#"{{"type":"user","uuid":"u1","timestamp":"2026-01-01T00:00:00Z","cwd":"{cwd}","message":{{"role":"user","content":"hello"}}}}"#
		),
	)
	.expect("write session");
}

fn project_count(db: &Db) -> i64 {
	db.with(|conn| Ok(conn.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))?))
		.expect("count")
}

fn session_count(db: &Db) -> i64 {
	db.with(|conn| Ok(conn.query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))?))
		.expect("count")
}

fn fts_count(db: &Db) -> i64 {
	db.with(|conn| Ok(conn.query_row("SELECT COUNT(*) FROM messages_fts", [], |r| r.get(0))?))
		.expect("count")
}

#[test]
fn adds_a_folder_claude_has_never_run_in() {
	let tmp = TempDir::new().unwrap();
	let dir = tmp.path().join("code").join("brand-new");
	std::fs::create_dir_all(&dir).unwrap();
	let db = open_db(tmp.path());

	let project = add_project_in(&db, dir.to_str().unwrap()).expect("add");

	assert_eq!(project.display_name, "brand-new");
	assert_eq!(project.session_count, 0);
	assert_eq!(project.last_session_at, None);
	assert!(!project.pinned);
	// The path is what a session spawn will use as its cwd, and what the
	// transcript directory is derived from, so it has to be the real one.
	assert_eq!(project.real_path, dir.canonicalize().unwrap().to_str().unwrap());
	// A uuid, not a path encoding: identity is the decision, not the folder.
	assert_eq!(project.id.len(), 36, "expected a uuid, got {}", project.id);
}

/// The property that replaces "the ids must match": a scan links what Claude
/// wrote to the folder you added, by canonical path.
#[test]
fn a_later_scan_attaches_its_sessions_to_the_folder_you_added() {
	let tmp = TempDir::new().unwrap();
	let dir = tmp.path().join("code").join("foo");
	std::fs::create_dir_all(&dir).unwrap();
	let claude_dir = tmp.path().join(".claude");
	let db = open_db(tmp.path());

	let added = add_project_in(&db, dir.to_str().unwrap()).expect("add");
	assert_eq!(project_count(&db), 1);

	// Now Claude runs there for the first time and the indexer finds it.
	write_claude_session(
		&claude_dir,
		&dir.canonicalize().unwrap(),
		"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
	);
	make_indexer(db.clone(), claude_dir).full_scan().expect("scan");

	// One project, not two: the scan links by path and never invents a row.
	assert_eq!(project_count(&db), 1);
	let listed = db.with(list_projects_in).expect("list");
	assert_eq!(listed.len(), 1);
	assert_eq!(listed[0].id, added.id);
	assert_eq!(listed[0].session_count, 1);
	assert!(listed[0].last_session_at.is_some());
}

/// The whole reason for the split. Under the old model `projects` mirrored
/// `~/.claude/projects/`, so a scan created a row for every directory Claude
/// had ever touched — which is what the user asked us to stop doing.
#[test]
fn a_scan_never_adds_a_project_you_did_not_ask_for() {
	let tmp = TempDir::new().unwrap();
	let untouched = tmp.path().join("code").join("someone-elses-thing");
	std::fs::create_dir_all(&untouched).unwrap();
	let claude_dir = tmp.path().join(".claude");
	let db = open_db(tmp.path());
	write_claude_session(
		&claude_dir,
		&untouched.canonicalize().unwrap(),
		"11111111-2222-3333-4444-555555555555",
	);

	make_indexer(db.clone(), claude_dir).full_scan().expect("scan");

	assert_eq!(project_count(&db), 0, "Claude having worked there is not a decision you made");
	// And nothing was parsed either: indexing is gated on the workspace, so an
	// unadded folder costs a readdir and nothing more.
	assert_eq!(session_count(&db), 0);
	assert_eq!(fts_count(&db), 0);
}

/// The bug that made "close a project" impossible before this refactor: a
/// DELETE was undone by the next scan, because the table was a mirror.
#[test]
fn removing_a_project_survives_the_next_scan() {
	let tmp = TempDir::new().unwrap();
	let dir = tmp.path().join("code").join("foo");
	std::fs::create_dir_all(&dir).unwrap();
	let claude_dir = tmp.path().join(".claude");
	let db = open_db(tmp.path());
	write_claude_session(
		&claude_dir,
		&dir.canonicalize().unwrap(),
		"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
	);

	let added = add_project_in(&db, dir.to_str().unwrap()).expect("add");
	make_indexer(db.clone(), claude_dir.clone()).full_scan().expect("scan");
	assert_eq!(session_count(&db), 1);
	assert!(fts_count(&db) > 0);

	remove_project_in(&db, &added.id).expect("remove");
	assert_eq!(project_count(&db), 0);
	// Search is scoped to the workspace, so the index goes with the membership
	// rather than lingering as rows no query can read.
	assert_eq!(session_count(&db), 0);
	assert_eq!(fts_count(&db), 0);

	make_indexer(db.clone(), claude_dir).full_scan().expect("rescan");
	assert_eq!(project_count(&db), 0, "the scan must not put it back");
	assert_eq!(session_count(&db), 0);
}

/// Nothing on disk is touched — ADR-0004 — so re-adding rebuilds from the
/// transcripts that never moved. That is what makes "no confirm" defensible.
#[test]
fn re_adding_a_removed_project_recovers_its_history() {
	let tmp = TempDir::new().unwrap();
	let dir = tmp.path().join("code").join("foo");
	std::fs::create_dir_all(&dir).unwrap();
	let claude_dir = tmp.path().join(".claude");
	let db = open_db(tmp.path());
	write_claude_session(
		&claude_dir,
		&dir.canonicalize().unwrap(),
		"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
	);

	let added = add_project_in(&db, dir.to_str().unwrap()).expect("add");
	make_indexer(db.clone(), claude_dir.clone()).full_scan().expect("scan");
	remove_project_in(&db, &added.id).expect("remove");

	add_project_in(&db, dir.to_str().unwrap()).expect("re-add");
	make_indexer(db.clone(), claude_dir).full_scan().expect("rescan");

	let listed = db.with(list_projects_in).expect("list");
	assert_eq!(listed.len(), 1);
	assert_eq!(listed[0].session_count, 1, "the transcript was still on disk");
	assert!(fts_count(&db) > 0, "and it is searchable again");
}

#[test]
fn adding_twice_is_idempotent_and_keeps_the_pin() {
	let tmp = TempDir::new().unwrap();
	let dir = tmp.path().join("code").join("foo");
	std::fs::create_dir_all(&dir).unwrap();
	let db = open_db(tmp.path());

	let first = add_project_in(&db, dir.to_str().unwrap()).expect("add");
	db.with_mut(|conn| {
		conn.execute("UPDATE projects SET pinned = 1 WHERE id = ?1", params![first.id])?;
		Ok(())
	})
	.expect("pin");

	let second = add_project_in(&db, dir.to_str().unwrap()).expect("add again");

	assert_eq!(project_count(&db), 1);
	assert_eq!(second.id, first.id);
	// Re-adding a project you have already pinned must not quietly unpin it.
	assert!(second.pinned);
}

#[test]
fn a_path_through_a_symlink_resolves_to_the_folder_it_points_at() {
	let tmp = TempDir::new().unwrap();
	let real = tmp.path().join("code").join("foo");
	std::fs::create_dir_all(&real).unwrap();
	let link = tmp.path().join("shortcut");
	std::os::unix::fs::symlink(&real, &link).unwrap();
	let db = open_db(tmp.path());

	let via_link = add_project_in(&db, link.to_str().unwrap()).expect("add via link");
	let via_real = add_project_in(&db, real.to_str().unwrap()).expect("add via real path");

	// Claude records the resolved cwd, so a project added by its symlink has to
	// land on the same row or its sessions would never attach.
	assert_eq!(via_link.id, via_real.id);
	assert_eq!(project_count(&db), 1);
}

/// F1 + F6: a project whose folder has gone is flagged by the scan, so the UI
/// can gray the row and disable its `+` before the click rather than letting
/// the spawn guard explain it afterwards.
#[test]
fn a_scan_flags_a_project_whose_folder_has_gone() {
	let tmp = TempDir::new().unwrap();
	let dir = tmp.path().join("code").join("foo");
	std::fs::create_dir_all(&dir).unwrap();
	let real = dir.canonicalize().unwrap();
	let claude_dir = tmp.path().join(".claude");
	let db = open_db(tmp.path());
	write_claude_session(&claude_dir, &real, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
	add_project_in(&db, real.to_str().unwrap()).expect("add");

	let missing = |db: &Db| -> i64 {
		db.with(
			|conn| Ok(conn.query_row("SELECT missing FROM projects LIMIT 1", [], |r| r.get(0))?),
		)
		.expect("read missing")
	};

	make_indexer(db.clone(), claude_dir.clone()).full_scan().expect("scan");
	assert_eq!(missing(&db), 0, "the folder is right there");

	// Now it isn't. The transcripts under ~/.claude survive — that is exactly
	// the case: the sessions are still browsable, only starting a new one is not.
	std::fs::remove_dir_all(&real).unwrap();
	make_indexer(db.clone(), claude_dir.clone()).full_scan().expect("rescan");
	assert_eq!(missing(&db), 1);

	// And it clears again rather than sticking, so restoring a folder doesn't
	// need a wiped database to be usable.
	std::fs::create_dir_all(&real).unwrap();
	make_indexer(db.clone(), claude_dir).full_scan().expect("third scan");
	assert_eq!(missing(&db), 0);
}

#[test]
fn adding_a_folder_clears_a_stale_missing_flag() {
	// The folder came back and the user re-added it by hand rather than waiting
	// for a scan. `add_project` has just canonicalized it, so it knows better
	// than the flag does.
	let tmp = TempDir::new().unwrap();
	let dir = tmp.path().join("code").join("foo");
	std::fs::create_dir_all(&dir).unwrap();
	let db = open_db(tmp.path());

	let added = add_project_in(&db, dir.to_str().unwrap()).expect("add");
	db.with_mut(|conn| {
		conn.execute("UPDATE projects SET missing = 1 WHERE id = ?1", params![added.id])?;
		Ok(())
	})
	.expect("mark missing");

	assert!(!add_project_in(&db, dir.to_str().unwrap()).expect("re-add").missing);
}

/// A deleted folder is importable — the transcripts are all still there and
/// reading them is the reason you'd want it — but only because an agent has
/// history for it. A path nobody has ever worked in is still a typo.
#[test]
fn a_deleted_folder_is_importable_but_a_typo_is_not() {
	let tmp = TempDir::new().unwrap();
	let dir = tmp.path().join("code").join("gone");
	std::fs::create_dir_all(&dir).unwrap();
	let real = dir.canonicalize().unwrap();
	let claude_dir = tmp.path().join(".claude");
	let db = open_db(tmp.path());
	write_claude_session(&claude_dir, &real, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

	// Discovery runs whether or not anything is in the workspace.
	make_indexer(db.clone(), claude_dir).discover().expect("discover");
	std::fs::remove_dir_all(&real).unwrap();

	let imported = add_project_in(&db, real.to_str().unwrap()).expect("import a gone folder");
	assert!(imported.missing, "it should say so rather than pretend");

	assert!(
		add_project_in(&db, "/no/such/directory/anywhere").is_err(),
		"a path no agent has heard of is a mistake, not an import"
	);
}

#[test]
fn rejects_what_cannot_be_a_project() {
	let tmp = TempDir::new().unwrap();
	let file = tmp.path().join("notadir.txt");
	std::fs::write(&file, "x").unwrap();
	let db = open_db(tmp.path());

	assert!(add_project_in(&db, "relative/path").is_err());
	assert!(add_project_in(&db, "/no/such/directory/anywhere").is_err());
	assert!(add_project_in(&db, file.to_str().unwrap()).is_err());
	assert_eq!(project_count(&db), 0);
}
