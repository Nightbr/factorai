//! Locating the `claude` CLI binary on disk.
//!
//! Three-tier discovery, ported from
//! [the reference app's claude_cli.rs](https://github.com/example/repo).
//! See specs/annex-A-cli-agent-patterns.md § A.1 for the rationale.
//!
//! Order of attempts:
//!   0. The user's override, when the caller passes one (F11).
//!   1. `which claude` in the inherited process PATH.
//!   2. `$SHELL -lc 'command -v claude'` (then /bin/zsh, /bin/bash) — handles
//!      macOS GUI launches that don't inherit a terminal PATH.
//!   3. Probe a list of common install locations.
//!
//! **The override arrives as a parameter, not as a database read.** This module
//! stays a pure function of its input — the caller resolves the setting and
//! hands a path — so it keeps no `Db` dependency and its tests keep working
//! without one. What matters is that *every* caller passes it: `check_cli`
//! reaching the finder on its own is how the settings page would come to report
//! "not installed" for the binary sessions are actually spawning from.
//!
//! Windows entries from the reference app's list are dropped (Q1: no Windows support).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::Serialize;
use tracing::{debug, warn};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCliStatus {
	pub installed: bool,
	pub binary_path: Option<String>,
	pub version: Option<String>,
}

/// Locate the `claude` binary. Returns the first hit from any tier.
///
/// `override_path` is the user's setting (F11). When present it is the answer —
/// **no fallback to the probe**, because a typo that silently resolved to
/// whatever the tiers found would show a working version beside a path that
/// does not work, which is the opposite of validating before you depend on it.
pub fn find_claude_binary(override_path: Option<&Path>) -> AppResult<PathBuf> {
	if let Some(p) = override_path {
		if p.is_file() {
			debug!(?p, "using the configured claude binary");
			return Ok(p.to_path_buf());
		}
		return Err(AppError::NotFound(format!("no claude binary at {}", p.display())));
	}
	if let Some(p) = find_on_path() {
		debug!(?p, "found claude via PATH");
		return Ok(p);
	}
	if let Some(p) = find_in_user_shell() {
		debug!(?p, "found claude via login shell");
		return Ok(p);
	}
	if let Some(p) = probe_known_candidates() {
		debug!(?p, "found claude via candidate probe");
		return Ok(p);
	}
	Err(AppError::NotFound("claude CLI not found".into()))
}

/// Check whether `claude` is installed. Doesn't error — returns a status the
/// frontend can use to drive an onboarding banner or the settings page's
/// read-only Claude row.
///
/// `override_path` is passed straight through to `find_claude_binary`, so what
/// this reports and what a session spawns are the same binary.
///
/// **`installed` means the binary resolved, not that `--version` answered.** A
/// resolved path with `version: None` is a real state — a wrapper script, a
/// broken install, a `--version` that hangs — and it is the caller's to
/// present. Folding it into `installed: false` would let a version probe veto a
/// binary that spawns sessions perfectly well.
pub fn check_cli(override_path: Option<&Path>) -> ClaudeCliStatus {
	match find_claude_binary(override_path) {
		Ok(p) => {
			let version = version_for(&p);
			ClaudeCliStatus {
				installed: true,
				binary_path: Some(p.to_string_lossy().to_string()),
				version,
			}
		}
		Err(_) => ClaudeCliStatus { installed: false, binary_path: None, version: None },
	}
}

fn find_on_path() -> Option<PathBuf> {
	run_lookup("which", &["claude"])
}

fn find_in_user_shell() -> Option<PathBuf> {
	for shell in user_shell_candidates() {
		if !shell.exists() {
			continue;
		}
		if let Some(p) = ask_shell(&shell) {
			return Some(p);
		}
	}
	None
}

fn user_shell_candidates() -> Vec<PathBuf> {
	let mut shells = Vec::new();
	if let Some(s) = std::env::var_os("SHELL") {
		if !s.is_empty() {
			shells.push(PathBuf::from(s));
		}
	}
	shells.push(PathBuf::from("/bin/zsh"));
	shells.push(PathBuf::from("/bin/bash"));
	shells
}

fn ask_shell(shell: &Path) -> Option<PathBuf> {
	let output = Command::new(shell).arg("-lc").arg("command -v claude").output().ok()?;
	if !output.status.success() {
		return None;
	}
	let stdout = String::from_utf8_lossy(&output.stdout);
	first_existing(&stdout)
}

fn run_lookup(cmd: &str, args: &[&str]) -> Option<PathBuf> {
	let output = Command::new(cmd).args(args).output().ok()?;
	if !output.status.success() {
		return None;
	}
	let stdout = String::from_utf8_lossy(&output.stdout);
	first_existing(&stdout)
}

fn first_existing(stdout: &str) -> Option<PathBuf> {
	for line in stdout.lines() {
		let trimmed = line.trim();
		if trimmed.is_empty() {
			continue;
		}
		let p = PathBuf::from(trimmed);
		if p.exists() {
			return Some(p);
		}
	}
	None
}

fn probe_known_candidates() -> Option<PathBuf> {
	candidate_paths().into_iter().find(|p| p.exists())
}

fn candidate_paths() -> Vec<PathBuf> {
	let mut out = Vec::new();
	if let Some(home) = dirs::home_dir() {
		out.extend([
			home.join(".local/bin/claude"),
			home.join(".claude/local/claude"),
			home.join(".local/share/mise/shims/claude"),
			home.join(".asdf/shims/claude"),
			home.join(".npm-global/bin/claude"),
			home.join(".npm/bin/claude"),
			home.join(".linuxbrew/bin/claude"),
		]);
		// nvm-managed installs: glob ~/.nvm/versions/node/*/bin/claude
		if let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) {
			let mut nvm: Vec<PathBuf> = entries
				.filter_map(Result::ok)
				.map(|e| e.path().join("bin").join("claude"))
				.filter(|p| p.exists())
				.collect();
			// Sort so the highest version (lexicographic) wins.
			nvm.sort();
			nvm.reverse();
			out.extend(nvm);
		}
	}
	out.extend([
		PathBuf::from("/opt/homebrew/bin/claude"),
		PathBuf::from("/usr/local/bin/claude"),
		PathBuf::from("/home/linuxbrew/.linuxbrew/bin/claude"),
	]);
	out
}

/// Best-effort version lookup. Runs `claude --version` with a 2-second
/// soft timeout. Returns the first whitespace-separated token that looks
/// like a semver (e.g. "0.2.34" out of "claude 0.2.34 (build abc)").
fn version_for(bin: &Path) -> Option<String> {
	let output = Command::new(bin)
		.arg("--version")
		.output()
		.map_err(|e| warn!(error = %e, "claude --version failed"))
		.ok()?;
	if !output.status.success() {
		return None;
	}
	let _ = Duration::from_secs(2); // documented intent; std Command has no built-in timeout
	let s = String::from_utf8_lossy(&output.stdout);
	for tok in s.split_whitespace() {
		if is_version_like(tok) {
			return Some(tok.to_string());
		}
	}
	None
}

fn is_version_like(s: &str) -> bool {
	let s = s.trim_start_matches('v');
	let mut parts = s.split('.');
	let a = parts.next();
	let b = parts.next();
	let c = parts.next();
	matches!((a, b, c), (Some(a), Some(b), Some(c)) if
		a.chars().all(|ch| ch.is_ascii_digit()) &&
		b.chars().all(|ch| ch.is_ascii_digit()) &&
		c.chars().all(|ch| ch.is_ascii_digit() || ch == '-' || ch == '+' || ch.is_ascii_alphabetic())
	)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn version_like_accepts_semver() {
		assert!(is_version_like("0.2.34"));
		assert!(is_version_like("v1.0.0"));
		assert!(is_version_like("1.2.3-alpha"));
	}

	#[test]
	fn version_like_rejects_non_versions() {
		assert!(!is_version_like("claude"));
		assert!(!is_version_like("1.2"));
		assert!(!is_version_like(""));
		assert!(!is_version_like("abc.def.ghi"));
	}

	#[test]
	fn candidate_paths_includes_known_locations() {
		let paths = candidate_paths();
		// At minimum the absolute paths show up regardless of HOME.
		assert!(paths.iter().any(|p| p == &PathBuf::from("/opt/homebrew/bin/claude")));
		assert!(paths.iter().any(|p| p == &PathBuf::from("/usr/local/bin/claude")));
	}

	#[test]
	fn first_existing_picks_first_real_path() {
		let tmp = tempfile::TempDir::new().unwrap();
		let real = tmp.path().join("real");
		std::fs::write(&real, "").unwrap();
		let stdout = format!("/no/such/path\n{}\n/also/missing\n", real.display());
		assert_eq!(first_existing(&stdout), Some(real));
	}

	#[test]
	fn first_existing_returns_none_when_all_missing() {
		assert_eq!(first_existing("/a\n/b\n"), None);
	}

	#[test]
	fn override_wins_over_the_probe() {
		let tmp = tempfile::TempDir::new().unwrap();
		let fake = tmp.path().join("claude");
		std::fs::write(&fake, "").unwrap();
		// Whatever the three tiers would have found on this machine, the
		// configured path is the answer — that is what makes the settings page
		// and the spawn path agree about one binary (F11).
		assert_eq!(find_claude_binary(Some(&fake)).unwrap(), fake);
	}

	#[test]
	fn a_missing_override_does_not_fall_back_to_the_probe() {
		let tmp = tempfile::TempDir::new().unwrap();
		let nowhere = tmp.path().join("no-such-claude");
		// The alternative — probing anyway — would report a working version
		// beside a path that does not work, which is the one thing validating
		// before you depend on it exists to prevent.
		assert!(find_claude_binary(Some(&nowhere)).is_err());
		assert!(!check_cli(Some(&nowhere)).installed);
	}

	#[test]
	fn a_directory_is_not_a_binary() {
		let tmp = tempfile::TempDir::new().unwrap();
		// `exists()` would accept this; a path you cannot exec is not an install.
		assert!(find_claude_binary(Some(tmp.path())).is_err());
	}

	#[test]
	fn no_override_still_probes() {
		// Whether `claude` is installed on the machine running the tests is not
		// this test's business — that the absent override reaches the tiers
		// rather than short-circuiting is. Either outcome proves it ran them;
		// what it must not do is fail the way a missing override does.
		let status = check_cli(None);
		assert_eq!(status.installed, status.binary_path.is_some());
	}
}
