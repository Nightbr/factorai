//! The `settings` table — the half of F11's preferences that Rust reads
//! (ADR-0013).
//!
//! Two operations over one key/value table, keyed by `SettingKey` rather than a
//! free string (see `models::SettingKey`). Preferences only the renderer reads
//! are not here: they live in `prefsStore` on localStorage, because localStorage
//! is synchronous and a width or a switch that arrives a tick after first paint
//! flashes its default.
//!
//! **The value is a `String`, and absent means unset.** Not a JSON value: every
//! key so far is a scalar, and the one thing a JSON column would buy — a
//! structured preference — is exactly what belongs in `prefsStore` instead.
//! `set(key, None)` deletes the row, which is how the settings UI clears the
//! Claude binary override and returns to auto-detection. An empty string is a
//! *set* value that happens to be empty, and would break the probe, so callers
//! that read a text field hand `None` for a blank one.

use std::path::PathBuf;

use rusqlite::{Connection, OptionalExtension};

use crate::db::Db;
use crate::error::AppResult;
use crate::models::SettingKey;

/// One setting's value, or `None` when no row exists.
pub fn get(conn: &Connection, key: SettingKey) -> AppResult<Option<String>> {
	let value = conn
		.query_row("SELECT value FROM settings WHERE key = ?1", [key.column()], |row| row.get(0))
		.optional()?;
	Ok(value)
}

/// Write one setting, or delete it when `value` is `None`.
pub fn set(conn: &Connection, key: SettingKey, value: Option<&str>) -> AppResult<()> {
	match value {
		Some(v) => {
			conn.execute(
				"INSERT INTO settings(key, value) VALUES (?1, ?2)
				 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
				[key.column(), v],
			)?;
		}
		None => {
			conn.execute("DELETE FROM settings WHERE key = ?1", [key.column()])?;
		}
	}
	Ok(())
}

/// The user's `claude` binary override, for the spawn path and the CLI probe.
///
/// **Swallows a read failure into `None`.** This sits in front of
/// `find_claude_binary`, whose whole job is to answer "where is claude" without
/// a database — so a settings table we cannot read means "nothing overridden",
/// and the three-tier probe still spawns a session. Failing the spawn instead
/// would turn a broken preference into a broken app.
pub fn claude_binary_override(db: &Db) -> Option<PathBuf> {
	db.with(|conn| get(conn, SettingKey::ClaudeBinaryPath)).ok().flatten().map(PathBuf::from)
}

#[cfg(test)]
mod tests {
	use super::*;
	use tempfile::TempDir;

	fn db() -> (TempDir, Db) {
		let tmp = TempDir::new().unwrap();
		let db = Db::open(&tmp.path().join("data")).expect("open db");
		(tmp, db)
	}

	#[test]
	fn round_trips_a_value() {
		let (_tmp, db) = db();
		db.with(|conn| {
			assert_eq!(get(conn, SettingKey::ClaudeBinaryPath)?, None);
			set(conn, SettingKey::ClaudeBinaryPath, Some("/opt/homebrew/bin/claude"))?;
			assert_eq!(
				get(conn, SettingKey::ClaudeBinaryPath)?.as_deref(),
				Some("/opt/homebrew/bin/claude")
			);
			// Writing again replaces rather than failing the primary key.
			set(conn, SettingKey::ClaudeBinaryPath, Some("/usr/local/bin/claude"))?;
			assert_eq!(
				get(conn, SettingKey::ClaudeBinaryPath)?.as_deref(),
				Some("/usr/local/bin/claude")
			);
			Ok(())
		})
		.unwrap();
	}

	#[test]
	fn none_deletes_the_row() {
		let (_tmp, db) = db();
		db.with(|conn| {
			set(conn, SettingKey::ClaudeBinaryPath, Some("/tmp/claude"))?;
			set(conn, SettingKey::ClaudeBinaryPath, None)?;
			// Not an empty string: unset has to be distinguishable, because it is
			// what sends the spawn path back to the three-tier probe.
			assert_eq!(get(conn, SettingKey::ClaudeBinaryPath)?, None);
			let rows: i64 =
				conn.query_row("SELECT count(*) FROM settings", [], |r| r.get(0)).unwrap();
			assert_eq!(rows, 0);
			Ok(())
		})
		.unwrap();
	}

	#[test]
	fn deleting_something_never_set_is_not_an_error() {
		let (_tmp, db) = db();
		db.with(|conn| set(conn, SettingKey::ClaudeBinaryPath, None)).unwrap();
	}

	#[test]
	fn claude_binary_override_reads_the_setting() {
		let (_tmp, db) = db();
		assert_eq!(claude_binary_override(&db), None);
		db.with(|conn| set(conn, SettingKey::ClaudeBinaryPath, Some("/tmp/claude"))).unwrap();
		assert_eq!(claude_binary_override(&db), Some(PathBuf::from("/tmp/claude")));
	}
}
