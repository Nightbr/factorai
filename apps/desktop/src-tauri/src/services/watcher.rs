use std::sync::Arc;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_mini::new_debouncer;
use tracing::{info, warn};

use crate::services::indexer::{project_dir_for_event, Indexer};

/// Spawn a debounced filesystem watcher on the claude projects dir. Re-runs
/// the project scan for any project containing a changed `.jsonl` —
/// including a sub-agent transcript, which maps up to its project rather
/// than being mistaken for one.
///
/// Debounce window is 1s per spec/Q5. We watch the whole projects tree
/// recursively; the indexer's mtime/size check makes targeted reindex cheap.
///
/// Watching everything and filtering late is deliberate. Activity in a folder
/// that isn't in the workspace is dropped by `scan_dir_path` — silently, which
/// is the point of the new model: a project arrives because you added it, never
/// because Claude touched a directory. But a folder you *have* added and never
/// run Claude in has no directory to watch until its first session exists, and
/// only a recursive watch on the parent notices that appearing.
pub fn spawn(indexer: Arc<Indexer>) {
	let projects_dir = indexer.claude_dir().join("projects");
	if !projects_dir.exists() {
		warn!(path = ?projects_dir, "watcher skipped — projects dir missing");
		return;
	}

	std::thread::Builder::new()
		.name("indexer-watcher".into())
		.spawn(move || {
			let (tx, rx) = std::sync::mpsc::channel();
			let mut debouncer = match new_debouncer(Duration::from_millis(1000), tx) {
				Ok(d) => d,
				Err(e) => {
					warn!(error = %e, "failed to construct debouncer");
					return;
				}
			};
			if let Err(e) = debouncer.watcher().watch(&projects_dir, RecursiveMode::Recursive) {
				warn!(error = %e, "failed to watch projects dir");
				return;
			}
			info!(path = ?projects_dir, "watcher started");

			while let Ok(res) = rx.recv() {
				match res {
					Ok(events) => {
						let mut dirty_projects = std::collections::HashSet::new();
						for ev in events {
							let path = &ev.path;
							if path.extension().is_some_and(|e| e == "jsonl") {
								match project_dir_for_event(path, &projects_dir) {
									Some(p) => {
										dirty_projects.insert(p);
									}
									None => warn!(
										path = ?path,
										"changed jsonl is not inside a project directory; ignoring"
									),
								}
							}
						}
						for p in dirty_projects {
							if let Err(e) = indexer.scan_dir_path(&p) {
								warn!(path = ?p, error = %e, "reindex failed");
							}
						}
					}
					Err(e) => warn!(error = %e, "watcher error"),
				}
			}
		})
		.expect("failed to spawn watcher thread");
}
