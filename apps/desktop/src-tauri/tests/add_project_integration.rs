//! Integration tests for adding a folder as a project (F1).
//!
//! The interesting property is not the insert — it is that a hand-added folder
//! and the same folder as the indexer later discovers it are **one row**. That
//! only holds if `add_project` reproduces Claude Code's directory encoding
//! exactly, so these tests run a real scan over a synthetic `~/.claude` and
//! assert the two meet.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use factorai_lib::commands::projects::add_project_in;
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
fn write_claude_session(claude_dir: &Path, cwd: &Path) {
	let encoded = format!("-{}", cwd.to_string_lossy().trim_start_matches('/').replace('/', "-"));
	let project_dir = claude_dir.join("projects").join(&encoded);
	std::fs::create_dir_all(&project_dir).expect("mkdir project");
	let cwd = cwd.to_string_lossy();
	std::fs::write(
		project_dir.join("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"),
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
	// The path is what a session spawn will use as its cwd, so it has to be the
	// real one rather than anything decoded back out of the id.
	assert_eq!(project.real_path.as_deref(), dir.canonicalize().unwrap().to_str());
}

#[test]
fn a_later_scan_reconciles_onto_the_same_row() {
	let tmp = TempDir::new().unwrap();
	let dir = tmp.path().join("code").join("foo");
	std::fs::create_dir_all(&dir).unwrap();
	let claude_dir = tmp.path().join(".claude");
	let db = open_db(tmp.path());

	let added = add_project_in(&db, dir.to_str().unwrap()).expect("add");
	assert_eq!(project_count(&db), 1);

	// Now Claude runs there for the first time and the indexer finds it.
	write_claude_session(&claude_dir, &dir.canonicalize().unwrap());
	make_indexer(db.clone(), claude_dir).full_scan().expect("scan");

	// One project, not two: the id the button minted is the id the indexer
	// derives from the directory name. A mismatch here is the bug that would
	// leave you with a dead empty row beside a live one for the same folder.
	assert_eq!(project_count(&db), 1);
	db.with(|conn| {
		let count: i64 = conn.query_row(
			"SELECT session_count FROM projects WHERE id = ?1",
			params![added.id],
			|r| r.get(0),
		)?;
		assert_eq!(count, 1);
		Ok(())
	})
	.expect("read back");
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
	// land on the same row or the two would never reconcile.
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
	write_claude_session(&claude_dir, &real);

	let missing = |db: &Db| -> i64 {
		db.with(|conn| {
			Ok(conn.query_row("SELECT missing FROM projects LIMIT 1", [], |r| r.get(0))?)
		})
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
