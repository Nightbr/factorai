//! factorai's own tools, and the only ones the model can actually call
//! (F22 slice 3, ADR-0029).
//!
//! **Why these are not on the IDE bridge**, which is where they were first
//! built: the CLI registers whatever it finds in `~/.claude/ide/` under the
//! hardcoded server key `ide` — `connectToServer("ide", …)`, observed in 2.1.251
//! — and then filters that server's tools down to a two-name allowlist
//! (`executeCode`, `getDiagnostics`) before the model ever sees the list. The
//! `ideName` we put in the lockfile is a label in the `/ide` picker, not the key.
//! So the bridge can never be a way to give the model a new tool; F20's tools
//! work because the *CLI* calls them. ADR-0029 has the reasoning and the
//! evidence.
//!
//! What is here is therefore a plain MCP server under a plain name, and its
//! tools arrive as `mcp__factorai__*`.

use std::sync::Arc;

use serde_json::{json, Value};
use tracing::{debug, info, warn};

use crate::error::AppResult;
use crate::models::{Routine, RoutineInput};
use crate::services::mcp_wire::{
	self, tool_error, tool_text, Failure, Incoming, INVALID_PARAMS, METHOD_NOT_FOUND,
};
use crate::services::routines::{next_occurrences, RoutinePatch};

/// The name this server is registered under, and therefore the `mcp__<name>__`
/// prefix every tool below reaches the model with.
///
/// **Anything but `ide`.** That key is the CLI's own and is tool-capped; see the
/// module comment.
pub const SERVER_NAME: &str = "factorai";

/// One project's routines, by project id.
pub type ListRoutines = Arc<dyn Fn(&str) -> AppResult<Vec<Routine>> + Send + Sync>;
/// Write a new routine, recording the session that asked as its author.
pub type CreateRoutine = Arc<dyn Fn(&RoutineInput) -> AppResult<Routine> + Send + Sync>;
/// Change part of one, recording the session that asked as the last hand.
pub type UpdateRoutine = Arc<dyn Fn(&str, &RoutinePatch) -> AppResult<Routine> + Send + Sync>;

/// The routines this session may read and write (ADR-0028).
///
/// **The project is baked in, not taken as an argument.** It is resolved at
/// spawn from the session's own `SpawnOpts`, so there is no `projectId` on any
/// tool for an agent to point somewhere else — the database analogue of the path
/// scope in ADR-0017 § 3, and the same reasoning: the token authenticates a
/// process on this machine, which is a weaker claim than it looks, so the layer
/// that actually holds is the one the client cannot address.
///
/// The author is baked in the same way. Every write records the session that
/// made it, and the tool has no say in what that says.
pub struct Routines {
	/// The project every tool in this group reads and writes.
	pub project_id: String,
	/// Its folder, for [`AgentTools::instructions`] — the one thing the session
	/// can check for itself against `pwd`.
	pub project_path: String,
	pub list: ListRoutines,
	pub create: CreateRoutine,
	/// Partial by design — see [`RoutinePatch`]. An agent holds a subset of the
	/// fields and would otherwise have to echo back the ones it did not
	/// understand.
	pub update: UpdateRoutine,
}

/// One session's view of factorai's tools.
pub struct AgentTools {
	routines: Routines,
}

impl AgentTools {
	pub fn new(routines: Routines) -> Self {
		Self { routines }
	}

	/// What this session needs to know that is not a tool.
	///
	/// **The fix for a real failure** (2026-08-30). Asked to "create a routine
	/// that checks for reminders", a session went to Claude Code's built-in
	/// `schedule` skill — which advertises "scheduled cloud agents (routines) that
	/// execute on a cron schedule", the user's exact words — spent a turn
	/// interviewing them, and failed with a 403 because the vault is a private
	/// repository the cloud cannot read. Nothing had told the session it was
	/// running inside factorai at all, so a local routine was not a thing it could
	/// have chosen.
	///
	/// Claude Code injects this as `## factorai` followed by the text
	/// (`mcp_instructions_delta`, observed 2.1.251). It is short on purpose: it is
	/// paid for in context on every session factorai starts.
	///
	/// **The "only while factorai is open" line is a property of the tool, not a
	/// hedge against the recommendation.** F22 insists that limit is stated as
	/// behaviour rather than buried as a caveat, and a session that schedules
	/// something without knowing it would be reporting work it cannot promise.
	fn instructions(&self) -> String {
		// `concat!` of whole lines rather than `\`-continuations: rustfmt joins
		// continued lines and leaves the source indentation *inside* the literal,
		// which put tabs in the middle of sentences. Caught by the test below.
		const BODY: &str = concat!(
			"To schedule recurring work in this project, use `createRoutine` from this server ",
			"rather than a cloud routine. A factorai routine starts a new agent session in this ",
			"same folder, on this machine, with your prompt as its first message — nothing has ",
			"to be pushed to a remote and no repository access has to be granted to anyone. ",
			"It runs only while factorai is open.",
		);
		format!(
			"This session is running inside factorai, in the project at {}.\n\n{BODY}",
			self.routines.project_path
		)
	}

	/// Answer one message. `None` for a notification, which by definition is not
	/// answered, and for anything we cannot parse.
	pub fn handle(&self, text: &str) -> Option<String> {
		let incoming: Incoming = match serde_json::from_str(text) {
			Ok(v) => v,
			Err(e) => {
				debug!(error = %e, "agent tool server could not parse a frame");
				return None;
			}
		};

		let params = incoming.params.unwrap_or(Value::Null);
		let Some(id) = incoming.id else {
			// `notifications/initialized` is the only one the CLI sends here.
			debug!(method = %incoming.method, "agent tool server ignored a notification");
			return None;
		};

		let result = match incoming.method.as_str() {
			"initialize" => {
				Ok(mcp_wire::initialize_result(&params, SERVER_NAME, Some(&self.instructions())))
			}
			"tools/list" => Ok(tools_list()),
			"tools/call" => self.tools_call(&params),
			other => {
				// `server/discover` arrives first and is optional; answering
				// "no such method" is what a server that does not implement it
				// is supposed to say, and the CLI carries on to `initialize`.
				debug!(method = other, "agent tool server was asked for a method it does not have");
				Err(Failure::rpc(METHOD_NOT_FOUND, format!("no such method: {other}")))
			}
		};

		Some(mcp_wire::reply(id, result))
	}

	fn tools_call(&self, params: &Value) -> Result<Value, Failure> {
		let name = params
			.get("name")
			.and_then(Value::as_str)
			.ok_or_else(|| Failure::rpc(INVALID_PARAMS, "tools/call needs a name"))?;
		let args = params.get("arguments").cloned().unwrap_or(Value::Null);

		match name {
			"listRoutines" => Ok(self.list_routines()),
			"createRoutine" => Ok(self.create_routine(&args)),
			"updateRoutine" => Ok(self.update_routine(&args)),
			"setRoutineEnabled" => Ok(self.set_routine_enabled(&args)),
			other => Err(Failure::rpc(METHOD_NOT_FOUND, format!("no such tool: {other}"))),
		}
	}

	/// This project's schedules, run state included.
	///
	/// The run state is here rather than held back because "did the routine I
	/// wrote yesterday actually work" is the question an agent comes back with,
	/// and `lastError` is the only thing that answers it.
	fn list_routines(&self) -> Value {
		match (self.routines.list)(&self.routines.project_id) {
			Ok(routines) => {
				let rows: Vec<Value> = routines.iter().map(describe_routine).collect();
				tool_text(
					&json!({
						"routines": rows,
						"note": "These are the routines of the project this session is running \
								 in. A routine starts a new agent session with its prompt as the \
								 first message, and only while factorai is open.",
					})
					.to_string(),
				)
			}
			Err(e) => tool_error(&format!("could not read this project's routines: {e}")),
		}
	}

	/// Schedule new work in this session's project.
	fn create_routine(&self, args: &Value) -> Value {
		let (Some(name), Some(cron), Some(prompt)) = (
			args.get("name").and_then(Value::as_str),
			args.get("cron").and_then(Value::as_str),
			args.get("prompt").and_then(Value::as_str),
		) else {
			return tool_error("createRoutine needs a name, a cron and a prompt");
		};
		let input = RoutineInput {
			project_id: self.routines.project_id.clone(),
			name: name.to_string(),
			cron: cron.to_string(),
			prompt: prompt.to_string(),
			// Absent means yes: an agent asked to schedule something has asked
			// for it to run, and a schedule that waits for a human to arm it is
			// a draft the agent will nonetheless report as scheduled.
			enabled: args.get("enabled").and_then(Value::as_bool).unwrap_or(true),
			catchup_hours: args.get("catchupHours").and_then(Value::as_i64),
		};
		match (self.routines.create)(&input) {
			Ok(routine) => {
				info!(routine = %routine.name, "an agent created a routine");
				tool_text(&format!(
					"Created the routine \"{}\" ({}).\n{}",
					routine.name,
					routine.id,
					schedule_answer(&routine)
				))
			}
			Err(e) => tool_error(&format!("{e}")),
		}
	}

	/// Change part of a routine in this session's project.
	fn update_routine(&self, args: &Value) -> Value {
		let Some(id) = args.get("id").and_then(Value::as_str) else {
			return tool_error("updateRoutine needs an id — call listRoutines for them");
		};
		let patch = RoutinePatch {
			name: args.get("name").and_then(Value::as_str).map(str::to_string),
			cron: args.get("cron").and_then(Value::as_str).map(str::to_string),
			prompt: args.get("prompt").and_then(Value::as_str).map(str::to_string),
			enabled: args.get("enabled").and_then(Value::as_bool),
			// Three states, and the wire has all three: the key is absent (leave
			// it), the key is `null` (put it back on the app-wide default), or the
			// key is a number. Collapsing the first two would make every partial
			// update silently reset the window.
			catchup_hours: args.get("catchupHours").map(|v| v.as_i64()),
		};
		self.write_routine(id, &patch, "Updated")
	}

	/// Stop, or resume, a routine's future fires. Never touches a session it has
	/// already started — that is not what a switch means (F22).
	fn set_routine_enabled(&self, args: &Value) -> Value {
		let Some(id) = args.get("id").and_then(Value::as_str) else {
			return tool_error("setRoutineEnabled needs an id — call listRoutines for them");
		};
		let Some(enabled) = args.get("enabled").and_then(Value::as_bool) else {
			return tool_error("setRoutineEnabled needs enabled: true or false");
		};
		let verb = if enabled { "Enabled" } else { "Disabled" };
		self.write_routine(id, &RoutinePatch::just_enabled(enabled), verb)
	}

	/// The half `updateRoutine` and `setRoutineEnabled` share: refuse a routine
	/// that is not this project's, write, and answer with the schedule.
	///
	/// **The scope check is here rather than in the store**, because it is this
	/// server's rule and not the database's: the editor may edit any routine of
	/// the project it is showing, and this is the caller that has to be held to
	/// one project. Checked by reading the row through the project-scoped list,
	/// so an id from another project is indistinguishable from one that does not
	/// exist — which is the right answer to both.
	fn write_routine(&self, id: &str, patch: &RoutinePatch, verb: &str) -> Value {
		match (self.routines.list)(&self.routines.project_id) {
			Ok(routines) if routines.iter().any(|r| r.id == id) => {}
			Ok(_) => {
				warn!(id, "agent tool server refused a routine outside the session's project");
				return tool_error(&format!(
					"no routine {id} in this session's project — call listRoutines to see them"
				));
			}
			Err(e) => return tool_error(&format!("could not read this project's routines: {e}")),
		}
		match (self.routines.update)(id, patch) {
			Ok(routine) => {
				info!(routine = %routine.name, verb, "an agent changed a routine");
				tool_text(&format!(
					"{} the routine \"{}\" ({}).\n{}",
					verb,
					routine.name,
					routine.id,
					schedule_answer(&routine)
				))
			}
			Err(e) => tool_error(&format!("{e}")),
		}
	}
}

/// One routine, as the agent sees it.
fn describe_routine(routine: &Routine) -> Value {
	json!({
		"id": routine.id,
		"name": routine.name,
		"cron": routine.cron,
		"prompt": routine.prompt,
		"enabled": routine.enabled,
		"catchupHours": routine.catchup_hours,
		"nextRun": routine.next_run_at.map(stamp),
		"lastRun": routine.last_run_at.map(stamp),
		"lastError": routine.last_error,
		// Which of the two wrote it, in a word, because "is this mine to change"
		// is the only thing an agent does with a session id it cannot resolve.
		"createdBy": author(routine.created_by_session_id.as_deref()),
		"lastChangedBy": author(routine.last_modified_by_session_id.as_deref()),
	})
}

/// `None` means a human wrote it — see migration `0014`, where the absence is
/// meaningful rather than merely missing.
fn author(session_id: Option<&str>) -> Value {
	match session_id {
		Some(id) => json!({ "who": "agent", "sessionId": id }),
		None => json!({ "who": "human" }),
	}
}

/// When a schedule next fires, spelled out.
///
/// **The next few times, not just the next one** (F22): the line under the
/// editor's schedule control is what stops a human saving an expression that
/// never fires, and an agent writing one unattended has strictly less to go on.
/// A cron that cannot fire again is refused before it is stored, so an empty
/// list here means only that the projection ran out.
fn schedule_answer(routine: &Routine) -> String {
	if !routine.enabled {
		return format!(
			"Schedule: {} — but it is disabled, so it will not run until it is enabled.",
			routine.cron
		);
	}
	let next = next_occurrences(&routine.cron, crate::epoch_ms(), 3);
	if next.is_empty() {
		return format!("Schedule: {} — no upcoming runs.", routine.cron);
	}
	format!(
		"Schedule: {} — next runs {}. It runs only while factorai is open.",
		routine.cron,
		next.iter().map(|at| stamp(*at)).collect::<Vec<_>>().join(", ")
	)
}

/// Epoch ms as local wall-clock time, with the offset spelled out.
///
/// **24-hour with an explicit offset, whatever the app's clock setting says.**
/// That setting is a renderer preference (ADR-0013) which this server cannot
/// read, and the reader here is a model rather than a person — for which an
/// unambiguous stamp beats a familiar one. Local rather than UTC because a cron
/// expression means local time (Q25), and a projection in another zone would
/// not match what the routines list shows.
fn stamp(ms: i64) -> String {
	use chrono::{Local, TimeZone};
	Local
		.timestamp_millis_opt(ms)
		.single()
		.map(|dt| dt.format("%Y-%m-%d %H:%M (%:z)").to_string())
		.unwrap_or_else(|| format!("{ms}"))
}

/// The four we offer.
///
/// There is deliberately no `deleteRoutine`, and its absence is a decision
/// rather than an omission (ADR-0028). The editor's delete asks first; a tool
/// call has nobody to ask, and disable is the reversible form of the same act.
/// No `projectId` argument anywhere either — the project is the session's own,
/// resolved at spawn.
///
/// **Three things here are not decoration**, and each was earned by watching a
/// real session fail to find these tools at all (2026-08-30):
///
/// * `_meta["anthropic/alwaysLoad"]` on **`createRoutine` alone**. The CLI reads
///   it as `M._meta?.["anthropic/alwaysLoad"] === true` and keeps that tool out
///   of the deferred set, so it is present at the moment somebody says "create a
///   routine" rather than something a model must first think to search for. Only
///   the one: it is the tool that has to be there unprompted, and the other
///   three are reachable by search once the server is known. The server-config
///   `alwaysLoad` flag would load all four and is deliberately not used.
/// * `_meta["anthropic/searchHint"]` on all four, so the deferred path still
///   matches the words people actually use — routine, schedule, cron, recurring,
///   daily.
/// * `annotations.readOnlyHint`, which is simply true of `listRoutines` and
///   false of the rest. The CLI reads it for `isReadOnly()` and
///   `isConcurrencySafe()`. Nothing here sets `destructiveHint`, because nothing
///   here destroys anything — that is what leaving `deleteRoutine` out bought.
fn tools_list() -> Value {
	json!({
		"tools": [
			{
				"name": "listRoutines",
				"description": "The scheduled routines of the project this session is running \
								in. A routine starts a new agent session on a cron schedule \
								with its prompt as the first message. Call this before \
								updating one, for its id and its current schedule.",
				"inputSchema": { "type": "object", "properties": {} },
				"annotations": { "title": "List factorai routines", "readOnlyHint": true },
				"_meta": {
					"anthropic/searchHint": "list existing routines, schedules, cron jobs or \
											 recurring tasks configured for this project in \
											 factorai",
				},
			},
			{
				"name": "createRoutine",
				"description": "Schedule recurring work in this project — use this rather \
								than a cloud routine when the session is running in factorai. \
								factorai starts a new agent session in this same folder, on \
								this machine, on the schedule you give, with `prompt` as its \
								first message. Nothing has to be pushed to a remote and no \
								repository access has to be granted. Write the prompt for an \
								agent starting cold, with no memory of this conversation. \
								Routines run only while factorai is open; one due while it is \
								closed runs when it next opens, if it is still inside its \
								catch-up window. Say what you scheduled and when it will run.",
				"inputSchema": {
					"type": "object",
					"properties": {
						"name": {
							"type": "string",
							"description": "Short label for the list, e.g. \"Nightly triage\".",
						},
						"cron": {
							"type": "string",
							"description": "Five-field cron expression in local time — \
											minute hour day-of-month month day-of-week. \
											`0 2 * * *` is every day at 02:00.",
						},
						"prompt": {
							"type": "string",
							"description": "The session's first message. Self-contained: the \
											agent that receives it starts with no context.",
						},
						"enabled": {
							"type": "boolean",
							"description": "Defaults to true. False creates it switched off.",
						},
						"catchupHours": {
							"type": "number",
							"description": "How late a missed run may still start, in hours. \
											Omit to inherit the app-wide default; 0 never \
											runs late.",
						},
					},
					"required": ["name", "cron", "prompt"],
				},
				"annotations": { "title": "Create a factorai routine", "readOnlyHint": false },
				// The one tool that has to exist before anyone thinks to look for
				// it — see this function's own comment.
				"_meta": {
					"anthropic/alwaysLoad": true,
					"anthropic/searchHint": "schedule a recurring task, routine, cron job, \
											 daily or weekly agent run for this project in \
											 factorai, running locally on this machine",
				},
			},
			{
				"name": "updateRoutine",
				"description": "Change a routine in this session's project. Send only the \
								fields you are changing; everything else is left alone. \
								Call listRoutines first for the id.",
				"inputSchema": {
					"type": "object",
					"properties": {
						"id": { "type": "string", "description": "From listRoutines." },
						"name": { "type": "string" },
						"cron": {
							"type": "string",
							"description": "Five-field cron expression in local time.",
						},
						"prompt": { "type": "string" },
						"enabled": { "type": "boolean" },
						"catchupHours": {
							"type": "number",
							"description": "Null puts it back on the app-wide default.",
						},
					},
					"required": ["id"],
				},
				"annotations": { "title": "Change a factorai routine", "readOnlyHint": false },
				"_meta": {
					"anthropic/searchHint": "change or edit an existing factorai routine's \
											 schedule, cron, prompt or catch-up window",
				},
			},
			{
				"name": "setRoutineEnabled",
				"description": "Stop or resume a routine's future runs. It never touches a \
								session the routine has already started. There is no way to \
								delete a routine from here — disabling is the reversible \
								form, and deleting one is the human's to do.",
				"inputSchema": {
					"type": "object",
					"properties": {
						"id": { "type": "string", "description": "From listRoutines." },
						"enabled": { "type": "boolean" },
					},
					"required": ["id", "enabled"],
				},
				"annotations": {
					"title": "Enable or disable a factorai routine",
					"readOnlyHint": false,
				},
				"_meta": {
					"anthropic/searchHint": "stop, pause, resume, enable or disable a \
											 factorai routine without deleting it",
				},
			},
		]
	})
}

#[cfg(test)]
mod tests {
	use std::sync::Arc;

	use parking_lot::Mutex;
	use serde_json::{json, Value};

	use super::*;

	/// The routine table this session's tools write to, and every project id the
	/// tools asked it about. The scope claim is that the second is only ever the
	/// session's own, whatever an argument says.
	struct Fixture {
		tools: AgentTools,
		routines: Arc<Mutex<Vec<Routine>>>,
		asked_for: Arc<Mutex<Vec<String>>>,
	}

	/// The project every fixture's session runs in.
	const PROJECT: &str = "p-session";

	fn a_routine(id: &str, project_id: &str, name: &str) -> Routine {
		Routine {
			id: id.into(),
			project_id: project_id.into(),
			name: name.into(),
			cron: "0 2 * * *".into(),
			prompt: "Triage the inbox".into(),
			enabled: true,
			catchup_hours: None,
			last_fire_at: None,
			last_run_at: None,
			last_session_id: None,
			last_skipped_at: None,
			last_error: None,
			created_at: 0,
			created_by_session_id: None,
			last_modified_by_session_id: None,
			next_run_at: None,
		}
	}

	/// A routine store standing in for the `routines` table, with the author
	/// baked in the way `start_bridge` bakes it — so a test can assert what got
	/// recorded without a database.
	fn routine_store(
		rows: Arc<Mutex<Vec<Routine>>>,
		asked_for: Arc<Mutex<Vec<String>>>,
	) -> Routines {
		let list_rows = rows.clone();
		let create_rows = rows.clone();
		Routines {
			project_id: PROJECT.to_string(),
			project_path: "/p/session".to_string(),
			list: Arc::new(move |project_id| {
				asked_for.lock().push(project_id.to_string());
				Ok(list_rows
					.lock()
					.iter()
					.filter(|r| r.project_id == project_id)
					.cloned()
					.collect())
			}),
			create: Arc::new(move |input| {
				if input.cron == "not a cron" {
					return Err(crate::error::AppError::InvalidInput(
						"not a cron expression: not a cron".into(),
					));
				}
				let mut routine = a_routine("r-new", &input.project_id, &input.name);
				routine.cron = input.cron.clone();
				routine.prompt = input.prompt.clone();
				routine.enabled = input.enabled;
				routine.catchup_hours = input.catchup_hours;
				routine.created_by_session_id = Some("s-agent".into());
				create_rows.lock().push(routine.clone());
				Ok(routine)
			}),
			update: Arc::new(move |id, patch| {
				let mut rows = rows.lock();
				let Some(row) = rows.iter_mut().find(|r| r.id == id) else {
					return Err(crate::error::AppError::NotFound(format!("no routine {id}")));
				};
				if let Some(name) = &patch.name {
					row.name = name.clone();
				}
				if let Some(cron) = &patch.cron {
					row.cron = cron.clone();
				}
				if let Some(prompt) = &patch.prompt {
					row.prompt = prompt.clone();
				}
				if let Some(enabled) = patch.enabled {
					row.enabled = enabled;
				}
				if let Some(hours) = patch.catchup_hours {
					row.catchup_hours = hours;
				}
				row.last_modified_by_session_id = Some("s-agent".into());
				Ok(row.clone())
			}),
		}
	}

	fn fixture() -> Fixture {
		let routines: Arc<Mutex<Vec<Routine>>> = Arc::new(Mutex::new(Vec::new()));
		let asked_for: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
		let tools = AgentTools::new(routine_store(routines.clone(), asked_for.clone()));
		Fixture { tools, routines, asked_for }
	}

	fn call(tools: &AgentTools, method: &str, params: Value) -> Value {
		let body = json!({ "jsonrpc": "2.0", "id": 7, "method": method, "params": params });
		let reply = tools.handle(&body.to_string()).expect("a request is answered");
		serde_json::from_str(&reply).unwrap()
	}

	/// The text of a `tools/call` result, and whether it was a tool failure.
	fn tool_result(value: &Value) -> (String, bool) {
		let result = &value["result"];
		(
			result["content"][0]["text"].as_str().unwrap_or_default().to_string(),
			result["isError"].as_bool().unwrap_or(false),
		)
	}

	#[test]
	fn the_server_is_not_named_ide_and_offers_exactly_the_four() {
		// **The reason this module exists** (ADR-0029). The CLI registers the IDE
		// bridge under the hardcoded key `ide` and then shows the model only
		// `executeCode` and `getDiagnostics` from it — so a tool an agent is meant
		// to call cannot live there, whatever it advertises.
		assert_ne!(SERVER_NAME, "ide");

		let f = fixture();
		let reply = call(&f.tools, "tools/list", Value::Null);
		let names: Vec<&str> = reply["result"]["tools"]
			.as_array()
			.unwrap()
			.iter()
			.map(|t| t["name"].as_str().unwrap())
			.collect();
		assert_eq!(names, ["listRoutines", "createRoutine", "updateRoutine", "setRoutineEnabled"]);
		// The one that is absent on purpose (ADR-0028): the editor's delete asks
		// first, and a tool call has nobody to ask.
		assert!(!names.contains(&"deleteRoutine"));
	}

	#[test]
	fn initialize_tells_the_session_where_it_is_running() {
		// **The fix for a real failure.** Asked to "create a routine", a session
		// reached for Claude Code's built-in `schedule` skill — cloud agents,
		// whose description carries the same words — interviewed the user, and
		// died on a 403 against a private repo. Nothing had told it that it was
		// running inside factorai, so a local routine was never a candidate.
		let f = fixture();
		let reply = call(&f.tools, "initialize", json!({ "protocolVersion": "2025-11-25" }));
		let instructions = reply["result"]["instructions"].as_str().expect("instructions");

		assert!(instructions.contains("factorai"), "{instructions}");
		assert!(instructions.contains("/p/session"), "it names the project folder");
		assert!(instructions.contains("createRoutine"), "it names the tool to reach for");
		assert!(instructions.contains("cloud routine"), "it names what it is preferred over");
		// The limit is stated rather than buried, which F22 requires of every
		// surface that mentions a routine at all.
		assert!(instructions.contains("only while factorai is open"), "{instructions}");
		// No stray indentation inside the sentences: rustfmt joins `\`-continued
		// lines and leaves the source's tabs in the literal, which is how this
		// text first shipped reading "It runs only while\t\t\tfactorai is open".
		assert!(!instructions.contains('\t'), "{instructions:?}");
	}

	#[test]
	fn createroutine_is_always_loaded_and_the_others_are_searchable() {
		// A tool nobody can see is a tool nobody calls. `anthropic/alwaysLoad`
		// keeps `createRoutine` out of the deferred set so it exists at the moment
		// somebody says "create a routine"; the rest carry search hints for the
		// path where a model has to go looking.
		let f = fixture();
		let reply = call(&f.tools, "tools/list", Value::Null);
		let tools = reply["result"]["tools"].as_array().unwrap();

		let always: Vec<&str> = tools
			.iter()
			.filter(|t| t["_meta"]["anthropic/alwaysLoad"] == json!(true))
			.map(|t| t["name"].as_str().unwrap())
			.collect();
		assert_eq!(always, ["createRoutine"], "only the one that must be there unprompted");

		for t in tools {
			let hint = t["_meta"]["anthropic/searchHint"].as_str().unwrap_or_default();
			assert!(hint.contains("routine"), "{} has no usable search hint", t["name"]);
			assert!(hint.contains("factorai"), "{} does not name the app", t["name"]);
		}
	}

	#[test]
	fn only_the_read_tool_claims_to_be_read_only() {
		// The CLI reads `readOnlyHint` for `isReadOnly()` and
		// `isConcurrencySafe()`. Claiming it for a write would be the same
		// confident falsehood `getDiagnostics` is kept out of the bridge to avoid.
		let f = fixture();
		let reply = call(&f.tools, "tools/list", Value::Null);
		for t in reply["result"]["tools"].as_array().unwrap() {
			let name = t["name"].as_str().unwrap();
			let read_only = t["annotations"]["readOnlyHint"] == json!(true);
			assert_eq!(read_only, name == "listRoutines", "{name}");
			assert!(t["annotations"]["title"].is_string(), "{name} has no title");
			// Nothing here destroys anything — which is what leaving
			// `deleteRoutine` out bought (ADR-0028).
			assert_ne!(t["annotations"]["destructiveHint"], json!(true), "{name}");
		}
	}

	#[test]
	fn initialize_echoes_the_version_and_names_this_server() {
		let f = fixture();
		// The CLI has been observed asking for `2025-11-25` over HTTP, against
		// `2025-06-18` on the bridge. Echoing is what keeps both true.
		let reply = call(&f.tools, "initialize", json!({ "protocolVersion": "2025-11-25" }));
		assert_eq!(reply["result"]["protocolVersion"], "2025-11-25");
		assert_eq!(reply["result"]["serverInfo"]["name"], SERVER_NAME);
	}

	#[test]
	fn a_notification_is_not_answered() {
		let f = fixture();
		let body = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
		assert!(f.tools.handle(&body.to_string()).is_none());
	}

	#[test]
	fn an_optional_method_we_do_not_have_is_a_method_not_found() {
		// `server/discover` arrives before `initialize` and is optional; the CLI
		// carries on when a server says it does not have it.
		let f = fixture();
		let reply = call(&f.tools, "server/discover", json!({}));
		assert_eq!(reply["error"]["code"], -32601);
	}

	#[test]
	fn createroutine_schedules_in_this_sessions_project_and_says_when() {
		let f = fixture();
		let reply = call(
			&f.tools,
			"tools/call",
			json!({ "name": "createRoutine", "arguments": {
				"name": "Nightly triage",
				"cron": "0 2 * * *",
				"prompt": "Triage the inbox",
			}}),
		);

		let (text, failed) = tool_result(&reply);
		assert!(!failed, "{text}");
		let rows = f.routines.lock();
		assert_eq!(rows.len(), 1);
		assert_eq!(rows[0].project_id, PROJECT);
		// Absent `enabled` means yes: an agent that scheduled something asked for
		// it to run, and it will report it as scheduled either way.
		assert!(rows[0].enabled);
		// The next-fire line is what stops a schedule that silently never runs —
		// the editor shows it to a human, and this is the agent's copy of it.
		assert!(text.contains("next runs"), "{text}");
		assert!(text.contains("only while factorai is open"), "{text}");
	}

	#[test]
	fn no_routine_tool_can_name_another_project() {
		// The scope claim, and the cheapest possible statement of it: `projectId`
		// is not a parameter, so an agent that sends one is ignored rather than
		// obeyed. The database analogue of the path scope in ADR-0017 § 3.
		let f = fixture();
		call(
			&f.tools,
			"tools/call",
			json!({ "name": "createRoutine", "arguments": {
				"name": "Elsewhere",
				"cron": "0 2 * * *",
				"prompt": "do a thing",
				"projectId": "p-somebody-elses",
			}}),
		);
		call(
			&f.tools,
			"tools/call",
			json!({ "name": "listRoutines",
			"arguments": { "projectId": "p-somebody-elses" } }),
		);

		assert_eq!(f.routines.lock()[0].project_id, PROJECT);
		assert!(
			f.asked_for.lock().iter().all(|p| p == PROJECT),
			"the store was asked about {:?}",
			f.asked_for.lock()
		);
	}

	#[test]
	fn updateroutine_refuses_a_routine_that_is_not_this_projects() {
		let f = fixture();
		f.routines.lock().push(a_routine("r-other", "p-somebody-elses", "Theirs"));

		let reply = call(
			&f.tools,
			"tools/call",
			json!({ "name": "updateRoutine",
				"arguments": { "id": "r-other", "cron": "0 5 * * *" } }),
		);

		let (text, failed) = tool_result(&reply);
		assert!(failed, "{text}");
		assert!(text.contains("no routine r-other"), "{text}");
		// Untouched, which is the half that matters.
		assert_eq!(f.routines.lock()[0].cron, "0 2 * * *");
	}

	#[test]
	fn updateroutine_changes_only_the_fields_it_was_sent() {
		// The partial merge. An agent holds a subset and would otherwise have to
		// echo back everything it did not understand — `catchupHours` being the
		// field a round trip loses, since absent there means *inherit the
		// app-wide default* rather than *no value*.
		let f = fixture();
		let mut existing = a_routine("r1", PROJECT, "Nightly triage");
		existing.catchup_hours = Some(4);
		f.routines.lock().push(existing);

		let reply = call(
			&f.tools,
			"tools/call",
			json!({ "name": "updateRoutine",
				"arguments": { "id": "r1", "cron": "0 5 * * *" } }),
		);

		assert!(!tool_result(&reply).1);
		let rows = f.routines.lock();
		assert_eq!(rows[0].cron, "0 5 * * *");
		assert_eq!(rows[0].name, "Nightly triage", "an unsent field is left alone");
		assert_eq!(rows[0].prompt, "Triage the inbox");
		assert_eq!(rows[0].catchup_hours, Some(4), "an unsent window is not reset");
	}

	#[test]
	fn a_null_catchup_puts_a_routine_back_on_the_app_default() {
		// The other half of the three states the wire carries: absent leaves it,
		// `null` clears it, a number pins it. Collapsing the first two would make
		// every partial update silently reset the window.
		let f = fixture();
		let mut existing = a_routine("r1", PROJECT, "Nightly triage");
		existing.catchup_hours = Some(4);
		f.routines.lock().push(existing);

		call(
			&f.tools,
			"tools/call",
			json!({ "name": "updateRoutine",
				"arguments": { "id": "r1", "catchupHours": Value::Null } }),
		);

		assert_eq!(f.routines.lock()[0].catchup_hours, None);
	}

	#[test]
	fn setroutineenabled_switches_it_off_and_says_it_will_not_run() {
		let f = fixture();
		f.routines.lock().push(a_routine("r1", PROJECT, "Nightly triage"));

		let reply = call(
			&f.tools,
			"tools/call",
			json!({ "name": "setRoutineEnabled",
				"arguments": { "id": "r1", "enabled": false } }),
		);

		let (text, failed) = tool_result(&reply);
		assert!(!failed, "{text}");
		assert!(!f.routines.lock()[0].enabled);
		// A disabled routine gets no next-fire list, because it has none — saying
		// "next runs 02:00" about something switched off is the confident
		// falsehood `getDiagnostics` is kept out of the list to avoid.
		assert!(text.contains("it is disabled"), "{text}");
		assert!(!text.contains("next runs"), "{text}");
	}

	#[test]
	fn a_write_records_the_session_that_made_it() {
		// The provenance F22 originally recorded as absent, and asked to revisit
		// before this slice was built (ADR-0028). The author is bound at the
		// bridge, so no tool argument can claim to be somebody else.
		let f = fixture();
		f.routines.lock().push(a_routine("r1", PROJECT, "Written by a human"));

		call(
			&f.tools,
			"tools/call",
			json!({ "name": "createRoutine", "arguments": {
				"name": "Written by an agent", "cron": "0 2 * * *", "prompt": "go" }}),
		);
		call(
			&f.tools,
			"tools/call",
			json!({ "name": "setRoutineEnabled",
				"arguments": { "id": "r1", "enabled": false } }),
		);

		let rows = f.routines.lock();
		// An agent amending a human's routine is the case one column cannot
		// record: the row would still read as untouched.
		assert_eq!(rows[0].created_by_session_id, None);
		assert_eq!(rows[0].last_modified_by_session_id.as_deref(), Some("s-agent"));
		assert_eq!(rows[1].created_by_session_id.as_deref(), Some("s-agent"));
	}

	#[test]
	fn listroutines_says_which_of_the_two_wrote_each_one() {
		let f = fixture();
		f.routines.lock().push(a_routine("r1", PROJECT, "Theirs"));
		let mut mine = a_routine("r2", PROJECT, "Mine");
		mine.created_by_session_id = Some("s-agent".into());
		f.routines.lock().push(mine);

		let reply = call(&f.tools, "tools/call", json!({ "name": "listRoutines" }));
		let body: Value = serde_json::from_str(&tool_result(&reply).0).unwrap();

		assert_eq!(body["routines"][0]["createdBy"]["who"], "human");
		assert_eq!(body["routines"][1]["createdBy"]["who"], "agent");
		assert_eq!(body["routines"][1]["createdBy"]["sessionId"], "s-agent");
	}

	#[test]
	fn a_schedule_the_store_refuses_comes_back_as_a_tool_error() {
		// A refusal is a tool error, not a transport error: the call was
		// well-formed and the answer is no, which is the distinction that lets a
		// model read the failure and fix its own expression.
		let f = fixture();
		let reply = call(
			&f.tools,
			"tools/call",
			json!({ "name": "createRoutine", "arguments": {
				"name": "Broken", "cron": "not a cron", "prompt": "go" }}),
		);

		let (text, failed) = tool_result(&reply);
		assert!(failed, "{text}");
		assert!(text.contains("not a cron expression"), "{text}");
		assert!(reply["error"].is_null(), "a refusal is not a JSON-RPC error");
		assert!(f.routines.lock().is_empty());
	}

	#[test]
	fn a_routine_tool_missing_its_arguments_says_which() {
		let f = fixture();
		for (name, args, wanted) in [
			("createRoutine", json!({ "name": "x" }), "needs a name, a cron and a prompt"),
			("updateRoutine", json!({ "cron": "0 2 * * *" }), "needs an id"),
			("setRoutineEnabled", json!({ "id": "r1" }), "needs enabled"),
		] {
			let reply = call(&f.tools, "tools/call", json!({ "name": name, "arguments": args }));
			let (text, failed) = tool_result(&reply);
			assert!(failed, "{name}: {text}");
			assert!(text.contains(wanted), "{name}: {text}");
		}
	}
}
