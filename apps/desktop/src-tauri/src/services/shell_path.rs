//! The `PATH` a child process should get — the user's, not ours.
//!
//! A GUI application does not have the user's `PATH`. Launched from Finder, the
//! Dock or a `.desktop` file it inherits launchd's / the session manager's
//! environment, and no shell rc file has ever run in it. So `/opt/homebrew/bin`
//! (or `/usr/local/bin` on an Intel Mac) is absent, and so is every
//! version-manager shim — nvm, mise, asdf, fnm, volta. Handing that on to a
//! `claude` session breaks everything in it that resolves a program by name,
//! and none of the breakage looks like an environment problem from the inside:
//!
//! - A hook runs as `/bin/sh -c "<command>"`. `/bin/sh` is found because it is
//!   invoked by absolute path; the bare `bash` *inside* the command goes through
//!   `PATH` and isn't. What surfaces is
//!   `SessionStart:startup hook error … /bin/sh: bash: command not found`.
//! - A stdio MCP server is launched as `npx` / `node` / `uvx` / `docker` and
//!   fails its JSON-RPC handshake. What surfaces is `-32000`.
//! - A `statusLine` command fails silently — no banner at all.
//! - `git`, `gh`, `pnpm` and everything else the agent runs from `Bash`.
//!
//! The tell is always the same: it works when `claude` is started from a
//! terminal. That difference *is* the diagnosis.
//!
//! **So ask a shell.** Run the user's login shell once at startup and read the
//! `PATH` it produces. This is the `fix-path-for-mac` pattern VS Code and most
//! Electron developer tools use; it is prior art, not a scheme of ours. Four
//! details are what make it work in practice rather than in principle:
//!
//! - **`-ilc`, both flags.** `-l` sources `~/.zprofile`, where Homebrew's
//!   `shellenv` usually lands; `-i` sources `~/.zshrc`, where nvm / mise / asdf
//!   usually land. Either one alone misses half of real machines.
//! - **Sentinels, not raw stdout.** An interactive shell talks: MOTD,
//!   powerlevel10k's instant prompt, `direnv`, version-manager banners. The
//!   answer is fished out from between two markers.
//! - **Stdin from `/dev/null`, and a timeout.** An interactive shell may block
//!   waiting to be typed at. On timeout the child is killed and the floor below
//!   is used instead.
//! - **Read `$SHELL`.** Not everyone runs zsh. `/bin/zsh` is only the guess for
//!   when `$SHELL` is unset, and no further shells are tried after it: a
//!   `$SHELL` that cannot be run is pathological, and [`FALLBACK_PATH`] is a
//!   better answer to it than a cascade that quietly consults a shell whose rc
//!   files the user does not use.
//!
//! Resolution happens **once** and is cached for the app's lifetime — see
//! [`child_path`]. Everything else about a child's environment is inherited
//! whole; see [`super::child_env`], which is where this gets applied.

use std::ffi::{OsStr, OsString};
#[cfg(unix)]
use std::io::Read;
#[cfg(unix)]
use std::os::unix::ffi::OsStringExt;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
#[cfg(unix)]
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::process::{Command, Stdio};
#[cfg(unix)]
use std::sync::{mpsc, OnceLock};
#[cfg(unix)]
use std::time::Duration;

#[cfg(unix)]
use tracing::{info, warn};

/// Markers around the answer, so the shell's own chatter can be discarded.
#[cfg(unix)]
const START: &str = "__FACTORAI_PATH_START__";
#[cfg(unix)]
const END: &str = "__FACTORAI_PATH_END__";

/// Where to look when the shell cannot be asked. Both Homebrew prefixes are
/// here on purpose: Apple Silicon puts it in `/opt/homebrew`, Intel in
/// `/usr/local`, and a floor that only knows one of them is a floor that drops
/// half of macOS through it.
#[cfg(unix)]
pub const FALLBACK_PATH: &str =
	"/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

/// Programs whose absence means the resolved `PATH` is not usable, checked at
/// startup so the diagnosis is in the log rather than three layers down inside
/// a hook error. `bash` is what hooks shell out to; `node` is what stdio MCP
/// servers are.
#[cfg(unix)]
const EXPECTED: &[&str] = &["bash", "node"];

/// Long enough for a slow `~/.zshrc` (nvm alone can take a second), short
/// enough that a shell which is never going to answer doesn't hold a session
/// launch. Only ever paid once.
#[cfg(unix)]
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(5);

#[cfg(unix)]
static CHILD_PATH: OnceLock<OsString> = OnceLock::new();

/// The `PATH` every child process gets. Resolved on first call and cached.
///
/// [`warm`] normally wins this race off the main thread; a caller arriving
/// while that is still in flight blocks on it rather than resolving a second
/// time, which is what `OnceLock` is for.
///
/// On Windows the GUI process already has the full user `PATH` (there is no
/// login-shell barrier), so this just returns the inherited value.
#[cfg(unix)]
pub fn child_path() -> &'static OsStr {
	CHILD_PATH.get_or_init(resolve).as_os_str()
}

/// Windows: the inherited PATH is already correct. Return it as a leaked
/// static so the return type matches the Unix signature.
#[cfg(windows)]
pub fn child_path() -> &'static OsStr {
	use std::sync::OnceLock;
	static WIN_PATH: OnceLock<OsString> = OnceLock::new();
	WIN_PATH.get_or_init(|| std::env::var_os("PATH").unwrap_or_default()).as_os_str()
}

/// Resolve and cache off the caller's thread, and say in the log if the answer
/// looks unusable. Called from `setup()`: the window must not wait on a shell.
#[cfg(unix)]
pub fn warm() {
	std::thread::spawn(|| {
		let path = child_path();
		let missing: Vec<&str> =
			EXPECTED.iter().copied().filter(|n| which_in(path, n).is_none()).collect();
		if missing.is_empty() {
			return;
		}
		warn!(
			path = %path.to_string_lossy(),
			missing = ?missing,
			"could not resolve your shell environment: these programs are not on the PATH \
			 sessions will run with, so hooks, MCP servers and the statusline will fail"
		);
	});
}

/// Windows: no shell probe needed.
#[cfg(windows)]
pub fn warm() {}

#[cfg(unix)]
fn resolve() -> OsString {
	let shell = login_shell();
	match path_from_shell(&shell, RESOLVE_TIMEOUT) {
		Some(path) => {
			info!(shell = %shell.display(), path = %path.to_string_lossy(), "resolved login shell PATH");
			path
		}
		None => {
			warn!(shell = %shell.display(), "could not read PATH from the login shell; using the fallback");
			OsString::from(FALLBACK_PATH)
		}
	}
}

#[cfg(unix)]
fn login_shell() -> PathBuf {
	match std::env::var_os("SHELL") {
		Some(s) if !s.is_empty() => PathBuf::from(s),
		_ => PathBuf::from("/bin/zsh"),
	}
}

/// Ask one shell. `None` for every failure mode — unspawnable, timed out, no
/// sentinels, nothing usable between them — because they all mean the same
/// thing to the caller.
#[cfg(unix)]
fn path_from_shell(shell: &Path, timeout: Duration) -> Option<OsString> {
	let script = format!("printf '%s' \"{START}${{PATH}}{END}\"");
	let mut child = Command::new(shell)
		.arg("-ilc")
		.arg(&script)
		.stdin(Stdio::null())
		.stdout(Stdio::piped())
		// The noise is the reason for the sentinels; it is not worth reading.
		.stderr(Stdio::null())
		.spawn()
		.map_err(|e| warn!(shell = %shell.display(), error = %e, "could not run the login shell"))
		.ok()?;

	// Reading on this thread would be the hang the timeout exists to prevent, so
	// stdout is drained on its own. The thread is deliberately never joined: a
	// backgrounded grandchild can hold the write end open after the shell itself
	// is gone, and waiting for that is the same deadlock in a different place.
	let mut stdout = child.stdout.take()?;
	let (tx, rx) = mpsc::channel();
	std::thread::spawn(move || {
		let mut buf = Vec::new();
		let _ = stdout.read_to_end(&mut buf);
		let _ = tx.send(buf);
	});

	let received = rx.recv_timeout(timeout);
	// Unconditionally, and before looking at the result: on the happy path the
	// shell has already exited and this is a no-op that reaps it, and on the
	// timeout it is the only thing that stops a stuck interactive shell living
	// as long as the app does.
	let _ = child.kill();
	let _ = child.wait();

	let out = received
		.map_err(
			|_| warn!(shell = %shell.display(), ?timeout, "the login shell did not answer in time"),
		)
		.ok()?;
	extract(&out)
}

/// The bytes between the sentinels, sanitised. Bytes, not `str`: a `PATH` is
/// not required to be UTF-8 and lossy-converting one would corrupt the entry
/// it touched rather than fail.
#[cfg(unix)]
fn extract(out: &[u8]) -> Option<OsString> {
	let after_start = &out[find(out, START.as_bytes())? + START.len()..];
	let value = &after_start[..find(after_start, END.as_bytes())?];
	sanitize(value)
}

#[cfg(unix)]
fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
	haystack.windows(needle.len()).position(|w| w == needle)
}

/// Drop empty entries and refuse a `PATH` with nothing left in it. An empty
/// entry means the current directory — a session's cwd is a project checkout,
/// so that is a program-execution hazard rather than a cosmetic flaw, and
/// `PATH=""` is worse than having asked nothing at all.
#[cfg(unix)]
fn sanitize(value: &[u8]) -> Option<OsString> {
	let kept: Vec<&[u8]> = value.split(|b| *b == b':').filter(|e| !e.is_empty()).collect();
	if kept.is_empty() {
		return None;
	}
	Some(OsString::from_vec(kept.join(&b':')))
}

/// First executable named `name` in `path`. Deliberately not `which`, which
/// would answer for *our* `PATH` and so could never see the problem.
#[cfg(unix)]
fn which_in(path: &OsStr, name: &str) -> Option<PathBuf> {
	std::env::split_paths(path).map(|dir| dir.join(name)).find(|p| is_executable(p))
}

#[cfg(unix)]
fn is_executable(p: &Path) -> bool {
	std::fs::metadata(p)
		.map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
		.unwrap_or(false)
}

#[cfg(all(test, unix))]
mod tests {
	use std::os::unix::ffi::OsStrExt;

	use super::*;

	/// A stand-in shell: ignores `-ilc` and the script entirely, and writes
	/// exactly what the test wants on stdout. Asking a real shell would make
	/// these tests assertions about the machine they run on.
	fn fake_shell(dir: &Path, body: &str) -> PathBuf {
		let p = dir.join("fake-shell");
		std::fs::write(&p, format!("#!/bin/sh\n{body}\n")).unwrap();
		std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
		p
	}

	#[test]
	fn the_answer_is_fished_out_from_between_the_shell_s_chatter() {
		// What a real interactive shell looks like: a MOTD, an instant prompt,
		// direnv, an nvm banner, and the one line we asked for somewhere in it.
		let tmp = tempfile::TempDir::new().unwrap();
		let shell = fake_shell(
			tmp.path(),
			"echo 'Welcome to Ubuntu 24.04'\n\
			 printf 'direnv: loading .envrc\\n'\n\
			 printf '%s' \"__FACTORAI_PATH_START__/opt/homebrew/bin:/usr/bin:/bin__FACTORAI_PATH_END__\"\n\
			 echo 'Now using node v22.11.0'",
		);
		assert_eq!(
			path_from_shell(&shell, Duration::from_secs(5)),
			Some(OsString::from("/opt/homebrew/bin:/usr/bin:/bin"))
		);
	}

	#[test]
	fn a_shell_that_never_answers_is_killed_and_gives_no_path() {
		// The interactive-shell-blocks-on-input case, with a timeout a test can
		// afford. `resolve` turns this None into FALLBACK_PATH.
		let tmp = tempfile::TempDir::new().unwrap();
		let shell = fake_shell(tmp.path(), "sleep 60");
		assert_eq!(path_from_shell(&shell, Duration::from_millis(200)), None);
	}

	#[test]
	fn a_shell_that_cannot_be_run_gives_no_path() {
		assert_eq!(path_from_shell(Path::new("/nonexistent/shell"), Duration::from_secs(5)), None);
	}

	#[test]
	fn a_shell_that_says_nothing_useful_gives_no_path() {
		let tmp = tempfile::TempDir::new().unwrap();
		// No sentinels at all — a shell whose rc files exited before our command.
		assert_eq!(
			path_from_shell(&fake_shell(tmp.path(), "echo hi"), Duration::from_secs(5)),
			None
		);
		// Sentinels, but nothing between them.
		let empty =
			fake_shell(tmp.path(), "printf '%s' '__FACTORAI_PATH_START____FACTORAI_PATH_END__'");
		assert_eq!(path_from_shell(&empty, Duration::from_secs(5)), None);
	}

	#[test]
	fn the_fallback_is_used_when_the_shell_cannot_be_asked() {
		// The acceptance case: $SHELL pointing at a binary that isn't there.
		let path = match path_from_shell(Path::new("/nonexistent/shell"), Duration::from_secs(5)) {
			Some(p) => p,
			None => OsString::from(FALLBACK_PATH),
		};
		assert_eq!(path, OsString::from(FALLBACK_PATH));
		// And it is a floor a hook can actually run in: /bin/sh finds bash there.
		for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
			assert!(std::env::split_paths(&path).any(|p| p == Path::new(dir)), "{dir} missing");
		}
	}

	#[test]
	fn an_empty_entry_never_survives_as_the_current_directory() {
		// A trailing or doubled colon means "." to execvp, and a session's cwd is
		// a project checkout someone else may have written to.
		assert_eq!(sanitize(b"/usr/bin::/bin:"), Some(OsString::from("/usr/bin:/bin")));
		assert_eq!(sanitize(b":"), None);
		assert_eq!(sanitize(b""), None);
	}

	#[test]
	fn a_path_that_is_not_utf8_survives_intact() {
		// Not hypothetical on a machine with a mojibake directory name in PATH;
		// lossy conversion would corrupt that entry rather than report anything.
		let mut raw = Vec::from(START.as_bytes());
		raw.extend_from_slice(b"/usr/bin:/home/\xff\xfe/bin");
		raw.extend_from_slice(END.as_bytes());
		let got = extract(&raw).unwrap();
		assert_eq!(got.as_bytes(), b"/usr/bin:/home/\xff\xfe/bin");
	}

	#[test]
	fn which_in_reads_the_given_path_and_not_ours() {
		let tmp = tempfile::TempDir::new().unwrap();
		let bin = tmp.path().join("bin");
		std::fs::create_dir(&bin).unwrap();
		std::fs::write(bin.join("not-executable"), "").unwrap();
		let exe = fake_shell(&bin, "true");
		let path = OsString::from(bin.to_str().unwrap());

		assert_eq!(which_in(&path, "fake-shell"), Some(exe));
		// A file that is there but cannot be run is not a hit — that distinction
		// is the whole value of the startup self-check.
		assert_eq!(which_in(&path, "not-executable"), None);
		// And `sh` is on the real PATH but not on this one.
		assert_eq!(which_in(&path, "sh"), None);
	}
}
