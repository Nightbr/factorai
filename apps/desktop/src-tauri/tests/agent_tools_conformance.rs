//! Does a real `claude` actually call factorai's tools? (F22 slice 3, ADR-0029.)
//!
//! **This test exists because its absence shipped a broken feature.** Slice 3
//! was first built on the IDE bridge and verified by driving that bridge's
//! socket directly: every assertion passed, the server answered perfectly, and
//! no model was ever offered a single one of the tools — because the CLI
//! registers the bridge under the hardcoded key `ide` and filters that server's
//! tools down to `executeCode` and `getDiagnostics` before the model sees the
//! list. A test at the transport can only ever prove the transport.
//!
//! So the assertion here is deliberately end-to-end and deliberately dumb: run
//! the real binary, give it the real `--mcp-config` a spawn would give it, ask
//! it in English to schedule something, and look in the database afterwards.
//!
//! **`#[ignore]` because it costs a model turn.** Run it explicitly:
//!
//! ```bash
//! cargo test --test agent_tools_conformance -- --ignored --nocapture
//! ```
//!
//! Record the CLI version with any pass, the way ADR-0017 asks for the bridge's
//! own conformance runs. Last observed green against **2.1.251**.

use std::process::Command;
use std::sync::Arc;

use factorai_lib::db::Db;
use factorai_lib::models::RoutineInput;
use factorai_lib::services::agent_tools::{AgentTools, AgentToolsServer, Routines};
use factorai_lib::services::routines::{self, RoutinePatch};
use tempfile::TempDir;

const PROJECT: &str = "p-conformance";

/// The clock the store takes. `crate::epoch_ms` is private to the lib, and an
/// integration test is an outside caller like any other.
fn now_ms() -> i64 {
	chrono::Utc::now().timestamp_millis()
}

/// A tool server over a throwaway database with one project in it.
///
/// The store closures are the ones `lib.rs` wires, minus the `routines:changed`
/// emit — that needs a Tauri handle, and it is not what this test is about.
fn harness(db: Db, session_id: &str, project_path: &str) -> AgentToolsServer {
	let author = session_id.to_string();
	let (list_db, create_db, update_db) = (db.clone(), db.clone(), db);
	let routines = Routines {
		project_id: PROJECT.to_string(),
		project_path: project_path.to_string(),
		list: Arc::new(move |project_id| {
			list_db.with(|conn| routines::list(conn, project_id, now_ms()))
		}),
		create: {
			let author = author.clone();
			Arc::new(move |input: &RoutineInput| {
				create_db.with(|conn| routines::create(conn, input, Some(&author), now_ms()))
			})
		},
		update: Arc::new(move |id: &str, patch: &RoutinePatch| {
			update_db
				.with(|conn| routines::update_partial(conn, id, patch, Some(&author), now_ms()))
		}),
	};
	let tools = AgentTools::new(routines);
	AgentToolsServer::start(Arc::new(move |text| tools.handle(text))).expect("bind")
}

fn db_with_a_project(dir: &TempDir) -> Db {
	let db = Db::open(&dir.path().join("data")).expect("open db");
	db.with(|conn| {
		conn.execute(
			"INSERT INTO projects(id, real_path, display_name, opened_at)
			 VALUES (?1, ?2, 'conformance', 0)",
			rusqlite::params![PROJECT, dir.path().to_string_lossy()],
		)?;
		Ok(())
	})
	.expect("seed project");
	db
}

/// Run one turn against the real binary and hand back what the model said.
fn run_claude(dir: &TempDir, config: String, prompt: &str) -> String {
	let out = Command::new("claude")
		.arg("--mcp-config")
		.arg(config)
		.arg("--allowedTools")
		.arg("mcp__factorai__createRoutine,mcp__factorai__listRoutines")
		.arg("-p")
		.arg(prompt)
		.current_dir(dir.path())
		.output()
		.expect("run claude");
	let stdout = String::from_utf8_lossy(&out.stdout).to_string();
	let stderr = String::from_utf8_lossy(&out.stderr);
	println!("--- claude stdout ---\n{stdout}\n--- stderr ---\n{stderr}");
	stdout
}

#[test]
#[ignore = "runs the real claude binary and costs a model turn"]
fn a_real_claude_can_schedule_a_routine() {
	let dir = TempDir::new().unwrap();
	let db = db_with_a_project(&dir);
	let session = "s-conformance";
	let server = harness(db.clone(), session, &dir.path().to_string_lossy());

	// Exactly what `TerminalManager::argv_for` puts in a session's argv — and
	// **without `--strict-mcp-config`**, which is the flag that would silently
	// drop every MCP server the user configured for themselves.
	let out = Command::new("claude")
		.arg("--mcp-config")
		.arg(server.mcp_config_arg())
		.arg("--allowedTools")
		.arg("mcp__factorai__createRoutine,mcp__factorai__listRoutines")
		.arg("-p")
		.arg(
			"Schedule a routine in this project called \"Conformance check\" that runs \
			 every weekday at 07:30 with the prompt \"Check the overnight build.\". \
			 Then say DONE.",
		)
		.current_dir(dir.path())
		.output()
		.expect("run claude");

	let stdout = String::from_utf8_lossy(&out.stdout);
	let stderr = String::from_utf8_lossy(&out.stderr);
	println!("--- claude stdout ---\n{stdout}\n--- stderr ---\n{stderr}");

	// The only assertion that matters: the row is in the database, written by a
	// tool the model chose to call from an English instruction.
	let rows = db.with(|conn| routines::list(conn, PROJECT, now_ms())).expect("read routines");
	assert_eq!(
		rows.len(),
		1,
		"the model did not create a routine. stdout was:\n{stdout}\nstderr:\n{stderr}"
	);
	let routine = &rows[0];
	assert!(routine.enabled, "a routine an agent scheduled should run");
	assert_eq!(
		routine.created_by_session_id.as_deref(),
		Some(session),
		"the write must be attributed to the session that made it (ADR-0028)"
	);
	assert_eq!(routine.project_id, PROJECT, "and scoped to the session's own project");
	assert!(
		routine.next_run_at.is_some(),
		"a schedule that can never fire is refused before it is stored"
	);
	println!(
		"routine {:?} — cron {:?}, next run {:?}",
		routine.name, routine.cron, routine.next_run_at
	);
}

#[test]
#[ignore = "runs the real claude binary and costs a model turn"]
fn the_word_factorai_is_not_needed_to_find_the_tool() {
	// **The failure this is written from** (2026-08-30, from a real transcript).
	// Asked in exactly these terms, a session went to Claude Code's built-in
	// `schedule` skill — cloud agents, advertised with the same words the user
	// used — interviewed the human for a turn, and died on an HTTP 403 because
	// the vault was a private repository the cloud could not read. It only
	// reached `mcp__factorai__createRoutine` after the human typed "on factorai".
	//
	// Nothing had told that session it was running inside factorai. Two things
	// fix it and both are asserted by unit tests: `anthropic/alwaysLoad` keeps
	// `createRoutine` out of the deferred set, and the server's `initialize`
	// instructions say where the session is. This is the end-to-end proof that
	// the two together are enough, which is the only proof that counts —
	// everything else here would have passed before the fix as well.
	let dir = TempDir::new().unwrap();
	let db = db_with_a_project(&dir);
	let session = "s-discovery";
	let server = harness(db.clone(), session, &dir.path().to_string_lossy());

	let stdout = run_claude(
		&dir,
		server.mcp_config_arg(),
		"Create a routine that checks every weekday morning whether any invoice is \
		 overdue and whether a tax declaration is due. Then say DONE.",
	);

	let rows = db.with(|conn| routines::list(conn, PROJECT, now_ms())).expect("read routines");
	assert_eq!(
		rows.len(),
		1,
		"the model did not reach for factorai's own tool without being told to. \
		 stdout was:\n{stdout}"
	);
	assert_eq!(rows[0].created_by_session_id.as_deref(), Some(session));
	println!("routine {:?} — cron {:?}", rows[0].name, rows[0].cron);
}
