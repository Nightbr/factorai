//! Several Claude identities on one machine (F25, ADR-0036).
//!
//! A profile is a name plus a config directory. Everything that makes one
//! identity different from another — credentials, `settings.json`, `projects/`,
//! `ide/`, hooks, MCP config — lives inside that directory, because
//! `CLAUDE_CONFIG_DIR` is the CLI's own isolation boundary. So this module
//! writes rows and resolves paths; it never holds a token, and creating a
//! profile deliberately stops at an empty directory so that logging in happens
//! in the CLI, where it belongs.
//!
//! **Two rules are enforced here rather than by the caller**, because both are
//! reachable from more than one surface and neither may be half-applied:
//!
//! - Exactly one default per agent. The partial unique index in migration 0017
//!   forbids two; [`set_default`] clears the old one in the same transaction,
//!   and [`delete`] refuses to remove the last one.
//! - One profile per directory. `config_dir` is UNIQUE, and [`create`] also
//!   refuses a directory nested inside another profile's — the constraint
//!   catches the equal case, and nesting is the same mistake spelled slightly
//!   differently: two identities that share `ide/` and `projects/`.

use std::path::{Component, Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use tauri::Emitter;
use tracing::{info, warn};

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::{Profile, ProfileInput};

/// The only agent that has profiles today. A second one is an INSERT with a
/// different value here, not a schema change — see migration 0017.
pub const CLAUDE: &str = "claude";

/// The name [`ensure_default`] gives the profile it seeds. Not special to the
/// code — it is renameable like any other — but it is what an existing install
/// sees the first time it opens the Profiles section.
const SEEDED_NAME: &str = "Default";

/// `profiles:changed` — the list is different, so re-read it. Carries no payload
/// on purpose: every consumer wants the whole list (there are a handful of rows),
/// and the indexer's reaction is to re-read profiles and re-arm its watches
/// rather than to patch anything.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProfilesChangedEvent {}

fn announce(app: &tauri::AppHandle) {
	let _ = app.emit("profiles:changed", ProfilesChangedEvent {});
}

const SELECT: &str = "SELECT id, agent, name, config_dir, is_default, created_at FROM profiles";

/// The same columns, aliased, for the reads that reach a profile through another
/// table. Kept beside [`SELECT`] so the two cannot drift into different column
/// orders — `map_row` reads both.
const SELECT_JOINED: &str = "SELECT p.id, p.agent, p.name, p.config_dir, p.is_default,
	p.created_at FROM profiles p";

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Profile> {
	let config_dir: String = row.get(3)?;
	Ok(Profile {
		id: row.get(0)?,
		agent: row.get(1)?,
		name: row.get(2)?,
		// Computed here rather than stored. The list is short and read only while
		// Settings is open, and a stored flag would need a scan to clear itself
		// after a remount — which is the one case where the answer changes without
		// anybody touching the row.
		missing: !Path::new(&config_dir).is_dir(),
		config_dir,
		is_default: row.get::<_, i64>(4)? == 1,
		created_at: row.get(5)?,
	})
}

/// Every profile, default first and then by name. One list across agents: the
/// section shows the agent as a column, so grouping is the renderer's business.
pub fn list(conn: &Connection) -> AppResult<Vec<Profile>> {
	let sql = format!("{SELECT} ORDER BY agent, is_default DESC, name COLLATE NOCASE");
	let mut stmt = conn.prepare(&sql)?;
	let rows = stmt.query_map([], map_row)?;
	Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Profile> {
	let sql = format!("{SELECT} WHERE id = ?1");
	conn.query_row(&sql, params![id], map_row)
		.optional()?
		.ok_or_else(|| AppError::NotFound(format!("profile {id}")))
}

/// The profile a project with no assignment spawns under.
pub fn default_for(conn: &Connection, agent: &str) -> AppResult<Option<Profile>> {
	let sql = format!("{SELECT} WHERE agent = ?1 AND is_default = 1");
	Ok(conn.query_row(&sql, params![agent], map_row).optional()?)
}

/// The profile a spawn runs as, and the three rules that decide it (F25).
///
/// **Read per spawn**, which is what makes "running sessions keep their profile,
/// the next one uses the new one" true without anything invalidating a cache —
/// the same shape `user_binary` and `session_cwd` already have in
/// `services::terminal`.
///
/// In order, and the order is the feature:
///
/// 1. **The session's own profile**, when this is a resume. A transcript
///    physically lives under the config directory it was written in, so
///    `--resume` against any other one finds nothing and silently starts a fresh
///    conversation under an old name. This outranks the project deliberately: a
///    project reassigned after a session ran must not make that session
///    unresumable.
/// 2. **The project's assignment**, which is what a new session uses.
/// 3. **The agent's default**, for a project nobody has assigned — the state
///    every install starts in.
pub fn for_spawn(conn: &Connection, project_id: &str, session_id: Option<&str>) -> Option<Profile> {
	if let Some(session_id) = session_id {
		match for_session(conn, session_id) {
			Ok(Some(profile)) => return Some(profile),
			Ok(None) => {}
			// Logged rather than swallowed. Falling through is the right behaviour
			// — a spawn must not fail because a lookup did — but a failure here
			// means resumes are quietly running under the project's profile, which
			// is the silent version of this feature breaking.
			Err(e) => warn!(error = %e, session_id, "could not resolve a session's profile"),
		}
	}
	match assigned(conn, project_id, CLAUDE) {
		Ok(Some(profile)) => Some(profile),
		Ok(None) => default_for(conn, CLAUDE).ok().flatten(),
		Err(e) => {
			warn!(error = %e, project_id, "could not resolve a project's profile");
			default_for(conn, CLAUDE).ok().flatten()
		}
	}
}

/// The config directory a spawn runs under. [`for_spawn`] with the row thrown
/// away, for `services::terminal`, which wants a path and no opinions.
pub fn config_dir_for_spawn(
	db: &Db,
	project_id: &str,
	session_id: Option<&str>,
) -> Option<PathBuf> {
	db.with(|conn| Ok(for_spawn(conn, project_id, session_id)))
		.ok()
		.flatten()
		.map(|p| PathBuf::from(p.config_dir))
}

/// The profile whose store holds this session's transcript.
///
/// Read through `discovered_projects`, which is the only place that fact is
/// recorded — and it is recorded by the *scan*, so a session that has not been
/// indexed yet answers `None`. That is correct rather than unfortunate: a
/// session with no transcript has nothing to resume, and the caller falls
/// through to the project's assignment, which is where a brand-new session
/// belongs.
pub fn for_session(conn: &Connection, session_id: &str) -> AppResult<Option<Profile>> {
	let sql = format!(
		"{SELECT_JOINED} JOIN discovered_projects d ON d.profile_id = p.id
		 JOIN sessions s ON s.discovered_id = d.id
		 WHERE s.id = ?1 LIMIT 1"
	);
	Ok(conn.query_row(&sql, params![session_id], map_row).optional()?)
}

/// The profile assigned to a project for one agent, or `None` for "use the
/// default" — which is what no row means (F25 slice 3).
pub fn assigned(conn: &Connection, project_id: &str, agent: &str) -> AppResult<Option<Profile>> {
	let sql = format!(
		"{SELECT_JOINED} JOIN project_profiles pp ON pp.profile_id = p.id
		 WHERE pp.project_id = ?1 AND pp.agent = ?2"
	);
	Ok(conn.query_row(&sql, params![project_id, agent], map_row).optional()?)
}

/// Assign a project to a profile, or clear the assignment with `None`.
///
/// **A move, not an addition**: one profile per project per agent, so the row is
/// replaced. `INSERT OR REPLACE` rather than an upsert on the unique index,
/// because the primary key and the index disagree about which row is "the same
/// one" — the pair `(project_id, profile_id)` versus `(project_id, agent)` — and
/// a delete-then-insert is the only spelling that means the same thing under
/// both.
///
/// **Applies to new sessions.** The config directory is read at spawn, so
/// nothing running changes, and every control that calls this says so.
pub fn assign(conn: &Connection, project_id: &str, profile_id: Option<&str>) -> AppResult<()> {
	match profile_id {
		Some(profile_id) => {
			let profile = get(conn, profile_id)?;
			conn.execute(
				"DELETE FROM project_profiles WHERE project_id = ?1 AND agent = ?2",
				params![project_id, profile.agent],
			)?;
			conn.execute(
				"INSERT INTO project_profiles(project_id, profile_id, agent, assigned_at)
				 VALUES (?1, ?2, ?3, ?4)",
				params![project_id, profile.id, profile.agent, crate::epoch_ms()],
			)?;
		}
		// Clearing is scoped to this agent for the same reason assigning is: a
		// second agent's assignment is a different fact and must survive.
		None => {
			conn.execute(
				"DELETE FROM project_profiles WHERE project_id = ?1 AND agent = ?2",
				params![project_id, CLAUDE],
			)?;
		}
	}
	Ok(())
}

/// Every config directory in play, for the passes that have to cover all of
/// them: the boot sweep of stale IDE lockfiles, and — from slice 2 — the scan
/// and the file watcher.
///
/// Failure is an empty list rather than an error. Both callers are startup
/// housekeeping that must not stop the app from opening, and both already treat
/// "nothing to do" as a normal answer.
pub fn config_dirs(db: &Db) -> Vec<PathBuf> {
	all(db).into_iter().map(|p| PathBuf::from(p.config_dir)).collect()
}

/// Every profile, for the callers that cannot propagate an error: the boot
/// sweep, the scan and the watcher's reconcile. Same rule as [`config_dirs`] —
/// a failed read is an empty list, and all three treat "nothing to do" as a
/// normal answer.
pub fn all(db: &Db) -> Vec<Profile> {
	db.with(list).unwrap_or_default()
}

/// Resolve the default profile's config directory, the first time.
///
/// Migration 0017 writes the row — it has to, because 0018 attributes every
/// existing discovery to it and `profile_id` is NOT NULL — and leaves
/// `config_dir` blank, because static SQL cannot read `CLAUDE_HOME`. This is the
/// other half: it fills that blank in with `claude_dir` and is then inert.
///
/// **Inert is the point.** Once the row has a directory, the environment
/// variable is never consulted again — so a stale `CLAUDE_HOME` export in
/// somebody's shell profile cannot outrank what Settings shows
/// (specs/07-open-questions.md Q3).
///
/// Four states, and the middle two exist because a database can be edited by
/// hand and a directory can already be taken:
///
/// - **The default has a directory.** Nothing happens.
/// - **A profile already holds `claude_dir`.** It is promoted, and the blank
///   placeholder — if there is one — is deleted rather than left as a second
///   profile with no directory. Filling the blank in would violate
///   `config_dir UNIQUE`.
/// - **A blank placeholder.** Its directory is set and it is made the default.
/// - **Neither.** One row is written, which is the path a database whose
///   `profiles` table was emptied by hand takes.
pub fn ensure_default(db: &Db, claude_dir: &Path) -> AppResult<Profile> {
	let dir = claude_dir.to_string_lossy().into_owned();
	db.with_mut(|conn| {
		let tx = conn.transaction()?;
		let resolved_default: Option<String> = tx
			.query_row(
				"SELECT id FROM profiles
				  WHERE agent = ?1 AND is_default = 1 AND config_dir <> ''",
				params![CLAUDE],
				|r| r.get(0),
			)
			.optional()?;
		if resolved_default.is_none() {
			let holder: Option<String> = tx
				.query_row(
					"SELECT id FROM profiles WHERE agent = ?1 AND config_dir = ?2",
					params![CLAUDE, dir],
					|r| r.get(0),
				)
				.optional()?;
			let blank: Option<String> = tx
				.query_row(
					"SELECT id FROM profiles WHERE agent = ?1 AND config_dir = ''",
					params![CLAUDE],
					|r| r.get(0),
				)
				.optional()?;
			match (holder, blank) {
				(Some(id), blank) => {
					info!(%id, "promoting the profile that already holds the seed directory");
					if let Some(blank) = blank.filter(|b| *b != id) {
						// Its discoveries, if the migration attributed any to it, move to
						// the profile that owns the directory they were found in.
						tx.execute(
							"UPDATE discovered_projects SET profile_id = ?2 WHERE profile_id = ?1",
							params![blank, id],
						)?;
						tx.execute("DELETE FROM profiles WHERE id = ?1", params![blank])?;
					}
					clear_default(&tx, CLAUDE)?;
					tx.execute("UPDATE profiles SET is_default = 1 WHERE id = ?1", params![id])?;
				}
				(None, Some(id)) => {
					info!(%id, config_dir = %dir, "resolving the seeded default profile");
					clear_default(&tx, CLAUDE)?;
					tx.execute(
						"UPDATE profiles SET config_dir = ?2, is_default = 1 WHERE id = ?1",
						params![id, dir],
					)?;
				}
				(None, None) => {
					let id = uuid::Uuid::new_v4().to_string();
					info!(%id, config_dir = %dir, "writing a default profile from scratch");
					clear_default(&tx, CLAUDE)?;
					tx.execute(
						"INSERT INTO profiles(id, agent, name, config_dir, is_default, created_at)
						 VALUES (?1, ?2, ?3, ?4, 1, ?5)",
						params![id, CLAUDE, unique_seed_name(&tx)?, dir, crate::epoch_ms()],
					)?;
				}
			}
		}
		tx.commit()?;
		Ok(())
	})?;
	db.with(|conn| default_for(conn, CLAUDE))?
		.ok_or_else(|| AppError::Db("the default profile is missing right after seeding".into()))
}

/// Demote whatever holds the default for an agent. Always called *before* the
/// promotion it makes room for: the partial unique index rejects the second
/// default, so the other order cannot work — which is the constraint doing its
/// job rather than an ordering to remember.
fn clear_default(conn: &Connection, agent: &str) -> AppResult<()> {
	conn.execute(
		"UPDATE profiles SET is_default = 0 WHERE agent = ?1 AND is_default = 1",
		params![agent],
	)?;
	Ok(())
}

/// `Default`, or `Default (2)` if somebody has already taken the name. Names are
/// unique per agent, so a seed that collides would fail the insert — and it can
/// collide, because the seed runs on every boot and a user may rename another
/// profile to `Default` and then demote it.
fn unique_seed_name(conn: &Connection) -> AppResult<String> {
	for suffix in 0..100 {
		let name =
			if suffix == 0 { SEEDED_NAME.to_string() } else { format!("{SEEDED_NAME} ({suffix})") };
		let taken: bool = conn
			.query_row(
				"SELECT 1 FROM profiles WHERE agent = ?1 AND name = ?2",
				params![CLAUDE, name],
				|_| Ok(true),
			)
			.optional()?
			.unwrap_or(false);
		if !taken {
			return Ok(name);
		}
	}
	Err(AppError::InvalidInput("no free name for the default profile".into()))
}

/// Create a profile, making its directory if it is missing.
///
/// **The directory is left empty**, and that is the whole of the authentication
/// story: the CLI populates it on first run and asks the user to log in, which
/// is the only place a credential should ever appear. Copying one profile's
/// credentials into another would be us holding a secret, which this project
/// does not do.
pub fn create(conn: &Connection, input: &ProfileInput, now_ms: i64) -> AppResult<Profile> {
	let name = input.name.trim();
	if name.is_empty() {
		return Err(AppError::InvalidInput("a profile needs a name".into()));
	}
	let dir = validate_dir(conn, &input.config_dir)?;
	// Before the insert: a row pointing at a directory we could not create is a
	// profile that fails at spawn instead of at the form.
	std::fs::create_dir_all(&dir)?;

	let id = uuid::Uuid::new_v4().to_string();
	conn.execute(
		"INSERT INTO profiles(id, agent, name, config_dir, is_default, created_at)
		 VALUES (?1, ?2, ?3, ?4, 0, ?5)",
		params![id, CLAUDE, name, dir.to_string_lossy(), now_ms],
	)
	.map_err(name_or_dir_taken)?;
	get(conn, &id)
}

pub fn rename(conn: &Connection, id: &str, name: &str) -> AppResult<Profile> {
	let name = name.trim();
	if name.is_empty() {
		return Err(AppError::InvalidInput("a profile needs a name".into()));
	}
	let changed = conn
		.execute("UPDATE profiles SET name = ?2 WHERE id = ?1", params![id, name])
		.map_err(name_or_dir_taken)?;
	if changed == 0 {
		return Err(AppError::NotFound(format!("profile {id}")));
	}
	get(conn, id)
}

/// Promote a profile, demoting whatever held the default for its agent.
///
/// One transaction, and the clear happens first: the partial unique index would
/// reject the second default, so an ordering that sets before it clears cannot
/// work at all — which is the constraint doing its job.
pub fn set_default(conn: &mut Connection, id: &str) -> AppResult<Profile> {
	let tx = conn.transaction()?;
	let agent: String = tx
		.query_row("SELECT agent FROM profiles WHERE id = ?1", params![id], |r| r.get(0))
		.optional()?
		.ok_or_else(|| AppError::NotFound(format!("profile {id}")))?;
	clear_default(&tx, &agent)?;
	tx.execute("UPDATE profiles SET is_default = 1 WHERE id = ?1", params![id])?;
	tx.commit()?;
	get(conn, id)
}

/// Delete a profile. **Removes the row and nothing on disk.**
///
/// The config directory, the credentials in it and the transcripts under it all
/// stay. Deleting a login we deliberately never hold is not ours to do, and
/// re-adding a profile on the same path brings its sessions back on the next
/// scan.
///
/// Refuses while the profile is its agent's default: every project with no
/// assignment resolves through it, so removing it would leave those spawns
/// without an identity. Promote another first.
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
	let profile = get(conn, id)?;
	if profile.is_default {
		return Err(AppError::InvalidInput(
			"this is the default profile — make another one the default first".into(),
		));
	}
	// **Refused rather than cascaded** (F25 slice 3). `project_profiles` has
	// `ON DELETE CASCADE`, so the database would happily drop the assignment and
	// leave those projects spawning under the default — a silent move of
	// somebody's work to another identity. The count is named in the message
	// because "reassign them first" without "which" is not an instruction.
	let assigned_projects: i64 = conn.query_row(
		"SELECT COUNT(*) FROM project_profiles WHERE profile_id = ?1",
		params![id],
		|r| r.get(0),
	)?;
	if assigned_projects > 0 {
		return Err(AppError::InvalidInput(format!(
			"{assigned_projects} project(s) use this profile — point them somewhere else first"
		)));
	}
	conn.execute("DELETE FROM profiles WHERE id = ?1", params![id])?;
	Ok(())
}

/// The directory to suggest for a new profile called `name`.
///
/// Ours rather than `~/.claude-<name>`: a directory we propose inside our own
/// data area cannot collide with something the CLI or another tool already owns,
/// and the field is editable, so anyone with an existing `~/.claude-work` can
/// point at it instead.
pub fn suggested_dir(name: &str) -> PathBuf {
	let slug: String = name
		.trim()
		.to_lowercase()
		.chars()
		.map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
		.collect::<String>()
		.split('-')
		.filter(|s| !s.is_empty())
		.collect::<Vec<_>>()
		.join("-");
	let root = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")).join(".factorai/profiles");
	if slug.is_empty() {
		root
	} else {
		root.join(slug)
	}
}

/// A UNIQUE violation on this table is one of two user mistakes, and the
/// message has to say which. Everything else stays a `Db` error.
///
/// Matched on the **columns** SQLite names, not on the index name: a violation
/// reads `UNIQUE constraint failed: profiles.agent, profiles.name`, and the
/// index that was actually consulted appears nowhere in it.
fn name_or_dir_taken(e: rusqlite::Error) -> AppError {
	let text = e.to_string();
	if text.contains("profiles.config_dir") {
		AppError::InvalidInput("another profile already uses that directory".into())
	} else if text.contains("profiles.name") {
		AppError::InvalidInput("a profile with that name already exists".into())
	} else {
		AppError::from(e)
	}
}

/// Check a candidate config directory, returning it lexically cleaned.
///
/// **The nesting test is lexical, not `canonicalize`**, and that is deliberate:
/// the directory usually does not exist yet — that is the point of creating one
/// — and `canonicalize` fails on a path that is not there. A symlinked pair of
/// paths can therefore slip past it. The UNIQUE constraint is the backstop for
/// the case that actually matters (the same directory twice), and this is what
/// catches the shape a person types by accident.
fn validate_dir(conn: &Connection, raw: &str) -> AppResult<PathBuf> {
	let raw = raw.trim();
	if raw.is_empty() {
		return Err(AppError::InvalidInput("a profile needs a config directory".into()));
	}
	let path = clean(Path::new(raw));
	if !path.is_absolute() {
		return Err(AppError::InvalidInput(
			"a profile's config directory has to be an absolute path".into(),
		));
	}
	if path.exists() && !path.is_dir() {
		return Err(AppError::InvalidInput(format!("{} is not a directory", path.display())));
	}
	for other in list(conn)? {
		// A blank `config_dir` is migration 0017's unresolved placeholder, and
		// `Path::new("").starts_with` matches *everything* — so leaving it in the
		// comparison would refuse every directory anyone typed. `ensure_default`
		// resolves it at boot, before any of this is reachable; the guard is here
		// because the failure it prevents is total and silent.
		if other.config_dir.trim().is_empty() {
			continue;
		}
		let existing = clean(Path::new(&other.config_dir));
		if path.starts_with(&existing) || existing.starts_with(&path) {
			return Err(AppError::InvalidInput(format!(
				"that directory overlaps the profile \"{}\" at {}",
				other.name, other.config_dir
			)));
		}
	}
	Ok(path)
}

/// Drop `.` components and collapse `..`, without touching the filesystem.
/// `Path::components` already normalises separators and trailing slashes, so
/// what is left is making `/a/b/../c` and `/a/c` compare equal.
fn clean(path: &Path) -> PathBuf {
	let mut out = PathBuf::new();
	for c in path.components() {
		match c {
			Component::CurDir => {}
			Component::ParentDir => {
				out.pop();
			}
			other => out.push(other.as_os_str()),
		}
	}
	out
}

// ── The announcing layer ────────────────────────────────────────────────────
//
// Every write goes through one of these. What the event buys is the half a
// renderer cannot do for itself: the indexer re-reads profiles and re-arms its
// watches, which is what makes a new profile's sessions appear at all.

pub fn create_and_announce(
	db: &Db,
	app: &tauri::AppHandle,
	input: &ProfileInput,
	now_ms: i64,
) -> AppResult<Profile> {
	let profile = db.with(|conn| create(conn, input, now_ms))?;
	announce(app);
	Ok(profile)
}

pub fn rename_and_announce(
	db: &Db,
	app: &tauri::AppHandle,
	id: &str,
	name: &str,
) -> AppResult<Profile> {
	let profile = db.with(|conn| rename(conn, id, name))?;
	announce(app);
	Ok(profile)
}

pub fn set_default_and_announce(db: &Db, app: &tauri::AppHandle, id: &str) -> AppResult<Profile> {
	let profile = db.with_mut(|conn| set_default(conn, id))?;
	announce(app);
	Ok(profile)
}

pub fn delete_and_announce(db: &Db, app: &tauri::AppHandle, id: &str) -> AppResult<()> {
	db.with(|conn| delete(conn, id))?;
	announce(app);
	Ok(())
}

#[cfg(test)]
mod tests {
	use tempfile::TempDir;

	use super::*;

	fn db() -> (TempDir, Db) {
		let tmp = TempDir::new().unwrap();
		let db = Db::open(&tmp.path().join("data")).expect("open db");
		(tmp, db)
	}

	fn input(name: &str, dir: &Path) -> ProfileInput {
		ProfileInput { name: name.into(), config_dir: dir.to_string_lossy().into_owned() }
	}

	#[test]
	fn seeding_is_idempotent_and_does_not_reread_the_environment() {
		let (_tmp, db) = db();
		let home = tempfile::tempdir().unwrap();
		let first = ensure_default(&db, home.path()).unwrap();

		// A second boot with a *different* `CLAUDE_HOME` must not move the
		// default: the row is authoritative once it exists (Q3).
		let elsewhere = tempfile::tempdir().unwrap();
		let second = ensure_default(&db, elsewhere.path()).unwrap();
		assert_eq!(first.id, second.id);
		assert_eq!(second.config_dir, home.path().to_string_lossy());
		assert_eq!(db.with(list).unwrap().len(), 1);
	}

	#[test]
	fn seeding_promotes_the_profile_that_already_holds_the_directory() {
		let (_tmp, db) = db();
		let home = tempfile::tempdir().unwrap();
		// A database whose default was demoted by hand: `config_dir` is UNIQUE, so
		// inserting a second row for the same directory is not an option.
		db.with(|conn| {
			conn.execute(
				"INSERT INTO profiles(id, agent, name, config_dir, is_default, created_at)
				 VALUES ('p1', 'claude', 'Personal', ?1, 0, 1)",
				params![home.path().to_string_lossy()],
			)?;
			Ok(())
		})
		.unwrap();

		let seeded = ensure_default(&db, home.path()).unwrap();
		assert_eq!(seeded.id, "p1");
		assert_eq!(db.with(list).unwrap().len(), 1);
	}

	#[test]
	fn one_default_per_agent_survives_promotion() {
		let (_tmp, db) = db();
		let home = tempfile::tempdir().unwrap();
		let first = ensure_default(&db, home.path()).unwrap();
		let work = tempfile::tempdir().unwrap();
		let second = db.with(|c| create(c, &input("Work", &work.path().join("cfg")), 2)).unwrap();
		assert!(!second.is_default);

		db.with_mut(|c| set_default(c, &second.id)).unwrap();
		let after = db.with(list).unwrap();
		let defaults: Vec<_> = after.iter().filter(|p| p.is_default).map(|p| &p.id).collect();
		assert_eq!(defaults, vec![&second.id]);
		assert!(!after.iter().find(|p| p.id == first.id).unwrap().is_default);
	}

	#[test]
	fn creating_makes_the_directory_and_leaves_it_empty() {
		let (_tmp, db) = db();
		let root = tempfile::tempdir().unwrap();
		let dir = root.path().join("nested/work");
		let created = db.with(|c| create(c, &input("Work", &dir), 1)).unwrap();
		assert!(dir.is_dir());
		assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
		assert!(!created.missing);
	}

	#[test]
	fn a_directory_cannot_be_shared_or_nested() {
		let (_tmp, db) = db();
		let root = tempfile::tempdir().unwrap();
		let dir = root.path().join("work");
		db.with(|c| create(c, &input("Work", &dir), 1)).unwrap();

		let same = db.with(|c| create(c, &input("Work copy", &dir), 2));
		assert!(matches!(same, Err(AppError::InvalidInput(_))));
		let inside = db.with(|c| create(c, &input("Inside", &dir.join("deeper")), 3));
		assert!(matches!(inside, Err(AppError::InvalidInput(_))));
		let outside = db.with(|c| create(c, &input("Outside", root.path()), 4));
		assert!(matches!(outside, Err(AppError::InvalidInput(_))));
		// `..` is collapsed before the comparison, so this is the same path as
		// `work` wearing a disguise.
		let disguised = db.with(|c| create(c, &input("Disguised", &dir.join("../work")), 5));
		assert!(matches!(disguised, Err(AppError::InvalidInput(_))));
	}

	#[test]
	fn a_relative_directory_is_refused() {
		let (_tmp, db) = db();
		let bad = db.with(|c| {
			create(c, &ProfileInput { name: "Work".into(), config_dir: "some/where".into() }, 1)
		});
		assert!(matches!(bad, Err(AppError::InvalidInput(_))));
	}

	#[test]
	fn names_are_unique_per_agent() {
		let (_tmp, db) = db();
		let root = tempfile::tempdir().unwrap();
		db.with(|c| create(c, &input("Work", &root.path().join("a")), 1)).unwrap();
		let clash = db.with(|c| create(c, &input("Work", &root.path().join("b")), 2));
		assert!(matches!(clash, Err(AppError::InvalidInput(_))));
	}

	#[test]
	fn the_default_cannot_be_deleted_and_the_others_can() {
		let (_tmp, db) = db();
		let home = tempfile::tempdir().unwrap();
		let default = ensure_default(&db, home.path()).unwrap();
		let root = tempfile::tempdir().unwrap();
		let other = db.with(|c| create(c, &input("Work", &root.path().join("w")), 2)).unwrap();

		assert!(matches!(db.with(|c| delete(c, &default.id)), Err(AppError::InvalidInput(_))));
		db.with(|c| delete(c, &other.id)).unwrap();
		// The directory outlives the row: it holds a login we never held.
		assert!(root.path().join("w").is_dir());
		assert_eq!(db.with(list).unwrap().len(), 1);
	}

	#[test]
	fn a_missing_directory_is_reported_not_hidden() {
		let (_tmp, db) = db();
		let root = tempfile::tempdir().unwrap();
		let dir = root.path().join("gone");
		let created = db.with(|c| create(c, &input("Work", &dir), 1)).unwrap();
		assert!(!created.missing);
		std::fs::remove_dir_all(&dir).unwrap();
		let after = db.with(|c| get(c, &created.id)).unwrap();
		assert!(after.missing);
	}

	#[test]
	fn suggested_directories_are_slugs_under_our_own_data_area() {
		let root = dirs::home_dir().unwrap().join(".factorai/profiles");
		assert_eq!(suggested_dir("Work Account"), root.join("work-account"));
		assert_eq!(suggested_dir("  Wörk!! "), root.join("w-rk"));
		// Nothing usable in the name is not a reason to propose `/`.
		assert_eq!(suggested_dir("***"), root);
	}

	/// The three rules a spawn resolves by, in the order that makes the feature
	/// work (F25 slice 3).
	#[test]
	fn a_spawn_resolves_the_session_then_the_project_then_the_default() {
		let (_tmp, db) = db();
		let home = tempfile::tempdir().unwrap();
		let personal = ensure_default(&db, home.path()).unwrap();
		let root = tempfile::tempdir().unwrap();
		let work = db.with(|c| create(c, &input("Work", &root.path().join("work")), 2)).unwrap();

		db.with(|conn| {
			conn.execute(
				"INSERT INTO projects(id, real_path, display_name, opened_at)
				 VALUES ('p1', '/code/one', 'one', 0)",
				[],
			)?;
			// A transcript of `s1` sits in the *personal* store, recorded the way the
			// scan records it.
			conn.execute(
				"INSERT INTO discovered_projects(profile_id, key, real_path, project_id)
				 VALUES (?1, '-code-one', '/code/one', 'p1')",
				params![personal.id],
			)?;
			conn.execute(
				"INSERT INTO sessions(id, discovered_id, title, created_at, updated_at,
				                      turn_count, file_mtime, file_size)
				 SELECT 's1', id, '', 0, 0, 0, 0, 0 FROM discovered_projects",
				[],
			)?;
			Ok(())
		})
		.unwrap();

		// 3. Nothing assigned: the default.
		let resolved = db.with(|c| Ok(for_spawn(c, "p1", None))).unwrap().unwrap();
		assert_eq!(resolved.id, personal.id);

		// 2. Assigned: a new session uses the project's profile.
		db.with(|c| assign(c, "p1", Some(&work.id))).unwrap();
		let resolved = db.with(|c| Ok(for_spawn(c, "p1", None))).unwrap().unwrap();
		assert_eq!(resolved.id, work.id);

		// 1. **The session outranks the project**, which is the whole rule: `s1`'s
		// transcript is in the personal store, so resuming it anywhere else finds
		// nothing and silently starts a new conversation under an old name.
		let resolved = db.with(|c| Ok(for_spawn(c, "p1", Some("s1")))).unwrap().unwrap();
		assert_eq!(resolved.id, personal.id);

		// A session the scan has never seen has no transcript to be anywhere, so it
		// falls through to the project — which is where a brand-new session belongs.
		let resolved = db.with(|c| Ok(for_spawn(c, "p1", Some("unknown")))).unwrap().unwrap();
		assert_eq!(resolved.id, work.id);
	}

	#[test]
	fn assigning_a_project_moves_it_rather_than_adding_a_second_row() {
		let (_tmp, db) = db();
		let home = tempfile::tempdir().unwrap();
		let personal = ensure_default(&db, home.path()).unwrap();
		let root = tempfile::tempdir().unwrap();
		let work = db.with(|c| create(c, &input("Work", &root.path().join("work")), 2)).unwrap();
		db.with(|conn| {
			conn.execute(
				"INSERT INTO projects(id, real_path, display_name, opened_at)
				 VALUES ('p1', '/code/one', 'one', 0)",
				[],
			)?;
			Ok(())
		})
		.unwrap();

		db.with(|c| assign(c, "p1", Some(&personal.id))).unwrap();
		db.with(|c| assign(c, "p1", Some(&work.id))).unwrap();
		let rows: i64 = db
			.with(|conn| {
				Ok(conn.query_row(
					"SELECT COUNT(*) FROM project_profiles WHERE project_id = 'p1'",
					[],
					|r| r.get(0),
				)?)
			})
			.unwrap();
		assert_eq!(rows, 1, "one profile per project per agent");
		assert_eq!(db.with(|c| assigned(c, "p1", CLAUDE)).unwrap().unwrap().id, work.id);

		// Clearing falls back to the default rather than leaving a project with no
		// identity at all.
		db.with(|c| assign(c, "p1", None)).unwrap();
		assert!(db.with(|c| assigned(c, "p1", CLAUDE)).unwrap().is_none());
		assert_eq!(db.with(|c| Ok(for_spawn(c, "p1", None))).unwrap().unwrap().id, personal.id);
	}

	/// Deleting a profile that a project points at is refused, which is the other
	/// half of "no assignment means the default": a cascade would silently move
	/// that project's next session to another identity.
	#[test]
	fn a_profile_a_project_points_at_cannot_be_deleted() {
		let (_tmp, db) = db();
		let home = tempfile::tempdir().unwrap();
		ensure_default(&db, home.path()).unwrap();
		let root = tempfile::tempdir().unwrap();
		let work = db.with(|c| create(c, &input("Work", &root.path().join("work")), 2)).unwrap();
		db.with(|conn| {
			conn.execute(
				"INSERT INTO projects(id, real_path, display_name, opened_at)
				 VALUES ('p1', '/code/one', 'one', 0)",
				[],
			)?;
			Ok(())
		})
		.unwrap();
		db.with(|c| assign(c, "p1", Some(&work.id))).unwrap();

		assert!(matches!(db.with(|c| delete(c, &work.id)), Err(AppError::InvalidInput(_))));
		db.with(|c| assign(c, "p1", None)).unwrap();
		db.with(|c| delete(c, &work.id)).expect("deletable once nothing points at it");
	}
}
