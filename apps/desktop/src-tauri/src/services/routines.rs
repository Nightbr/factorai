//! Routines — a project's scheduled prompts (F22, ADR-0026).
//!
//! Two halves that are deliberately separable. The **store** is plain rows and
//! plain SQL. The **scheduler** is [`plan`], a pure function from a set of
//! routines plus a clock to a list of things to do, which is what makes the
//! rules that matter — the overlap skip, the concurrency cap, coalesced
//! catch-up — testable without a database, a PTY or a Tauri runtime.
//!
//! `croner` parses and projects the schedule; the deciding is ours (ADR-0026
//! § 5). What it buys is documented DST behaviour rather than incidental
//! behaviour: a fixed-time routine runs at the first valid instant after a
//! spring-forward gap and once only in a fall-back overlap (Q25).

use std::collections::HashSet;
use std::str::FromStr;

use chrono::{Local, TimeZone};
use croner::Cron;
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{AppError, AppResult};
use crate::models::{Routine, RoutineInput};

/// How often the runner asks "what is due?".
pub const TICK_SECS: u64 = 30;

/// An occurrence this recently past is **not** a missed fire, so it runs
/// whatever the catch-up window says — otherwise a routine with catch-up
/// switched off could only ever fire in the instant the tick happened to
/// coincide with its schedule.
const FRESH_MS: i64 = (TICK_SECS as i64 * 1000) * 4;

/// The app-wide catch-up window when `routines.catchup_hours` is unset.
pub const DEFAULT_CATCHUP_HOURS: i64 = 6;

/// How many routine sessions may start at once when `routines.max_concurrent`
/// is unset. Low on purpose: ten projects with an hourly routine all come due
/// at `:00`, and ten `claude` processes at once is not a schedule, it is a
/// thundering herd.
pub const DEFAULT_MAX_CONCURRENT: i64 = 2;

// ---------------------------------------------------------------- scheduling

/// What the scheduler decided about one routine this tick.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
	/// Start a session for the occurrence at this epoch-ms.
	Fire { occurrence: i64 },
	/// The previous session is still live, so this occurrence is dropped —
	/// consumed, not deferred, which is the only rule under which an
	/// overrunning routine cannot pile up (F22).
	Skip { occurrence: i64 },
}

/// One decision, paired with the routine it is about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Planned {
	pub routine_id: String,
	pub action: Action,
}

/// The scheduler, as a pure function.
///
/// `live` is the set of session ids with a live PTY. `cap` is how many routine
/// sessions may be running at once, and `running` how many already are.
///
/// **Everything past the cap is left for the next tick, in due order.** That is
/// the queue: a fire beyond the cap runs *late*, it is not skipped. Only an
/// overlap skips, and a skip does not consume a slot because it starts nothing.
pub fn plan(
	routines: &[Routine],
	live: &HashSet<String>,
	now_ms: i64,
	default_catchup_hours: i64,
	cap: i64,
	running: i64,
) -> Vec<Planned> {
	let mut due: Vec<(i64, &Routine)> = routines
		.iter()
		.filter_map(|r| due_occurrence(r, now_ms, default_catchup_hours).map(|at| (at, r)))
		.collect();
	// Oldest first: if the cap holds some back, the ones that have been waiting
	// longest go first.
	due.sort_by_key(|(at, r)| (*at, r.id.clone()));

	let mut started = running;
	let mut out = Vec::new();
	for (occurrence, routine) in due {
		let overlapping = routine.last_session_id.as_deref().is_some_and(|id| live.contains(id));
		if overlapping {
			out.push(Planned {
				routine_id: routine.id.clone(),
				action: Action::Skip { occurrence },
			});
			continue;
		}
		if started >= cap {
			// Not recorded at all: an unconsumed occurrence is exactly what the
			// next tick should find again.
			continue;
		}
		started += 1;
		out.push(Planned { routine_id: routine.id.clone(), action: Action::Fire { occurrence } });
	}
	out
}

/// The occurrence this routine owes a run for, if any.
///
/// **Only the most recent one is ever considered, which is what coalescing
/// is**: five hourly fires missed while the app was closed are one run, not
/// five, because the older four are not the latest occurrence and nothing ever
/// looks for them.
pub fn due_occurrence(routine: &Routine, now_ms: i64, default_catchup_hours: i64) -> Option<i64> {
	if !routine.enabled {
		return None;
	}
	let previous = previous_occurrence_ms(&routine.cron, now_ms)?;
	// A routine that has never fired is measured from when it was created, so
	// saving one at 10:00 does not immediately fire the 10:00 occurrence it was
	// written a moment too late for.
	let marker = routine.last_fire_at.unwrap_or(routine.created_at);
	if previous <= marker {
		return None;
	}
	let late_by = now_ms - previous;
	if late_by <= FRESH_MS {
		return Some(previous);
	}
	let hours = routine.catchup_hours.unwrap_or(default_catchup_hours).max(0);
	if late_by <= hours.saturating_mul(3_600_000) {
		Some(previous)
	} else {
		// Too old to be worth running, and deliberately **not** consumed: the
		// next occurrence will be the latest one soon enough, and writing a
		// marker here would be a record of a run that never happened.
		None
	}
}

/// Parse a cron expression, or say why it cannot be one.
///
/// The one place an expression is validated, so a routine that could never fire
/// cannot be saved — a schedule that silently does nothing is the failure this
/// feature is least able to explain after the fact.
pub fn parse_cron(expr: &str) -> AppResult<Cron> {
	Cron::from_str(expr)
		.map_err(|e| AppError::InvalidInput(format!("not a cron expression: {expr} ({e})")))
}

/// The next time this expression fires after `from_ms`, in epoch ms.
pub fn next_occurrence_ms(expr: &str, from_ms: i64) -> Option<i64> {
	let cron = parse_cron(expr).ok()?;
	let from = local(from_ms)?;
	cron.find_next_occurrence(&from, false).ok().map(|dt| dt.timestamp_millis())
}

/// The most recent time this expression fired at or before `at_ms`.
fn previous_occurrence_ms(expr: &str, at_ms: i64) -> Option<i64> {
	let cron = parse_cron(expr).ok()?;
	let at = local(at_ms)?;
	cron.find_previous_occurrence(&at, true).ok().map(|dt| dt.timestamp_millis())
}

/// Epoch ms as **local** wall-clock time, which is what a cron expression means
/// (Q25). `None` only for a timestamp local time cannot represent.
fn local(ms: i64) -> Option<chrono::DateTime<Local>> {
	Local.timestamp_millis_opt(ms).single()
}

// -------------------------------------------------------------------- store

const COLUMNS: &str = "id, project_id, name, cron, prompt, enabled, catchup_hours,
	 last_fire_at, last_run_at, last_session_id, last_skipped_at, last_error, created_at";

fn row_to_routine(row: &rusqlite::Row<'_>, now_ms: i64) -> rusqlite::Result<Routine> {
	let cron: String = row.get(3)?;
	// Derived per query rather than stored, so a row can never carry a stale
	// "next run" — the only thing that could make it stale is time passing.
	let next_run_at = next_occurrence_ms(&cron, now_ms);
	Ok(Routine {
		id: row.get(0)?,
		project_id: row.get(1)?,
		name: row.get(2)?,
		cron,
		prompt: row.get(4)?,
		enabled: row.get::<_, i64>(5)? != 0,
		catchup_hours: row.get(6)?,
		last_fire_at: row.get(7)?,
		last_run_at: row.get(8)?,
		last_session_id: row.get(9)?,
		last_skipped_at: row.get(10)?,
		last_error: row.get(11)?,
		created_at: row.get(12)?,
		next_run_at,
	})
}

/// Every routine in one project, oldest first — the order they were written in,
/// which is the only order a hand-maintained list of half a dozen wants.
pub fn list(conn: &Connection, project_id: &str, now_ms: i64) -> AppResult<Vec<Routine>> {
	let sql = format!("SELECT {COLUMNS} FROM routines WHERE project_id = ?1 ORDER BY created_at");
	let mut stmt = conn.prepare(&sql)?;
	let rows = stmt
		.query_map(params![project_id], |row| row_to_routine(row, now_ms))?
		.collect::<rusqlite::Result<Vec<_>>>()?;
	Ok(rows)
}

/// Every routine in every project — what the runner ticks over.
pub fn list_all(conn: &Connection, now_ms: i64) -> AppResult<Vec<Routine>> {
	let sql = format!("SELECT {COLUMNS} FROM routines ORDER BY created_at");
	let mut stmt = conn.prepare(&sql)?;
	let rows = stmt
		.query_map([], |row| row_to_routine(row, now_ms))?
		.collect::<rusqlite::Result<Vec<_>>>()?;
	Ok(rows)
}

/// One routine by id.
pub fn get(conn: &Connection, id: &str, now_ms: i64) -> AppResult<Routine> {
	let sql = format!("SELECT {COLUMNS} FROM routines WHERE id = ?1");
	conn.query_row(&sql, params![id], |row| row_to_routine(row, now_ms))
		.optional()?
		.ok_or_else(|| AppError::NotFound(format!("no routine {id}")))
}

/// Create a routine. The cron expression is validated first — see [`parse_cron`].
pub fn create(conn: &Connection, input: &RoutineInput, now_ms: i64) -> AppResult<Routine> {
	parse_cron(&input.cron)?;
	let id = uuid::Uuid::new_v4().to_string();
	conn.execute(
		"INSERT INTO routines(id, project_id, name, cron, prompt, enabled, catchup_hours, created_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
		params![
			id,
			input.project_id,
			input.name,
			input.cron,
			input.prompt,
			i64::from(input.enabled),
			input.catchup_hours,
			now_ms
		],
	)?;
	get(conn, &id, now_ms)
}

/// Rewrite a routine's configuration. Run state is not touched: it belongs to
/// the runner, and a caller that could write `last_run_at` could rewrite
/// whether something ran.
pub fn update(
	conn: &Connection,
	id: &str,
	input: &RoutineInput,
	now_ms: i64,
) -> AppResult<Routine> {
	parse_cron(&input.cron)?;
	let changed = conn.execute(
		"UPDATE routines SET name = ?2, cron = ?3, prompt = ?4, enabled = ?5, catchup_hours = ?6
		 WHERE id = ?1",
		params![
			id,
			input.name,
			input.cron,
			input.prompt,
			i64::from(input.enabled),
			input.catchup_hours
		],
	)?;
	if changed == 0 {
		return Err(AppError::NotFound(format!("no routine {id}")));
	}
	get(conn, id, now_ms)
}

/// Delete a routine. **Its running session is left alone** (F22) — the
/// `session_routines` row survives with a null routine, so the session's origin
/// icon degrades rather than the session pretending a human started it.
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
	conn.execute("DELETE FROM routines WHERE id = ?1", params![id])?;
	Ok(())
}

/// Stop, or resume, future fires. Never touches a live session: that is not
/// what a switch means.
pub fn set_enabled(conn: &Connection, id: &str, enabled: bool) -> AppResult<()> {
	let changed = conn.execute(
		"UPDATE routines SET enabled = ?2 WHERE id = ?1",
		params![id, i64::from(enabled)],
	)?;
	if changed == 0 {
		return Err(AppError::NotFound(format!("no routine {id}")));
	}
	Ok(())
}

/// Record that an occurrence started a session.
///
/// `last_run_at` is the **fire**, not the completion (F22): a run that
/// kill-on-quit takes still counts, because re-running an agent that already
/// committed is worse than skipping it and nothing can tell those apart after.
pub fn record_fire(
	conn: &Connection,
	id: &str,
	occurrence: i64,
	session_id: &str,
	now_ms: i64,
) -> AppResult<()> {
	conn.execute(
		"UPDATE routines
		 SET last_fire_at = ?2, last_run_at = ?3, last_session_id = ?4, last_error = NULL
		 WHERE id = ?1",
		params![id, occurrence, now_ms, session_id],
	)?;
	Ok(())
}

/// Record that an occurrence was dropped because the previous session was still
/// live. `last_fire_at` moves, because a skipped fire is consumed rather than
/// deferred — without that it would come back every tick for the rest of the day.
pub fn record_skip(conn: &Connection, id: &str, occurrence: i64, now_ms: i64) -> AppResult<()> {
	conn.execute(
		"UPDATE routines SET last_fire_at = ?2, last_skipped_at = ?3 WHERE id = ?1",
		params![id, occurrence, now_ms],
	)?;
	Ok(())
}

/// Record that an occurrence could not start. The occurrence is consumed for
/// the same reason a skip is: a fire that fails every tick is a loop, and the
/// row carries the reason where being away from the machine cannot lose it.
pub fn record_error(conn: &Connection, id: &str, occurrence: i64, error: &str) -> AppResult<()> {
	conn.execute(
		"UPDATE routines SET last_fire_at = ?2, last_error = ?3 WHERE id = ?1",
		params![id, occurrence, error],
	)?;
	Ok(())
}

/// Mark a session as a routine's. Written at spawn — which is why
/// `session_routines` has no foreign key to `sessions` (migration 0013).
pub fn link_session(
	conn: &Connection,
	session_id: &str,
	routine_id: &str,
	now_ms: i64,
) -> AppResult<()> {
	conn.execute(
		"INSERT INTO session_routines(session_id, routine_id, created_at) VALUES (?1, ?2, ?3)
		 ON CONFLICT(session_id) DO UPDATE SET routine_id = excluded.routine_id",
		params![session_id, routine_id, now_ms],
	)?;
	Ok(())
}

/// How many of the currently live sessions a routine started.
///
/// Counted from the table rather than remembered, so it survives a renderer
/// reload — the PTYs do, and a cap that forgot them would let the next tick
/// start another N.
pub fn running_count(conn: &Connection, live: &HashSet<String>) -> AppResult<i64> {
	if live.is_empty() {
		return Ok(0);
	}
	let mut stmt = conn.prepare("SELECT session_id FROM session_routines")?;
	let ids =
		stmt.query_map([], |row| row.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
	Ok(ids.iter().filter(|id| live.contains(*id)).count() as i64)
}

/// A setting that is a whole number, or the default when it is unset or is not
/// one. A malformed value is a preference to ignore, never a reason to stop
/// scheduling.
pub fn numeric_setting(conn: &Connection, key: crate::models::SettingKey, default: i64) -> i64 {
	crate::services::settings::get(conn, key)
		.ok()
		.flatten()
		.and_then(|v| v.trim().parse::<i64>().ok())
		.unwrap_or(default)
}

// ------------------------------------------------------------------- runner

/// The tick that starts routine sessions (ADR-0026 § 1).
///
/// **It decides; it does not spawn.** The renderer performs the spawn, into a
/// hidden pooled terminal with no tab, so a fire needs a live renderer — which
/// is the same window the schedule already needs open. What this owns is the
/// clock, the rules and the writes, in that order: every row is written
/// *before* `routine:fire` goes out, the same write-then-emit ordering
/// `session:worktree` follows, because an event ahead of its row is a fact the
/// next reload disagrees with.
pub struct Runner {
	db: crate::db::Db,
	app: tauri::AppHandle,
	/// The live PTYs, asked for rather than held: the runner needs an answer
	/// from `TerminalManager` and a count from the database, and owning either
	/// would make it the wrong kind of object.
	live: std::sync::Arc<dyn Fn() -> HashSet<String> + Send + Sync>,
}

/// What the renderer is told to start.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FireEvent {
	pub routine_id: String,
	pub routine_name: String,
	pub project_id: String,
	pub session_id: String,
	pub prompt: String,
	/// The project's folder. Resolved here because the runner already had to
	/// read the row to know the project exists at all.
	pub cwd: String,
}

impl Runner {
	pub fn new(
		db: crate::db::Db,
		app: tauri::AppHandle,
		live: std::sync::Arc<dyn Fn() -> HashSet<String> + Send + Sync>,
	) -> Self {
		Self { db, app, live }
	}

	/// Start ticking. The first tick is immediate — that is catch-up, which is
	/// not a separate mechanism: an occurrence missed while the app was closed
	/// is simply one whose latest instance is in the past (see
	/// [`due_occurrence`]).
	/// **A named thread, not `tokio::spawn`** — found by running it. `setup()` is
	/// called before Tauri's runtime exists, so spawning a task there panics with
	/// *"there is no reactor running"* on the main thread, before the window
	/// appears. The indexer's scan and the watcher are threads for the same
	/// reason, and this loop blocks on a sleep rather than doing async work
	/// anyway.
	pub fn start(self: std::sync::Arc<Self>) {
		std::thread::Builder::new()
			.name("routine-runner".into())
			.spawn(move || {
				loop {
					// Immediately, then every tick: the first pass *is* catch-up.
					self.tick(crate::epoch_ms());
					std::thread::sleep(std::time::Duration::from_secs(TICK_SECS));
				}
			})
			.expect("failed to spawn routine runner thread");
	}

	/// Fire one routine on demand, through the same rules a tick applies.
	///
	/// The overlap skip and the cap are not the schedule's rules, they are the
	/// feature's — a `Run now` that ignored them would be a second set of rules
	/// for the same act, and the one most likely to be clicked twice.
	pub fn run_now(&self, routine: &Routine, now_ms: i64) {
		let live = (self.live)();
		if routine.last_session_id.as_deref().is_some_and(|id| live.contains(id)) {
			let _ = self.db.with(|conn| record_skip(conn, &routine.id, now_ms, now_ms));
			return;
		}
		let capped = self.db.with(|conn| {
			let cap = numeric_setting(
				conn,
				crate::models::SettingKey::RoutinesMaxConcurrent,
				DEFAULT_MAX_CONCURRENT,
			)
			.max(1);
			Ok(running_count(conn, &live)? >= cap)
		});
		if capped.unwrap_or(false) {
			return;
		}
		self.fire(routine, now_ms, now_ms);
	}

	/// One pass. Public for the integration test, which drives it with a clock
	/// it controls rather than waiting thirty seconds.
	pub fn tick(&self, now_ms: i64) {
		if let Err(e) = self.tick_inner(now_ms) {
			// Logged, never propagated: a tick that fails is one schedule pass
			// missed, and the loop has to survive it.
			tracing::warn!(error = %e, "routine tick failed");
		}
	}

	fn tick_inner(&self, now_ms: i64) -> AppResult<()> {
		let live = (self.live)();
		let (planned, folders) = self.db.with(|conn| {
			let routines = list_all(conn, now_ms)?;
			let cap = numeric_setting(
				conn,
				crate::models::SettingKey::RoutinesMaxConcurrent,
				DEFAULT_MAX_CONCURRENT,
			)
			.max(1);
			let default_catchup = numeric_setting(
				conn,
				crate::models::SettingKey::RoutinesCatchupHours,
				DEFAULT_CATCHUP_HOURS,
			);
			let running = running_count(conn, &live)?;
			let planned = plan(&routines, &live, now_ms, default_catchup, cap, running);
			let by_id: std::collections::HashMap<String, Routine> =
				routines.into_iter().map(|r| (r.id.clone(), r)).collect();
			Ok((planned, by_id))
		})?;

		for step in planned {
			let Some(routine) = folders.get(&step.routine_id) else { continue };
			match step.action {
				Action::Skip { occurrence } => {
					self.db.with(|conn| record_skip(conn, &routine.id, occurrence, now_ms))?;
					tracing::info!(
						routine = %routine.name,
						"routine skipped: its previous session is still running"
					);
				}
				Action::Fire { occurrence } => self.fire(routine, occurrence, now_ms),
			}
		}
		Ok(())
	}

	/// Consume one occurrence: mint the id, write the rows, then tell the
	/// renderer.
	fn fire(&self, routine: &Routine, occurrence: i64, now_ms: i64) {
		let folder = match self.project_folder(&routine.project_id) {
			Ok(Some(path)) => path,
			// The project is gone from the workspace, or its folder is. Recorded
			// on the row rather than only in the log: a routine that stopped
			// working has to be able to say so from the list, where being away
			// from the machine cannot lose it.
			Ok(None) => {
				self.record_failure(routine, occurrence, "the project folder is gone");
				return;
			}
			Err(e) => {
				self.record_failure(routine, occurrence, &e.to_string());
				return;
			}
		};

		let session_id = uuid::Uuid::new_v4().to_string();
		let written = self.db.with(|conn| {
			link_session(conn, &session_id, &routine.id, now_ms)?;
			record_fire(conn, &routine.id, occurrence, &session_id, now_ms)
		});
		if let Err(e) = written {
			tracing::warn!(error = %e, routine = %routine.name, "could not record a routine fire");
			return;
		}

		use tauri::Emitter;
		let _ = self.app.emit(
			"routine:fire",
			FireEvent {
				routine_id: routine.id.clone(),
				routine_name: routine.name.clone(),
				project_id: routine.project_id.clone(),
				session_id,
				prompt: routine.prompt.clone(),
				cwd: folder,
			},
		);
	}

	fn record_failure(&self, routine: &Routine, occurrence: i64, message: &str) {
		tracing::warn!(routine = %routine.name, message, "routine could not start");
		let _ = self.db.with(|conn| record_error(conn, &routine.id, occurrence, message));
	}

	/// The project's folder, or `None` when there is no usable one — which is
	/// the same rule the sidebar's `+` button follows, for the same reason: a
	/// folder that is not there sends `claude` to `$HOME` and files the session
	/// under another project.
	fn project_folder(&self, project_id: &str) -> AppResult<Option<String>> {
		let path: Option<String> = self.db.with(|conn| {
			Ok(conn
				.query_row(
					"SELECT real_path FROM projects WHERE id = ?1",
					params![project_id],
					|row| row.get::<_, String>(0),
				)
				.optional()?)
		})?;
		Ok(path.filter(|p| std::path::Path::new(p).is_dir()))
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::db::Db;
	use tempfile::TempDir;

	fn db() -> (TempDir, Db) {
		let tmp = TempDir::new().unwrap();
		let db = Db::open(&tmp.path().join("data")).expect("open db");
		db.with(|conn| {
			conn.execute(
				"INSERT INTO projects(id, real_path, display_name, opened_at)
				 VALUES ('p1', '/tmp/p1', 'p1', 0)",
				[],
			)?;
			Ok(())
		})
		.unwrap();
		(tmp, db)
	}

	fn input() -> RoutineInput {
		RoutineInput {
			project_id: "p1".into(),
			name: "Nightly triage".into(),
			cron: "0 2 * * *".into(),
			prompt: "Triage the inbox".into(),
			enabled: true,
			catchup_hours: None,
		}
	}

	/// Epoch ms for a local wall-clock time, which is the only clock a cron
	/// expression has an opinion about.
	fn at(y: i32, m: u32, d: u32, h: u32, min: u32) -> i64 {
		use chrono::NaiveDate;
		let naive = NaiveDate::from_ymd_opt(y, m, d).unwrap().and_hms_opt(h, min, 0).unwrap();
		Local.from_local_datetime(&naive).unwrap().timestamp_millis()
	}

	fn routine(cron: &str, created: i64) -> Routine {
		Routine {
			id: "r1".into(),
			project_id: "p1".into(),
			name: "r".into(),
			cron: cron.into(),
			prompt: "p".into(),
			enabled: true,
			catchup_hours: None,
			last_fire_at: None,
			last_run_at: None,
			last_session_id: None,
			last_skipped_at: None,
			last_error: None,
			created_at: created,
			next_run_at: None,
		}
	}

	#[test]
	fn a_routine_created_after_todays_occurrence_does_not_fire_immediately() {
		// Created at 03:00, scheduled for 02:00. The 02:00 that already happened
		// is not a fire it missed — it is one it was written too late for.
		let r = routine("0 2 * * *", at(2026, 8, 20, 3, 0));
		assert_eq!(due_occurrence(&r, at(2026, 8, 20, 3, 30), 6), None);
	}

	#[test]
	fn an_occurrence_that_just_passed_fires_even_with_catchup_off() {
		let mut r = routine("0 2 * * *", at(2026, 8, 19, 0, 0));
		r.catchup_hours = Some(0);
		let now = at(2026, 8, 20, 2, 0) + 1000;
		assert_eq!(due_occurrence(&r, now, 6), Some(at(2026, 8, 20, 2, 0)));
	}

	#[test]
	fn a_missed_occurrence_inside_the_window_still_fires() {
		let mut r = routine("0 2 * * *", at(2026, 8, 19, 0, 0));
		r.catchup_hours = Some(6);
		// Four hours late — the laptop was shut.
		assert_eq!(due_occurrence(&r, at(2026, 8, 20, 6, 0), 6), Some(at(2026, 8, 20, 2, 0)));
	}

	#[test]
	fn a_missed_occurrence_past_the_window_does_not_fire_and_is_not_consumed() {
		let mut r = routine("0 2 * * *", at(2026, 8, 19, 0, 0));
		r.catchup_hours = Some(2);
		assert_eq!(due_occurrence(&r, at(2026, 8, 20, 9, 0), 6), None);
	}

	#[test]
	fn catchup_zero_means_never_late() {
		let mut r = routine("0 2 * * *", at(2026, 8, 19, 0, 0));
		r.catchup_hours = Some(0);
		assert_eq!(due_occurrence(&r, at(2026, 8, 20, 5, 0), 6), None);
	}

	#[test]
	fn the_app_wide_default_applies_when_the_routine_does_not_override() {
		let r = routine("0 2 * * *", at(2026, 8, 19, 0, 0));
		let now = at(2026, 8, 20, 5, 0);
		assert_eq!(due_occurrence(&r, now, 6), Some(at(2026, 8, 20, 2, 0)));
		assert_eq!(due_occurrence(&r, now, 1), None);
	}

	#[test]
	fn five_missed_hourly_fires_are_one_run() {
		// Closed from 02:00 to 07:00 with an hourly routine: only 07:00 is
		// considered, because nothing ever looks past the latest occurrence.
		let mut r = routine("0 * * * *", at(2026, 8, 19, 0, 0));
		r.last_fire_at = Some(at(2026, 8, 20, 2, 0));
		r.catchup_hours = Some(12);
		let now = at(2026, 8, 20, 7, 30);
		assert_eq!(due_occurrence(&r, now, 6), Some(at(2026, 8, 20, 7, 0)));
	}

	#[test]
	fn a_disabled_routine_is_never_due() {
		let mut r = routine("0 * * * *", at(2026, 8, 19, 0, 0));
		r.enabled = false;
		assert_eq!(due_occurrence(&r, at(2026, 8, 20, 7, 1), 6), None);
	}

	#[test]
	fn an_overlapping_routine_skips_rather_than_starting_a_second_session() {
		let mut r = routine("0 * * * *", at(2026, 8, 19, 0, 0));
		r.last_fire_at = Some(at(2026, 8, 20, 6, 0));
		r.last_session_id = Some("s-live".into());
		let live = HashSet::from(["s-live".to_string()]);
		let planned = plan(&[r], &live, at(2026, 8, 20, 7, 0) + 1000, 6, 2, 0);
		assert_eq!(
			planned,
			vec![Planned {
				routine_id: "r1".into(),
				action: Action::Skip { occurrence: at(2026, 8, 20, 7, 0) },
			}]
		);
	}

	#[test]
	fn the_cap_holds_the_rest_back_rather_than_dropping_them() {
		let now = at(2026, 8, 20, 7, 0) + 1000;
		let mut rs = Vec::new();
		for i in 0..4 {
			let mut r = routine("0 * * * *", at(2026, 8, 19, 0, 0));
			r.id = format!("r{i}");
			rs.push(r);
		}
		let planned = plan(&rs, &HashSet::new(), now, 6, 2, 0);
		// Two start; the other two are not recorded at all, so the next tick
		// finds the same occurrence and runs them late.
		assert_eq!(planned.len(), 2);
		assert!(planned.iter().all(|p| matches!(p.action, Action::Fire { .. })));
		assert_eq!(planned[0].routine_id, "r0");

		// One slot left because one is already running.
		let planned = plan(&rs, &HashSet::new(), now, 6, 2, 1);
		assert_eq!(planned.len(), 1);
	}

	#[test]
	fn a_skip_does_not_consume_a_slot() {
		let now = at(2026, 8, 20, 7, 0) + 1000;
		let mut overlapping = routine("0 * * * *", at(2026, 8, 19, 0, 0));
		overlapping.id = "r-overlap".into();
		overlapping.last_session_id = Some("s-live".into());
		let mut fresh = routine("0 * * * *", at(2026, 8, 19, 0, 0));
		fresh.id = "r-fresh".into();
		let live = HashSet::from(["s-live".to_string()]);

		// One slot, and the overlapping routine does not take it: it starts
		// nothing, so the other still runs on the same tick.
		let planned = plan(&[overlapping, fresh], &live, now, 6, 1, 0);
		assert_eq!(planned.len(), 2);
		let action = |id: &str| {
			planned.iter().find(|p| p.routine_id == id).map(|p| p.action.clone()).unwrap()
		};
		assert!(matches!(action("r-overlap"), Action::Skip { .. }));
		assert!(matches!(action("r-fresh"), Action::Fire { .. }));
	}

	#[test]
	fn an_invalid_expression_cannot_be_saved() {
		let (_tmp, db) = db();
		db.with(|conn| {
			let mut bad = input();
			bad.cron = "not a cron".into();
			assert!(create(conn, &bad, 1).is_err());
			Ok(())
		})
		.unwrap();
	}

	#[test]
	fn crud_round_trips() {
		let (_tmp, db) = db();
		db.with(|conn| {
			let now = at(2026, 8, 20, 12, 0);
			let created = create(conn, &input(), now)?;
			assert_eq!(created.name, "Nightly triage");
			assert!(created.enabled);
			// Derived, and derived from *now* rather than stored.
			assert_eq!(created.next_run_at, Some(at(2026, 8, 21, 2, 0)));

			let mut changed = input();
			changed.name = "Nightly digest".into();
			changed.catchup_hours = Some(0);
			let updated = update(conn, &created.id, &changed, now)?;
			assert_eq!(updated.name, "Nightly digest");
			assert_eq!(updated.catchup_hours, Some(0));

			set_enabled(conn, &created.id, false)?;
			assert!(!get(conn, &created.id, now)?.enabled);

			assert_eq!(list(conn, "p1", now)?.len(), 1);
			delete(conn, &created.id)?;
			assert!(list(conn, "p1", now)?.is_empty());
			Ok(())
		})
		.unwrap();
	}

	#[test]
	fn run_state_is_recorded_and_a_fire_clears_the_last_error() {
		let (_tmp, db) = db();
		db.with(|conn| {
			let now = at(2026, 8, 20, 12, 0);
			let r = create(conn, &input(), now)?;
			record_error(conn, &r.id, now, "claude not found")?;
			assert_eq!(get(conn, &r.id, now)?.last_error.as_deref(), Some("claude not found"));

			record_fire(conn, &r.id, now, "s1", now + 5)?;
			let after = get(conn, &r.id, now)?;
			assert_eq!(after.last_error, None);
			assert_eq!(after.last_session_id.as_deref(), Some("s1"));
			assert_eq!(after.last_fire_at, Some(now));
			assert_eq!(after.last_run_at, Some(now + 5));

			record_skip(conn, &r.id, now + 3_600_000, now + 3_600_001)?;
			let after = get(conn, &r.id, now)?;
			// The skip consumed the occurrence — otherwise it comes back every
			// tick — while the last *run* is still the one that really happened.
			assert_eq!(after.last_fire_at, Some(now + 3_600_000));
			assert_eq!(after.last_run_at, Some(now + 5));
			assert_eq!(after.last_skipped_at, Some(now + 3_600_001));
			Ok(())
		})
		.unwrap();
	}

	#[test]
	fn a_sessions_origin_survives_its_routine_being_deleted() {
		let (_tmp, db) = db();
		db.with(|conn| {
			let now = at(2026, 8, 20, 12, 0);
			let r = create(conn, &input(), now)?;
			// No `sessions` row exists — this is the case migration 0007 found,
			// and the insert has to work anyway.
			link_session(conn, "s-new", &r.id, now)?;
			delete(conn, &r.id)?;
			let routine_id: Option<String> = conn.query_row(
				"SELECT routine_id FROM session_routines WHERE session_id = 's-new'",
				[],
				|row| row.get(0),
			)?;
			assert_eq!(routine_id, None);
			Ok(())
		})
		.unwrap();
	}

	#[test]
	fn running_count_only_counts_live_routine_sessions() {
		let (_tmp, db) = db();
		db.with(|conn| {
			let now = at(2026, 8, 20, 12, 0);
			let r = create(conn, &input(), now)?;
			link_session(conn, "s-live", &r.id, now)?;
			link_session(conn, "s-dead", &r.id, now)?;
			let live = HashSet::from(["s-live".to_string(), "s-human".to_string()]);
			assert_eq!(running_count(conn, &live)?, 1);
			assert_eq!(running_count(conn, &HashSet::new())?, 0);
			Ok(())
		})
		.unwrap();
	}

	#[test]
	fn a_malformed_setting_falls_back_to_the_default() {
		let (_tmp, db) = db();
		db.with(|conn| {
			use crate::models::SettingKey;
			assert_eq!(numeric_setting(conn, SettingKey::RoutinesMaxConcurrent, 2), 2);
			crate::services::settings::set(conn, SettingKey::RoutinesMaxConcurrent, Some("4"))?;
			assert_eq!(numeric_setting(conn, SettingKey::RoutinesMaxConcurrent, 2), 4);
			crate::services::settings::set(conn, SettingKey::RoutinesMaxConcurrent, Some("lots"))?;
			assert_eq!(numeric_setting(conn, SettingKey::RoutinesMaxConcurrent, 2), 2);
			Ok(())
		})
		.unwrap();
	}
}
