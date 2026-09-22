//! Surviving a web process that dies under us (F7,
//! [ADR-0059](../../../../specs/adr/0059-a-dead-web-process-is-reloaded-not-left-on-screen.md)).
//!
//! **The renderer runs in a process of its own and it can be killed without
//! killing ours.** When that happens the window is still there, still on top,
//! still accepting clicks — and completely dead, which is indistinguishable
//! from a hang. Every PTY, every IDE bridge and every row in the database is
//! untouched; the only thing that has gone is the view.
//!
//! The crash this was written for is a missing GStreamer element
//! ([ADR-0058](../../../../specs/adr/0058-the-appimage-carries-its-own-gstreamer-plugins.md)):
//! WebKit connects a signal to a `NULL` factory and the whole process goes. It
//! is not the only one — an out-of-memory renderer ends the same way — and a
//! recovery that only understood media would be the wrong shape.
//!
//! **So the view is reloaded, and the reader is told.** A reload costs the
//! renderer's own state, which is the open file, the scroll position and which
//! tab was in front. It does not cost a session: the PTYs are ours and
//! `terminal_list` is what the renderer asks on boot to find them again.
//!
//! **Rate-limited, because a page that crashes *while loading* would otherwise
//! be an infinite boot loop** — and a dead window a human can close beats a
//! window that flickers forever. Past the limit the crash is recorded and the
//! view is left as it is.
//!
//! Linux only. WebKitGTK offers `web-process-terminated`; `WKWebView`'s
//! equivalent is a delegate method wry does not surface, so on macOS this
//! records nothing and reloads nothing.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How many reloads we will attempt inside [`WINDOW`] before giving up.
///
/// Three, because the failures worth recovering from are one-shot — a file that
/// killed the decoder is not reopened by a reloaded renderer, since the viewer's
/// state died with it. A fourth crash in a minute is a page that cannot load,
/// and reloading it again only makes the window harder to close.
const MAX_RELOADS: usize = 3;

/// The window the limit is counted over.
const WINDOW: Duration = Duration::from_secs(60);

/// What the renderer is told the first time it asks after a crash.
///
/// Deliberately says what survived. The reader is looking at an app that threw
/// its own state away, and the question that matters to them is whether the
/// agents did too.
const NOTICE: &str = "The window's renderer crashed and was reloaded. \
	Your sessions kept running — the terminals and anything Claude was doing are untouched. \
	What was lost is the view: the file the viewer had open, and where you were scrolled.";

/// What the view has done to us lately.
///
/// One per app. Lives in `AppState` because the *command* that drains the notice
/// needs it and the *signal handler* that fills it does too, and those two have
/// nothing else in common.
#[derive(Default)]
pub struct Health {
	/// Waiting to be handed to the renderer, which asks once on boot. `None`
	/// once taken — this is a notice, not a status.
	pending: Mutex<Option<String>>,
	/// When we last reloaded, newest last, trimmed to [`WINDOW`].
	reloads: Mutex<Vec<Instant>>,
	/// Every crash this run, including the ones past the limit. Never reset, so
	/// a log line can say "the third time" honestly.
	crashes: AtomicU32,
}

impl Health {
	/// Record a crash and answer whether this one earns a reload.
	///
	/// Both halves together, because deciding and recording are the same
	/// decision: a crash we refuse to reload for still has to leave a notice, or
	/// the window goes quiet with nothing said about why.
	pub fn on_crash(&self) -> bool {
		self.crashes.fetch_add(1, Ordering::Relaxed);
		*self.pending.lock().expect("webview notice") = Some(NOTICE.to_string());

		let now = Instant::now();
		let mut reloads = self.reloads.lock().expect("webview reloads");
		reloads.retain(|at| now.duration_since(*at) < WINDOW);
		if reloads.len() >= MAX_RELOADS {
			return false;
		}
		reloads.push(now);
		true
	}

	/// The notice, once. Answers `None` on every call but the first after a
	/// crash, which is what makes it safe for the renderer to ask on every boot.
	pub fn take_notice(&self) -> Option<String> {
		self.pending.lock().expect("webview notice").take()
	}

	/// How many times the view has died this run.
	pub fn crash_count(&self) -> u32 {
		self.crashes.load(Ordering::Relaxed)
	}
}

/// Watch the main window's web process and reload it when it dies.
///
/// Called from `setup()`. `with_webview` dispatches to the thread that owns the
/// widget, so the handler it installs is already on the GTK main thread when it
/// fires and can reload in place.
#[cfg(target_os = "linux")]
pub fn install<R: tauri::Runtime>(
	window: &tauri::WebviewWindow<R>,
	health: std::sync::Arc<Health>,
) {
	use tracing::{error, warn};
	use webkit2gtk::WebViewExt;

	let result = window.with_webview(move |webview| {
		let view = webview.inner();
		view.connect_web_process_terminated(move |view, reason| {
			let count = health.crash_count() + 1;
			if health.on_crash() {
				warn!(?reason, count, "the web process died — reloading the view");
				view.reload();
			} else {
				// Past the limit. Saying so is the point: the window is about to
				// stay blank, and the log is the only place that can explain it.
				error!(
					?reason,
					count,
					"the web process died again too soon — leaving the window as it is \
					 rather than looping on a page that cannot load"
				);
			}
		});
	});

	if let Err(e) = result {
		// Not fatal, and deliberately not a panic: an app that boots without the
		// safety net is worth more than one that refuses to boot without it.
		tracing::warn!(error = %e, "could not watch the web process for crashes");
	}
}

/// macOS has no signal for this that wry exposes, so nothing is watched.
///
/// The `Health` still exists and the command still answers — it simply never
/// has anything to report, which is the honest answer rather than a second
/// shape for the renderer to handle.
#[cfg(not(target_os = "linux"))]
pub fn install<R: tauri::Runtime>(
	_window: &tauri::WebviewWindow<R>,
	_health: std::sync::Arc<Health>,
) {
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_first_crashes_reload_and_the_next_does_not() {
		let health = Health::default();
		for _ in 0..MAX_RELOADS {
			assert!(health.on_crash(), "a crash inside the limit reloads");
		}
		assert!(!health.on_crash(), "past the limit we stop reloading");
		assert_eq!(health.crash_count(), MAX_RELOADS as u32 + 1);
	}

	#[test]
	fn the_notice_is_handed_over_once() {
		let health = Health::default();
		assert_eq!(health.take_notice(), None, "nothing to say before a crash");

		health.on_crash();
		assert!(health.take_notice().is_some());
		assert_eq!(health.take_notice(), None, "a notice is not a status");
	}

	#[test]
	fn a_crash_past_the_limit_still_leaves_a_notice() {
		// The window is about to stay blank, so this is the one case where the
		// reader most needs the sentence — losing it with the reload would be
		// exactly backwards.
		let health = Health::default();
		for _ in 0..MAX_RELOADS {
			health.on_crash();
		}
		let _ = health.take_notice();

		assert!(!health.on_crash());
		assert!(health.take_notice().is_some());
	}
}
