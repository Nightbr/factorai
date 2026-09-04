use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_mini::new_debouncer;
use tracing::{info, warn};

use crate::services::indexer::{project_dir_for_event, Indexer};
use crate::services::profiles;

/// How long a watch waits for quiet before reporting. Spec Q5.
const DEBOUNCE: Duration = Duration::from_millis(1000);

/// How often the thread wakes with nothing to do, to notice a re-arm. Only a
/// flag is read on such a wake — the profile list is queried when it is set.
const IDLE_TICK: Duration = Duration::from_millis(500);

/// Ask the watcher to reconcile its roots against the `profiles` table.
///
/// Cheap and idempotent: it raises a flag the watcher thread reads on its next
/// idle tick. Called after a profile is created or deleted — a rename changes no
/// directory and needs nothing.
///
/// **This is the half of `profiles:changed` that Rust has to handle itself.** The
/// event tells the renderer to re-read a list; a new profile's transcripts,
/// though, are only noticed by something watching its directory, and no renderer
/// can arrange that.
#[derive(Default)]
pub struct Control {
	dirty: AtomicBool,
}

impl Control {
	pub fn rearm(&self) {
		self.dirty.store(true, Ordering::Relaxed);
	}

	fn take(&self) -> bool {
		self.dirty.swap(false, Ordering::Relaxed)
	}
}

/// Spawn a debounced filesystem watcher over **every profile's** projects
/// directory (F25 slice 2). Re-runs the project scan for any project containing
/// a changed `.jsonl` — including a sub-agent transcript, which maps up to its
/// project rather than being mistaken for one.
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
			let mut watched: HashMap<PathBuf, String> = HashMap::new();
			reconcile(&indexer, &mut debouncer, &mut watched);

			loop {
				match rx.recv_timeout(IDLE_TICK) {
					Ok(Ok(events)) => {
						// Root → the project directories under it that changed. Keyed by
						// root because the profile is what turns a directory name into a
						// row, and two roots can hold the same name.
						let mut dirty: HashMap<&PathBuf, std::collections::HashSet<PathBuf>> =
							HashMap::new();
						for ev in events {
							let path = &ev.path;
							if path.extension().is_none_or(|e| e != "jsonl") {
								continue;
							}
							let Some((root, dir)) = watched
								.keys()
								.filter(|root| path.starts_with(root))
								.filter_map(|root| {
									project_dir_for_event(path, root).map(|dir| (root, dir))
								})
								.next()
							else {
								warn!(
									path = ?path,
									"changed jsonl is not inside a watched project directory; ignoring"
								);
								continue;
							};
							dirty.entry(root).or_default().insert(dir);
						}
						for (root, dirs) in dirty {
							let Some(profile_id) = watched.get(root) else { continue };
							for dir in dirs {
								if let Err(e) = indexer.scan_dir_path(profile_id, &dir) {
									warn!(path = ?dir, error = %e, "reindex failed");
								}
							}
						}
					}
					Ok(Err(e)) => warn!(error = %e, "watcher error"),
					Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
						if control.take() {
							reconcile(&indexer, &mut debouncer, &mut watched);
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
	watched: &mut HashMap<PathBuf, String>,
) {
	let wanted: HashMap<PathBuf, String> = profiles::all(indexer.db())
		.into_iter()
		.map(|p| (PathBuf::from(&p.config_dir).join("projects"), p.id))
		.collect();

	for (root, _) in watched.clone() {
		if !wanted.contains_key(&root) {
			// Best effort: `unwatch` fails when the path is already gone, which is
			// one of the two ways we get here in the first place.
			let _ = debouncer.watcher().unwatch(&root);
			watched.remove(&root);
			info!(path = ?root, "watcher stopped");
		}
	}

	for (root, profile_id) in wanted {
		if watched.contains_key(&root) {
			continue;
		}
		if !root.exists() {
			// Not a warning per re-arm: a profile created a moment ago has an empty
			// config directory with no `projects/` in it until its first session
			// runs, which is the ordinary case rather than a fault.
			info!(path = ?root, "watcher skipped — projects dir not there yet");
			continue;
		}
		match debouncer.watcher().watch(&root, RecursiveMode::Recursive) {
			Ok(()) => {
				info!(path = ?root, "watcher started");
				watched.insert(root, profile_id);
			}
			Err(e) => warn!(error = %e, path = ?root, "failed to watch projects dir"),
		}
	}
}
