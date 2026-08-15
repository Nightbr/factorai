//! The environment a spawned session should inherit.
//!
//! A session inherits ours, because `PATH`, `HOME`, `SSH_AUTH_SOCK` and the
//! rest are exactly what a shell in a project needs. But when factorai is
//! running as an **AppImage**, "ours" is not the user's environment — it is the
//! user's environment with the AppImage's private runtime pushed in front of
//! it. Handing that to a child means every `claude` session, and everything it
//! ever runs, resolves libraries and data files out of a squashfs mount that
//! belongs to a different program.
//!
//! Two failures seen on a real machine, neither of which looks like an env
//! problem from the inside:
//!
//! - `PYTHONHOME=$APPDIR/usr/` makes any `python3` die with
//!   `ModuleNotFoundError: No module named 'encodings'` before it runs a line.
//! - `LD_LIBRARY_PATH=$APPDIR/usr/lib/:…` makes another GTK/WebKit binary load
//!   *our* bundled WebKitGTK, which then can't find its own helper processes.
//!
//! **The rule is one sentence: drop the entries that live inside `$APPDIR`.**
//! `linuxdeploy`'s `AppRun` builds every one of these as
//! `$APPDIR/…:$ORIGINAL`, so removing the `$APPDIR` entries leaves precisely
//! what the user had — and for the handful it invents outright (`PYTHONHOME`,
//! `GTK_EXE_PREFIX`, `GIO_EXTRA_MODULES`, …) nothing remains, which is right,
//! since those are unset on a normal desktop.
//!
//! No list of variable names is hardcoded on purpose. AppRun's set has grown
//! before and will again, and a name-based list would silently stop covering
//! the new ones. Matching on the path is what makes this exhaustive.
//!
//! Outside an AppImage — a dev build, a `.deb`, a `.app` — `APPDIR` is unset
//! and this does nothing at all.

use std::ffi::{OsStr, OsString};
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};

/// Set by the AppImage runtime and meaningless once the paths they describe
/// are gone. Leaving `APPIMAGE` behind while `APPDIR` is dropped would be
/// worse than either: a tool that checks one and uses the other would follow
/// it straight into a directory we just removed from every search path.
const APPIMAGE_MARKERS: &[&str] = &["APPDIR", "APPIMAGE", "ARGV0", "OWD"];

/// This process's environment, minus anything the AppImage runtime injected.
pub fn child_env() -> Vec<(OsString, OsString)> {
	let appdir = std::env::var_os("APPDIR").map(PathBuf::from);
	sanitize(std::env::vars_os(), appdir.as_deref())
}

/// The testable half of [`child_env`]. `appdir` is `$APPDIR` — `None` when not
/// running from an AppImage, in which case the environment passes through
/// untouched.
pub fn sanitize<I>(vars: I, appdir: Option<&Path>) -> Vec<(OsString, OsString)>
where
	I: IntoIterator<Item = (OsString, OsString)>,
{
	// A blank or root `$APPDIR` would make "inside $APPDIR" true of the whole
	// filesystem and strip the environment to nothing. It should never happen;
	// treating it as "not an AppImage" means it can't be a catastrophe if it
	// does.
	let appdir = match appdir {
		Some(d) if d.as_os_str().as_bytes() != b"/" && !d.as_os_str().is_empty() => d,
		_ => return vars.into_iter().collect(),
	};

	vars.into_iter()
		.filter(|(k, _)| !APPIMAGE_MARKERS.iter().any(|m| k == OsStr::new(m)))
		.filter_map(|(k, v)| strip_appdir_entries(&v, appdir).map(|v| (k, v)))
		.collect()
}

/// The value with its `$APPDIR` entries removed, or `None` if that leaves
/// nothing — an empty `LD_LIBRARY_PATH` means "look in the current directory",
/// so it has to be unset rather than blanked.
///
/// A value with no `$APPDIR` entry is returned **byte for byte**. That matters:
/// most of the environment is not a path list, and splitting on `:` and
/// rejoining would quietly rewrite anything that happens to contain one —
/// `LS_COLORS`, a connection string, a `GTK_THEME=Adwaita:dark`. Only values we
/// have actually found something to remove from get rebuilt.
fn strip_appdir_entries(value: &OsStr, appdir: &Path) -> Option<OsString> {
	let prefix = appdir.as_os_str().as_bytes();
	let bytes = value.as_bytes();
	if !bytes.split(|b| *b == b':').any(|e| is_inside(e, prefix)) {
		return Some(value.to_os_string());
	}

	let kept: Vec<&[u8]> = bytes
		.split(|b| *b == b':')
		// Empty entries go too, and only here — they are the tail of AppRun's
		// `$APPDIR/…:$ORIGINAL` when the user had no original, and an empty
		// entry in a search path means the current directory.
		.filter(|e| !e.is_empty() && !is_inside(e, prefix))
		.collect();
	if kept.is_empty() {
		return None;
	}
	Some(OsString::from_vec(kept.join(&b':')))
}

/// Whether one path-list entry lies at or under `prefix`.
///
/// The boundary check is what stops `$APPDIR` of `/tmp/.mount_ab` from also
/// claiming `/tmp/.mount_abcdef` — different mounts, and on a machine running
/// two AppImages at once, both are real.
fn is_inside(entry: &[u8], prefix: &[u8]) -> bool {
	entry.starts_with(prefix) && matches!(entry.get(prefix.len()), None | Some(b'/'))
}

#[cfg(test)]
mod tests {
	use super::*;

	const APPDIR: &str = "/tmp/.mount_Factorfa";

	fn env(pairs: &[(&str, &str)]) -> Vec<(OsString, OsString)> {
		pairs
			.iter()
			.map(|(k, v)| (OsString::from(k), OsString::from(v)))
			.collect()
	}

	fn run(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
		sanitize(env(pairs), Some(Path::new(APPDIR)))
			.into_iter()
			.map(|(k, v)| (k.into_string().unwrap(), v.into_string().unwrap()))
			.collect()
	}

	fn get(pairs: &[(&str, &str)], key: &str) -> Option<String> {
		run(pairs).into_iter().find(|(k, _)| k == key).map(|(_, v)| v)
	}

	#[test]
	fn outside_an_appimage_nothing_is_touched() {
		let original = env(&[("PATH", "/usr/bin"), ("PYTHONHOME", "/opt/py")]);
		assert_eq!(sanitize(original.clone(), None), original);
	}

	#[test]
	fn a_prepended_search_path_keeps_the_user_tail() {
		// AppRun writes `$APPDIR/…:$ORIGINAL`, so the original is the remainder.
		assert_eq!(
			get(
				&[("PATH", "/tmp/.mount_Factorfa/usr/bin/:/tmp/.mount_Factorfa/bin/:/home/me/.local/bin:/usr/bin")],
				"PATH"
			),
			Some("/home/me/.local/bin:/usr/bin".into())
		);
	}

	#[test]
	fn a_var_the_appimage_invented_is_unset_not_blanked() {
		// PYTHONHOME is *replaced* rather than prepended, which is why python3
		// dies outright rather than degrading. Nothing survives the strip, and
		// the variable has to disappear — `PYTHONHOME=""` is not the same as no
		// PYTHONHOME.
		assert_eq!(get(&[("PYTHONHOME", "/tmp/.mount_Factorfa/usr/")], "PYTHONHOME"), None);
	}

	#[test]
	fn a_trailing_empty_entry_does_not_survive_as_the_current_directory() {
		// `LD_LIBRARY_PATH=$APPDIR/usr/lib/:…:` — the trailing colon is where the
		// user's (empty) value was pasted in. Keeping it would leave `""`, which
		// the loader reads as ".".
		assert_eq!(
			get(
				&[("LD_LIBRARY_PATH", "/tmp/.mount_Factorfa/usr/lib/:/tmp/.mount_Factorfa/lib/:")],
				"LD_LIBRARY_PATH"
			),
			None
		);
	}

	#[test]
	fn system_entries_alongside_appdir_ones_are_kept() {
		// The GTK hook writes `$APPDIR/…` plus hardcoded system dirs. Only ours go.
		assert_eq!(
			get(
				&[(
					"GTK_PATH",
					"/tmp/.mount_Factorfa//usr/lib/x86_64-linux-gnu/gtk-3.0:/usr/lib64/gtk-3.0"
				)],
				"GTK_PATH"
			),
			Some("/usr/lib64/gtk-3.0".into())
		);
	}

	#[test]
	fn the_appimage_markers_go_with_the_paths_they_describe() {
		let out = run(&[
			("APPDIR", APPDIR),
			("APPIMAGE", "/home/me/Applications/FactorAI.AppImage"),
			("HOME", "/home/me"),
		]);
		assert_eq!(out, vec![("HOME".to_string(), "/home/me".to_string())]);
	}

	#[test]
	fn a_value_with_no_appdir_entry_is_returned_byte_for_byte() {
		// Most of the environment is not a path list. Splitting on `:` and
		// rejoining would rewrite anything that merely contains one — note the
		// empty entry here survives, because this value is never rebuilt.
		for value in ["Adwaita:dark", "rs=0:di=01;34:", "postgres://u@h:5432/db"] {
			assert_eq!(get(&[("SOME_VAR", value)], "SOME_VAR"), Some(value.into()));
		}
	}

	#[test]
	fn a_sibling_mount_with_a_longer_name_is_not_ours_to_strip() {
		// Two AppImages running at once is ordinary. `/tmp/.mount_Factorfa` must
		// not claim `/tmp/.mount_FactorfaOther`.
		assert_eq!(
			get(&[("PATH", "/tmp/.mount_FactorfaOther/usr/bin:/usr/bin")], "PATH"),
			Some("/tmp/.mount_FactorfaOther/usr/bin:/usr/bin".into())
		);
	}

	#[test]
	fn an_appdir_of_root_is_ignored_rather_than_stripping_everything() {
		let original = env(&[("PATH", "/usr/bin"), ("HOME", "/home/me")]);
		assert_eq!(sanitize(original.clone(), Some(Path::new("/"))), original);
		assert_eq!(sanitize(original.clone(), Some(Path::new(""))), original);
	}
}
