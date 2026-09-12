//! Are we running inside WSL, and does this path live on the Windows drive?
//!
//! **This is a runtime question, and it cannot be a `#[cfg]` one.** factorai on
//! Windows *is* the Linux build, running inside a WSL 2 distribution under WSLg
//! (ADR-0044). One binary, one target triple, two environments: `cfg!(windows)`
//! is never true there, and `#[cfg(target_os = "linux")]` cannot tell a WSL
//! distribution apart from a laptop running Debian. Anything that has to differ
//! has to ask at runtime, which is what this module is for.
//!
//! It answers exactly two questions and deliberately not a third. There is no
//! path translation here, no `wslpath`, no `\\wsl.localhost` handling: the app
//! runs *inside* the distribution, so every path it ever sees is already a Linux
//! path, and a translation layer would only exist to serve a boundary we chose
//! not to have.
//!
//! See `specs/01-architecture.md` § "Build targets" and ADR-0044.

use std::path::Path;
use std::sync::OnceLock;

/// Whether this process is running inside a WSL distribution.
///
/// Probed once and cached: the answer cannot change while the process lives,
/// and the callers are on the project-list query path, which is polled every
/// 2 seconds (F1).
pub fn is_wsl() -> bool {
	static IS_WSL: OnceLock<bool> = OnceLock::new();
	*IS_WSL.get_or_init(probe)
}

/// Whether `path` is on the Windows filesystem, reached over the 9p share.
///
/// **This is the flag behind the warning on a project row**, and the failure it
/// names is otherwise invisible. `/mnt/c` and friends are DrvFs mounts, and
/// inotify over 9p does not deliver events — upstream treats 9p as a filesystem
/// where watches are unreliable, and Microsoft has said as much since
/// microsoft/WSL#216. So a project kept on the Windows drive gets a watcher that
/// never fires: the sidebar stops updating, sessions do not appear as they are
/// written, and nothing in the app looks broken. git is slow there for the same
/// reason, which is the part a user *can* feel.
///
/// False everywhere that is not WSL, including native Linux, where `/mnt` is an
/// ordinary mount point and means nothing in particular.
pub fn is_windows_filesystem(path: &Path) -> bool {
	is_wsl() && is_drive_mount(path)
}

/// The path half of [`is_windows_filesystem`], split out so it can be tested
/// without a WSL kernel underneath it.
///
/// A DrvFs mount is `/mnt/<drive letter>`, one character. That single-character
/// rule is doing real work: WSL's own plumbing lives at `/mnt/wsl`, which is a
/// tmpfs and not a Windows drive at all, and a user may well have `/mnt/data`
/// or `/mnt/backup` on native Linux disks inside the distribution. Warning
/// about those would be wrong and would teach people to ignore the warning.
fn is_drive_mount(path: &Path) -> bool {
	let mut parts = path.components();
	// An absolute path, so the first component is the root. A relative path
	// cannot be a drive mount and is not something a project ever holds.
	if parts.next() != Some(std::path::Component::RootDir) {
		return false;
	}
	if parts.next().and_then(|c| c.as_os_str().to_str()) != Some("mnt") {
		return false;
	}
	match parts.next().and_then(|c| c.as_os_str().to_str()) {
		Some(drive) => drive.len() == 1 && drive.chars().all(|c| c.is_ascii_alphabetic()),
		// `/mnt` itself. Not a drive, and not a place a project lives.
		None => false,
	}
}

/// Three signals, because no single one of them is guaranteed.
///
/// `WSL_DISTRO_NAME` is set by the launcher and is the cheapest, but a process
/// re-parented or started from a stripped environment may not carry it — and
/// this app already strips variables off its own children (`child_env`), so a
/// rule that trusted the environment alone would be one refactor away from
/// being wrong. `WSLInterop` is the binfmt handler WSL registers to run Windows
/// executables and is present on every WSL 2 distribution. `/proc/version`
/// carries Microsoft's kernel build string and is the oldest of the three.
#[cfg(target_os = "linux")]
fn probe() -> bool {
	if std::env::var_os("WSL_DISTRO_NAME").is_some() {
		return true;
	}
	if Path::new("/proc/sys/fs/binfmt_misc/WSLInterop").exists() {
		return true;
	}
	std::fs::read_to_string("/proc/version")
		.map(|v| {
			let v = v.to_ascii_lowercase();
			v.contains("microsoft") || v.contains("wsl")
		})
		.unwrap_or(false)
}

/// macOS has no WSL to be inside of.
#[cfg(not(target_os = "linux"))]
fn probe() -> bool {
	false
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::path::PathBuf;

	#[test]
	fn a_drive_mount_is_one_letter_under_mnt() {
		assert!(is_drive_mount(&PathBuf::from("/mnt/c")));
		assert!(is_drive_mount(&PathBuf::from("/mnt/c/Users/me/code/app")));
		assert!(is_drive_mount(&PathBuf::from("/mnt/d/work")));
	}

	/// The rule that keeps the warning honest. `/mnt/wsl` is WSL's own tmpfs and
	/// a multi-letter mount is a disk someone mounted themselves — neither is
	/// the Windows drive, and warning about them would train the reader to
	/// dismiss the one case that matters.
	#[test]
	fn other_mounts_are_not_the_windows_drive() {
		assert!(!is_drive_mount(&PathBuf::from("/mnt/wsl/docker-desktop")));
		assert!(!is_drive_mount(&PathBuf::from("/mnt/data/projects")));
		assert!(!is_drive_mount(&PathBuf::from("/mnt")));
		assert!(!is_drive_mount(&PathBuf::from("/mnt/")));
	}

	#[test]
	fn a_home_path_is_never_a_drive_mount() {
		assert!(!is_drive_mount(&PathBuf::from("/home/me/code/app")));
		assert!(!is_drive_mount(&PathBuf::from("/Users/me/code/app")));
		assert!(!is_drive_mount(&PathBuf::from("/")));
	}

	/// A relative path cannot name a mount, and `components()` would otherwise
	/// let `mnt/c` through the same match as `/mnt/c`.
	#[test]
	fn a_relative_path_is_not_a_drive_mount() {
		assert!(!is_drive_mount(&PathBuf::from("mnt/c/code")));
		assert!(!is_drive_mount(&PathBuf::from("./mnt/c")));
	}

	/// Outside WSL the whole question is moot, and `/mnt/c` on a Linux laptop is
	/// an ordinary directory somebody made.
	#[test]
	fn the_flag_is_false_when_not_inside_wsl() {
		if !is_wsl() {
			assert!(!is_windows_filesystem(&PathBuf::from("/mnt/c/code")));
		}
	}
}
