//! The environment a spawned session should inherit.
//!
//! A session inherits ours, because `HOME`, `USER`, `SHELL`, `SSH_AUTH_SOCK`,
//! `LANG`, the proxy variables and the rest are exactly what a shell in a
//! project needs, and a minimal environment built by hand is a long tail of
//! bugs — git over SSH stops working, output stops being UTF-8, a corporate CA
//! bundle goes missing. So this is a **diff against what we have**, never a
//! replacement for it.
//!
//! Three things are wrong with "what we have". The first two come from being a
//! GUI application rather than something started from a terminal; the third
//! comes from who started *us*.
//!
//! **`PATH` is not the user's.** No rc file has ever run in this process, so
//! Homebrew and every version-manager shim are missing from it, and a session
//! given that `PATH` cannot run a hook, a stdio MCP server or a statusline
//! command. [`super::shell_path`] resolves the real one by asking the login
//! shell once at startup; [`EnvChanges::with_path`] is where it is put back.
//!
//! **The AppImage runtime is in front of everything else.** When factorai is
//! running as an AppImage, "ours" is the user's environment with the AppImage's
//! private runtime prepended. Handing that to a child means every `claude`
//! session, and everything it ever runs, resolves libraries and data files out
//! of a squashfs mount that belongs to a different program.
//!
//! Two failures seen on a real machine, neither of which looks like an env
//! problem from the inside:
//!
//! - `PYTHONHOME=$APPDIR/usr/` makes any `python3` die with
//!   `ModuleNotFoundError: No module named 'encodings'` before it runs a line.
//! - `LD_LIBRARY_PATH=$APPDIR/usr/lib/:…` makes another GTK/WebKit binary load
//!   *our* bundled WebKitGTK, which then can't find its own helper processes.
//!
//! **The rule is one sentence: drop the entries that live inside an AppImage
//! runtime mount.** `linuxdeploy`'s `AppRun` builds every one of these as
//! `$APPDIR/…:$ORIGINAL`, so removing those entries leaves precisely what the
//! user had — and for the handful it invents outright (`PYTHONHOME`,
//! `GTK_EXE_PREFIX`, `GIO_EXTRA_MODULES`, …) nothing remains, which is right,
//! since those are unset on a normal desktop.
//!
//! No list of variable names is hardcoded on purpose. AppRun's set has grown
//! before and will again, and a name-based list would silently stop covering
//! the new ones. Matching on the path is what makes this exhaustive.
//!
//! **"An AppImage runtime mount" is deliberately wider than `$APPDIR`** —
//! widened 2026-08-20, and the narrow version was a real bug rather than a
//! theoretical gap. `$APPDIR` is the mount *this process* is running from, so
//! matching only it strips only the newest layer of a nested launch. Found on
//! the machine this app is developed on: an agent session spawned by a release
//! build had `APPDIR` correctly unset and that build's own mount correctly gone
//! from every path — and still carried **two older mounts** in
//! `LD_LIBRARY_PATH`, `PATH`, `XDG_DATA_DIRS`, `PYTHONPATH`, `PERLLIB`,
//! `QT_PLUGIN_PATH` and the `GST_*` pair, because the app had itself been
//! launched from inside an older copy of itself and inherited them. So
//! `pnpm dev` in that session still died on `WebKitNetworkProcess`, from a
//! build that already had this module in it.
//!
//! Hence the second half of the match: an entry is also ours to drop if any of
//! its path components is a `.mount_*` directory, which is what the AppImage
//! runtime names its squashfuse mountpoint. That is a **shape**, not a name
//! list, and it holds for a mount we were never told about — including one
//! belonging to a different program, since a path we inherited from another
//! AppImage's runtime poisons a child exactly as ours does. Its price is a
//! `.mount_*` component in a genuine user path, which costs that one search
//! entry; set against a session that cannot run `python3`, that is the right
//! way round.
//!
//! Outside an AppImage — a dev build, a `.deb`, a `.app` — `APPDIR` is unset,
//! and the rule then does nothing *unless* something we inherited points into a
//! mount. A dev build launched from an agent shell inside the release app is
//! exactly that case, and it is how this app is built every day.
//!
//! **One variable is dropped by name regardless**, because it is not about
//! AppImages and applies on every platform: `CLAUDE_CODE_CHILD_SESSION`, which
//! describes our process rather than the child's and turns transcript saving
//! off in any `claude` that inherits it. See [`AGENT_MARKERS`].

use std::ffi::{OsStr, OsString};
#[cfg(unix)]
use std::path::{Path, PathBuf};

use portable_pty::CommandBuilder;

#[cfg(unix)]
use super::shell_path;

/// Set by the AppImage runtime and meaningless once the paths they describe
/// are gone. Leaving `APPIMAGE` behind while `APPDIR` is dropped would be
/// worse than either: a tool that checks one and uses the other would follow
/// it straight into a directory we just removed from every search path.
#[cfg(unix)]
const APPIMAGE_MARKERS: &[&str] = &["APPDIR", "APPIMAGE", "ARGV0", "OWD"];

/// What the AppImage runtime calls its squashfuse mountpoint, under `$TMPDIR`.
/// See [`is_runtime_mount_entry`] for why a path component and not a full path.
#[cfg(unix)]
const RUNTIME_MOUNT_PREFIX: &[u8] = b".mount_";

/// How Claude Code marks a process it spawned itself, and describes *us* rather
/// than the child.
///
/// A `claude` that inherits it starts with **transcript saving off** and says so
/// in its banner: `Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION
/// marker`. That is not cosmetic. No transcript means no row for the indexer,
/// nothing to search, and `session_flag`'s probe (ADR-0008) sees no file — so the
/// next launch of the same id picks `--session-id` on an id Claude already knows
/// and fails with "already in use". The symptom lands one step from the cause,
/// like every other bug this module exists for.
///
/// Reachable whenever factorai is itself started from inside a Claude session,
/// which is exactly how it gets developed. Found 2026-08-18 while probing the CLI
/// for F10's title sequences.
const AGENT_MARKERS: &[&str] = &["CLAUDE_CODE_CHILD_SESSION"];

/// What has to change about the inherited environment — as a **diff**, not as a
/// finished environment.
///
/// The diff shape is the whole point, and it is load-bearing.
/// `CommandBuilder::new()` seeds itself from `std::env::vars_os()`, so a child
/// starts with everything we have and `env()` only ever *overrides* a key.
/// Handing it a clean list and setting each entry therefore changes nothing
/// about the variables that matter, because the ones we want gone are exactly
/// the ones such a list omits — and an omitted key keeps its inherited value.
///
/// v0.5.0 shipped precisely that bug: the rule below was right, fully
/// unit-tested, and applied nothing at all. Removals have to be spoken aloud,
/// so they are their own field and [`EnvChanges::apply_to`] is the only way to
/// use this type.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct EnvChanges {
	/// Unset on the child.
	pub remove: Vec<OsString>,
	/// Overwrite on the child.
	pub set: Vec<(OsString, OsString)>,
}

impl EnvChanges {
	pub fn apply_to(self, cmd: &mut CommandBuilder) {
		for key in self.remove {
			cmd.env_remove(key);
		}
		for (key, value) in self.set {
			cmd.env(key, value);
		}
	}

	/// Pin `PATH` to `path` — the login shell's, not ours. See
	/// [`super::shell_path`] for why ours is the wrong answer in a GUI process.
	///
	/// This has the last word on the key, so it first takes `PATH` out of
	/// whatever the `$APPDIR` rule decided about it: leaving a stale `remove`
	/// behind would have `apply_to` unset the variable we are here to set.
	///
	/// The value still goes through the strip, because it was produced by a
	/// shell that inherited *our* `PATH`, and both zsh and bash extend the one
	/// they are given rather than build a fresh one — so under an AppImage the
	/// answer comes back with `$APPDIR/usr/bin` still on the front of it.
	#[cfg(unix)]
	pub fn with_path(mut self, path: &OsStr, appdir: Option<&Path>) -> Self {
		let key = OsStr::new("PATH");
		self.remove.retain(|k| k != key);
		self.set.retain(|(k, _)| k != key);
		// Unconditional, with no `$APPDIR` arm: a value with nothing to strip
		// comes back byte for byte, and the mount a nested launch left behind is
		// only visible to the shape half of the rule anyway. `None` means the
		// strip left nothing — a `PATH` made entirely of AppImage directories,
		// which is not a `PATH` at all.
		let value = strip_appimage_entries(path, usable_appdir(appdir))
			.unwrap_or_else(|| OsString::from(shell_path::FALLBACK_PATH));
		self.set.push((key.to_os_string(), value));
		self
	}
}

/// The changes for this process's environment.
///
/// On Unix this also strips AppImage runtime directories and pins `PATH` to
/// the login shell's answer. On Windows only the cross-platform
/// [`AGENT_MARKERS`] are removed — AppImages do not exist there.
#[cfg(unix)]
pub fn changes_for_current_env() -> EnvChanges {
	let appdir = std::env::var_os("APPDIR").map(PathBuf::from);
	changes(std::env::vars_os(), appdir.as_deref())
		.with_path(shell_path::child_path(), appdir.as_deref())
}

/// Windows stub: only the cross-platform agent-marker removal applies.
#[cfg(windows)]
pub fn changes_for_current_env() -> EnvChanges {
	changes_markers_only(std::env::vars_os())
}

/// Windows-only: remove [`AGENT_MARKERS`] from `vars` and nothing else.
#[cfg(windows)]
fn changes_markers_only<I>(vars: I) -> EnvChanges
where
	I: IntoIterator<Item = (OsString, OsString)>,
{
	let mut out = EnvChanges::default();
	for (key, _) in vars {
		if AGENT_MARKERS.iter().any(|m| key == OsStr::new(m)) {
			out.remove.push(key);
		}
	}
	out
}

/// The testable half of [`changes_for_current_env`] (Unix only). `appdir` is
/// `$APPDIR` — `None` when not running from an AppImage, which disables the
/// path-based rule but not the by-name [`AGENT_MARKERS`] one.
#[cfg(unix)]
pub fn changes<I>(vars: I, appdir: Option<&Path>) -> EnvChanges
where
	I: IntoIterator<Item = (OsString, OsString)>,
{
	use std::os::unix::ffi::OsStrExt;

	// Deliberately *not* an early return when there is no `$APPDIR`: the agent
	// markers below have nothing to do with AppImages and have to go on every
	// platform and every build.
	let appdir = usable_appdir(appdir);

	// Collected because the pass below needs an answer that can come from a
	// variable it has not reached yet: whether *any* AppImage runtime is in
	// play. `APPDIR` being unset no longer settles that — an inherited mount
	// counts, and it is what a nested launch leaves behind.
	let vars: Vec<(OsString, OsString)> = vars.into_iter().collect();
	let appimage = appdir.is_some()
		|| vars
			.iter()
			.any(|(_, value)| value.as_bytes().split(|b| *b == b':').any(is_runtime_mount_entry));

	let mut out = EnvChanges::default();
	for (key, value) in vars {
		if AGENT_MARKERS.iter().any(|m| key == OsStr::new(m)) {
			out.remove.push(key);
			continue;
		}
		if !appimage {
			continue;
		}
		if APPIMAGE_MARKERS.iter().any(|m| key == OsStr::new(m)) {
			out.remove.push(key);
			continue;
		}
		match strip_appimage_entries(&value, appdir) {
			None => out.remove.push(key),
			Some(stripped) if stripped != value => out.set.push((key, stripped)),
			// Untouched by the rule, so there is nothing to say about it.
			Some(_) => {}
		}
	}
	out
}

/// `$APPDIR` if it is one we are willing to match against.
///
/// A blank or root `$APPDIR` would make "inside $APPDIR" true of the whole
/// filesystem and strip the environment to nothing. It should never happen;
/// treating it as "not an AppImage" means it can't be a catastrophe if it does.
#[cfg(unix)]
fn usable_appdir(appdir: Option<&Path>) -> Option<&Path> {
	use std::os::unix::ffi::OsStrExt;
	appdir.filter(|d| {
		let bytes = d.as_os_str().as_bytes();
		!bytes.is_empty() && bytes != b"/"
	})
}

/// The value with its AppImage entries removed, or `None` if that leaves
/// nothing — an empty `LD_LIBRARY_PATH` means "look in the current directory",
/// so it has to be unset rather than blanked.
///
/// A value with no AppImage entry is returned **byte for byte**. That matters:
/// most of the environment is not a path list, and splitting on `:` and
/// rejoining would quietly rewrite anything that happens to contain one —
/// `LS_COLORS`, a connection string, a `GTK_THEME=Adwaita:dark`. Only values we
/// have actually found something to remove from get rebuilt.
#[cfg(unix)]
fn strip_appimage_entries(value: &OsStr, appdir: Option<&Path>) -> Option<OsString> {
	use std::os::unix::ffi::{OsStrExt, OsStringExt};
	let prefix = appdir.map(|d| d.as_os_str().as_bytes());
	let ours = |entry: &&[u8]| is_appimage_entry(entry, prefix);
	let bytes = value.as_bytes();
	if !bytes.split(|b| *b == b':').any(|e| ours(&e)) {
		return Some(value.to_os_string());
	}

	let kept: Vec<&[u8]> = bytes
		.split(|b| *b == b':')
		// Empty entries go too, and only here — they are the tail of AppRun's
		// `$APPDIR/…:$ORIGINAL` when the user had no original, and an empty
		// entry in a search path means the current directory.
		.filter(|e| !e.is_empty() && !ours(e))
		.collect();
	if kept.is_empty() {
		return None;
	}
	Some(OsString::from_vec(kept.join(&b':')))
}

/// Whether one path-list entry belongs to an AppImage runtime: ours by
/// `$APPDIR`, or anyone's by the shape of its path.
///
/// Both halves are needed. `$APPDIR` is authoritative and covers a mountpoint
/// that is not named like one — `--appimage-extract-and-run` sets it to a
/// `squashfs-root` directory. The shape covers the mounts `$APPDIR` cannot know
/// about, which is every layer of a nested launch but the newest.
#[cfg(unix)]
fn is_appimage_entry(entry: &[u8], appdir: Option<&[u8]>) -> bool {
	if let Some(prefix) = appdir {
		if is_inside(entry, prefix) {
			return true;
		}
	}
	is_runtime_mount_entry(entry)
}

/// Whether a path runs through a directory the AppImage runtime mounted.
///
/// The runtime names its squashfuse mountpoint `$TMPDIR/.mount_<prefix><rand>`,
/// so a `.mount_*` path component is the tell. Matched on the component rather
/// than on `/tmp/.mount_`, because `TMPDIR` is the user's to set.
#[cfg(unix)]
fn is_runtime_mount_entry(entry: &[u8]) -> bool {
	entry.split(|b| *b == b'/').any(|c| c.starts_with(RUNTIME_MOUNT_PREFIX))
}

/// Whether one path-list entry lies at or under `prefix`.
///
/// The boundary check is what stops `$APPDIR` of `/tmp/.mount_ab` from also
/// claiming `/tmp/.mount_abcdef`. Since 2026-08-20 the shape rule strips a
/// sibling mount anyway, so this no longer decides that entry's fate — it
/// decides *which* rule takes it, and keeps `$APPDIR` from over-reaching on a
/// mountpoint that is not named like one at all.
#[cfg(unix)]
fn is_inside(entry: &[u8], prefix: &[u8]) -> bool {
	entry.starts_with(prefix) && matches!(entry.get(prefix.len()), None | Some(b'/'))
}

#[cfg(all(test, unix))]
mod tests {
	use super::*;

	const APPDIR: &str = "/tmp/.mount_Factorfa";

	fn env(pairs: &[(&str, &str)]) -> Vec<(OsString, OsString)> {
		pairs.iter().map(|(k, v)| (OsString::from(k), OsString::from(v))).collect()
	}
	#[test]
	#[cfg(windows)]
	fn test_changes_markers_only_windows() {
		let vars = vec![
			(OsString::from("CLAUDE_CODE_CHILD_SESSION"), OsString::from("123")),
			(OsString::from("PATH"), OsString::from("C:\\Windows")),
		];
		let ch = changes_markers_only(vars);
		assert_eq!(ch.remove, vec![OsString::from("CLAUDE_CODE_CHILD_SESSION")]);
		assert!(ch.set.is_empty());
	}

	#[cfg(unix)]
	mod unix_tests {
		use super::*;
		use std::path::Path;

		const APPDIR: &str = "/tmp/.mount_Factorfa";

		fn env(pairs: &[(&str, &str)]) -> Vec<(OsString, OsString)> {
			pairs.iter().map(|(k, v)| (OsString::from(k), OsString::from(v))).collect()
		}

		fn run(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
			apply(pairs, changes(env(pairs), Some(Path::new(APPDIR))))
		}

		fn run_without_appdir(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
			apply(pairs, changes(env(pairs), None))
		}

		fn apply(pairs: &[(&str, &str)], ch: EnvChanges) -> Vec<(String, String)> {
			let mut out: Vec<(String, String)> = env(pairs)
				.into_iter()
				.map(|(k, v)| (k.into_string().unwrap(), v.into_string().unwrap()))
				.collect();
			out.retain(|(k, _)| !ch.remove.iter().any(|r| r == OsStr::new(k.as_str())));
			for (k, v) in ch.set {
				let (k, v) = (k.into_string().unwrap(), v.into_string().unwrap());
				match out.iter_mut().find(|(ek, _)| *ek == k) {
					Some(slot) => slot.1 = v,
					None => out.push((k, v)),
				}
			}
			out
		}

		fn get(pairs: &[(&str, &str)], key: &str) -> Option<String> {
			run(pairs).into_iter().find(|(k, _)| k == key).map(|(_, v)| v)
		}

		#[test]
		fn outside_an_appimage_nothing_is_touched() {
			let original = env(&[("PATH", "/usr/bin"), ("PYTHONHOME", "/opt/py")]);
			assert_eq!(changes(original, None), EnvChanges::default());
		}

		#[test]
		fn the_agent_marker_goes_even_without_an_appdir() {
			let ch =
				changes(env(&[("PATH", "/usr/bin"), ("CLAUDE_CODE_CHILD_SESSION", "abc123")]), None);
			assert_eq!(ch.remove, vec![OsString::from("CLAUDE_CODE_CHILD_SESSION")]);
			assert!(ch.set.is_empty());
		}

		#[test]
		fn the_agent_marker_goes_inside_an_appimage_too() {
			assert_eq!(
				get(
					&[("CLAUDE_CODE_CHILD_SESSION", "abc123"), ("PATH", "/usr/bin")],
					"CLAUDE_CODE_CHILD_SESSION"
				),
				None
			);
		}

		#[test]
		fn removals_actually_reach_the_command_builder() {
			let mut cmd = CommandBuilder::new("/bin/true");
			cmd.env_clear();
			let inherited = [
				("APPDIR", APPDIR),
				("APPIMAGE", "/home/me/Applications/FactorAI.AppImage"),
				("PYTHONHOME", "/tmp/.mount_Factorfa/usr/"),
				("PATH", "/tmp/.mount_Factorfa/usr/bin:/usr/bin"),
				("HOME", "/home/me"),
			];
			for (k, v) in inherited {
				cmd.env(k, v);
			}

			changes(env(&inherited), Some(Path::new(APPDIR))).apply_to(&mut cmd);

			assert_eq!(cmd.get_env("APPDIR"), None);
			assert_eq!(cmd.get_env("APPIMAGE"), None);
			assert_eq!(cmd.get_env("PYTHONHOME"), None);
			assert_eq!(cmd.get_env("PATH"), Some(OsStr::new("/usr/bin")));
			assert_eq!(cmd.get_env("HOME"), Some(OsStr::new("/home/me")));
		}

		#[test]
		fn a_prepended_search_path_keeps_the_user_tail() {
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
			assert_eq!(get(&[("PYTHONHOME", "/tmp/.mount_Factorfa/usr/")], "PYTHONHOME"), None);
		}

		#[test]
		fn a_trailing_empty_entry_does_not_survive_as_the_current_directory() {
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
			for value in ["Adwaita:dark", "rs=0:di=01;34:", "postgres://u@h:5432/db"] {
				assert_eq!(get(&[("SOME_VAR", value)], "SOME_VAR"), Some(value.into()));
			}
		}

		#[test]
		fn a_mount_that_is_not_ours_goes_too_because_we_inherited_it() {
			assert_eq!(
				get(&[("PATH", "/tmp/.mount_FactorfaOther/usr/bin:/usr/bin")], "PATH"),
				Some("/usr/bin".into())
			);
		}

		#[test]
		fn appdir_does_not_claim_a_longer_name_by_prefix() {
			let appdir = b"/tmp/squashfs-root";
			assert!(is_inside(b"/tmp/squashfs-root/usr/bin", appdir));
			assert!(is_inside(appdir, appdir));
			assert!(!is_inside(b"/tmp/squashfs-root-other/usr/bin", appdir));
		}

		#[test]
		fn mounts_from_an_earlier_launch_go_even_though_appdir_names_only_one() {
			let value = concat!(
				"/tmp/.mount_Factorfa/usr/lib:",
				"/tmp/.mount_FactorBigjgf/usr/lib:",
				"/tmp/.mount_FactoreiCOda/usr/lib:",
				"/usr/lib/x86_64-linux-gnu"
			);
			assert_eq!(
				get(&[("LD_LIBRARY_PATH", value)], "LD_LIBRARY_PATH"),
				Some("/usr/lib/x86_64-linux-gnu".into())
			);
		}

		#[test]
		fn an_inherited_mount_is_stripped_with_no_appdir_at_all() {
			let inherited = [
				("LD_LIBRARY_PATH", "/tmp/.mount_Factorfa/usr/lib:/usr/lib"),
				("PYTHONHOME", "/tmp/.mount_Factorfa/usr/"),
				("HOME", "/home/me"),
			];
			let ch = changes(env(&inherited), None);
			assert!(ch.remove.iter().any(|k| k == OsStr::new("PYTHONHOME")));
			assert_eq!(ch.set, vec![(OsString::from("LD_LIBRARY_PATH"), OsString::from("/usr/lib"))]);
		}

		#[test]
		fn a_machine_with_no_appimage_in_sight_is_still_untouched() {
			let ch = changes(
				env(&[("PATH", "/usr/bin"), ("LD_LIBRARY_PATH", "/usr/lib"), ("OWD", "/home/me")]),
				None,
			);
			assert_eq!(ch, EnvChanges::default());
		}

		#[test]
		fn stale_markers_go_even_when_we_are_not_the_appimage() {
			let out = run_without_appdir(&[
				("APPDIR", "/tmp/.mount_Factorfa"),
				("APPIMAGE", "/home/me/Applications/FactorAI.AppImage"),
				("OWD", "/home/me"),
				("HOME", "/home/me"),
			]);
			assert_eq!(out, vec![("HOME".to_string(), "/home/me".to_string())]);
		}

		#[test]
		fn the_login_shell_path_wins_over_the_one_we_inherited() {
			let mut cmd = CommandBuilder::new("/bin/true");
			cmd.env_clear();
			cmd.env("PATH", "/usr/bin:/usr/sbin");
			cmd.env("HOME", "/home/me");

			changes(env(&[]), None)
				.with_path(OsStr::new("/opt/homebrew/bin:/usr/bin:/bin"), None)
				.apply_to(&mut cmd);

			assert_eq!(cmd.get_env("PATH"), Some(OsStr::new("/opt/homebrew/bin:/usr/bin:/bin")));
			assert_eq!(cmd.get_env("HOME"), Some(OsStr::new("/home/me")));
		}

		#[test]
		fn a_login_shell_path_under_an_appimage_is_stripped_and_not_then_unset() {
			let inherited = [("APPDIR", APPDIR), ("PATH", "/tmp/.mount_Factorfa/usr/bin")];
			let mut cmd = CommandBuilder::new("/bin/true");
			cmd.env_clear();
			for (k, v) in inherited {
				cmd.env(k, v);
			}

			let plain = changes(env(&inherited), Some(Path::new(APPDIR)));
			assert!(plain.remove.iter().any(|k| k == OsStr::new("PATH")));

			plain
				.with_path(
					OsStr::new("/tmp/.mount_Factorfa/usr/bin:/home/me/.local/bin:/usr/bin"),
					Some(Path::new(APPDIR)),
				)
				.apply_to(&mut cmd);

			assert_eq!(cmd.get_env("PATH"), Some(OsStr::new("/home/me/.local/bin:/usr/bin")));
		}

		#[test]
		fn a_path_that_is_nothing_but_the_appimage_falls_back_to_the_floor() {
			let out = EnvChanges::default()
				.with_path(OsStr::new("/tmp/.mount_Factorfa/usr/bin"), Some(Path::new(APPDIR)));
			assert_eq!(
				out.set,
				vec![(OsString::from("PATH"), OsString::from(shell_path::FALLBACK_PATH))]
			);
		}

		#[test]
		fn an_appdir_of_root_is_ignored_rather_than_stripping_everything() {
			let original = env(&[("PATH", "/usr/bin"), ("HOME", "/home/me")]);
			assert_eq!(changes(original.clone(), Some(Path::new("/"))), EnvChanges::default());
			assert_eq!(changes(original, Some(Path::new(""))), EnvChanges::default());
		}
	}
}
