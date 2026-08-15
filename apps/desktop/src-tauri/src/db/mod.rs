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
	(
		"0003_project_missing",
		include_str!("migrations/0003_project_missing.sql"),
	),
	(
		"0004_session_subagent",
		include_str!("migrations/0004_session_subagent.sql"),
	),
];

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

	fn migrate(&self) -> AppResult<()> {
		let mut conn = self.conn.lock();
		// Bootstrap the bookkeeping table itself.
		conn.execute(
			"CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
			[],
		)?;
		let tx = conn.transaction()?;
		for (name, sql) in MIGRATIONS {
			let already_applied: bool = tx
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
			tx.execute_batch(sql)?;
			tx.execute(
				"INSERT INTO _meta(key, value) VALUES (?1, ?2)",
				[format!("migration:{name}"), chrono::Utc::now().to_rfc3339()],
			)?;
		}
		tx.commit()?;
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
