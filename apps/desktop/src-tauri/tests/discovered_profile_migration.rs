//! Migration 0018, run against a database built at the 0017 mark (F25 slice 2).
//!
//! This is the second migration in the project that can lose someone's data,
//! and it can lose more of it than 0004 could. `discovered_projects` is
//! **referenced** by `sessions` with `ON DELETE CASCADE`, and changing a
//! table-level constraint means SQLite's 12-step rebuild, which ends in a
//! `DROP TABLE` on that very table. Get it wrong and every session row and
//! every pin goes with it — silently, since the transcripts are still on disk
//! and the sidebar simply comes up empty.
//!
//! So the properties are the boring ones, asserted the only way that means
//! anything: build the pre-migration tables by hand, mark 0001–0017 applied so
//! `Db::open` runs exactly 0018, and look at what came out.

use std::path::Path;

use factorai_lib::db::Db;
use rusqlite::Connection;
use tempfile::TempDir;

/// The slice of the 0017-era schema that migration 0018 touches, plus the
/// `_meta` rows that make `Db::open` run only 0018.
///
/// Only these tables: 0018 rebuilds `discovered_projects`, which references
/// `projects` and `profiles` and is referenced by `sessions`, which is in turn
/// referenced by `session_pins`. Nothing else in the schema is in the blast
/// radius, and a hand-written copy of all seventeen migrations would be a second
/// source of truth for the schema rather than a test.
fn seed_at_0017(data_dir: &Path) {
	std::fs::create_dir_all(data_dir).unwrap();
	let conn = Connection::open(data_dir.join("factorai.db")).unwrap();
	conn.execute_batch(
		r#"
		CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
		CREATE TABLE projects (
			id           TEXT PRIMARY KEY,
			real_path    TEXT NOT NULL UNIQUE,
			display_name TEXT NOT NULL,
			missing      INTEGER NOT NULL DEFAULT 0,
			opened_at    INTEGER NOT NULL
		);
		CREATE TABLE profiles (
			id         TEXT PRIMARY KEY,
			agent      TEXT NOT NULL DEFAULT 'claude',
			name       TEXT NOT NULL,
			config_dir TEXT NOT NULL UNIQUE,
			is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
			created_at INTEGER NOT NULL
		);
		CREATE UNIQUE INDEX idx_profile_default_per_agent
			ON profiles(agent) WHERE is_default = 1;
		CREATE UNIQUE INDEX idx_profile_name_per_agent ON profiles(agent, name);
		CREATE TABLE discovered_projects (
			id         INTEGER PRIMARY KEY,
			agent      TEXT NOT NULL DEFAULT 'claude',
			key        TEXT NOT NULL,
			real_path  TEXT,
			project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
			UNIQUE (agent, key)
		);
		CREATE INDEX idx_discovered_project ON discovered_projects(project_id);
		CREATE INDEX idx_discovered_real_path ON discovered_projects(real_path);
		CREATE TABLE sessions (
			id            TEXT PRIMARY KEY,
			discovered_id INTEGER NOT NULL REFERENCES discovered_projects(id) ON DELETE CASCADE,
			title         TEXT,
			created_at    INTEGER NOT NULL,
			updated_at    INTEGER NOT NULL,
			turn_count    INTEGER NOT NULL DEFAULT 0,
			file_mtime    INTEGER NOT NULL,
			file_size     INTEGER NOT NULL,
			cwd           TEXT
		);
		CREATE TABLE session_pins (
			session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
			pinned_at  INTEGER NOT NULL
		);

		INSERT INTO _meta(key, value) VALUES
			('migration:0001_init', '2026-01-01T00:00:00Z'),
			('migration:0002_fts', '2026-01-01T00:00:00Z'),
			('migration:0003_project_missing', '2026-01-01T00:00:00Z'),
			('migration:0004_workspace_projects', '2026-01-01T00:00:00Z'),
			('migration:0005_session_subagent', '2026-01-01T00:00:00Z'),
			('migration:0006_session_worktrees', '2026-01-01T00:00:00Z'),
			('migration:0007_session_worktrees_no_fk', '2026-01-01T00:00:00Z'),
			('migration:0008_session_last_cwd', '2026-01-01T00:00:00Z'),
			('migration:0009_session_last_touched', '2026-01-01T00:00:00Z'),
			('migration:0010_session_touched_paths', '2026-01-01T00:00:00Z'),
			('migration:0011_project_sort_order', '2026-01-01T00:00:00Z'),
			('migration:0012_sidebar_rows', '2026-01-01T00:00:00Z'),
			('migration:0013_routines', '2026-01-01T00:00:00Z'),
			('migration:0014_routine_provenance', '2026-01-01T00:00:00Z'),
			('migration:0015_session_pins', '2026-01-01T00:00:00Z'),
			('migration:0016_routine_claims', '2026-01-01T00:00:00Z'),
			('migration:0017_profiles', '2026-01-01T00:00:00Z');

		-- One profile, as 0017 seeds it: default, directory not yet resolved.
		INSERT INTO profiles(id, agent, name, config_dir, is_default, created_at)
			VALUES ('prof-default', 'claude', 'Default', '', 1, 0);

		INSERT INTO projects(id, real_path, display_name, missing, opened_at)
			VALUES ('p-foo', '/home/me/code/foo', 'foo', 0, 0);

		-- A discovery in the workspace, one outside it, and three sessions
		-- between them. The unlinked row matters: it is the shape the migration
		-- could most easily drop, since nothing in the workspace points at it.
		INSERT INTO discovered_projects(id, agent, key, real_path, project_id) VALUES
			(1, 'claude', '-home-me-code-foo', '/home/me/code/foo', 'p-foo'),
			(2, 'claude', '-home-me-code-bar', '/home/me/code/bar', NULL);

		INSERT INTO sessions(id, discovered_id, title, created_at, updated_at, turn_count, file_mtime, file_size, cwd) VALUES
			('s1', 1, 'first', 1, 1, 2, 0, 0, '/home/me/code/foo'),
			('s2', 1, 'second', 2, 2, 3, 0, 0, '/home/me/code/foo'),
			('s3', 2, 'elsewhere', 3, 3, 1, 0, 0, '/home/me/code/bar');

		INSERT INTO session_pins(session_id, pinned_at) VALUES ('s2', 99);
		"#,
	)
	.unwrap();
}

fn scalar<T: rusqlite::types::FromSql>(db: &Db, sql: &str) -> T {
	db.with(|conn| Ok(conn.query_row(sql, [], |r| r.get::<_, T>(0))?)).expect("query")
}

#[test]
fn every_session_and_pin_survives_the_rebuild() {
	let tmp = TempDir::new().unwrap();
	let data_dir = tmp.path().join("data");
	seed_at_0017(&data_dir);

	let db = Db::open(&data_dir).expect("migrate");

	// **The whole reason this file exists.** `DROP TABLE discovered_projects`
	// inside the shared migration transaction would have taken all three of these
	// with it, and the pin after them.
	assert_eq!(scalar::<i64>(&db, "SELECT COUNT(*) FROM sessions"), 3);
	assert_eq!(scalar::<i64>(&db, "SELECT COUNT(*) FROM session_pins"), 1);
	assert_eq!(scalar::<i64>(&db, "SELECT COUNT(*) FROM discovered_projects"), 2);

	// Including the row nothing in the workspace points at: a discovery outside
	// the workspace is history, not garbage.
	assert_eq!(
		scalar::<i64>(&db, "SELECT COUNT(*) FROM discovered_projects WHERE project_id IS NULL"),
		1
	);

	// And every session still resolves to the directory its transcript is in,
	// which is what `get_session_tail` joins the path from.
	let key: String = scalar(&db, "SELECT d.key FROM sessions s JOIN discovered_projects d ON d.id = s.discovered_id WHERE s.id = 's1'");
	assert_eq!(key, "-home-me-code-foo");

	// No dangling references left behind — the same check the runner makes before
	// it turns enforcement back on, asserted from the outside as well.
	db.with(|conn| {
		let mut stmt = conn.prepare("PRAGMA foreign_key_check")?;
		let violations = stmt.query_map([], |r| r.get::<_, String>(0))?.count();
		assert_eq!(violations, 0);
		Ok(())
	})
	.unwrap();
}

#[test]
fn every_discovery_lands_on_the_default_profile() {
	let tmp = TempDir::new().unwrap();
	let data_dir = tmp.path().join("data");
	seed_at_0017(&data_dir);

	let db = Db::open(&data_dir).expect("migrate");

	assert_eq!(
		scalar::<i64>(
			&db,
			"SELECT COUNT(*) FROM discovered_projects WHERE profile_id = 'prof-default'"
		),
		2,
		"an existing install keeps working: everything it had belongs to the profile it had"
	);
	// The duplicated column is gone; whose store it is comes from the profile.
	let columns: Vec<String> = db
		.with(|conn| {
			let mut stmt =
				conn.prepare("SELECT name FROM pragma_table_info('discovered_projects')")?;
			let names: Vec<String> =
				stmt.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
			Ok(names)
		})
		.expect("columns");
	assert!(!columns.contains(&"agent".to_string()), "0018 dropped it: {columns:?}");
	assert!(columns.contains(&"profile_id".to_string()));
}

#[test]
fn the_same_repository_can_be_discovered_under_two_profiles() {
	let tmp = TempDir::new().unwrap();
	let data_dir = tmp.path().join("data");
	seed_at_0017(&data_dir);

	let db = Db::open(&data_dir).expect("migrate");

	// **The thing the migration is for.** `UNIQUE (agent, key)` rejected this
	// outright, which is why a second profile's transcripts could not be recorded
	// at all before 0018.
	db.with(|conn| {
		conn.execute(
			"INSERT INTO profiles(id, agent, name, config_dir, is_default, created_at)
			 VALUES ('prof-work', 'claude', 'Work', '/home/me/.claude-work', 0, 0)",
			[],
		)?;
		conn.execute(
			"INSERT INTO discovered_projects(profile_id, key, real_path, project_id)
			 VALUES ('prof-work', '-home-me-code-foo', '/home/me/code/foo', 'p-foo')",
			[],
		)?;
		Ok(())
	})
	.unwrap();
	assert_eq!(
		scalar::<i64>(
			&db,
			"SELECT COUNT(*) FROM discovered_projects WHERE key = '-home-me-code-foo'"
		),
		2
	);

	// Twice under the *same* profile is still refused: the key moved, it did not
	// go away.
	let duplicate = db.with(|conn| {
		conn.execute(
			"INSERT INTO discovered_projects(profile_id, key) VALUES ('prof-work', '-home-me-code-foo')",
			[],
		)?;
		Ok(())
	});
	assert!(duplicate.is_err(), "UNIQUE (profile_id, key) still holds");

	// And deleting a profile takes its discoveries — and their sessions — out of
	// the index, leaving the other profile's alone. That is what makes a deleted
	// profile recoverable by re-adding it: nothing on disk was touched.
	db.with(|conn| {
		conn.execute("DELETE FROM profiles WHERE id = 'prof-work'", [])?;
		Ok(())
	})
	.unwrap();
	assert_eq!(
		scalar::<i64>(
			&db,
			"SELECT COUNT(*) FROM discovered_projects WHERE key = '-home-me-code-foo'"
		),
		1
	);
	assert_eq!(
		scalar::<i64>(&db, "SELECT COUNT(*) FROM sessions"),
		3,
		"the default's sessions stay"
	);
}

#[test]
fn migrating_twice_is_a_no_op() {
	let tmp = TempDir::new().unwrap();
	let data_dir = tmp.path().join("data");
	seed_at_0017(&data_dir);

	let first = Db::open(&data_dir).expect("migrate");
	drop(first);
	// The ledger is keyed by name, so the second open must skip 0018 rather than
	// rebuild a table that no longer has the column it reads.
	let db = Db::open(&data_dir).expect("reopen");
	assert_eq!(scalar::<i64>(&db, "SELECT COUNT(*) FROM sessions"), 3);
	assert_eq!(scalar::<i64>(&db, "SELECT COUNT(*) FROM discovered_projects"), 2);
	// Enforcement is back on after a standalone migration, both times.
	assert_eq!(scalar::<i64>(&db, "PRAGMA foreign_keys"), 1);
}
