//! Indexing a transcript's tail rather than re-reading it whole (PERF-03).
//!
//! Transcripts are append-only, and the indexer used to re-read, re-parse and
//! re-tokenise the entire file every time one changed — so a live session with
//! a large transcript paid its whole size per second of output.
//!
//! The properties worth holding are not "it is faster". They are: the tail is
//! the only thing read, nothing already indexed is lost or duplicated, a line
//! that was half-written when the watcher fired is read once and only once, and
//! a `/rename` from earlier in the file still outranks a title the tail carries.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use factorai_lib::commands::projects::add_project_in;
use factorai_lib::db::Db;
use factorai_lib::models::SessionsChanged;
use factorai_lib::services::indexer::Indexer;
use rusqlite::params;
use tempfile::TempDir;

const SID: &str = "11111111-2222-3333-4444-555555555555";

fn store_dir(claude_dir: &Path, cwd: &Path) -> PathBuf {
	let encoded = format!("-{}", cwd.to_string_lossy().trim_start_matches('/').replace('/', "-"));
	let dir = claude_dir.join("projects").join(encoded);
	std::fs::create_dir_all(&dir).expect("mkdir store");
	dir
}

fn make_indexer(db: Db, claude_dir: PathBuf) -> Indexer {
	factorai_lib::services::profiles::ensure_default(&db, &claude_dir).expect("default profile");
	let changes: Arc<Mutex<Vec<SessionsChanged>>> = Arc::new(Mutex::new(Vec::new()));
	Indexer::with_callbacks(
		db,
		Arc::new(|_| {}),
		Arc::new(move |c: SessionsChanged| changes.lock().unwrap().push(c)),
	)
}

/// A store with one project and a transcript of exactly `lines`, scanned once.
fn fixture(tmp: &Path) -> (Db, Indexer, PathBuf) {
	let claude_dir = tmp.join(".claude");
	let cwd = tmp.join("code").join("foo");
	std::fs::create_dir_all(&cwd).unwrap();
	let cwd = cwd.canonicalize().unwrap();
	let store = store_dir(&claude_dir, &cwd);
	let db = Db::open(&tmp.join("data")).expect("open db");
	add_project_in(&db, cwd.to_str().unwrap()).expect("add project");
	let indexer = make_indexer(db.clone(), claude_dir);
	(db, indexer, store.join(format!("{SID}.jsonl")))
}

fn user(uuid: &str, ts: &str, text: &str) -> String {
	format!(
		r#"{{"type":"user","uuid":"{uuid}","timestamp":"{ts}","message":{{"role":"user","content":"{text}"}}}}"#
	)
}

fn assistant(uuid: &str, ts: &str, text: &str) -> String {
	format!(
		r#"{{"type":"assistant","uuid":"{uuid}","timestamp":"{ts}","message":{{"role":"assistant","content":[{{"type":"text","text":"{text}"}}]}}}}"#
	)
}

/// Rewrite the file and make sure the next scan can tell: some filesystems
/// carry a coarse mtime, and the indexer's first gate is `(mtime, size)`.
fn write(path: &Path, body: &str) {
	std::fs::write(path, body).expect("write transcript");
	std::thread::sleep(std::time::Duration::from_millis(15));
	let again = std::fs::read_to_string(path).unwrap();
	std::fs::write(path, again).unwrap();
}

fn row<T: rusqlite::types::FromSql>(db: &Db, col: &str) -> T {
	db.with(|conn| {
		Ok(conn.query_row(
			&format!("SELECT {col} FROM sessions WHERE id = ?1"),
			params![SID],
			|r| r.get::<_, T>(0),
		)?)
	})
	.expect("row")
}

fn message_bodies(db: &Db) -> Vec<String> {
	db.with(|conn| {
		let mut stmt =
			conn.prepare("SELECT body FROM messages WHERE session_id = ?1 ORDER BY id")?;
		let out = stmt
			.query_map(params![SID], |r| r.get::<_, String>(0))?
			.collect::<rusqlite::Result<Vec<_>>>()?;
		Ok(out)
	})
	.expect("bodies")
}

#[test]
fn an_appended_turn_is_added_without_re_reading_the_prefix() {
	let tmp = TempDir::new().unwrap();
	let (db, indexer, path) = fixture(tmp.path());

	let first = format!(
		"{}\n{}\n",
		user("u1", "2026-01-01T00:00:00Z", "help me with react hooks"),
		assistant("a1", "2026-01-01T00:00:05Z", "here is a useEffect example")
	);
	write(&path, &first);
	indexer.full_scan().expect("first scan");
	assert_eq!(row::<i64>(&db, "turn_count"), 2);
	assert_eq!(message_bodies(&db).len(), 2);
	let after_first = row::<i64>(&db, "indexed_bytes");
	assert_eq!(after_first, first.len() as i64, "the whole file was consumed");

	// **The prefix is rewritten as well as appended to, to exactly the same
	// length.** A full re-parse would notice; a tail parse cannot, and that is
	// the assertion — it is the only way to prove from the outside that the
	// prefix was not read again. The length has to match or the resume offset
	// lands mid-line and the boundary check sends it down the full path instead,
	// which is the next test.
	let tampered = first.replace("help me with react hooks", "PREFIX WAS RE-READ!!!!!!");
	assert_eq!(tampered.len(), first.len(), "the tamper must not move the offsets");
	let second = format!("{tampered}{}\n", user("u2", "2026-01-01T00:00:10Z", "and now tailwind"));
	write(&path, &second);
	indexer.full_scan().expect("second scan");

	assert_eq!(row::<i64>(&db, "turn_count"), 3, "the appended turn counts once");
	let bodies = message_bodies(&db);
	assert_eq!(bodies.len(), 3, "one row added, none duplicated");
	assert_eq!(
		bodies[0], "help me with react hooks",
		"the prefix kept what was indexed the first time, so it was not re-read"
	);
	assert_eq!(bodies[2], "and now tailwind");
	assert_eq!(row::<i64>(&db, "indexed_bytes"), second.len() as i64);
}

#[test]
fn a_half_written_last_line_is_indexed_once_when_it_is_finished() {
	let tmp = TempDir::new().unwrap();
	let (db, indexer, path) = fixture(tmp.path());

	// What the watcher actually catches: Claude is part-way through writing the
	// line. It is not valid JSON, so nothing can be made of it yet.
	let whole = user("u1", "2026-01-01T00:00:00Z", "the first question");
	let half = &whole[..whole.len() / 2];
	write(&path, &format!("{whole}\n{half}"));
	indexer.full_scan().expect("first scan");
	assert_eq!(row::<i64>(&db, "turn_count"), 1, "the truncated line is not an event yet");
	assert_eq!(
		row::<i64>(&db, "indexed_bytes"),
		whole.len() as i64 + 1,
		"and the offset stops before it, so it will be read again"
	);

	// The rest of it lands.
	let finished = format!("{whole}\n{}\n", user("u2", "2026-01-01T00:00:05Z", "the second one"));
	write(&path, &finished);
	indexer.full_scan().expect("second scan");

	assert_eq!(row::<i64>(&db, "turn_count"), 2);
	let bodies = message_bodies(&db);
	assert_eq!(bodies, vec!["the first question", "the second one"], "read once, not twice");
}

#[test]
fn a_line_that_parsed_without_its_newline_is_not_read_twice() {
	let tmp = TempDir::new().unwrap();
	let (db, indexer, path) = fixture(tmp.path());

	// The other half of the same race: the JSON object is complete but the
	// newline has not been written yet. It parses, so it is indexed — and the
	// newline arriving must not make it arrive a second time.
	let one = user("u1", "2026-01-01T00:00:00Z", "complete but unterminated");
	write(&path, &one);
	indexer.full_scan().expect("first scan");
	assert_eq!(message_bodies(&db).len(), 1);

	write(&path, &format!("{one}\n{}\n", user("u2", "2026-01-01T00:00:05Z", "the next one")));
	indexer.full_scan().expect("second scan");

	assert_eq!(
		message_bodies(&db),
		vec!["complete but unterminated", "the next one"],
		"the newline is an empty line, not a repeat of the event before it"
	);
	assert_eq!(row::<i64>(&db, "turn_count"), 2);
}

#[test]
fn a_rename_earlier_in_the_file_outranks_a_later_ai_title() {
	let tmp = TempDir::new().unwrap();
	let (db, indexer, path) = fixture(tmp.path());

	let rename = r#"{"type":"custom-title","uuid":"t1","timestamp":"2026-01-01T00:00:01Z","customTitle":"What I called it"}"#;
	let first = format!("{}\n{rename}\n", user("u1", "2026-01-01T00:00:00Z", "hello"));
	write(&path, &first);
	indexer.full_scan().expect("first scan");
	assert_eq!(row::<String>(&db, "title"), "What I called it");
	assert_eq!(row::<String>(&db, "title_kind"), "custom");

	// Claude retitles the session afterwards. A full parse settled this by
	// reading both lines; a tail parse sees only the second and has to know from
	// the row that it is up against a rename.
	let ai = r#"{"type":"ai-title","uuid":"t2","timestamp":"2026-01-01T00:00:09Z","aiTitle":"What Claude called it"}"#;
	write(&path, &format!("{first}{ai}\n"));
	indexer.full_scan().expect("second scan");

	assert_eq!(
		row::<String>(&db, "title"),
		"What I called it",
		"a rename is not undone by the tail"
	);
	assert_eq!(row::<String>(&db, "title_kind"), "custom");
}

#[test]
fn a_rename_in_the_tail_still_wins() {
	let tmp = TempDir::new().unwrap();
	let (db, indexer, path) = fixture(tmp.path());

	let first = format!("{}\n", user("u1", "2026-01-01T00:00:00Z", "hello there"));
	write(&path, &first);
	indexer.full_scan().expect("first scan");
	assert_eq!(row::<String>(&db, "title_kind"), "derived");

	let rename = r#"{"type":"custom-title","uuid":"t1","timestamp":"2026-01-01T00:00:09Z","customTitle":"Renamed later"}"#;
	write(&path, &format!("{first}{rename}\n"));
	indexer.full_scan().expect("second scan");

	assert_eq!(row::<String>(&db, "title"), "Renamed later");
	assert_eq!(row::<String>(&db, "title_kind"), "custom");
}

#[test]
fn a_transcript_that_shrank_is_parsed_in_full_again() {
	let tmp = TempDir::new().unwrap();
	let (db, indexer, path) = fixture(tmp.path());

	let first = format!(
		"{}\n{}\n",
		user("u1", "2026-01-01T00:00:00Z", "the original first line"),
		assistant("a1", "2026-01-01T00:00:05Z", "and a reply")
	);
	write(&path, &first);
	indexer.full_scan().expect("first scan");
	assert_eq!(message_bodies(&db).len(), 2);

	// Shorter than what was indexed, so the prefix cannot be what we read: the
	// only correct answer is to start over.
	let rewritten = format!("{}\n", user("u9", "2026-02-01T00:00:00Z", "a different conversation"));
	assert!(rewritten.len() < first.len());
	write(&path, &rewritten);
	indexer.full_scan().expect("second scan");

	assert_eq!(
		message_bodies(&db),
		vec!["a different conversation"],
		"the old rows go with the full re-parse"
	);
	assert_eq!(row::<i64>(&db, "turn_count"), 1);
}

#[test]
fn a_row_from_before_the_column_existed_takes_one_full_parse() {
	let tmp = TempDir::new().unwrap();
	let (db, indexer, path) = fixture(tmp.path());

	let first = format!("{}\n", user("u1", "2026-01-01T00:00:00Z", "indexed by an older build"));
	write(&path, &first);
	indexer.full_scan().expect("first scan");

	// What migration 0021 leaves behind on every existing row: no resume point
	// and nothing to say where the title came from.
	db.with(|conn| {
		conn.execute(
			"UPDATE sessions SET indexed_bytes = 0, title_kind = NULL WHERE id = ?1",
			params![SID],
		)?;
		conn.execute("DELETE FROM messages WHERE session_id = ?1", params![SID])?;
		Ok(())
	})
	.unwrap();

	write(&path, &format!("{first}{}\n", user("u2", "2026-01-01T00:00:05Z", "and a new turn")));
	indexer.full_scan().expect("second scan");

	assert_eq!(
		message_bodies(&db),
		vec!["indexed by an older build", "and a new turn"],
		"the whole file is read, so the row that predates the column recovers"
	);
	assert_eq!(row::<String>(&db, "title_kind"), "derived", "and it is resumable from now on");
}

#[test]
fn a_prefix_rewritten_to_a_different_length_falls_back_to_a_full_parse() {
	let tmp = TempDir::new().unwrap();
	let (db, indexer, path) = fixture(tmp.path());

	let first = format!("{}\n", user("u1", "2026-01-01T00:00:00Z", "the original question"));
	write(&path, &first);
	indexer.full_scan().expect("first scan");
	assert_eq!(message_bodies(&db), vec!["the original question"]);

	// Longer than it was, and different, so the stored offset now points into
	// the middle of a line. Every cheap test — mtime, size, parse version —
	// still says "resume", and only looking at the byte there can tell.
	let rewritten = format!(
		"{}\n{}\n",
		user("u1", "2026-01-01T00:00:00Z", "a much longer first question than before"),
		user("u2", "2026-01-01T00:00:05Z", "and a second")
	);
	assert!(rewritten.len() > first.len());
	write(&path, &rewritten);
	indexer.full_scan().expect("second scan");

	assert_eq!(
		message_bodies(&db),
		vec!["a much longer first question than before", "and a second"],
		"the file is read from the start, so nothing is skipped or duplicated"
	);
	assert_eq!(row::<i64>(&db, "turn_count"), 2);
}
