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

use serde::Serialize;

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

/// How long a claimed fire may go unstarted before the runner gives up on it
/// (ADR-0030).
///
/// The renderer normally starts one within a second of the claim — the same tick
/// on a running window, the first paint after a launch. Five minutes is what a
/// slow start, a webview reload or a `location.reload()` mid-fire can take
/// without anything being wrong; past it, nothing is coming, and the row is
/// better off saying so than holding an occurrence open forever.
pub const CLAIM_GRACE_MS: i64 = 5 * 60 * 1000;

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
/// `claimed` is the set of routines with a fire already in flight — decided and
/// emitted, not yet started (ADR-0030). **Those are not due again**: the
/// occurrence a claim is for is deliberately unconsumed, so the claim is the
/// only thing between it and a second decision thirty seconds later.
///
/// **Everything past the cap is left for the next tick, in due order.** That is
/// the queue: a fire beyond the cap runs *late*, it is not skipped. Only an
/// overlap skips, and a skip does not consume a slot because it starts nothing.
pub fn plan(
	routines: &[Routine],
	live: &HashSet<String>,
	claimed: &HashSet<String>,
	now_ms: i64,
	default_catchup_hours: i64,
	cap: i64,
	running: i64,
) -> Vec<Planned> {
	let mut due: Vec<(i64, &Routine)> = routines
		.iter()
		.filter(|r| !claimed.contains(&r.id))
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
	cron.find_next_occurrence(&from, false).ok().map(|dt| whole_second(dt.timestamp_millis()))
}

/// The most recent time this expression fired at or before `at_ms`.
fn previous_occurrence_ms(expr: &str, at_ms: i64) -> Option<i64> {
	let cron = parse_cron(expr).ok()?;
	let at = local(at_ms)?;
	cron.find_previous_occurrence(&at, true).ok().map(|dt| whole_second(dt.timestamp_millis()))
}

/// An occurrence to the second, dropping whatever sub-second part came with it.
///
/// **A correctness fix, not tidiness** (2026-08-30, found in the wild: a routine
/// started a session on every tick for a whole minute). `croner` answers
/// `find_previous_occurrence` with the *query instant's* milliseconds attached —
/// ask at `02:00:14.974` and the 02:00 occurrence comes back as `02:00:00.974`.
/// `last_fire_at` stores that, the next tick asks at `02:00:44.976`, gets
/// `02:00:00.976`, and finds it **greater than the marker** — so the same cron
/// minute is due again, and again, until the minute is over.
///
/// Truncating here makes an occurrence a property of the schedule rather than of
/// the moment somebody asked, which is what the marker comparison in
/// [`due_occurrence`] assumes. `div_euclid` rather than `/`, so a pre-1970
/// timestamp truncates downwards like every other one.
fn whole_second(ms: i64) -> i64 {
	ms.div_euclid(1000) * 1000
}

/// Epoch ms as **local** wall-clock time, which is what a cron expression means
/// (Q25). `None` only for a timestamp local time cannot represent.
fn local(ms: i64) -> Option<chrono::DateTime<Local>> {
	Local.timestamp_millis_opt(ms).single()
}

// -------------------------------------------------------------------- store

const COLUMNS: &str = "id, project_id, name, cron, prompt, enabled, catchup_hours,
	 last_fire_at, last_run_at, last_session_id, last_skipped_at, last_error, created_at,
	 created_by_session_id, last_modified_by_session_id";

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
		created_by_session_id: row.get(13)?,
		last_modified_by_session_id: row.get(14)?,
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

/// How many routines one project may hold (F22 slice 3, ADR-0028).
///
/// Far above any hand-maintained list and low enough that a loop stops within a
/// tick. It exists because an agent can write routines now, and an agent inside
/// a routine's own session can write more: the concurrency cap bounds what
/// *runs*, and nothing bounded what *accumulates*. Enforced in the store rather
/// than at the bridge, so the editor answers the same way — one rule, both
/// callers, which is the shape `run_now` already established.
pub const MAX_PER_PROJECT: i64 = 20;

/// A name has to fit a row that truncates at a couple of hundred pixels; this
/// is the bound that stops it being a document.
const MAX_NAME_LEN: usize = 200;

/// A prompt becomes argv on a spawn that may be hours away (ADR-0026 § 4).
/// Unbounded, it is a spawn failure long after the call that caused it, with
/// nobody watching. Generous for a prompt and far under either platform's argv
/// limit.
const MAX_PROMPT_LEN: usize = 8192;

/// A change to some of a routine's fields.
///
/// **The bridge's shape, not the editor's** (ADR-0028). The editor is a form: it
/// holds every field and sends all of them, which is the honest write for it.
/// An agent holds a subset and would otherwise have to read, echo back
/// everything it did not understand, and hope — `catchup_hours` being exactly
/// the field a round trip loses, since `None` there means *inherit the app-wide
/// default* rather than *no value*.
///
/// Which is why that one is a double option: absent leaves it alone,
/// `Some(None)` puts it back on the default, `Some(Some(n))` pins it. The
/// editor sends a patch with every field set, so full replacement is this same
/// function with nothing left out.
#[derive(Debug, Clone, Default)]
pub struct RoutinePatch {
	pub name: Option<String>,
	pub cron: Option<String>,
	pub prompt: Option<String>,
	pub enabled: Option<bool>,
	pub catchup_hours: Option<Option<i64>>,
}

impl RoutinePatch {
	/// The whole configuration, as the editor sends it.
	pub fn whole(input: &RoutineInput) -> Self {
		Self {
			name: Some(input.name.clone()),
			cron: Some(input.cron.clone()),
			prompt: Some(input.prompt.clone()),
			enabled: Some(input.enabled),
			catchup_hours: Some(input.catchup_hours),
		}
	}

	/// Just the switch — what `setRoutineEnabled` and the row's toggle send.
	pub fn just_enabled(enabled: bool) -> Self {
		Self { enabled: Some(enabled), ..Self::default() }
	}

	fn is_empty(&self) -> bool {
		self.name.is_none()
			&& self.cron.is_none()
			&& self.prompt.is_none()
			&& self.enabled.is_none()
			&& self.catchup_hours.is_none()
	}
}

/// A name that will fit the row it has to explain itself from.
fn check_name(name: &str) -> AppResult<()> {
	if name.trim().is_empty() {
		return Err(AppError::InvalidInput("a routine needs a name".into()));
	}
	if name.chars().count() > MAX_NAME_LEN {
		return Err(AppError::InvalidInput(format!(
			"that name is longer than {MAX_NAME_LEN} characters"
		)));
	}
	Ok(())
}

/// A prompt that can still be argv when the fire comes due.
fn check_prompt(prompt: &str) -> AppResult<()> {
	if prompt.trim().is_empty() {
		return Err(AppError::InvalidInput(
			"a routine needs a prompt — it is the session's first message".into(),
		));
	}
	if prompt.chars().count() > MAX_PROMPT_LEN {
		return Err(AppError::InvalidInput(format!(
			"that prompt is longer than {MAX_PROMPT_LEN} characters"
		)));
	}
	Ok(())
}

/// A schedule that parses **and can still happen**.
///
/// The second half is the one that was missing. `0 0 31 2 *` is a valid cron
/// expression for a date that does not exist, so it parses and then never fires
/// — the failure this feature is least able to explain after the fact, and one
/// an agent writing a schedule unattended has no next-fire line to catch.
fn check_cron(expr: &str, now_ms: i64) -> AppResult<()> {
	parse_cron(expr)?;
	if next_occurrence_ms(expr, now_ms).is_none() {
		return Err(AppError::InvalidInput(format!(
			"{expr} parses but never fires again — nothing would ever run"
		)));
	}
	Ok(())
}

/// How many routines a project already has, for [`MAX_PER_PROJECT`].
pub fn count_in_project(conn: &Connection, project_id: &str) -> AppResult<i64> {
	Ok(conn.query_row(
		"SELECT COUNT(*) FROM routines WHERE project_id = ?1",
		params![project_id],
		|row| row.get(0),
	)?)
}

/// The next few times an expression fires, for a caller that has to be shown
/// its schedule rather than trusted to project it (F22: the next-fire line is
/// "the whole defence against a schedule that silently never fires").
pub fn next_occurrences(expr: &str, from_ms: i64, count: usize) -> Vec<i64> {
	let mut out = Vec::with_capacity(count);
	let mut cursor = from_ms;
	for _ in 0..count {
		match next_occurrence_ms(expr, cursor) {
			// +1ms so the next projection starts after the one just found rather
			// than on it, which would return the same occurrence forever.
			Some(at) => {
				out.push(at);
				cursor = at + 1;
			}
			None => break,
		}
	}
	out
}

/// Create a routine. Validated first — see [`check_cron`] — and capped, so a
/// project cannot accumulate schedules without bound.
///
/// `author` is the session that asked, or `None` for a human at the editor.
pub fn create(
	conn: &Connection,
	input: &RoutineInput,
	author: Option<&str>,
	now_ms: i64,
) -> AppResult<Routine> {
	check_name(&input.name)?;
	check_prompt(&input.prompt)?;
	check_cron(&input.cron, now_ms)?;
	let existing = count_in_project(conn, &input.project_id)?;
	if existing >= MAX_PER_PROJECT {
		return Err(AppError::InvalidInput(format!(
			"this project already has {existing} routines, which is the limit"
		)));
	}
	let id = uuid::Uuid::new_v4().to_string();
	conn.execute(
		"INSERT INTO routines(id, project_id, name, cron, prompt, enabled, catchup_hours,
		 created_at, created_by_session_id)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
		params![
			id,
			input.project_id,
			input.name,
			input.cron,
			input.prompt,
			i64::from(input.enabled),
			input.catchup_hours,
			now_ms,
			author
		],
	)?;
	get(conn, &id, now_ms)
}

/// Rewrite some of a routine's configuration. Run state is not touched: it
/// belongs to the runner, and a caller that could write `last_run_at` could
/// rewrite whether something ran.
///
/// **Only what is being changed is validated.** A patch that carries no cron
/// does not re-check the stored one — a routine written under an older `croner`
/// should not become impossible to switch off.
///
/// `author` is recorded as the last hand on the row, including when it is
/// `None`: a human editing a routine an agent wrote clears the mark, which is
/// the truthful answer to "who changed this last".
pub fn update_partial(
	conn: &Connection,
	id: &str,
	patch: &RoutinePatch,
	author: Option<&str>,
	now_ms: i64,
) -> AppResult<Routine> {
	if patch.is_empty() {
		return Err(AppError::InvalidInput("nothing to change".into()));
	}
	if let Some(name) = &patch.name {
		check_name(name)?;
	}
	if let Some(prompt) = &patch.prompt {
		check_prompt(prompt)?;
	}
	if let Some(cron) = &patch.cron {
		check_cron(cron, now_ms)?;
	}
	// Read-modify-write inside the caller's transaction rather than a SQL
	// `COALESCE` over five bound parameters: `catchup_hours` is nullable and
	// being set to null is a real edit, which `COALESCE` cannot express.
	let current = get(conn, id, now_ms)?;
	let name = patch.name.clone().unwrap_or(current.name);
	let cron = patch.cron.clone().unwrap_or(current.cron);
	let prompt = patch.prompt.clone().unwrap_or(current.prompt);
	let enabled = patch.enabled.unwrap_or(current.enabled);
	let catchup_hours = patch.catchup_hours.unwrap_or(current.catchup_hours);
	conn.execute(
		"UPDATE routines SET name = ?2, cron = ?3, prompt = ?4, enabled = ?5, catchup_hours = ?6,
		 last_modified_by_session_id = ?7
		 WHERE id = ?1",
		params![id, name, cron, prompt, i64::from(enabled), catchup_hours, author],
	)?;
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
///
/// A patch with one field set, so the switch and the editor write through one
/// function — and so flipping it records a hand on the row like any other edit.
pub fn set_enabled(
	conn: &Connection,
	id: &str,
	enabled: bool,
	author: Option<&str>,
	now_ms: i64,
) -> AppResult<Routine> {
	update_partial(conn, id, &RoutinePatch::just_enabled(enabled), author, now_ms)
}

// ------------------------------------------------------- writes that announce

/// `routines:changed` — a project's list is no longer what the renderer has.
///
/// Carries the project rather than the routine because every reader of it is a
/// list keyed by project, and a client that has to fetch anyway gains nothing
/// from knowing which row moved.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutinesChangedEvent {
	pub project_id: String,
}

/// Write, then say so.
///
/// **Every routine write goes through this layer, whichever caller made it**
/// (ADR-0028). The editor's own mutations already invalidate their query
/// optimistically, so for them this is a belt on braces; for a write that
/// arrived over the IDE bridge it is the only thing that stops an open Routines
/// tab from showing a list that is no longer true. One emitter rather than one
/// per caller, for the reason `session:worktree` has one: two paths doing the
/// same job for different callers is how they come to disagree.
///
/// Write-then-emit, in that order and never the other — an event ahead of its
/// row is a fact the next reload contradicts.
fn announce(app: &tauri::AppHandle, project_id: &str) {
	use tauri::Emitter;
	let _ =
		app.emit("routines:changed", RoutinesChangedEvent { project_id: project_id.to_string() });
}

/// Create a routine and tell the renderer. `author` is the session that asked,
/// or `None` for a human at the editor.
pub fn create_and_announce(
	db: &crate::db::Db,
	app: &tauri::AppHandle,
	input: &RoutineInput,
	author: Option<&str>,
	now_ms: i64,
) -> AppResult<Routine> {
	let routine = db.with(|conn| create(conn, input, author, now_ms))?;
	announce(app, &routine.project_id);
	Ok(routine)
}

/// Change part of a routine and tell the renderer.
pub fn update_and_announce(
	db: &crate::db::Db,
	app: &tauri::AppHandle,
	id: &str,
	patch: &RoutinePatch,
	author: Option<&str>,
	now_ms: i64,
) -> AppResult<Routine> {
	let routine = db.with(|conn| update_partial(conn, id, patch, author, now_ms))?;
	announce(app, &routine.project_id);
	Ok(routine)
}

/// Delete a routine and tell the renderer. **Not reachable from the bridge**
/// (ADR-0028): an agent may schedule work and switch it off, and only a human
/// unschedules it — the confirmation the editor asks for has nobody to ask on a
/// tool call.
pub fn delete_and_announce(
	db: &crate::db::Db,
	app: &tauri::AppHandle,
	id: &str,
	now_ms: i64,
) -> AppResult<()> {
	// Read the project before the row is gone; there is nothing to key the
	// event on afterwards.
	let project_id = db.with(|conn| get(conn, id, now_ms)).map(|r| r.project_id).ok();
	db.with(|conn| delete(conn, id))?;
	if let Some(project_id) = project_id {
		announce(app, &project_id);
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

/// A fire the runner decided on and nobody has started yet (ADR-0030).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Claim {
	pub session_id: String,
	pub routine_id: String,
	pub occurrence: i64,
	pub claimed_at: i64,
}

/// Claim an occurrence for a session id, before anything is told to start it.
///
/// This is what makes a fire survive an emit that reaches nobody. It writes
/// **nothing** on `routines`: the occurrence stays unconsumed until a PTY
/// exists, which is the whole point — a fire the window never picked up must
/// still be a fire the next tick can retry.
pub fn claim(
	conn: &Connection,
	session_id: &str,
	routine_id: &str,
	occurrence: i64,
	now_ms: i64,
) -> AppResult<()> {
	conn.execute(
		"INSERT INTO routine_claims(session_id, routine_id, occurrence, claimed_at)
		 VALUES (?1, ?2, ?3, ?4)
		 ON CONFLICT(session_id) DO UPDATE SET claimed_at = excluded.claimed_at",
		params![session_id, routine_id, occurrence, now_ms],
	)?;
	Ok(())
}

/// Every fire in flight, oldest claim first — the order they should be retried
/// in, for the reason the cap's queue is in due order.
pub fn claims(conn: &Connection) -> AppResult<Vec<Claim>> {
	let mut stmt = conn.prepare(
		"SELECT session_id, routine_id, occurrence, claimed_at FROM routine_claims
		 ORDER BY claimed_at, session_id",
	)?;
	let rows = stmt
		.query_map([], |row| {
			Ok(Claim {
				session_id: row.get(0)?,
				routine_id: row.get(1)?,
				occurrence: row.get(2)?,
				claimed_at: row.get(3)?,
			})
		})?
		.collect::<rusqlite::Result<Vec<_>>>()?;
	Ok(rows)
}

/// The routines with a fire in flight — what [`plan`] must not decide again.
pub fn claimed_routine_ids(conn: &Connection) -> AppResult<HashSet<String>> {
	let mut stmt = conn.prepare("SELECT routine_id FROM routine_claims")?;
	let ids = stmt
		.query_map([], |row| row.get::<_, String>(0))?
		.collect::<rusqlite::Result<HashSet<_>>>()?;
	Ok(ids)
}

/// One claim by the session it was minted for.
pub fn claim_for(conn: &Connection, session_id: &str) -> AppResult<Option<Claim>> {
	Ok(conn
		.query_row(
			"SELECT session_id, routine_id, occurrence, claimed_at FROM routine_claims
			 WHERE session_id = ?1",
			params![session_id],
			|row| {
				Ok(Claim {
					session_id: row.get(0)?,
					routine_id: row.get(1)?,
					occurrence: row.get(2)?,
					claimed_at: row.get(3)?,
				})
			},
		)
		.optional()?)
}

/// Forget a claim — because it started, or because nothing is coming for it.
/// The row is in-flight state, never history: `session_routines` is the history,
/// and it is written at the same moment this row goes.
pub fn drop_claim(conn: &Connection, session_id: &str) -> AppResult<()> {
	conn.execute("DELETE FROM routine_claims WHERE session_id = ?1", params![session_id])?;
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
/// clock, the rules and the writes, in that order.
///
/// **A fire is claimed, emitted, and only then recorded** (ADR-0030). The claim
/// row goes in before `routine:fire` — the write-then-emit ordering
/// `session:worktree` follows, because an event ahead of its row is a fact the
/// next reload disagrees with — but `routines.last_run_at` is written by
/// [`Runner::mark_started`], from the spawn itself. The event alone could not
/// carry it: an emit with no listener is dropped, and the launch tick emits
/// before the webview has loaded any listeners at all.
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

/// The event that asks the renderer to start one fire. Built in two places —
/// the decision and the retry — which is the reason it is a function.
fn fire_event(routine: &Routine, session_id: &str, cwd: String) -> FireEvent {
	FireEvent {
		routine_id: routine.id.clone(),
		routine_name: routine.name.clone(),
		project_id: routine.project_id.clone(),
		session_id: session_id.to_string(),
		prompt: routine.prompt.clone(),
		cwd,
	}
}

/// Why a claimed fire is past saving, or `None` while it is still worth
/// emitting (ADR-0030).
///
/// Two ways to run out, and they answer different questions. The grace period is
/// *is a window going to pick this up* — five minutes of a live renderer not
/// starting it means none is coming. The catch-up window is the routine's own
/// rule about lateness, and it applies here for the same reason it applies to a
/// missed occurrence: whether a run is still wanted is the schedule's decision,
/// not the plumbing's. `FRESH_MS` is the floor, so `catchup_hours = 0` — *never
/// run late* — does not expire a claim in the seconds between deciding it and
/// spawning it.
fn claim_expiry(
	routine: &Routine,
	claim: &Claim,
	now_ms: i64,
	default_catchup_hours: i64,
) -> Option<&'static str> {
	if now_ms - claim.claimed_at > CLAIM_GRACE_MS {
		return Some("no window started it, so nothing ran");
	}
	let hours = routine.catchup_hours.unwrap_or(default_catchup_hours).max(0);
	let window = hours.saturating_mul(3_600_000).max(FRESH_MS);
	if now_ms - claim.occurrence > window {
		return Some("its catch-up window closed before anything started it");
	}
	None
}

/// What `Run now` did — **and why, when it did nothing** (2026-08-29, user
/// report: "play routine failed sometimes without any error displayed").
///
/// The rules that can decline a manual run are the scheduler's own, so the two
/// paths agree; what a manual run additionally owes is an answer, because
/// somebody is looking at it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunNowResult {
	pub outcome: RunOutcome,
	/// Set only when a session actually started.
	pub session_id: Option<String>,
	/// Why nothing started, in the words the row will show.
	pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RunOutcome {
	Started,
	Skipped,
	Capped,
	Failed,
}

impl RunNowResult {
	fn started(session_id: String) -> Self {
		Self { outcome: RunOutcome::Started, session_id: Some(session_id), message: None }
	}
	fn skipped(message: &str) -> Self {
		Self { outcome: RunOutcome::Skipped, session_id: None, message: Some(message.into()) }
	}
	fn capped(message: &str) -> Self {
		Self { outcome: RunOutcome::Capped, session_id: None, message: Some(message.into()) }
	}
	fn failed(message: &str) -> Self {
		Self { outcome: RunOutcome::Failed, session_id: None, message: Some(message.into()) }
	}
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
	pub fn run_now(&self, routine: &Routine, now_ms: i64) -> RunNowResult {
		// A fire already on its way is not a reason to make a second one: the
		// session it is for is about to exist, and this is the button most likely
		// to be pressed while waiting for something to appear.
		let in_flight =
			self.db.with(claimed_routine_ids).map(|ids| ids.contains(&routine.id)).unwrap_or(false);
		if in_flight {
			return RunNowResult::skipped("a fire for it is already starting");
		}
		let live = (self.live)();
		if routine.last_session_id.as_deref().is_some_and(|id| live.contains(id)) {
			let _ = self.db.with(|conn| record_skip(conn, &routine.id, now_ms, now_ms));
			return RunNowResult::skipped(
				"its previous session is still running — close it, or wait for it to finish",
			);
		}
		let cap = self
			.db
			.with(|conn| {
				let cap = numeric_setting(
					conn,
					crate::models::SettingKey::RoutinesMaxConcurrent,
					DEFAULT_MAX_CONCURRENT,
				)
				.max(1);
				Ok((running_count(conn, &live)?, cap))
			})
			.unwrap_or((0, DEFAULT_MAX_CONCURRENT));
		if cap.0 >= cap.1 {
			return RunNowResult::capped(&format!(
				"{} routine sessions are already running, which is the limit in Settings → Routines",
				cap.0
			));
		}
		match self.fire(routine, now_ms, now_ms) {
			Ok(session_id) => RunNowResult::started(session_id),
			Err(message) => RunNowResult::failed(&message),
		}
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
			let claimed = claimed_routine_ids(conn)?;
			let planned = plan(&routines, &live, &claimed, now_ms, default_catchup, cap, running);
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
				Action::Fire { occurrence } => {
					let _ = self.fire(routine, occurrence, now_ms);
				}
			}
		}

		// Then the fires that were decided but never started — the launch tick's
		// own, emitted before the webview had a listener, and anything a reload
		// interrupted. Older than one tick, so this is never the pass above
		// shouting twice.
		use tauri::Emitter;
		for event in self.pending_fires(now_ms, TICK_SECS as i64 * 1000) {
			tracing::info!(routine = %event.routine_name, "re-emitting a routine fire nobody started");
			let _ = self.app.emit("routine:fire", event);
		}
		Ok(())
	}

	/// Consume one occurrence: mint the id, write the rows, then tell the
	/// renderer. `Err` is the reason it could not start, already recorded on the
	/// row — the caller decides whether anyone is waiting to be told.
	fn fire(&self, routine: &Routine, occurrence: i64, now_ms: i64) -> Result<String, String> {
		let folder = match self.project_folder(&routine.project_id) {
			Ok(Some(path)) => path,
			// The project is gone from the workspace, or its folder is. Recorded
			// on the row rather than only in the log: a routine that stopped
			// working has to be able to say so from the list, where being away
			// from the machine cannot lose it.
			Ok(None) => {
				return Err(self.record_failure(routine, occurrence, "the project folder is gone"))
			}
			Err(e) => return Err(self.record_failure(routine, occurrence, &e.to_string())),
		};

		let session_id = uuid::Uuid::new_v4().to_string();
		let claimed =
			self.db.with(|conn| claim(conn, &session_id, &routine.id, occurrence, now_ms));
		if let Err(e) = claimed {
			tracing::warn!(error = %e, routine = %routine.name, "could not claim a routine fire");
			return Err(e.to_string());
		}

		use tauri::Emitter;
		let _ = self.app.emit("routine:fire", fire_event(routine, &session_id, folder));
		Ok(session_id)
	}

	/// A claimed fire now has a process. Record the run and tell the list.
	///
	/// **Called from `terminal_spawn`, not from an acknowledgement the renderer
	/// sends.** The PTY coming into existence is the fact being recorded, Rust is
	/// where it happens, and a round trip to ask the renderer to confirm what
	/// Rust just did is one more message that can be lost — which is the bug
	/// this whole path exists to fix. Every human-started session reaches here
	/// too and finds no claim, which is the cheap half of the same rule: one
	/// place where "a session started" is known.
	pub fn mark_started(&self, session_id: &str, now_ms: i64) {
		let claim = match self.db.with(|conn| claim_for(conn, session_id)) {
			Ok(Some(claim)) => claim,
			// The ordinary case: a session a human started.
			Ok(None) => return,
			Err(e) => {
				tracing::warn!(error = %e, session_id, "could not read a routine claim");
				return;
			}
		};
		// In this order, so a failure part-way leaves the claim behind for the
		// next tick to retry rather than a fire nothing recorded.
		let recorded = self.db.with(|conn| {
			record_fire(conn, &claim.routine_id, claim.occurrence, session_id, now_ms)?;
			link_session(conn, session_id, &claim.routine_id, now_ms)?;
			drop_claim(conn, session_id)?;
			Ok(get(conn, &claim.routine_id, now_ms)?.project_id)
		});
		match recorded {
			Ok(project_id) => announce(&self.app, &project_id),
			Err(e) => tracing::warn!(error = %e, session_id, "could not record a routine fire"),
		}
	}

	/// The fires still waiting for a window to start them — and the sweep of the
	/// ones past saving.
	///
	/// `min_age_ms` is the whole difference between the two callers. The tick asks
	/// for claims older than one tick, so it re-emits what was missed without
	/// re-emitting what it decided a moment ago; the renderer's drain on mount
	/// asks for all of them, which is what makes a launch-time catch-up fire
	/// arrive at a listener that exists.
	pub fn pending_fires(&self, now_ms: i64, min_age_ms: i64) -> Vec<FireEvent> {
		let pending = match self.db.with(claims) {
			Ok(pending) => pending,
			Err(e) => {
				tracing::warn!(error = %e, "could not read routine claims");
				return Vec::new();
			}
		};
		let default_catchup = self
			.db
			.with(|conn| {
				Ok(numeric_setting(
					conn,
					crate::models::SettingKey::RoutinesCatchupHours,
					DEFAULT_CATCHUP_HOURS,
				))
			})
			.unwrap_or(DEFAULT_CATCHUP_HOURS);

		let mut out = Vec::new();
		for claim in pending {
			let routine = match self.db.with(|conn| get(conn, &claim.routine_id, now_ms)) {
				Ok(routine) => routine,
				// The routine went while its fire was in flight. Nothing to start
				// it from, and nothing to record the failure on.
				Err(_) => {
					self.forget(&claim.session_id);
					continue;
				}
			};
			if let Some(reason) = claim_expiry(&routine, &claim, now_ms, default_catchup) {
				self.forget(&claim.session_id);
				self.record_failure(&routine, claim.occurrence, reason);
				continue;
			}
			let folder = match self.project_folder(&routine.project_id) {
				Ok(Some(folder)) => folder,
				Ok(None) => {
					self.forget(&claim.session_id);
					self.record_failure(&routine, claim.occurrence, "the project folder is gone");
					continue;
				}
				Err(e) => {
					tracing::warn!(error = %e, routine = %routine.name, "could not read a project");
					continue;
				}
			};
			if now_ms - claim.claimed_at < min_age_ms {
				continue;
			}
			out.push(fire_event(&routine, &claim.session_id, folder));
		}
		out
	}

	/// Drop a claim, logging rather than propagating: a claim that cannot be
	/// deleted is retried, and the sweep has to get through the rest of the list.
	fn forget(&self, session_id: &str) {
		if let Err(e) = self.db.with(|conn| drop_claim(conn, session_id)) {
			tracing::warn!(error = %e, session_id, "could not drop a routine claim");
		}
	}

	/// Record why a fire could not start, and hand the reason back so a caller
	/// with somebody watching — `Run now` — can say it out loud.
	fn record_failure(&self, routine: &Routine, occurrence: i64, message: &str) -> String {
		tracing::warn!(routine = %routine.name, message, "routine could not start");
		let _ = self.db.with(|conn| record_error(conn, &routine.id, occurrence, message));
		message.to_string()
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
			created_by_session_id: None,
			last_modified_by_session_id: None,
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

	/// **The duplicate-fire bug, in the wild on 2026-08-30**: a routine started a
	/// session on every tick for a whole minute.
	///
	/// `croner` returns an occurrence carrying the *query instant's*
	/// milliseconds, so a fire recorded at `02:00:14.974` was `02:00:00.974` and
	/// the next tick's `02:00:00.976` was greater than it. Both halves are
	/// pinned: an occurrence is a property of the schedule, and a routine that
	/// has fired is not due again in the same minute.
	#[test]
	fn an_occurrence_does_not_carry_the_millisecond_it_was_asked_at() {
		let exact = at(2026, 8, 30, 2, 0);
		assert_eq!(previous_occurrence_ms("0 2 * * *", exact + 14_974), Some(exact));
		assert_eq!(previous_occurrence_ms("0 2 * * *", exact + 44_976), Some(exact));
		assert_eq!(next_occurrence_ms("0 2 * * *", exact + 14_974), Some(exact + 86_400_000));
	}

	#[test]
	fn a_routine_that_just_fired_is_not_due_again_in_the_same_minute() {
		let mut r = routine("0 2 * * *", at(2026, 8, 29, 0, 0));
		let first_tick = at(2026, 8, 30, 2, 0) + 14_974;
		let occurrence = due_occurrence(&r, first_tick, 6).expect("due on the first tick");
		r.last_fire_at = Some(occurrence);

		// Thirty seconds later, same minute, same schedule: nothing owed.
		assert_eq!(due_occurrence(&r, at(2026, 8, 30, 2, 0) + 44_976, 6), None);
		// And still nothing at the end of the minute.
		assert_eq!(due_occurrence(&r, at(2026, 8, 30, 2, 0) + 59_999, 6), None);
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
		let planned = plan(&[r], &live, &HashSet::new(), at(2026, 8, 20, 7, 0) + 1000, 6, 2, 0);
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
		let planned = plan(&rs, &HashSet::new(), &HashSet::new(), now, 6, 2, 0);
		// Two start; the other two are not recorded at all, so the next tick
		// finds the same occurrence and runs them late.
		assert_eq!(planned.len(), 2);
		assert!(planned.iter().all(|p| matches!(p.action, Action::Fire { .. })));
		assert_eq!(planned[0].routine_id, "r0");

		// One slot left because one is already running.
		let planned = plan(&rs, &HashSet::new(), &HashSet::new(), now, 6, 2, 1);
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
		let planned = plan(&[overlapping, fresh], &live, &HashSet::new(), now, 6, 1, 0);
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
			assert!(create(conn, &bad, None, 1).is_err());
			Ok(())
		})
		.unwrap();
	}

	#[test]
	fn a_project_cannot_accumulate_routines_without_bound() {
		// The cap exists because an agent can write routines now, and an agent
		// inside a routine's own session can write more (ADR-0028). It is in the
		// store rather than at the bridge so the editor answers the same way.
		let (_tmp, db) = db();
		db.with(|conn| {
			let now = at(2026, 8, 20, 12, 0);
			for n in 0..MAX_PER_PROJECT {
				let mut i = input();
				i.name = format!("routine {n}");
				create(conn, &i, None, now)?;
			}
			let err = create(conn, &input(), Some("s1"), now).unwrap_err();
			assert!(format!("{err}").contains("which is the limit"), "{err}");
			assert_eq!(count_in_project(conn, "p1")?, MAX_PER_PROJECT);
			Ok(())
		})
		.unwrap();
	}

	#[test]
	fn a_schedule_that_parses_but_can_never_fire_is_refused() {
		// `0 0 31 2 *` is a valid expression for a date that does not exist. It
		// used to save cleanly and then never run — the failure this feature is
		// least able to explain afterwards, and the one an agent writing a
		// schedule unattended has no next-fire line to catch.
		let (_tmp, db) = db();
		db.with(|conn| {
			let mut impossible = input();
			impossible.cron = "0 0 31 2 *".into();
			let err = create(conn, &impossible, None, 1).unwrap_err();
			assert!(format!("{err}").contains("never fires again"), "{err}");
			Ok(())
		})
		.unwrap();
	}

	#[test]
	fn an_empty_or_oversized_name_or_prompt_is_refused() {
		// The prompt becomes argv on a spawn that may be hours away (ADR-0026 § 4).
		// Unbounded, that is a spawn failure long after the call that caused it,
		// with nobody watching.
		let (_tmp, db) = db();
		db.with(|conn| {
			let now = at(2026, 8, 20, 12, 0);
			for mutate in [
				(|i: &mut RoutineInput| i.name = "  ".into()) as fn(&mut RoutineInput),
				|i: &mut RoutineInput| i.prompt = String::new(),
				|i: &mut RoutineInput| i.name = "n".repeat(MAX_NAME_LEN + 1),
				|i: &mut RoutineInput| i.prompt = "p".repeat(MAX_PROMPT_LEN + 1),
			] {
				let mut i = input();
				mutate(&mut i);
				assert!(create(conn, &i, None, now).is_err());
			}
			Ok(())
		})
		.unwrap();
	}

	#[test]
	fn a_patch_leaves_the_fields_it_does_not_carry_alone() {
		// The bridge's shape. An agent holds a subset and would otherwise have to
		// echo back everything it did not understand — `catchup_hours` being the
		// field a round trip loses, since `None` there means *inherit the app-wide
		// default* rather than *no value*, which is why it is a double option.
		let (_tmp, db) = db();
		db.with(|conn| {
			let now = at(2026, 8, 20, 12, 0);
			let mut i = input();
			i.catchup_hours = Some(4);
			let created = create(conn, &i, None, now)?;

			let only_cron =
				RoutinePatch { cron: Some("0 5 * * *".into()), ..RoutinePatch::default() };
			let updated = update_partial(conn, &created.id, &only_cron, None, now)?;
			assert_eq!(updated.cron, "0 5 * * *");
			assert_eq!(updated.name, "Nightly triage", "an unsent field is left alone");
			assert_eq!(updated.catchup_hours, Some(4), "an unsent window is not reset");

			// `Some(None)` is the third state: back on the app-wide default.
			let cleared = RoutinePatch { catchup_hours: Some(None), ..RoutinePatch::default() };
			let updated = update_partial(conn, &created.id, &cleared, None, now)?;
			assert_eq!(updated.catchup_hours, None);
			Ok(())
		})
		.unwrap();
	}

	#[test]
	fn a_patch_carrying_nothing_is_refused_rather_than_recorded() {
		let (_tmp, db) = db();
		db.with(|conn| {
			let now = at(2026, 8, 20, 12, 0);
			let created = create(conn, &input(), None, now)?;
			assert!(update_partial(conn, &created.id, &RoutinePatch::default(), Some("s1"), now)
				.is_err());
			// And it did not leave a hand on the row for a change that never happened.
			assert_eq!(get(conn, &created.id, now)?.last_modified_by_session_id, None);
			Ok(())
		})
		.unwrap();
	}

	#[test]
	fn a_patch_does_not_revalidate_the_fields_it_is_not_touching() {
		// A routine written under an older `croner` must not become impossible to
		// switch off. The row is edited past the store to make that concrete.
		let (_tmp, db) = db();
		db.with(|conn| {
			let now = at(2026, 8, 20, 12, 0);
			let created = create(conn, &input(), None, now)?;
			conn.execute(
				"UPDATE routines SET cron = 'not a cron' WHERE id = ?1",
				params![created.id],
			)?;

			let off = set_enabled(conn, &created.id, false, None, now)?;
			assert!(!off.enabled);
			Ok(())
		})
		.unwrap();
	}

	#[test]
	fn provenance_records_the_author_and_the_last_hand_separately() {
		// One column cannot answer both questions (ADR-0028): an agent amending a
		// routine a human wrote would leave the row reading as untouched.
		let (_tmp, db) = db();
		db.with(|conn| {
			let now = at(2026, 8, 20, 12, 0);
			let human = create(conn, &input(), None, now)?;
			assert_eq!(human.created_by_session_id, None, "None means a human wrote it");

			let touched = set_enabled(conn, &human.id, false, Some("s-agent"), now)?;
			assert_eq!(touched.created_by_session_id, None);
			assert_eq!(touched.last_modified_by_session_id.as_deref(), Some("s-agent"));

			// And a human editing it back clears the mark, which is the truthful
			// answer to "who changed this last".
			let back = set_enabled(conn, &human.id, true, None, now)?;
			assert_eq!(back.last_modified_by_session_id, None);

			let agents = create(conn, &input(), Some("s-agent"), now)?;
			assert_eq!(agents.created_by_session_id.as_deref(), Some("s-agent"));
			Ok(())
		})
		.unwrap();
	}

	#[test]
	fn the_next_few_occurrences_advance_rather_than_repeating_one() {
		// Each projection has to start *after* the one just found, or the same
		// occurrence comes back forever and the agent is told a daily routine
		// runs three times at 02:00.
		let from = at(2026, 8, 20, 12, 0);
		let next = next_occurrences("0 2 * * *", from, 3);
		assert_eq!(next, vec![at(2026, 8, 21, 2, 0), at(2026, 8, 22, 2, 0), at(2026, 8, 23, 2, 0)]);
	}

	#[test]
	fn crud_round_trips() {
		let (_tmp, db) = db();
		db.with(|conn| {
			let now = at(2026, 8, 20, 12, 0);
			let created = create(conn, &input(), None, now)?;
			assert_eq!(created.name, "Nightly triage");
			assert!(created.enabled);
			// Derived, and derived from *now* rather than stored.
			assert_eq!(created.next_run_at, Some(at(2026, 8, 21, 2, 0)));

			let mut changed = input();
			changed.name = "Nightly digest".into();
			changed.catchup_hours = Some(0);
			let updated =
				update_partial(conn, &created.id, &RoutinePatch::whole(&changed), None, now)?;
			assert_eq!(updated.name, "Nightly digest");
			assert_eq!(updated.catchup_hours, Some(0));

			set_enabled(conn, &created.id, false, None, now)?;
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
			let r = create(conn, &input(), None, now)?;
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
			let r = create(conn, &input(), None, now)?;
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
			let r = create(conn, &input(), None, now)?;
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

	#[test]
	fn a_fire_in_flight_is_not_decided_again() {
		let now = at(2026, 8, 20, 7, 0) + 1000;
		let r = routine("0 * * * *", at(2026, 8, 19, 0, 0));
		// Nothing is recorded on the row until the session starts (ADR-0030), so
		// without the claim the 07:00 occurrence is due on every tick until it
		// does — which is a `claude` per thirty seconds.
		let claimed = HashSet::from([r.id.clone()]);
		assert!(plan(std::slice::from_ref(&r), &HashSet::new(), &claimed, now, 6, 2, 0).is_empty());
		assert_eq!(plan(&[r], &HashSet::new(), &HashSet::new(), now, 6, 2, 0).len(), 1);
	}

	#[test]
	fn a_claim_lives_until_the_session_starts_or_is_given_up_on() {
		let (_tmp, db) = db();
		db.with(|conn| {
			let now = at(2026, 8, 20, 12, 0);
			let r = create(conn, &input(), None, now)?;
			claim(conn, "s-new", &r.id, now, now + 5)?;

			let pending = claims(conn)?;
			assert_eq!(pending.len(), 1);
			assert_eq!(pending[0].occurrence, now);
			assert_eq!(pending[0].claimed_at, now + 5);
			assert_eq!(claimed_routine_ids(conn)?, HashSet::from([r.id.clone()]));
			assert_eq!(claim_for(conn, "s-new")?.map(|c| c.routine_id), Some(r.id.clone()));
			assert_eq!(claim_for(conn, "s-other")?, None);

			// Nothing on the routine yet: the occurrence is unconsumed on purpose.
			let during = get(conn, &r.id, now)?;
			assert_eq!(during.last_fire_at, None);
			assert_eq!(during.last_run_at, None);

			drop_claim(conn, "s-new")?;
			assert!(claims(conn)?.is_empty());
			Ok(())
		})
		.unwrap();
	}

	#[test]
	fn a_claim_for_a_deleted_routine_goes_with_it() {
		let (_tmp, db) = db();
		db.with(|conn| {
			let now = at(2026, 8, 20, 12, 0);
			let r = create(conn, &input(), None, now)?;
			claim(conn, "s-new", &r.id, now, now)?;
			// CASCADE, unlike `session_routines`'s SET NULL: a session that ran
			// is history worth keeping, a fire with no prompt left to start it
			// from is not.
			delete(conn, &r.id)?;
			assert!(claims(conn)?.is_empty());
			Ok(())
		})
		.unwrap();
	}

	#[test]
	fn a_claim_expires_when_no_window_takes_it() {
		let occurrence = at(2026, 8, 20, 9, 0);
		let r = routine("0 9 * * *", at(2026, 8, 19, 0, 0));
		let c = |claimed_at| Claim {
			session_id: "s".into(),
			routine_id: r.id.clone(),
			occurrence,
			claimed_at,
		};

		// The renderer's ordinary case: claimed a second ago, still worth emitting.
		assert_eq!(claim_expiry(&r, &c(occurrence), occurrence + 1000, 6), None);
		// A window that never came back for it.
		assert!(claim_expiry(&r, &c(occurrence), occurrence + CLAIM_GRACE_MS + 1, 6).is_some());

		// Re-claimed just now, but the occurrence itself is older than the
		// routine's catch-up window — the schedule's own rule about lateness, not
		// the plumbing's.
		let late = occurrence + 7 * 3_600_000;
		assert!(claim_expiry(&r, &c(late), late, 6).is_some());
		assert_eq!(claim_expiry(&r, &c(late), late, 12), None);

		// `catchup_hours = 0` is "never run late", and must still not expire a
		// claim in the seconds between deciding it and spawning it.
		let mut never_late = r.clone();
		never_late.catchup_hours = Some(0);
		assert_eq!(claim_expiry(&never_late, &c(occurrence), occurrence + 1000, 6), None);
		assert!(claim_expiry(&never_late, &c(occurrence), occurrence + FRESH_MS + 1, 6).is_some());
	}
}
