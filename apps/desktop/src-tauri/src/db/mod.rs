use std::path::Path;
use std::sync::Arc;

use parking_lot::Mutex;
use rusqlite::{Connection, OptionalExtension};
use tracing::info;

use crate::error::{AppError, AppResult};

/// Embedded migration files, applied in order. Tracked in `_meta`.
const MIGRATIONS: &[(&str, &str)] = &[
	("0001_init", include_str!("migrations/0001_init.sql")),
	("0002_fts", include_str!("migrations/0002_fts.sql")),
	("0003_project_missing", include_str!("migrations/0003_project_missing.sql")),
	("0004_workspace_projects", include_str!("migrations/0004_workspace_projects.sql")),
	// Renumbered from 0004 on the way in from PR #2, which developed alongside
	// the workspace split rather than after it. Order is what makes it correct:
	// 0004 rebuilds `sessions` and drops the old `projects` mirror, so this one
	// has to run second and is written against the tables that come out of it.
	// Renaming is only safe because it had not been applied anywhere real — it
	// is keyed by name in `_meta`, so a rename re-runs it, and
	// `ALTER TABLE ... ADD COLUMN` is not idempotent.
	("0005_session_subagent", include_str!("migrations/0005_session_subagent.sql")),
	("0006_session_worktrees", include_str!("migrations/0006_session_worktrees.sql")),
	// 0006's foreign key could not be satisfied by the case F21 exists for — see
	// this file's header comment for what a brand-new session's row situation is.
	// A separate migration rather than an edit, because 0006 has run.
	("0007_session_worktrees_no_fk", include_str!("migrations/0007_session_worktrees_no_fk.sql")),
	// F21 again: the panel could not follow an agent that moved into a worktree,
	// because the only cwd we kept was the one it started in.
	("0008_session_last_cwd", include_str!("migrations/0008_session_last_cwd.sql")),
	// F21 a third time: a cwd that never moves is not a cwd that says nothing —
	// the agent was working through absolute paths. Also the version stamp that
	// makes a parser change backfill itself.
	("0009_session_last_touched", include_str!("migrations/0009_session_last_touched.sql")),
	// F21 a fourth time, the same afternoon: the agent worked the worktree
	// entirely through `Bash`, which 0009 does not read. Harvesting shell commands
	// too makes the signal noisy, which is why 0009's single value becomes a list —
	// and why 0009's column is left behind rather than dropped. See the file.
	("0010_session_touched_paths", include_str!("migrations/0010_session_touched_paths.sql")),
	// Where a project sits in the sidebar becomes a stored ordinal you drag, and
	// `pinned` goes with it. Note what the file says about DROP COLUMN and about
	// why a table rebuild cannot use `PRAGMA foreign_keys` from in here.
	("0011_project_sort_order", include_str!("migrations/0011_project_sort_order.sql")),
	// Groups make the sidebar two levels, and 0011's per-project ordinal cannot
	// express that without meaning two things at once. The order moves into a
	// tree of rows. ADR-0025 supersedes ADR-0023 for this.
	("0012_sidebar_rows", include_str!("migrations/0012_sidebar_rows.sql")),
	// Routines (F22, ADR-0026): a project's scheduled prompts, and which routine
	// started a session. `session_routines` has **no** foreign key to `sessions`,
	// which is 0007's lesson applied up front rather than found again — the runner
	// writes at spawn, and the `sessions` row does not exist until Claude has
	// written a transcript.
	("0013_routines", include_str!("migrations/0013_routines.sql")),
	// Provenance on a routine (F22 slice 3, ADR-0028), because the IDE bridge can
	// now write one. NULL means a human wrote it — meaningful rather than
	// missing, since every row that predates this column came from the editor.
	("0014_routine_provenance", include_str!("migrations/0014_routine_provenance.sql")),
	// A pinned session sits above recency in its project's list (F2). The one
	// session-adjacent table that *can* carry a foreign key — the file says why,
	// and why it is not 0011's project pin coming back.
	("0015_session_pins", include_str!("migrations/0015_session_pins.sql")),
	// A routine fire is claimed before it is recorded (F22, ADR-0030), because the
	// emit that asked the renderer to spawn it could reach nobody — which is what
	// silently lost every launch-time catch-up fire. The file says what the row is
	// for and why it is never history.
	("0016_routine_claims", include_str!("migrations/0016_routine_claims.sql")),
	// Several Claude identities on one machine (F25, ADR-0036). Only the table
	// here: the default row needs `CLAUDE_HOME`, which static SQL cannot read, so
	// `services::profiles::ensure_default` writes it at boot instead.
	("0017_profiles", include_str!("migrations/0017_profiles.sql")),
	// A discovered directory belongs to a profile rather than to an agent (F25
	// slice 2), which is what lets the same repository be indexed under two
	// config directories. A **table rebuild**, so it is in `STANDALONE` below —
	// the file says why that is not optional.
	("0018_discovered_profile", include_str!("migrations/0018_discovered_profile.sql")),
	// Which identity a project's sessions run as (F25 slice 3). No row means the
	// agent's default, so an existing install keeps working with nothing written.
	// A plain `CREATE TABLE`, so not standalone: the rebuild was 0018's problem.
	("0019_project_profiles", include_str!("migrations/0019_project_profiles.sql")),
];

/// Migrations that need the connection to themselves, with foreign keys off.
///
/// SQLite's own 12-step `ALTER TABLE` procedure — the only way to change a
/// table-level constraint, since `DROP COLUMN` refuses a constrained column —
/// ends in `DROP TABLE` on the table being replaced. For a table something else
/// references that fires every `ON DELETE CASCADE` pointing at it, and the guard
/// (`PRAGMA foreign_keys = OFF`) is a **silent no-op inside a transaction**.
/// Migration 0011's closing note is where this was written down as the thing the
/// next rebuild would have to solve; 0018 is that rebuild.
///
/// `PRAGMA legacy_alter_table` is not an alternative: a rename rewrites
/// `REFERENCES` clauses in other tables whenever foreign keys are *enabled*,
/// whatever that flag says, so the rename hands the dependent table a pointer to
/// the corpse.
///
/// A standalone migration pays for the privilege with a `foreign_key_check`
/// afterwards, before enforcement comes back on — a rebuild that left a dangling
/// reference would otherwise be discovered by an unrelated write, hours later.
const STANDALONE: &[&str] = &["0018_discovered_profile"];

/// Thread-safe handle to the SQLite connection.
///
/// Single connection wrapped in a Mutex — simplest correct option for our
/// write-heavy indexer + read-mostly commands. Switch to a pool if it ever
/// becomes the bottleneck.
#[derive(Clone)]
pub struct Db {
	conn: Arc<Mutex<Connection>>,
}

impl Db {
	pub fn open(data_dir: &Path) -> AppResult<Self> {
		std::fs::create_dir_all(data_dir)?;
		let path = data_dir.join("factorai.db");
		info!(?path, "opening sqlite db");

		let conn = Connection::open(&path).map_err(AppError::from)?;
		// WAL gives us concurrent readers while the indexer writes.
		conn.pragma_update(None, "journal_mode", "WAL")?;
		conn.pragma_update(None, "foreign_keys", "ON")?;
		conn.pragma_update(None, "synchronous", "NORMAL")?;

		let db = Self { conn: Arc::new(Mutex::new(conn)) };
		db.migrate()?;
		Ok(db)
	}

	/// Apply what has not been applied, in order.
	///
	/// **One transaction per migration, not one for the batch.** The batch-wide
	/// transaction had to go when the first standalone migration arrived — a
	/// rebuild cannot run inside one, and committing halfway through a shared
	/// transaction to make room for it is the same thing as this, spelled less
	/// clearly. Each migration is still atomic, and each is recorded in `_meta`
	/// as it lands, so a failure at 18 leaves 1..17 applied and re-running
	/// resumes at 18 — which is what a name-keyed ledger is for.
	fn migrate(&self) -> AppResult<()> {
		let mut conn = self.conn.lock();
		// Bootstrap the bookkeeping table itself.
		conn.execute(
			"CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
			[],
		)?;
		for (name, sql) in MIGRATIONS {
			let already_applied: bool = conn
				.query_row(
					"SELECT 1 FROM _meta WHERE key = ?1",
					[format!("migration:{name}")],
					|_| Ok(true),
				)
				.optional()?
				.unwrap_or(false);
			if already_applied {
				continue;
			}
			info!(%name, "applying migration");
			if STANDALONE.contains(name) {
				apply_standalone(&mut conn, name, sql)?;
			} else {
				apply(&mut conn, name, sql)?;
			}
		}
		Ok(())
	}

	/// Run a closure with exclusive access to the connection.
	pub fn with<R>(&self, f: impl FnOnce(&Connection) -> AppResult<R>) -> AppResult<R> {
		let conn = self.conn.lock();
		f(&conn)
	}

	/// Run a closure with exclusive mutable access (for transactions).
	pub fn with_mut<R>(&self, f: impl FnOnce(&mut Connection) -> AppResult<R>) -> AppResult<R> {
		let mut conn = self.conn.lock();
		f(&mut conn)
	}
}

/// One migration, in its own transaction.
fn apply(conn: &mut Connection, name: &str, sql: &str) -> AppResult<()> {
	let tx = conn.transaction()?;
	tx.execute_batch(sql)?;
	record(&tx, name)?;
	tx.commit()?;
	Ok(())
}

/// One migration that rebuilds a table, with foreign keys off around it — see
/// [`STANDALONE`] for why that cannot be done from inside the migration.
///
/// Enforcement is restored whatever happens, including on the error path: a
/// connection left with foreign keys off would silently accept every dangling
/// write for the rest of the process's life.
fn apply_standalone(conn: &mut Connection, name: &str, sql: &str) -> AppResult<()> {
	conn.pragma_update(None, "foreign_keys", "OFF")?;
	let outcome = apply(conn, name, sql).and_then(|()| {
		// Step 10 of the documented procedure, and the reason a rebuild is
		// allowed to turn enforcement off at all: a reference the rebuild broke is
		// found here, now, rather than by an unrelated write much later.
		let mut stmt = conn.prepare("PRAGMA foreign_key_check")?;
		let violations = stmt.query_map([], |r| r.get::<_, String>(0))?.count();
		if violations > 0 {
			return Err(AppError::Db(format!(
				"migration {name} left {violations} dangling foreign key rows"
			)));
		}
		Ok(())
	});
	conn.pragma_update(None, "foreign_keys", "ON")?;
	outcome
}

fn record(conn: &Connection, name: &str) -> AppResult<()> {
	conn.execute(
		"INSERT INTO _meta(key, value) VALUES (?1, ?2)",
		[format!("migration:{name}"), chrono::Utc::now().to_rfc3339()],
	)?;
	Ok(())
}
