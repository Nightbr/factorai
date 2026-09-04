//! Migration 0004, run against a database built with the *old* schema.
//!
//! This is the slice of ADR-0011 that can lose someone's data, so it is tested
//! the only way that means anything: build the pre-migration tables by hand,
//! fill them the way the old indexer would have, open the database through
//! `Db::open` so the real migration runs, and assert on the other side.
//!
//! The property that matters most is the boring one — **everything that existed
//! is still there**. A user with thirty projects opens the new build and sees
//! thirty projects. An empty sidebar with a helpful modal is data loss as far
//! as they are concerned, whatever the schema says.

use std::path::Path;

use factorai_lib::db::Db;
use rusqlite::{params, Connection};
use tempfile::TempDir;

/// The schema as of migration 0003, plus the `_meta` rows that mark 0001–0003
/// applied so `Db::open` runs only 0004.
fn seed_old_database(data_dir: &Path) {
	std::fs::create_dir_all(data_dir).unwrap();
	let conn = Connection::open(data_dir.join("factorai.db")).unwrap();
	conn.execute_batch(
		r#"
		CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
		CREATE TABLE projects (
			id              TEXT PRIMARY KEY,
			real_path       TEXT,
			display_name    TEXT NOT NULL,
			last_session_at INTEGER,
			session_count   INTEGER NOT NULL DEFAULT 0,
			pinned          INTEGER NOT NULL DEFAULT 0,
			missing         INTEGER NOT NULL DEFAULT 0
		);
		CREATE TABLE sessions (
			id          TEXT PRIMARY KEY,
			project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			title       TEXT,
			created_at  INTEGER NOT NULL,
			updated_at  INTEGER NOT NULL,
			turn_count  INTEGER NOT NULL DEFAULT 0,
			file_mtime  INTEGER NOT NULL,
			file_size   INTEGER NOT NULL,
			cwd         TEXT
		);
		CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
		CREATE INDEX idx_sessions_project ON sessions(project_id, updated_at DESC);
		CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);
		CREATE VIRTUAL TABLE messages_fts USING fts5(
			session_id UNINDEXED, project_id UNINDEXED, role, body,
			tokenize = 'porter unicode61');

		INSERT INTO _meta(key, value) VALUES
			('migration:0001_init', '2026-01-01T00:00:00Z'),
			('migration:0002_fts', '2026-01-01T00:00:00Z'),
			('migration:0003_project_missing', '2026-01-01T00:00:00Z');

		-- Two ordinary projects, one of them pinned...
		INSERT INTO projects(id, real_path, display_name, last_session_at, session_count, pinned, missing) VALUES
			('-home-me-code-foo', '/home/me/code/foo', 'foo', 900, 2, 1, 0),
			('-home-me-code-bar', '/home/me/code/bar', 'bar', 500, 1, 0, 1);
		-- ...and one the old scan never managed to resolve: a directory with no
		-- recorded cwd, so we never learned which folder it describes.
		INSERT INTO projects(id, real_path, display_name, session_count) VALUES
			('-who-knows-where', NULL, 'who-knows-where', 1);

		INSERT INTO sessions(id, project_id, title, created_at, updated_at, turn_count, file_mtime, file_size, cwd) VALUES
			('s1', '-home-me-code-foo', 'One',   0, 900, 3, 10, 100, '/home/me/code/foo'),
			('s2', '-home-me-code-foo', 'Two',   0, 800, 1, 11, 110, '/home/me/code/foo'),
			('s3', '-home-me-code-bar', 'Three', 0, 500, 2, 12, 120, '/home/me/code/bar'),
			('s4', '-who-knows-where',  'Four',  0, 400, 1, 13, 130, NULL);

		INSERT INTO messages_fts(session_id, project_id, role, body) VALUES
			('s1', '-home-me-code-foo', 'user', 'the quick brown fox'),
			('s3', '-home-me-code-bar', 'user', 'a conversation about pelicans'),
			('s4', '-who-knows-where',  'user', 'orphaned words nobody can reach');
		"#,
	)
	.unwrap();
}

fn scalar<T: rusqlite::types::FromSql>(db: &Db, sql: &str) -> T {
	db.with(|conn| Ok(conn.query_row(sql, [], |r| r.get::<_, T>(0))?)).expect("query")
}

#[test]
fn every_resolved_project_survives_the_migration() {
	let tmp = TempDir::new().unwrap();
	let data_dir = tmp.path().join("data");
	seed_old_database(&data_dir);

	let db = Db::open(&data_dir).expect("migrate");

	// `list_projects` is flat and alphabetical since ADR-0025 — the sidebar's order
	// moved to `sidebar_rows`, so there is nothing here for a caller to sort by
	// except the name. The order the *user* sees is asserted below.
	let projects = db.with(factorai_lib::commands::projects::list_projects_in).expect("list");
	let names: Vec<&str> = projects.iter().map(|p| p.display_name.as_str()).collect();
	assert_eq!(names, vec!["bar", "foo"], "both resolved projects are in the workspace");

	let foo = projects.iter().find(|p| p.display_name == "foo").expect("foo");
	assert_eq!(foo.real_path, "/home/me/code/foo");
	assert_eq!(foo.session_count, 2);
	assert_eq!(foo.last_session_at, Some(900));
	assert_eq!(foo.id.len(), 36, "reissued as a uuid, got {}", foo.id);

	let bar = projects.iter().find(|p| p.display_name == "bar").expect("bar");
	assert!(bar.missing, "the missing flag carries over rather than resetting");
	assert_eq!(bar.session_count, 1);
}

/// **The whole chain of ordering decisions survives, across two migrations.**
///
/// The seeded database predates all of this: it has a `pinned` column and no
/// ordinal at all. 0011 turned the pin into a position (`pinned DESC,
/// display_name ASC`), and 0012 moved that position onto a `sidebar_rows` row.
/// So `foo` — pinned, and alphabetically *second* — must still come out first,
/// which is a fact no single migration's test can state.
#[test]
fn the_sidebar_order_survives_both_migrations() {
	let tmp = TempDir::new().unwrap();
	let data_dir = tmp.path().join("data");
	seed_old_database(&data_dir);

	let db = Db::open(&data_dir).expect("migrate");

	let rows = db.with(factorai_lib::commands::sidebar::list_sidebar_in).expect("list sidebar");
	let labels: Vec<String> = rows
		.iter()
		.map(|row| match row {
			factorai_lib::models::SidebarRow::Project { project, .. } => {
				project.display_name.clone()
			}
			factorai_lib::models::SidebarRow::Group { name, .. } => name.clone(),
		})
		.collect();
	assert_eq!(labels, vec!["foo", "bar"], "a pin was a decision and both migrations honour it");

	// One row per project, all at the top level, and no groups — a database that
	// has never seen this feature must not come out of it with structure nobody
	// created.
	db.with(|conn| {
		let rows: i64 = conn.query_row("SELECT COUNT(*) FROM sidebar_rows", [], |r| r.get(0))?;
		let groups: i64 =
			conn.query_row("SELECT COUNT(*) FROM sidebar_rows WHERE kind = 'group'", [], |r| {
				r.get(0)
			})?;
		let parented: i64 = conn.query_row(
			"SELECT COUNT(*) FROM sidebar_rows WHERE parent_id IS NOT NULL",
			[],
			|r| r.get(0),
		)?;
		assert_eq!(rows, 2);
		assert_eq!(groups, 0, "no group is invented on upgrade");
		assert_eq!(parented, 0);
		Ok(())
	})
	.expect("counts");

	// And 0011's column is gone, rather than lingering as a second source of truth.
	let columns: Vec<String> = db
		.with(|conn| {
			let mut stmt = conn.prepare("SELECT name FROM pragma_table_info('projects')")?;
			let names = stmt.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
			Ok(names)
		})
		.expect("columns");
	assert!(!columns.contains(&"sort_order".to_string()), "0012 drops it: {columns:?}");
	assert!(!columns.contains(&"pinned".to_string()), "0011 dropped it: {columns:?}");
}

#[test]
fn sessions_keep_their_transcripts_addressable() {
	let tmp = TempDir::new().unwrap();
	let data_dir = tmp.path().join("data");
	seed_old_database(&data_dir);

	let db = Db::open(&data_dir).expect("migrate");

	// The store key is what `get_session_tail` joins the transcript path from. Losing
	// it would make every migrated session unreadable while still listed.
	db.with(|conn| {
		let key: String = conn
			.query_row(
				"SELECT d.key FROM sessions s
				   JOIN discovered_projects d ON d.id = s.discovered_id
				  WHERE s.id = 's1'",
				[],
				|r| r.get(0),
			)
			.expect("s1 still resolves to a store directory");
		assert_eq!(key, "-home-me-code-foo");
		// Whose store it is now reads through the profile that owns the row —
		// migration 0018 took the duplicated `agent` column off this table (F25),
		// and every migrated discovery belongs to the seeded default profile.
		let (agent, is_default): (String, i64) = conn
			.query_row(
				"SELECT p.agent, p.is_default FROM discovered_projects d
				   JOIN profiles p ON p.id = d.profile_id
				  WHERE d.key = ?1",
				params![key],
				|r| Ok((r.get(0)?, r.get(1)?)),
			)
			.unwrap();
		assert_eq!(agent, "claude");
		assert_eq!(is_default, 1, "migrated discoveries land on the default profile");
		Ok(())
	})
	.unwrap();
}

#[test]
fn the_search_index_is_preserved_without_reparsing() {
	let tmp = TempDir::new().unwrap();
	let data_dir = tmp.path().join("data");
	seed_old_database(&data_dir);

	let db = Db::open(&data_dir).expect("migrate");

	// The FTS table was rebuilt to drop its `project_id` column. Its *content*
	// must come across — the transcripts are on disk, but re-parsing every one
	// of them on first launch of the new build is a cost nobody agreed to.
	let hits = db
		.with(|conn| factorai_lib::services::search::search(conn, "pelicans", None, 10))
		.expect("search");
	assert_eq!(hits.len(), 1);
	assert_eq!(hits[0].session_id, "s3");
	assert!(!hits[0].project_id.is_empty(), "resolved to the new workspace id");
}

/// A directory whose folder we never identified cannot become a project: the
/// workspace is keyed by folder and we do not know which one it is. Its rows go
/// rather than lingering as an index no query can read — search is scoped to
/// the workspace now.
#[test]
fn an_unresolvable_directory_is_dropped_rather_than_guessed_at() {
	let tmp = TempDir::new().unwrap();
	let data_dir = tmp.path().join("data");
	seed_old_database(&data_dir);

	let db = Db::open(&data_dir).expect("migrate");

	assert_eq!(scalar::<i64>(&db, "SELECT COUNT(*) FROM projects"), 2);
	// The discovery survives — if a later scan ever recovers its cwd it becomes
	// importable — but nothing of it is indexed.
	assert_eq!(
		scalar::<i64>(&db, "SELECT COUNT(*) FROM discovered_projects WHERE project_id IS NULL"),
		1
	);
	assert_eq!(scalar::<i64>(&db, "SELECT COUNT(*) FROM sessions WHERE id = 's4'"), 0);
	assert_eq!(scalar::<i64>(&db, "SELECT COUNT(*) FROM messages_fts WHERE session_id = 's4'"), 0);
	// And the three sessions that did have a home are all still here.
	assert_eq!(scalar::<i64>(&db, "SELECT COUNT(*) FROM sessions"), 3);
}

#[test]
fn migrating_twice_is_a_no_op() {
	let tmp = TempDir::new().unwrap();
	let data_dir = tmp.path().join("data");
	seed_old_database(&data_dir);

	let first = Db::open(&data_dir).expect("migrate");
	let id: String = scalar(&first, "SELECT id FROM projects ORDER BY display_name LIMIT 1");
	drop(first);

	// Reopening runs `migrate()` again; `_meta` must stop it. A second run would
	// reissue every project id, orphaning tabs and pins on every launch.
	let second = Db::open(&data_dir).expect("reopen");
	let again: String = scalar(&second, "SELECT id FROM projects ORDER BY display_name LIMIT 1");
	assert_eq!(id, again);
	assert_eq!(scalar::<i64>(&second, "SELECT COUNT(*) FROM projects"), 2);
}

/// A fresh install has no old tables to convert. The migration must still leave
/// a usable schema rather than erroring on the empty case.
#[test]
fn a_fresh_database_lands_on_the_same_schema() {
	let tmp = TempDir::new().unwrap();
	let db = Db::open(&tmp.path().join("data")).expect("open fresh");

	assert_eq!(scalar::<i64>(&db, "SELECT COUNT(*) FROM projects"), 0);
	assert_eq!(scalar::<i64>(&db, "SELECT COUNT(*) FROM discovered_projects"), 0);
	// `sessions.discovered_id` exists, i.e. we are on the post-0004 shape.
	db.with(|conn| {
		conn.query_row("SELECT COUNT(discovered_id) FROM sessions", [], |r| r.get::<_, i64>(0))?;
		Ok(())
	})
	.expect("post-0004 sessions table");
}
