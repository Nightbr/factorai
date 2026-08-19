//! The boundary a connected IDE client cannot cross (F20, ADR-0017 § 3).
//!
//! Three layers protect the bridge — a per-session token, a loopback bind, and
//! this. **This is the one that matters.** The token lives in a file readable by
//! anything running as the user, so it authenticates *a process on this
//! machine*, which is a much weaker claim than it looks. What stops a connected
//! client being a general-purpose file oracle is that every path it names has to
//! be inside the session's own project.
//!
//! Guarded by tests rather than by a comment, deliberately: getting this wrong
//! turns a developer tool into a local RCE, and it is the kind of wrong that no
//! user ever reports. The unit tests below cover the function; ADR-0017's
//! `tests/ide_ws_scope.rs` arrives with the handshake, where there is a socket
//! to drive them through and a wrong-token case to add beside them.

use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, AppResult};

/// Resolve `requested` and confirm it is inside `root`.
///
/// **Symlinks are resolved before the comparison**, which is the whole point: a
/// textual `..` check is defeated by a link inside the project pointing out of
/// it, and repositories contain links. `canonicalize` is what makes the answer
/// about the filesystem rather than about the string.
///
/// A path that does not exist is still answered rather than refused, because
/// "which file do you mean" and "does it exist" are different questions and the
/// caller wants different errors for them. The deepest ancestor that *does*
/// exist is canonicalised and the remainder appended — so a request for
/// `<project>/new/file.ts` resolves, and one for `/tmp/evil/../../etc/passwd`
/// does not, whether or not either exists.
///
/// Relative paths are refused outright. The protocol sends absolute ones, and
/// there is no working directory here that a relative path would sensibly mean.
pub fn resolve_within(root: &Path, requested: &str) -> AppResult<PathBuf> {
	let requested = Path::new(requested);
	if !requested.is_absolute() {
		return Err(AppError::InvalidInput(format!(
			"path must be absolute: {}",
			requested.display()
		)));
	}

	let root = root
		.canonicalize()
		.map_err(|e| AppError::InvalidInput(format!("project root is unreadable: {e}")))?;
	let resolved = canonicalize_lexically_deep(requested)?;

	if !resolved.starts_with(&root) {
		// Deliberately terse, and deliberately the same message whether the path
		// exists or not: a refusal that distinguishes the two is a probe for
		// what is on this disk.
		return Err(AppError::InvalidInput(format!(
			"path is outside the project: {}",
			requested.display()
		)));
	}
	Ok(resolved)
}

/// Canonicalise as much of `path` as exists, then append the rest.
///
/// `fs::canonicalize` fails outright on a missing path, which would make every
/// not-yet-created file unanswerable. Walking down from the deepest existing
/// ancestor keeps the symlink resolution — the part that carries the security
/// property — while still returning an answer for a leaf that isn't there.
fn canonicalize_lexically_deep(path: &Path) -> AppResult<PathBuf> {
	let mut existing = path.to_path_buf();
	// Owned rather than borrowed: `existing` is popped as we walk up, so a
	// slice into it would not survive the loop.
	let mut rest: Vec<std::ffi::OsString> = Vec::new();

	loop {
		match existing.canonicalize() {
			Ok(base) => {
				let mut out = base;
				// `rest` was pushed leaf-first.
				for part in rest.iter().rev() {
					out.push(part);
				}
				return Ok(out);
			}
			Err(_) => {
				// Only a *normal* component can be popped and re-appended safely.
				// A trailing `..` must never be re-appended after canonicalising
				// its parent — that is exactly the escape this function exists to
				// close, and it is reachable only for a path that doesn't exist.
				match existing.components().next_back() {
					Some(Component::Normal(name)) => {
						rest.push(name.to_os_string());
						if !existing.pop() {
							return Err(AppError::InvalidInput(format!(
								"cannot resolve path: {}",
								path.display()
							)));
						}
					}
					_ => {
						return Err(AppError::InvalidInput(format!(
							"cannot resolve path: {}",
							path.display()
						)))
					}
				}
			}
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::fs;
	use tempfile::tempdir;

	#[test]
	fn a_file_inside_the_project_resolves() {
		let dir = tempdir().unwrap();
		let root = dir.path();
		let file = root.join("src/main.rs");
		fs::create_dir_all(file.parent().unwrap()).unwrap();
		fs::write(&file, "").unwrap();

		let got = resolve_within(root, file.to_str().unwrap()).unwrap();
		assert_eq!(got, file.canonicalize().unwrap());
	}

	#[test]
	fn a_file_that_does_not_exist_yet_still_resolves() {
		let dir = tempdir().unwrap();
		let root = dir.path();
		let got = resolve_within(root, root.join("not/here.ts").to_str().unwrap()).unwrap();
		assert!(got.starts_with(root.canonicalize().unwrap()));
		assert!(got.ends_with("not/here.ts"));
	}

	#[test]
	fn dot_dot_cannot_climb_out() {
		let dir = tempdir().unwrap();
		let root = dir.path().join("project");
		fs::create_dir_all(root.join("src")).unwrap();
		fs::write(dir.path().join("secret.txt"), "").unwrap();

		let escape = root.join("src/../../secret.txt");
		assert!(resolve_within(&root, escape.to_str().unwrap()).is_err());
	}

	#[test]
	fn dot_dot_cannot_climb_out_through_a_path_that_does_not_exist() {
		// The lexical half: `canonicalize` can't help here because nothing along
		// the way exists, so the walk must refuse rather than pop-and-reappend.
		let dir = tempdir().unwrap();
		let root = dir.path().join("project");
		fs::create_dir_all(&root).unwrap();

		let escape = root.join("nope/../../../etc/passwd");
		assert!(resolve_within(&root, escape.to_str().unwrap()).is_err());
	}

	#[test]
	fn a_symlink_pointing_out_of_the_project_is_refused() {
		// The reason canonicalize is used at all. A textual check passes this.
		let dir = tempdir().unwrap();
		let root = dir.path().join("project");
		fs::create_dir_all(&root).unwrap();
		let outside = dir.path().join("outside.txt");
		fs::write(&outside, "secret").unwrap();

		let link = root.join("innocent.txt");
		std::os::unix::fs::symlink(&outside, &link).unwrap();

		assert!(resolve_within(&root, link.to_str().unwrap()).is_err());
	}

	#[test]
	fn a_symlink_inside_the_project_is_fine() {
		let dir = tempdir().unwrap();
		let root = dir.path().join("project");
		fs::create_dir_all(root.join("src")).unwrap();
		let target = root.join("src/real.rs");
		fs::write(&target, "").unwrap();
		let link = root.join("alias.rs");
		std::os::unix::fs::symlink(&target, &link).unwrap();

		assert_eq!(
			resolve_within(&root, link.to_str().unwrap()).unwrap(),
			target.canonicalize().unwrap()
		);
	}

	#[test]
	fn an_absolute_path_elsewhere_is_refused() {
		let dir = tempdir().unwrap();
		let root = dir.path().join("project");
		fs::create_dir_all(&root).unwrap();

		assert!(resolve_within(&root, "/etc/passwd").is_err());
	}

	#[test]
	fn a_relative_path_is_refused_rather_than_guessed_at() {
		let dir = tempdir().unwrap();
		assert!(resolve_within(dir.path(), "src/main.rs").is_err());
	}

	#[test]
	fn a_sibling_project_sharing_a_prefix_is_not_inside() {
		// `starts_with` on `Path` compares components, not bytes, so this is
		// already right — pinned because a string-prefix rewrite would break it
		// and every test above would still pass.
		let dir = tempdir().unwrap();
		let root = dir.path().join("project");
		let sibling = dir.path().join("project2");
		fs::create_dir_all(&root).unwrap();
		fs::create_dir_all(&sibling).unwrap();
		fs::write(sibling.join("f.txt"), "").unwrap();

		assert!(resolve_within(&root, sibling.join("f.txt").to_str().unwrap()).is_err());
	}

	#[test]
	fn the_root_itself_resolves() {
		let dir = tempdir().unwrap();
		let got = resolve_within(dir.path(), dir.path().to_str().unwrap()).unwrap();
		assert_eq!(got, dir.path().canonicalize().unwrap());
	}
}
