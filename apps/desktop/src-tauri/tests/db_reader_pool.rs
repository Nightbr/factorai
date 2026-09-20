//! The property PERF-02 bought: a read does not wait for the writer.
//!
//! `Db` used to be one connection behind one mutex, so a `list_sidebar` arriving
//! while the indexer was in the middle of a write transaction waited for that
//! transaction — on the main thread, every two seconds. WAL has allowed
//! concurrent readers since the day it was turned on; the mutex was what
//! prevented it.
//!
//! These are timing assertions, which is unusual here and is the only way to
//! state this one: the bounds are wide (a 500ms hold, a read that must finish
//! inside 150ms) so the test says "does not wait" rather than "is fast".

use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use factorai_lib::db::Db;
use tempfile::TempDir;

const HOLD: Duration = Duration::from_millis(500);

/// Opens a database and takes the writer for [`HOLD`], signalling once the
/// transaction is genuinely open so the reader races the hold and not the
/// thread start.
fn writer_holding(db: &Db) -> (thread::JoinHandle<()>, mpsc::Receiver<()>) {
	let db = db.clone();
	let (tx, rx) = mpsc::channel();
	let handle = thread::spawn(move || {
		db.with_mut(|conn| {
			let t = conn.transaction()?;
			t.execute("INSERT INTO settings(key, value) VALUES('perf02', 'held')", [])?;
			tx.send(()).ok();
			thread::sleep(HOLD);
			t.commit()?;
			Ok(())
		})
		.expect("writer");
	});
	(handle, rx)
}

#[test]
fn a_read_does_not_wait_for_an_open_write_transaction() {
	let tmp = TempDir::new().unwrap();
	let db = Db::open(tmp.path()).expect("open");

	let (writer, opened) = writer_holding(&db);
	opened.recv_timeout(Duration::from_secs(5)).expect("transaction opened");

	let t = Instant::now();
	let count: i64 = db
		.read(|conn| Ok(conn.query_row("SELECT count(*) FROM sessions", [], |r| r.get(0))?))
		.expect("read");
	let read_took = t.elapsed();

	assert_eq!(count, 0);
	assert!(
		read_took < HOLD / 3,
		"a pooled read waited on the writer: {read_took:?} against a {HOLD:?} hold"
	);

	writer.join().unwrap();
}

#[test]
fn the_writer_is_still_serialised_against_itself() {
	let tmp = TempDir::new().unwrap();
	let db = Db::open(tmp.path()).expect("open");

	let (writer, opened) = writer_holding(&db);
	opened.recv_timeout(Duration::from_secs(5)).expect("transaction opened");

	// The other half of the property, and the reason `with` was left alone:
	// everything it serialised is still serialised.
	let t = Instant::now();
	db.with(
		|conn| Ok(conn.query_row("SELECT count(*) FROM sessions", [], |r| r.get::<_, i64>(0))?),
	)
	.expect("with");
	let with_took = t.elapsed();

	assert!(with_took > HOLD / 2, "`with` should have waited for the writer, took {with_took:?}");

	writer.join().unwrap();
}

#[test]
fn a_write_through_read_is_refused() {
	let tmp = TempDir::new().unwrap();
	let db = Db::open(tmp.path()).expect("open");

	// What makes moving a caller onto `read` provable rather than a judgement:
	// the connection is read-only, so a caller that turns out to write fails
	// here and in the test suite rather than quietly stepping outside the
	// single-writer discipline.
	let refused = db.read(|conn| {
		Ok(conn.execute("INSERT INTO settings(key, value) VALUES('perf02', 'nope')", [])?)
	});
	assert!(refused.is_err(), "a read-only connection must refuse a write");

	// And the pool is not poisoned by it.
	let count: i64 = db
		.read(|conn| Ok(conn.query_row("SELECT count(*) FROM settings", [], |r| r.get(0))?))
		.expect("read after a refused write");
	assert_eq!(count, 0);
}

#[test]
fn the_pool_is_reused_and_survives_more_readers_than_it_keeps() {
	let tmp = TempDir::new().unwrap();
	let db = Db::open(tmp.path()).expect("open");

	// More concurrent readers than the pool keeps idle: the extras are served by
	// a connection opened for the call rather than by waiting for one.
	let handles: Vec<_> = (0..12)
		.map(|_| {
			let db = db.clone();
			thread::spawn(move || {
				db.read(|conn| {
					Ok(conn
						.query_row("SELECT count(*) FROM projects", [], |r| r.get::<_, i64>(0))?)
				})
				.expect("read")
			})
		})
		.collect();
	for h in handles {
		assert_eq!(h.join().unwrap(), 0);
	}
}
