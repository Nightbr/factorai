//! Show one path in the desktop's own file manager, with the file selected.
//!
//! The viewer already hands a file to whatever application owns its type
//! ("Open in default app", `plugin-shell`'s `open`). This answers the other
//! question a reader has about a path — *where does it live* — and the answer
//! is only useful if the file itself is highlighted: opening the containing
//! folder and leaving the reader to find the row again in a directory of two
//! hundred is most of the work still to do. See specs/05-features.md F7.
//!
//! **This is ours rather than `tauri-plugin-opener`'s** (ADR-0033). Two things
//! made the plugin the wrong shape here: a child it spawns inherits our
//! environment, which under an AppImage is the documented way to break another
//! GTK binary (see [`super::child_env`]), and its reveal has no route by which
//! this app's `PATH` fix reaches it.
//!
//! **Selection is not a portable idea, so each platform gets its own call.**
//!
//! - macOS: `open -R`, which is Finder's own reveal.
//! - Linux: `org.freedesktop.FileManager1.ShowItems` over the session bus —
//!   the freedesktop interface Nautilus, Dolphin, Nemo, Thunar and PCManFM all
//!   implement, and the only one of the three that selects the file. It is
//!   spoken through `dbus-send` rather than a D-Bus crate: one method call with
//!   no reply to read is not worth a dependency, and `dbus-send` is part of the
//!   same package as the bus this app is already talking to through GTK.
//!
//! The Linux fallback is `xdg-open` on the **parent directory**, for a desktop
//! whose file manager does not implement `FileManager1`. That loses the
//! selection, which is why it is the fallback and not the implementation.

use std::path::Path;
use std::process::{Command, Stdio};

use crate::error::{AppError, AppResult};

/// Reveal `path` — the containing folder, with `path` selected in it.
///
/// `path` must be absolute and must exist. Both are checked here rather than
/// left to the platform: a file manager handed a path that has gone opens the
/// user's home directory on some desktops and nothing at all on others, and
/// "nothing happened" is the one outcome a reader cannot tell from a bug in
/// this app.
pub fn reveal(path: &str) -> AppResult<()> {
	let path = Path::new(path);
	if !path.is_absolute() {
		return Err(AppError::InvalidInput(format!(
			"reveal needs an absolute path, got {}",
			path.display()
		)));
	}
	// `symlink_metadata`, so revealing a symlink reveals the link itself. That
	// is the row the reader clicked, and the tree already flags a link whose
	// target leaves the project rather than following it.
	if path.symlink_metadata().is_err() {
		return Err(AppError::NotFound(path.display().to_string()));
	}
	platform_reveal(path)
}

#[cfg(target_os = "macos")]
fn platform_reveal(path: &Path) -> AppResult<()> {
	// `-R` is reveal: Finder comes forward with the enclosing folder open and
	// the item selected. `open` exits as soon as Finder has been told.
	run(Command::new("open").arg("-R").arg(path))
}

#[cfg(not(target_os = "macos"))]
fn platform_reveal(path: &Path) -> AppResult<()> {
	// `--print-reply` is load-bearing and not for its output, which is thrown
	// away. Without it the call goes out with no reply expected, the bus
	// answers a missing `FileManager1` to nobody, and `dbus-send` exits 0 —
	// so the fallback below would never run on the desktops that need it.
	// `--reply-timeout` bounds the wait, because the name is bus-activatable
	// and a cold file manager is a process start.
	let mut dbus = Command::new("dbus-send");
	dbus.arg("--session")
		.arg("--print-reply")
		.arg("--reply-timeout=3000")
		.arg("--dest=org.freedesktop.FileManager1")
		.arg("--type=method_call")
		.arg("/org/freedesktop/FileManager1")
		.arg("org.freedesktop.FileManager1.ShowItems")
		.arg(format!("array:string:{}", file_uri(path)))
		// The startup id, which we have none of. Empty is what the interface
		// says to send then.
		.arg("string:");
	if run(&mut dbus).is_ok() {
		return Ok(());
	}

	// No `FileManager1` on this desktop, or no `dbus-send` to ask it with. The
	// folder without the selection is worth more than an error.
	let folder = path.parent().unwrap_or(path);
	run(Command::new("xdg-open").arg(folder))
}

/// Run `cmd` to completion with the environment a child of this process should
/// get, and turn anything but success into a `Process` error.
///
/// **The environment is the reason this is not two lines inline.** Every
/// command here ends up starting a GTK application — `xdg-open` by exec'ing
/// one, `dbus-send` by activating one on the bus — and handing that our own
/// environment is [`super::child_env`]'s whole subject: under an AppImage,
/// `LD_LIBRARY_PATH` points at a squashfs mount holding *our* WebKitGTK, and a
/// file manager that loads it cannot find its own helper processes.
///
/// Waited on rather than detached, because the exit status is what chooses the
/// fallback above. All three of these return as soon as they have handed the
/// path over, so there is nothing here that a reader waits on.
fn run(cmd: &mut Command) -> AppResult<()> {
	// Output is diagnostics for a call whose result is an exit code — a reply
	// blob from `dbus-send`, an `xdg-open` usage line — and inheriting stdio
	// would put it in whatever terminal happened to launch the app.
	cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
	super::child_env::changes_for_current_env().apply_to_command(cmd);

	let program = cmd.get_program().to_string_lossy().into_owned();
	let status =
		cmd.status().map_err(|e| AppError::Process(format!("could not run {program}: {e}")))?;
	if status.success() {
		return Ok(());
	}
	Err(AppError::Process(format!("{program} failed: {status}")))
}

/// A `file://` URI for an absolute path, percent-encoded per RFC 3986.
///
/// Encoded from the path's **bytes**, not from a `String`: a Unix path is not
/// required to be UTF-8, and a lossy conversion would produce a URI naming a
/// different file (or no file) rather than failing.
///
/// Everything outside RFC 3986's unreserved set is escaped, `/` excepted since
/// it is the path separator we are building with. That is wider than strictly
/// necessary — `dbus-send` would pass a literal `@` through — but a URI with
/// nothing left to interpret cannot be reinterpreted, and the receiver is a
/// file manager we did not write.
#[cfg(not(target_os = "macos"))]
fn file_uri(path: &Path) -> String {
	use std::fmt::Write;
	use std::os::unix::ffi::OsStrExt;

	let mut out = String::from("file://");
	for &byte in path.as_os_str().as_bytes() {
		match byte {
			b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
				out.push(byte as char);
			}
			// Infallible into a String; the result is discarded rather than
			// unwrapped so this stays free of `unwrap` (§ "Code style").
			_ => {
				let _ = write!(out, "%{byte:02X}");
			}
		}
	}
	out
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn reveal_refuses_a_relative_path() {
		// The renderer only ever holds absolute paths, and a relative one here
		// would be resolved against *our* cwd, which is not the project's.
		let err = reveal("src/lib.rs").unwrap_err();
		assert!(matches!(err, AppError::InvalidInput(_)), "got {err:?}");
	}

	#[test]
	fn reveal_of_a_missing_path_is_not_found() {
		let dir = tempfile::tempdir().unwrap();
		let gone = dir.path().join("never-existed.txt");
		let err = reveal(&gone.to_string_lossy()).unwrap_err();
		assert!(matches!(err, AppError::NotFound(_)), "got {err:?}");
	}

	#[cfg(not(target_os = "macos"))]
	#[test]
	fn file_uri_keeps_an_ordinary_path_readable() {
		assert_eq!(file_uri(Path::new("/home/x/notes.md")), "file:///home/x/notes.md");
	}

	#[cfg(not(target_os = "macos"))]
	#[test]
	fn file_uri_escapes_what_a_shell_or_a_uri_would_read() {
		// A space, a `#` (which would truncate the URI at a fragment), and a
		// `%` (which would make the rest of the path look pre-encoded).
		assert_eq!(file_uri(Path::new("/tmp/a b/c#d%e.txt")), "file:///tmp/a%20b/c%23d%25e.txt");
	}

	#[cfg(not(target_os = "macos"))]
	#[test]
	fn file_uri_escapes_non_utf8_bytes_rather_than_losing_them() {
		use std::ffi::OsStr;
		use std::os::unix::ffi::OsStrExt;

		// `0xFF` is not valid UTF-8 and is a legal byte in a Unix filename. A
		// lossy conversion would replace it with U+FFFD and name another file.
		let path = std::path::PathBuf::from(OsStr::from_bytes(b"/tmp/\xff.txt"));
		assert_eq!(file_uri(&path), "file:///tmp/%FF.txt");
	}
}
