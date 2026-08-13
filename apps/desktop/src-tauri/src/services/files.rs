//! Directory listing for the project file tree (specs/05-features.md F11).
//!
//! Deliberately shallow: one call lists exactly one directory. The tree in the
//! renderer expands lazily, so we never walk `node_modules` / `.venv` / a
//! symlink cycle — there is no recursion here to run away with.

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::{AppError, AppResult};
use crate::models::{DirEntry, DirListing};

/// Upper bound on entries returned for a single directory. Generated
/// directories (build output, caches) can hold tens of thousands of files and
/// the renderer would spend the whole frame budget reconciling rows nobody
/// reads. The listing reports `total` so the UI can say how many it hid.
pub const MAX_ENTRIES: usize = 2000;

/// List one directory. `root` is the project root: when given, symlinks whose
/// target resolves outside it are flagged so the tree can refuse to expand them
/// (browsing out of the project via a stray link is never what you meant).
pub fn list_dir(path: &str, root: Option<&str>) -> AppResult<DirListing> {
	list_dir_capped(path, root, MAX_ENTRIES)
}

/// `list_dir` with an injectable cap — lets tests exercise truncation without
/// creating 2000 files.
fn list_dir_capped(path: &str, root: Option<&str>, cap: usize) -> AppResult<DirListing> {
	let dir = Path::new(path);
	let meta = fs::metadata(dir).map_err(|e| match e.kind() {
		std::io::ErrorKind::NotFound => AppError::NotFound(format!("path {path}")),
		std::io::ErrorKind::PermissionDenied => AppError::Io(format!("permission denied: {path}")),
		_ => AppError::Io(format!("{path}: {e}")),
	})?;
	if !meta.is_dir() {
		return Err(AppError::InvalidInput(format!("not a directory: {path}")));
	}

	let root_canon = root.and_then(|r| fs::canonicalize(r).ok());

	let reader = fs::read_dir(dir).map_err(|e| match e.kind() {
		std::io::ErrorKind::PermissionDenied => AppError::Io(format!("permission denied: {path}")),
		_ => AppError::Io(format!("{path}: {e}")),
	})?;

	let mut entries: Vec<DirEntry> = Vec::new();
	for entry in reader {
		// A single unreadable entry (racing deletion, for instance) shouldn't
		// fail the whole listing.
		let Ok(entry) = entry else { continue };
		let name = entry.file_name().to_string_lossy().into_owned();
		// `.git` only. Dotfiles and caches stay visible — `.claude/` is one of
		// the more interesting directories in this app.
		if name == ".git" {
			continue;
		}
		entries.push(describe(&entry, &name, root_canon.as_deref()));
	}

	// Sort before truncating so the cap keeps a deterministic prefix rather
	// than whatever order the filesystem handed us.
	entries.sort_by(|a, b| {
		b.is_dir
			.cmp(&a.is_dir)
			.then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
			.then_with(|| a.name.cmp(&b.name))
	});

	let total = entries.len();
	let truncated = total > cap;
	if truncated {
		entries.truncate(cap);
	}

	Ok(DirListing { entries, total, truncated })
}

fn describe(entry: &fs::DirEntry, name: &str, root_canon: Option<&Path>) -> DirEntry {
	let path = entry.path();
	// `file_type()` describes the link itself; `metadata()` follows it. We want
	// both: the symlink flag from the former, dir-ness from the latter (a link
	// to a directory should still get a chevron).
	let link_type = entry.file_type().ok();
	let is_symlink = link_type.map(|t| t.is_symlink()).unwrap_or(false);
	let target = fs::metadata(&path).ok();
	let is_dir = target
		.as_ref()
		.map(|m| m.is_dir())
		.or_else(|| link_type.map(|t| t.is_dir()))
		.unwrap_or(false);

	DirEntry {
		name: name.to_string(),
		path: path.to_string_lossy().into_owned(),
		is_dir,
		is_symlink,
		symlink_outside_root: is_symlink && escapes_root(&path, root_canon),
		size: if is_dir { 0 } else { target.as_ref().map(|m| m.len()).unwrap_or(0) },
		modified_at: target.as_ref().and_then(|m| m.modified().ok()).and_then(to_millis),
	}
}

/// True when `path` resolves outside `root`. A link we can't resolve at all
/// (broken, or a permission wall) counts as escaping: better to refuse to
/// expand it than to follow it blind.
fn escapes_root(path: &Path, root_canon: Option<&Path>) -> bool {
	let Some(root) = root_canon else { return false };
	match fs::canonicalize(path) {
		Ok(target) => !target.starts_with(root),
		Err(_) => true,
	}
}

fn to_millis(t: SystemTime) -> Option<i64> {
	t.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as i64)
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::fs::File;
	use tempfile::tempdir;

	fn names(listing: &DirListing) -> Vec<&str> {
		listing.entries.iter().map(|e| e.name.as_str()).collect()
	}

	#[test]
	fn lists_directories_first_then_files_case_insensitively() {
		let dir = tempdir().unwrap();
		let root = dir.path();
		fs::create_dir(root.join("src")).unwrap();
		fs::create_dir(root.join("Apps")).unwrap();
		File::create(root.join("README.md")).unwrap();
		File::create(root.join("apple.txt")).unwrap();
		File::create(root.join(".env")).unwrap();

		let listing = list_dir(root.to_str().unwrap(), None).unwrap();

		// Dirs first (Apps before src, case-insensitive), then files with the
		// dotfile sorting under `.` and staying visible.
		assert_eq!(names(&listing), vec!["Apps", "src", ".env", "apple.txt", "README.md"]);
		assert!(!listing.truncated);
		assert_eq!(listing.total, 5);
	}

	#[test]
	fn excludes_git_but_keeps_other_dotdirs() {
		let dir = tempdir().unwrap();
		let root = dir.path();
		fs::create_dir(root.join(".git")).unwrap();
		fs::create_dir(root.join(".claude")).unwrap();
		fs::create_dir(root.join("__pycache__")).unwrap();

		let listing = list_dir(root.to_str().unwrap(), None).unwrap();

		assert_eq!(names(&listing), vec![".claude", "__pycache__"]);
		assert_eq!(listing.total, 2);
	}

	#[test]
	fn reports_sizes_and_dir_flags() {
		let dir = tempdir().unwrap();
		let root = dir.path();
		fs::create_dir(root.join("pkg")).unwrap();
		fs::write(root.join("a.txt"), b"hello").unwrap();

		let listing = list_dir(root.to_str().unwrap(), None).unwrap();
		let pkg = &listing.entries[0];
		let file = &listing.entries[1];

		assert!(pkg.is_dir);
		assert_eq!(pkg.size, 0);
		assert!(!file.is_dir);
		assert_eq!(file.size, 5);
		assert!(file.modified_at.is_some());
		assert!(file.path.ends_with("a.txt"));
	}

	#[test]
	fn truncates_to_the_cap_but_reports_the_true_total() {
		let dir = tempdir().unwrap();
		let root = dir.path();
		for i in 0..10 {
			File::create(root.join(format!("f{i:02}.txt"))).unwrap();
		}

		let listing = list_dir_capped(root.to_str().unwrap(), None, 4).unwrap();

		assert!(listing.truncated);
		assert_eq!(listing.total, 10);
		assert_eq!(listing.entries.len(), 4);
		// Deterministic prefix: sorted, then cut.
		assert_eq!(names(&listing), vec!["f00.txt", "f01.txt", "f02.txt", "f03.txt"]);
	}

	#[cfg(unix)]
	#[test]
	fn flags_symlinks_and_whether_they_escape_the_root() {
		let dir = tempdir().unwrap();
		let root = dir.path();
		let outside = tempdir().unwrap();
		fs::create_dir(root.join("real")).unwrap();
		std::os::unix::fs::symlink(root.join("real"), root.join("inside-link")).unwrap();
		std::os::unix::fs::symlink(outside.path(), root.join("outside-link")).unwrap();

		let listing = list_dir(root.to_str().unwrap(), Some(root.to_str().unwrap())).unwrap();
		let by_name = |n: &str| listing.entries.iter().find(|e| e.name == n).unwrap();

		let inside = by_name("inside-link");
		assert!(inside.is_symlink);
		assert!(inside.is_dir, "a link to a directory is expandable");
		assert!(!inside.symlink_outside_root);

		let outside_link = by_name("outside-link");
		assert!(outside_link.is_symlink);
		assert!(outside_link.symlink_outside_root);

		assert!(!by_name("real").is_symlink);
	}

	#[cfg(unix)]
	#[test]
	fn a_broken_symlink_is_listed_and_treated_as_escaping() {
		let dir = tempdir().unwrap();
		let root = dir.path();
		std::os::unix::fs::symlink(root.join("nope"), root.join("dangling")).unwrap();

		let listing = list_dir(root.to_str().unwrap(), Some(root.to_str().unwrap())).unwrap();
		let entry = &listing.entries[0];

		assert_eq!(entry.name, "dangling");
		assert!(entry.is_symlink);
		assert!(!entry.is_dir);
		assert!(entry.symlink_outside_root);
	}

	#[test]
	fn missing_path_is_not_found_and_a_file_is_invalid_input() {
		let dir = tempdir().unwrap();
		let missing = dir.path().join("nope");
		let file = dir.path().join("f.txt");
		File::create(&file).unwrap();

		assert!(matches!(
			list_dir(missing.to_str().unwrap(), None),
			Err(AppError::NotFound(_))
		));
		assert!(matches!(
			list_dir(file.to_str().unwrap(), None),
			Err(AppError::InvalidInput(_))
		));
	}

}
