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
//! and that rule does nothing at all.
//!
//! **One variable is dropped by name regardless**, because it is not about
//! AppImages and applies on every platform: `CLAUDE_CODE_CHILD_SESSION`, which
//! describes our process rather than the child's and turns transcript saving
//! off in any `claude` that inherits it. See [`AGENT_MARKERS`].

use std::ffi::{OsStr, OsString};
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};

use portable_pty::CommandBuilder;

use super::shell_path;

/// Set by the AppImage runtime and meaningless once the paths they describe
/// are gone. Leaving `APPIMAGE` behind while `APPDIR` is dropped would be
/// worse than either: a tool that checks one and uses the other would follow
/// it straight into a directory we just removed from every search path.
const APPIMAGE_MARKERS: &[&str] = &["APPDIR", "APPIMAGE", "ARGV0", "OWD"];

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
	pub fn with_path(mut self, path: &OsStr, appdir: Option<&Path>) -> Self {
		let key = OsStr::new("PATH");
		self.remove.retain(|k| k != key);
		self.set.retain(|(k, _)| k != key);
		let value = match usable_appdir(appdir) {
			// Nothing left after the strip would mean a `PATH` made of nothing
			// but the AppImage's own directories, which is not a `PATH` at all.
			Some(dir) => strip_appdir_entries(path, dir)
				.unwrap_or_else(|| OsString::from(shell_path::FALLBACK_PATH)),
			None => path.to_os_string(),
		};
		self.set.push((key.to_os_string(), value));
		self
	}
}

/// The changes for this process's environment.
pub fn changes_for_current_env() -> EnvChanges {
	let appdir = std::env::var_os("APPDIR").map(PathBuf::from);
	changes(std::env::vars_os(), appdir.as_deref())
		.with_path(shell_path::child_path(), appdir.as_deref())
}

/// The testable half of [`changes_for_current_env`]. `appdir` is `$APPDIR` —
/// `None` when not running from an AppImage, which disables the path-based rule
/// but not the by-name [`AGENT_MARKERS`] one.
pub fn changes<I>(vars: I, appdir: Option<&Path>) -> EnvChanges
where
	I: IntoIterator<Item = (OsString, OsString)>,
{
	// Deliberately *not* an early return when there is no `$APPDIR`: the agent
	// markers below have nothing to do with AppImages and have to go on every
	// platform and every build.
	let appdir = usable_appdir(appdir);

	let mut out = EnvChanges::default();
	for (key, value) in vars {
		if AGENT_MARKERS.iter().any(|m| key == OsStr::new(m)) {
			out.remove.push(key);
			continue;
		}
		let Some(appdir) = appdir else { continue };
		if APPIMAGE_MARKERS.iter().any(|m| key == OsStr::new(m)) {
			out.remove.push(key);
			continue;
		}
		match strip_appdir_entries(&value, appdir) {
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
fn usable_appdir(appdir: Option<&Path>) -> Option<&Path> {
	appdir.filter(|d| {
		let bytes = d.as_os_str().as_bytes();
		!bytes.is_empty() && bytes != b"/"
	})
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
		pairs.iter().map(|(k, v)| (OsString::from(k), OsString::from(v))).collect()
	}

	/// The environment a child actually ends up with: the input, with the
	/// changes applied the way `CommandBuilder` applies them. Asserting on this
	/// rather than on the returned diff is deliberate — a test that only reads
	/// `changes(...).set` passes just as happily when every removal is dropped
	/// on the floor, which is exactly how v0.5.0 shipped broken.
	fn run(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
		let ch = changes(env(pairs), Some(Path::new(APPDIR)));
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

	/// The agent marker is not an AppImage concern, so it cannot be behind the
	/// `$APPDIR` gate — a `.app` on macOS is where this bug was actually found.
	#[test]
	fn the_agent_marker_goes_even_without_an_appdir() {
		let ch =
			changes(env(&[("PATH", "/usr/bin"), ("CLAUDE_CODE_CHILD_SESSION", "abc123")]), None);
		assert_eq!(ch.remove, vec![OsString::from("CLAUDE_CODE_CHILD_SESSION")]);
		// And it changes nothing else, so a dev build's environment is otherwise
		// still untouched.
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

	/// The regression test for v0.5.0. `CommandBuilder` starts out holding this
	/// process's whole environment, so the only thing that can take a variable
	/// off a child is an explicit `env_remove` — and the bug was that we never
	/// issued one. This drives the real builder rather than a stand-in, because
	/// the mistake lived precisely in the gap between our rule and its API.
	#[test]
	fn removals_actually_reach_the_command_builder() {
		let mut cmd = CommandBuilder::new("/bin/true");
		// Start from a known environment rather than the test runner's, which
		// on a developer's machine may itself be inside an AppImage.
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

		// Gone, not blank — the failure mode was these surviving untouched.
		assert_eq!(cmd.get_env("APPDIR"), None);
		assert_eq!(cmd.get_env("APPIMAGE"), None);
		assert_eq!(cmd.get_env("PYTHONHOME"), None);
		// Rewritten, and the untouched one left exactly alone.
		assert_eq!(cmd.get_env("PATH"), Some(OsStr::new("/usr/bin")));
		assert_eq!(cmd.get_env("HOME"), Some(OsStr::new("/home/me")));
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

	/// The bug this file's `with_path` half exists for: a GUI process's `PATH`
	/// has never seen an rc file, so a hook's bare `bash` and an MCP server's
	/// `npx` are not resolvable in it. The login shell's answer has to win over
	/// the inherited value, and it has to reach the builder.
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
		// Everything else is still inherited — this is a diff, not a rebuild.
		assert_eq!(cmd.get_env("HOME"), Some(OsStr::new("/home/me")));
	}

	/// Under an AppImage the two rules meet on the same key: the shell we asked
	/// inherited our `PATH` and extended it, so its answer arrives with
	/// `$APPDIR` still on the front. The strip has to apply to the new value,
	/// and — the sharp edge — the `remove` the `$APPDIR` rule may have queued
	/// for `PATH` must not then unset it.
	#[test]
	fn a_login_shell_path_under_an_appimage_is_stripped_and_not_then_unset() {
		let inherited = [("APPDIR", APPDIR), ("PATH", "/tmp/.mount_Factorfa/usr/bin")];
		let mut cmd = CommandBuilder::new("/bin/true");
		cmd.env_clear();
		for (k, v) in inherited {
			cmd.env(k, v);
		}

		// The whole inherited PATH is $APPDIR, so the $APPDIR rule alone would
		// have removed the key outright.
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
