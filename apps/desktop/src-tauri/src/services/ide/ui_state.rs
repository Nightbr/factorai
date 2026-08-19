//! What the renderer currently has on screen, reported by it (F20).
//!
//! The bridge runs in Rust and cannot see the UI, but two of its answers depend
//! on what the UI is doing — and both would otherwise be guesses of exactly the
//! kind F20 refuses elsewhere:
//!
//! - **`getOpenEditors`** has to name the files the human actually has open. A
//!   hardcoded empty list is the same lie as a `getDiagnostics` that always says
//!   "no problems", in a place where returning nothing looks like a reasonable
//!   stub rather than a claim.
//! - **`openFile` on a background session** must mark its tab rather than seize
//!   the window, and only the renderer knows which session is in front.
//!
//! So the renderer pushes a snapshot whenever either changes, and the bridge
//! reads it. Small enough to hold under a lock: the write is a route change and
//! the read is one MCP call.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

/// One report from the renderer. Mirrors `@factorai/types` `UiSnapshot`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiSnapshot {
	/// The session whose tab is in front, or `None` when the human is somewhere
	/// that isn't a session at all.
	pub active_session: Option<String>,
	/// The path the viewer is showing (`?file=`), if any. At most one today;
	/// a list because the per-project tab system turns it into one, and a tool
	/// that already returns a list will not need a shape change then.
	pub open_file: Option<String>,
}

/// The snapshot, shared between the command that writes it and the bridges that
/// read it.
#[derive(Debug, Default)]
pub struct UiState(Mutex<UiSnapshot>);

impl UiState {
	pub fn set(&self, snapshot: UiSnapshot) {
		*self.0.lock() = snapshot;
	}

	pub fn get(&self) -> UiSnapshot {
		self.0.lock().clone()
	}

	/// Is this the session the human is looking at?
	///
	/// A bridge whose session is not in front answers `openFile` by marking its
	/// tab. `None` — the human is on the project list, or a settings page —
	/// counts as "not this one": nothing is in front, so nothing may take the
	/// window.
	pub fn is_active(&self, session_id: &str) -> bool {
		self.0.lock().active_session.as_deref() == Some(session_id)
	}

	/// What `getOpenEditors` answers.
	pub fn open_files(&self) -> Vec<String> {
		self.0.lock().open_file.iter().cloned().collect()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn nothing_is_active_until_the_renderer_says_so() {
		let ui = UiState::default();
		assert!(!ui.is_active("a"));
		assert!(ui.open_files().is_empty());
	}

	#[test]
	fn only_the_session_in_front_is_active() {
		let ui = UiState::default();
		ui.set(UiSnapshot { active_session: Some("a".into()), open_file: None });

		assert!(ui.is_active("a"));
		assert!(!ui.is_active("b"));
	}

	#[test]
	fn no_active_session_means_no_session_may_take_the_window() {
		// The human is on the project list. Nothing is in front, so an openFile
		// from any session marks a tab rather than opening over what they are on.
		let ui = UiState::default();
		ui.set(UiSnapshot { active_session: None, open_file: Some("/p/a.rs".into()) });

		assert!(!ui.is_active("a"));
	}

	#[test]
	fn open_files_reports_the_viewer_and_nothing_when_it_is_closed() {
		let ui = UiState::default();
		ui.set(UiSnapshot { active_session: Some("a".into()), open_file: Some("/p/a.rs".into()) });
		assert_eq!(ui.open_files(), vec!["/p/a.rs".to_string()]);

		ui.set(UiSnapshot { active_session: Some("a".into()), open_file: None });
		assert!(ui.open_files().is_empty());
	}
}
