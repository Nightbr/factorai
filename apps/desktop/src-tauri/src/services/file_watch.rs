use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_mini::{
	new_debouncer, notify::RecommendedWatcher, DebounceEventResult, Debouncer,
};
use parking_lot::Mutex;
use tracing::{debug, warn};

use crate::error::{AppError, AppResult};

/// How long a burst of writes is collapsed into one notification.
///
/// Shorter than the indexer's 1s (`services::watcher`) because the two answer
/// different questions: that one decides when to re-read a transcript nobody is
/// staring at, and this one decides how long the file you are *looking at*
/// keeps showing text that is no longer in it. Long enough that an agent
/// rewriting a file in several writes — or a tool that truncates and then fills
/// — refreshes once rather than flashing through an empty document.
pub const DEBOUNCE: Duration = Duration::from_millis(250);

/// A filesystem watch on **one** file: whatever the viewer has open (F7).
///
/// One at a time is the whole design. The viewer shows a single path, so a map
/// of watches would only ever hold one entry and would need a policy for the
/// ones that leaked; here, watching a second file *is* releasing the first, and
/// closing the viewer releases it with no path to leak. `Drop` on the
/// `Debouncer` is the release: it stops the debouncer's thread and drops the
/// backend watch (an inotify descriptor on Linux, an FSEvents stream on macOS).
///
/// **The watch is on the parent directory, not the file**, filtered by file
/// name. A watch on the file follows the inode, and an agent that saves by
/// writing `foo.md.tmp` and renaming it over `foo.md` — which `Write` and every
/// editor with atomic saves does — leaves that watch pointing at an inode
/// nothing will ever touch again. The directory sees the rename, the delete,
/// and the recreate, so it survives all three. Non-recursive, so a repository
/// root does not drag a tree of build output in with it.
pub struct FileWatch {
	active: Mutex<Option<Active>>,
}

struct Active {
	path: PathBuf,
	/// Held only to be dropped. Dropping it is the unsubscribe.
	_debouncer: Debouncer<RecommendedWatcher>,
}

impl FileWatch {
	pub fn new() -> Self {
		Self { active: Mutex::new(None) }
	}

	/// Watch `path`, calling `on_change` when it changes. Replaces any watch
	/// already running — the previous file is released before this returns.
	pub fn watch<F>(&self, path: &Path, on_change: F) -> AppResult<()>
	where
		F: Fn() + Send + 'static,
	{
		let dir = path
			.parent()
			.filter(|p| !p.as_os_str().is_empty())
			.ok_or_else(|| {
				AppError::InvalidInput(format!(
					"{} has no parent directory to watch",
					path.display()
				))
			})?
			.to_path_buf();
		let name: OsString = path
			.file_name()
			.ok_or_else(|| AppError::InvalidInput(format!("{} names no file", path.display())))?
			.to_os_string();

		let mut debouncer = new_debouncer(DEBOUNCE, move |res: DebounceEventResult| match res {
			// Every event is a direct child of the watched directory, so the file
			// name is enough to tell ours from its neighbours' — and it matches
			// through a rename that a path comparison against a canonicalized
			// original would not.
			Ok(events) => {
				if events.iter().any(|e| e.path.file_name() == Some(name.as_os_str())) {
					on_change();
				}
			}
			// A watch that has lost its footing is not worth a dialog: the file is
			// still readable and reopening it still re-reads (F7 § "Freshness").
			Err(e) => warn!(error = %e, "file watch error"),
		})
		.map_err(|e| AppError::Io(e.to_string()))?;

		debouncer
			.watcher()
			.watch(&dir, RecursiveMode::NonRecursive)
			.map_err(|e| AppError::Io(e.to_string()))?;

		// Swap under the lock, drop the old watch outside it. `Debouncer::drop`
		// signals another thread, and holding a lock across a wait on a thread is
		// exactly the shape that deadlocked the GTK main thread once already
		// (`TerminalManager`'s `child.lock()` across `wait()`).
		let previous = {
			let mut slot = self.active.lock();
			slot.replace(Active { path: path.to_path_buf(), _debouncer: debouncer })
		};
		drop(previous);

		debug!(path = ?path, "watching open file");
		Ok(())
	}

	/// Stop watching `path`, if that is what is being watched. Returns whether
	/// it stopped anything.
	///
	/// **Path-scoped on purpose.** The renderer unwatches when the viewer closes
	/// and watches when it opens, and those two can only be ordered by whoever
	/// sends them; a bare `unwatch()` arriving late — a closed viewer's cleanup
	/// landing after the next file's `watch` — would silently kill a live watch.
	/// Naming the path makes a late unwatch a no-op instead.
	pub fn unwatch(&self, path: &Path) -> bool {
		let previous = {
			let mut slot = self.active.lock();
			match slot.as_ref() {
				Some(active) if active.path == path => slot.take(),
				_ => None,
			}
		};
		let stopped = previous.is_some();
		drop(previous);
		if stopped {
			debug!(path = ?path, "released file watch");
		}
		stopped
	}

	/// What is being watched, if anything. Exists for tests and for the quit
	/// path's logging — nothing in the UI asks.
	pub fn watched(&self) -> Option<PathBuf> {
		self.active.lock().as_ref().map(|a| a.path.clone())
	}
}

impl Default for FileWatch {
	fn default() -> Self {
		Self::new()
	}
}

#[cfg(test)]
mod tests {
	use std::sync::mpsc;
	use std::time::Duration;

	use super::*;

	/// Long enough for the debounce plus the backend's own latency, short enough
	/// that a broken watch fails the suite rather than hanging it.
	const WAIT: Duration = Duration::from_secs(5);

	fn watch_into_channel(fw: &FileWatch, path: &Path) -> mpsc::Receiver<()> {
		let (tx, rx) = mpsc::channel();
		fw.watch(path, move || {
			let _ = tx.send(());
		})
		.unwrap();
		rx
	}

	#[test]
	fn notices_a_write() {
		let dir = tempfile::tempdir().unwrap();
		let file = dir.path().join("notes.md");
		std::fs::write(&file, "before\n").unwrap();

		let fw = FileWatch::new();
		let rx = watch_into_channel(&fw, &file);

		std::fs::write(&file, "after\n").unwrap();

		rx.recv_timeout(WAIT).expect("a write to the watched file should notify");
	}

	/// The reason the watch is on the directory. An agent's `Write` saves by
	/// renaming a temp file over the target, which leaves a watch on the
	/// original inode watching nothing.
	#[test]
	fn notices_an_atomic_replace() {
		let dir = tempfile::tempdir().unwrap();
		let file = dir.path().join("notes.md");
		std::fs::write(&file, "before\n").unwrap();

		let fw = FileWatch::new();
		let rx = watch_into_channel(&fw, &file);

		let tmp = dir.path().join("notes.md.tmp");
		std::fs::write(&tmp, "after\n").unwrap();
		std::fs::rename(&tmp, &file).unwrap();

		rx.recv_timeout(WAIT).expect("a rename over the watched file should notify");
	}

	/// A sibling's churn is the common case — the watch is on a whole directory,
	/// and a repository root has plenty of it.
	#[test]
	fn ignores_a_sibling() {
		let dir = tempfile::tempdir().unwrap();
		let file = dir.path().join("notes.md");
		std::fs::write(&file, "before\n").unwrap();

		let fw = FileWatch::new();
		let rx = watch_into_channel(&fw, &file);

		std::fs::write(dir.path().join("other.md"), "not the open file\n").unwrap();

		assert!(
			rx.recv_timeout(Duration::from_millis(1200)).is_err(),
			"a sibling's write must not refresh the viewer"
		);
	}

	#[test]
	fn watching_a_second_file_releases_the_first() {
		let dir = tempfile::tempdir().unwrap();
		let first = dir.path().join("first.md");
		let second = dir.path().join("second.md");
		std::fs::write(&first, "one\n").unwrap();
		std::fs::write(&second, "two\n").unwrap();

		let fw = FileWatch::new();
		let first_rx = watch_into_channel(&fw, &first);
		let second_rx = watch_into_channel(&fw, &second);
		assert_eq!(fw.watched().as_deref(), Some(second.as_path()));

		std::fs::write(&first, "one, edited\n").unwrap();
		std::fs::write(&second, "two, edited\n").unwrap();

		second_rx.recv_timeout(WAIT).expect("the file now open should notify");
		assert!(
			first_rx.recv_timeout(Duration::from_millis(200)).is_err(),
			"the previous file's watch should have been dropped"
		);
	}

	#[test]
	fn unwatch_is_scoped_to_its_path() {
		let dir = tempfile::tempdir().unwrap();
		let open = dir.path().join("open.md");
		std::fs::write(&open, "open\n").unwrap();

		let fw = FileWatch::new();
		let rx = watch_into_channel(&fw, &open);

		// A stale cleanup for a file the viewer has already moved off must not
		// take the live watch with it.
		assert!(!fw.unwatch(&dir.path().join("closed.md")));
		assert_eq!(fw.watched().as_deref(), Some(open.as_path()));

		assert!(fw.unwatch(&open));
		assert_eq!(fw.watched(), None);
		assert!(!fw.unwatch(&open), "unwatching twice stops nothing the second time");

		std::fs::write(&open, "edited after close\n").unwrap();
		assert!(
			rx.recv_timeout(Duration::from_millis(1200)).is_err(),
			"a released watch must not keep notifying"
		);
	}

	#[test]
	fn refuses_a_path_with_no_directory() {
		let fw = FileWatch::new();
		let err = fw.watch(Path::new("notes.md"), || {}).unwrap_err();
		assert!(matches!(err, AppError::InvalidInput(_)), "got {err:?}");
	}
}
