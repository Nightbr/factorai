use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use notify::RecursiveMode;
use notify_debouncer_mini::new_debouncer;
use parking_lot::Mutex;
use tracing::{info, warn};

use crate::agents::{self, codex};
use crate::services::indexer::{project_dir_for_event, Indexer};
use crate::services::profiles;

/// How long a watch waits for quiet before reporting. Spec Q5.
const DEBOUNCE: Duration = Duration::from_millis(1000);

/// How often the thread wakes with nothing to do, to notice a re-arm. Only a
/// flag is read on such a wake — the profile list is queried when it is set.
const IDLE_TICK: Duration = Duration::from_millis(500);

/// How often a wanted root that is not on disk yet is tried again.
///
/// **A re-arm is not enough on its own.** `Control::rearm` fires when a profile
/// row is written, and a profile's `projects/` directory does not exist until
/// its first session writes a transcript into it — which happens later, with
/// nothing to announce it. Without this retry that profile's store is watched by
/// nothing until the next boot, and its sessions are only ever the live one: the
/// row that would keep them in the sidebar is written by the scan the watcher
/// never triggers, so each one disappears when its terminal closes.
const RETRY: Duration = Duration::from_secs(5);

/// Ask the watcher to reconcile its roots against the `profiles` table.
///
/// The watcher thread checks the request on its next idle tick. Additions
/// also request a scan after the watches are armed, so writes between profile
/// creation and reconciliation are picked up.
///
/// **This is the half of `profiles:changed` that Rust has to handle itself.** The
/// event tells the renderer to re-read a list; a new profile's transcripts,
/// though, are only noticed by something watching its directory, and no renderer
/// can arrange that.
#[derive(Default)]
pub struct Control {
	request: Mutex<Rearm>,
}

#[derive(Default)]
enum Rearm {
	#[default]
	None,
	Only,
	AndScan,
}

impl Control {
	pub fn rearm(&self) {
		let mut request = self.request.lock();
		if matches!(*request, Rearm::None) {
			*request = Rearm::Only;
		}
	}

	pub fn profile_added(&self) {
		*self.request.lock() = Rearm::AndScan;
	}

	fn take(&self) -> Rearm {
		std::mem::take(&mut *self.request.lock())
	}
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum WatchKind {
	ClaudeProjects,
	CodexRollouts,
	CodexNames,
}

type Roots = HashMap<PathBuf, (String, WatchKind)>;

/// Watch every profile's transcript store (F25, F30). A changed transcript
/// triggers a project scan, including sub-agent transcripts that map up to
/// their parent project. Codex's title index also triggers a profile refresh.
///
/// **Each root remembers which profile it belongs to**, and that is not
/// bookkeeping for its own sake: `scan_dir_path` derives the store key from the
/// directory's name, and the same repository under two config directories
/// produces the same name. The watched root is the only thing that knows which
/// of the two a given event came from.
///
/// Watching everything under a root and filtering late is deliberate. Activity
/// in a folder that isn't in the workspace is dropped by `scan_dir_path` —
/// silently, which is the point of the model: a project arrives because you
/// added it, never because Claude touched a directory. But a folder you *have*
/// added and never run Claude in has no directory to watch until its first
/// session exists, and only a recursive watch on the parent notices that
/// appearing.
///
/// A profile whose config directory is absent is skipped and retried on the next
/// re-arm. It is not an error: the directory comes back when the volume is
/// remounted or the next session recreates it, and nothing was reaped meanwhile.
pub fn spawn(indexer: Arc<Indexer>, control: Arc<Control>) {
	std::thread::Builder::new()
		.name("indexer-watcher".into())
		.spawn(move || {
			let (tx, rx) = std::sync::mpsc::channel();
			let mut debouncer = match new_debouncer(DEBOUNCE, tx) {
				Ok(d) => d,
				Err(e) => {
					warn!(error = %e, "failed to construct debouncer");
					return;
				}
			};

			// Watched root → the profile it belongs to. The map *is* the set of
			// live watches, so reconciling is a diff against the table.
			let mut watched = Roots::new();
			// No scan on this first pass: `spawn_initial_scan` is reading the same
			// stores as we arm them.
			let mut pending = reconcile(&indexer, &mut debouncer, &mut watched).pending;
			let mut last_try = Instant::now();

			loop {
				match rx.recv_timeout(IDLE_TICK) {
					Ok(Ok(events)) => {
						// Root → the project directories under it that changed. Keyed by
						// root because the profile is what turns a directory name into a
						// row, and two roots can hold the same name.
						let mut dirty: HashMap<&PathBuf, HashSet<PathBuf>> = HashMap::new();
						let mut dirty_names = HashSet::new();
						for ev in events {
							let path = &ev.path;
							if let Some(profile_id) = codex_names_profile(&watched, path) {
								dirty_names.insert(profile_id);
								continue;
							}
							if path.extension().is_none_or(|e| e != "jsonl") {
								continue;
							}
							// A Codex root is a `sessions/` tree: the file itself is the
							// unit, and its first line says which folder it belongs to.
							if let Some((root, (profile_id, _))) =
								watched.iter().find(|(root, (_, kind))| {
									*kind == WatchKind::CodexRollouts && path.starts_with(root)
								}) {
								if let Err(e) = indexer.scan_codex_file(profile_id, path) {
									warn!(path = ?path, root = ?root, error = %e, "codex reindex failed");
								}
								continue;
							}
							let Some((root, dir)) = watched
								.iter()
								.filter(|(root, (_, kind))| {
									*kind == WatchKind::ClaudeProjects && path.starts_with(root)
								})
								.map(|(root, _)| root)
								.filter_map(|root| {
									project_dir_for_event(path, root).map(|dir| (root, dir))
								})
								.next()
							else {
								// The Codex home watch also sees unrelated files such as
								// history.jsonl.
								continue;
							};
							dirty.entry(root).or_default().insert(dir);
						}
						for (root, dirs) in dirty {
							let Some((profile_id, _)) = watched.get(root) else { continue };
							for dir in dirs {
								if let Err(e) = indexer.scan_dir_path(profile_id, &dir) {
									warn!(path = ?dir, error = %e, "reindex failed");
								}
							}
						}
						for profile_id in dirty_names {
							if let Err(e) = indexer.scan_codex_names(profile_id) {
								warn!(profile_id, error = %e, "codex name refresh failed");
							}
						}
					}
					Ok(Err(e)) => warn!(error = %e, "watcher error"),
					Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
						let request = control.take();
						let due = pending && last_try.elapsed() >= RETRY;
						if matches!(request, Rearm::None) && !due {
							continue;
						}
						let outcome = reconcile(&indexer, &mut debouncer, &mut watched);
						pending = outcome.pending;
						last_try = Instant::now();
						// A root armed this late holds transcripts no event will ever
						// mention again: the appends that wrote them happened while
						// nothing was watching, and a finished session never appends
						// twice. Read the store once so those sessions are indexed now
						// rather than at the next boot.
						if outcome.armed || matches!(request, Rearm::AndScan) {
							crate::services::indexer::spawn_initial_scan(indexer.clone());
						}
					}
					// Every sender is gone, which only happens when the debouncer is
					// dropped — i.e. never, since this thread owns it.
					Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
				}
			}
		})
		.expect("failed to spawn watcher thread");
}

/// Bring the live watches in line with the profiles table: add a root for each
/// profile that has one on disk, drop the roots of profiles that are gone.
fn reconcile<W: notify::Watcher>(
	indexer: &Indexer,
	debouncer: &mut notify_debouncer_mini::Debouncer<W>,
	watched: &mut Roots,
) -> Reconciled {
	let mut outcome = Reconciled::default();
	// F30 § "Discovery": watch the title index's parent so atomic replacement
	// keeps the watch attached, without recursively watching the whole home.
	let mut wanted = Roots::new();
	for p in profiles::all(indexer.db()) {
		let home = PathBuf::from(&p.config_dir);
		match p.agent.as_str() {
			agents::CLAUDE => {
				wanted.insert(home.join("projects"), (p.id, WatchKind::ClaudeProjects));
			}
			agents::CODEX => {
				wanted.insert(
					home.join(codex::SESSIONS_SUBDIR),
					(p.id.clone(), WatchKind::CodexRollouts),
				);
				wanted.insert(home, (p.id, WatchKind::CodexNames));
			}
			_ => {}
		}
	}

	for (root, _) in watched.clone() {
		if !wanted.contains_key(&root) {
			// Best effort: `unwatch` fails when the path is already gone, which is
			// one of the two ways we get here in the first place.
			let _ = debouncer.watcher().unwatch(&root);
			watched.remove(&root);
			info!(path = ?root, "watcher stopped");
		}
	}

	for (root, watch) in wanted {
		if watched.contains_key(&root) {
			continue;
		}
		if !root.exists() {
			// Not a warning per re-arm: a profile created a moment ago has an empty
			// config directory with no `projects/` in it until its first session
			// runs, which is the ordinary case rather than a fault. `RETRY` is what
			// makes sure the moment it appears is noticed.
			info!(path = ?root, "watcher skipped — directory not there yet");
			outcome.pending = true;
			continue;
		}
		let mode = match watch.1 {
			WatchKind::CodexNames => RecursiveMode::NonRecursive,
			WatchKind::ClaudeProjects | WatchKind::CodexRollouts => RecursiveMode::Recursive,
		};
		match debouncer.watcher().watch(&root, mode) {
			Ok(()) => {
				info!(path = ?root, "watcher started");
				watched.insert(root, watch);
				outcome.armed = true;
			}
			// Retried like a root that is not there: the failure is usually the
			// same one arriving a moment earlier — a directory being created
			// under us, or an inotify limit that clears.
			Err(e) => {
				warn!(error = %e, path = ?root, "failed to watch directory");
				outcome.pending = true;
			}
		}
	}
	outcome
}

/// What one pass of [`reconcile`] did, which is what decides whether the watcher
/// has to come back to it.
#[derive(Default)]
struct Reconciled {
	/// A root was taken on that was not watched before, so its store holds
	/// transcripts nothing has read.
	armed: bool,
	/// A profile the table names has no directory to watch yet, so this set is
	/// not final.
	pending: bool,
}

fn codex_names_profile<'a>(watched: &'a Roots, path: &Path) -> Option<&'a str> {
	if path.file_name()?.to_str()? != codex::INDEX_FILE {
		return None;
	}
	let (profile, kind) = watched.get(path.parent()?)?;
	(*kind == WatchKind::CodexNames).then_some(profile.as_str())
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::db::Db;
	use crate::models::ProfileInput;
	use crate::services::indexer::Indexer;

	/// An indexer over a fresh database, with the seeded default profile pointed
	/// at a directory that is already there — so the only root under test is the
	/// one the test creates.
	fn fixture(tmp: &std::path::Path) -> (Indexer, PathBuf) {
		let default_dir = tmp.join("default");
		std::fs::create_dir_all(default_dir.join("projects")).unwrap();
		let db = Db::open(&tmp.join("data")).expect("open db");
		profiles::ensure_default(&db, &default_dir).expect("resolve the default profile");
		let indexer = Indexer::with_callbacks(db, Arc::new(|_| {}), Arc::new(|_| {}));

		let config_dir = tmp.join("work");
		indexer
			.db()
			.with(|conn| {
				profiles::create(
					conn,
					&ProfileInput {
						name: "Work".into(),
						config_dir: config_dir.to_string_lossy().into_owned(),
						agent: None,
					},
					0,
				)
			})
			.expect("create profile");
		(indexer, config_dir)
	}

	/// The bug this retry exists for: a profile is created, its `projects/`
	/// directory does not exist until the CLI writes the first transcript, and
	/// nothing re-arms the watcher at that moment.
	#[test]
	fn a_profile_whose_projects_dir_appears_later_is_armed_without_a_re_arm() {
		let tmp = tempfile::tempdir().unwrap();
		let (indexer, config_dir) = fixture(tmp.path());
		let (tx, _rx) = std::sync::mpsc::channel();
		let mut debouncer = new_debouncer(DEBOUNCE, tx).unwrap();
		let mut watched = Roots::new();

		let first = reconcile(&indexer, &mut debouncer, &mut watched);
		assert!(first.pending, "a root that is not on disk leaves the set unfinished");
		assert_eq!(watched.len(), 1, "only the default profile's root is watchable");

		// The CLI's first session under this profile.
		std::fs::create_dir_all(config_dir.join("projects")).unwrap();

		let second = reconcile(&indexer, &mut debouncer, &mut watched);
		assert!(second.armed, "the root that appeared is taken on");
		assert!(!second.pending, "nothing is left to wait for");
		assert_eq!(watched.len(), 2);

		let third = reconcile(&indexer, &mut debouncer, &mut watched);
		assert!(!third.armed, "a root already watched is not armed twice");
		assert!(!third.pending);
	}

	#[test]
	fn a_seeded_codex_profile_watches_names_even_when_the_index_is_replaced() {
		let tmp = tempfile::tempdir().expect("scratch directory");
		let (indexer, _) = fixture(tmp.path());
		let (tx, rx) = std::sync::mpsc::channel();
		let mut debouncer = new_debouncer(Duration::from_millis(20), tx).expect("debouncer");
		let mut watched = Roots::new();
		reconcile(&indexer, &mut debouncer, &mut watched);

		let home = tmp.path().canonicalize().expect("canonical scratch directory").join("codex");
		std::fs::create_dir_all(home.join(codex::SESSIONS_SUBDIR)).expect("create rollout tree");
		let (profile, changed) =
			profiles::ensure_default_for(indexer.db(), agents::CODEX, &home).expect("seed profile");
		assert!(changed);
		let (_, changed) =
			profiles::ensure_default_for(indexer.db(), agents::CODEX, &home).expect("check again");
		assert!(!changed);

		let control = Control::default();
		control.profile_added();
		control.rearm();
		assert!(matches!(control.take(), Rearm::AndScan));
		assert!(reconcile(&indexer, &mut debouncer, &mut watched).armed);

		let index = home.join(codex::INDEX_FILE);
		let replacement = home.join("session_index.tmp");
		std::fs::write(&replacement, "{}\n").expect("write replacement");
		std::fs::rename(&replacement, &index).expect("replace index");
		let deadline = Instant::now() + Duration::from_secs(5);
		loop {
			let events = rx
				.recv_timeout(deadline.saturating_duration_since(Instant::now()))
				.expect("index replacement event")
				.expect("filesystem events");
			if events.iter().any(|event| {
				codex_names_profile(&watched, &event.path) == Some(profile.id.as_str())
			}) {
				break;
			}
			assert!(Instant::now() < deadline, "Codex name index event did not arrive");
		}
	}
}
