//! Reading git state for the Changes tab and the tree's decorations
//! (specs/05-features.md F13, ADR-0009).
//!
//! Everything here is a **read**. Nothing stages, discards, checks out or
//! commits: the terminal beside the panel already does that better, and a write
//! path racing an agent mid-edit is how you lose work.
//!
//! Two performance rules earn their keep at a 3s poll, both taken from reading
//! VS Code's git extension:
//!
//! 1. **Cap the row set before computing line stats.** The status walk is
//!    cheap; `Patch::line_stats()` reads both sides of every changed file. VS
//!    Code keeps line counts off the status path entirely (a separate
//!    `--numstat` call); we keep one call and pay for it by ordering.
//! 2. **Untracked directories recurse** (their `-uall`), so three new files in
//!    a new directory are three rows. The cap, not the recursion setting, is
//!    what protects us from a stray `npm install` in an unignored tree.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

use git2::{Delta, Diff, DiffFlags, DiffOptions, Patch, Repository, Status, StatusOptions};

use crate::error::{AppError, AppResult};
use crate::models::{FileContents, GitChange, GitChangeKind, GitGroup, GitRev, GitStatus};
use crate::services::files;

/// Rows returned to the renderer. VS Code's equivalent limit is 10 000, which it
/// can afford because its list is virtualised. Ours would mount that many
/// buttons into WebKitGTK — the exact shape of the freeze that killed the JSONL
/// viewer (F3, `c6374d6`). 500 is chosen against our renderer, not against git.
pub const MAX_CHANGES: usize = 500;

/// Above this, a row keeps its place in the list but reports no line counts.
/// Diffing a 5MB minified bundle to print `+1 −1` is work nobody asked for.
pub const MAX_STAT_BYTES: u64 = 1024 * 1024;

/// Repository state for one project. See specs/03-backend-rust.md § `git`.
pub fn status(project_path: &str) -> AppResult<GitStatus> {
	status_capped(project_path, MAX_CHANGES)
}

/// `status` with an injectable cap — lets tests exercise truncation without
/// creating 500 files, the same trick `list_dir_capped` uses.
fn status_capped(project_path: &str, cap: usize) -> AppResult<GitStatus> {
	let Some(repo) = discover(project_path) else {
		return Ok(GitStatus {
			repo_root: None,
			branch: None,
			changes: Vec::new(),
			total: 0,
			truncated: false,
		});
	};
	// A bare repository has no working directory, so nothing here applies.
	let Some(workdir) = repo.workdir().map(Path::to_path_buf) else {
		return Ok(GitStatus {
			repo_root: None,
			branch: None,
			changes: Vec::new(),
			total: 0,
			truncated: false,
		});
	};

	let mut rows = collect_rows(&repo)?;
	let total = rows.len();

	// Sort before truncating so the cap keeps a deterministic prefix rather
	// than libgit2's iteration order — same rule as `list_dir`.
	rows.sort_by(|a, b| {
		group_order(a.group)
			.cmp(&group_order(b.group))
			.then_with(|| a.repo_rel.to_lowercase().cmp(&b.repo_rel.to_lowercase()))
			.then_with(|| a.repo_rel.cmp(&b.repo_rel))
	});
	let truncated = total > cap;
	rows.truncate(cap);

	// Only now, on the rows that survived, is it worth reading file contents.
	let stats = line_stats(&repo, &rows);

	let project_root = canonical(project_path);
	let changes = rows
		.into_iter()
		.map(|row| {
			let abs = workdir.join(&row.repo_rel);
			let stat = stats.get(&(row.group, row.repo_rel.clone()));
			GitChange {
				rel_path: relative_from(&project_root, &abs),
				path: abs.to_string_lossy().into_owned(),
				group: row.group,
				kind: row.kind,
				old_rel_path: row
					.old_repo_rel
					.as_ref()
					.map(|old| relative_from(&project_root, &workdir.join(old))),
				additions: stat.and_then(|s| s.additions),
				deletions: stat.and_then(|s| s.deletions),
				is_binary: stat.is_some_and(|s| s.is_binary),
			}
		})
		.collect();

	Ok(GitStatus {
		repo_root: Some(workdir.to_string_lossy().into_owned()),
		branch: branch_name(&repo),
		changes,
		total,
		truncated,
	})
}

/// One file at `head` or `index`. `Ok(None)` when the path doesn't exist at
/// that revision — an added file has no HEAD side and a deleted one has no
/// worktree side, and both are ordinary rows in the list, not errors (F13).
pub fn blob(path: &str, rev: GitRev, max_bytes: Option<usize>) -> AppResult<Option<FileContents>> {
	let Some(repo) = discover(path) else {
		return Ok(None);
	};
	let Some(workdir) = repo.workdir().map(Path::to_path_buf) else {
		return Ok(None);
	};
	let Ok(rel) = canonical(path).strip_prefix(&workdir).map(Path::to_path_buf) else {
		return Ok(None);
	};

	let oid = match rev {
		GitRev::Head => {
			// An empty repository has no HEAD to peel: everything is an addition.
			let Ok(tree) = repo.head().and_then(|head| head.peel_to_tree()) else {
				return Ok(None);
			};
			match tree.get_path(&rel) {
				Ok(entry) => entry.id(),
				Err(_) => return Ok(None),
			}
		}
		GitRev::Index => {
			let index = repo.index().map_err(git_err)?;
			// Stage 0 is the ordinary entry; a conflicted path has stages 1-3
			// and no stage 0, which reads as "not in the index" — correct, the
			// conflict view diffs HEAD against the worktree instead.
			match index.get_path(&rel, 0) {
				Some(entry) => entry.id,
				None => return Ok(None),
			}
		}
	};

	let blob = repo.find_blob(oid).map_err(git_err)?;
	let cap = max_bytes.unwrap_or(files::DEFAULT_MAX_BYTES);
	Ok(Some(files::contents_from_bytes(path, blob.content(), blob.size() as u64, cap)))
}

/// Answers "would git ignore this?" for the entries of one directory listing.
///
/// Held open across a whole `list_dir` call so the repository is discovered and
/// its ignore rules parsed **once**, not per entry. VS Code has to solve this
/// differently — a debounced, batched `check-ignore` per visible file — because
/// its explorer doesn't own the directory listing. Ours does.
pub struct IgnoreChecker {
	repo: Repository,
}

impl IgnoreChecker {
	/// `None` outside a repository, or when it can't be opened. An undecorated
	/// listing is still a correct listing.
	pub fn open(dir: &str) -> Option<Self> {
		discover(dir).map(|repo| Self { repo })
	}

	pub fn is_ignored(&self, path: &Path) -> bool {
		self.repo.is_path_ignored(path).unwrap_or(false)
	}
}

/// A change before it has been priced (no line counts yet) or made absolute.
struct RawRow {
	/// Path relative to the repository's working directory.
	repo_rel: String,
	old_repo_rel: Option<String>,
	group: GitGroup,
	kind: GitChangeKind,
}

#[derive(Default)]
struct LineStat {
	additions: Option<usize>,
	deletions: Option<usize>,
	is_binary: bool,
}

fn collect_rows(repo: &Repository) -> AppResult<Vec<RawRow>> {
	let mut opts = StatusOptions::new();
	opts.include_untracked(true)
		.recurse_untracked_dirs(true)
		.include_ignored(false)
		.include_unmodified(false)
		.renames_head_to_index(true)
		.renames_index_to_workdir(true);

	let statuses = repo.statuses(Some(&mut opts)).map_err(git_err)?;
	let mut rows = Vec::new();

	for entry in statuses.iter() {
		let flags = entry.status();

		// A conflicted path is one row in its own group; its index and worktree
		// bits describe the conflict, not two ordinary changes.
		if flags.contains(Status::CONFLICTED) {
			if let Ok(path) = entry.path() {
				rows.push(RawRow {
					repo_rel: path.to_string(),
					old_repo_rel: None,
					group: GitGroup::Conflicted,
					kind: GitChangeKind::Conflicted,
				});
			}
			continue;
		}

		// The same file can be staged AND further modified in the worktree, so
		// these are two independent `if`s, not an `else`.
		if let Some(kind) = staged_kind(flags) {
			let delta = entry.head_to_index();
			if let Some(repo_rel) = delta_path(delta.as_ref(), entry.path().ok()) {
				rows.push(RawRow {
					old_repo_rel: rename_source(delta.as_ref(), kind, &repo_rel),
					repo_rel,
					group: GitGroup::Staged,
					kind,
				});
			}
		}

		if let Some(kind) = unstaged_kind(flags) {
			let delta = entry.index_to_workdir();
			if let Some(repo_rel) = delta_path(delta.as_ref(), entry.path().ok()) {
				rows.push(RawRow {
					old_repo_rel: rename_source(delta.as_ref(), kind, &repo_rel),
					repo_rel,
					group: GitGroup::Unstaged,
					kind,
				});
			}
		}
	}

	Ok(rows)
}

fn staged_kind(flags: Status) -> Option<GitChangeKind> {
	if flags.contains(Status::INDEX_NEW) {
		Some(GitChangeKind::Added)
	} else if flags.contains(Status::INDEX_MODIFIED) {
		Some(GitChangeKind::Modified)
	} else if flags.contains(Status::INDEX_DELETED) {
		Some(GitChangeKind::Deleted)
	} else if flags.contains(Status::INDEX_RENAMED) {
		Some(GitChangeKind::Renamed)
	} else if flags.contains(Status::INDEX_TYPECHANGE) {
		Some(GitChangeKind::Typechange)
	} else {
		None
	}
}

fn unstaged_kind(flags: Status) -> Option<GitChangeKind> {
	if flags.contains(Status::WT_NEW) {
		Some(GitChangeKind::Untracked)
	} else if flags.contains(Status::WT_MODIFIED) {
		Some(GitChangeKind::Modified)
	} else if flags.contains(Status::WT_DELETED) {
		Some(GitChangeKind::Deleted)
	} else if flags.contains(Status::WT_RENAMED) {
		Some(GitChangeKind::Renamed)
	} else if flags.contains(Status::WT_TYPECHANGE) {
		Some(GitChangeKind::Typechange)
	} else {
		None
	}
}

/// The delta's new path, falling back to the status entry's own path (which is
/// what libgit2 reports when there is no delta to describe the change).
fn delta_path(delta: Option<&git2::DiffDelta<'_>>, fallback: Option<&str>) -> Option<String> {
	delta
		.and_then(|d| d.new_file().path().or_else(|| d.old_file().path()))
		.map(|p| p.to_string_lossy().into_owned())
		.or_else(|| fallback.map(str::to_string))
}

fn rename_source(
	delta: Option<&git2::DiffDelta<'_>>,
	kind: GitChangeKind,
	new_path: &str,
) -> Option<String> {
	if kind != GitChangeKind::Renamed {
		return None;
	}
	delta
		.and_then(|d| d.old_file().path())
		.map(|p| p.to_string_lossy().into_owned())
		.filter(|old| old != new_path)
}

/// Line counts for the rows that survived the cap.
///
/// Two diffs, one per group, each walked once: for every delta we ask whether a
/// surviving row wants it before generating the patch, because generating one
/// means reading both sides of the file.
fn line_stats(repo: &Repository, rows: &[RawRow]) -> HashMap<(GitGroup, String), LineStat> {
	let mut wanted: HashMap<(GitGroup, String), LineStat> = HashMap::new();
	for row in rows {
		// Conflicted rows carry no counts: "what changed" isn't a meaningful
		// question for a path with three stages and no agreed base.
		if row.group != GitGroup::Conflicted {
			wanted.insert((row.group, row.repo_rel.clone()), LineStat::default());
		}
	}
	if wanted.is_empty() {
		return wanted;
	}

	let mut opts = DiffOptions::new();
	opts.include_untracked(true)
		.recurse_untracked_dirs(true)
		.show_untracked_content(true)
		// We want counts, not context. Fewer lines to produce per hunk.
		.context_lines(0);

	let head_tree = repo.head().and_then(|head| head.peel_to_tree()).ok();
	if let Ok(diff) = repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts)) {
		fill_stats(&diff, GitGroup::Staged, &mut wanted);
	}
	if let Ok(diff) = repo.diff_index_to_workdir(None, Some(&mut opts)) {
		fill_stats(&diff, GitGroup::Unstaged, &mut wanted);
	}

	wanted
}

fn fill_stats(
	diff: &Diff<'_>,
	group: GitGroup,
	wanted: &mut HashMap<(GitGroup, String), LineStat>,
) {
	for (idx, delta) in diff.deltas().enumerate() {
		let Some(path) = delta
			.new_file()
			.path()
			.or_else(|| delta.old_file().path())
			.map(|p| p.to_string_lossy().into_owned())
		else {
			continue;
		};
		let key = (group, path);
		let Some(slot) = wanted.get_mut(&key) else {
			continue; // A delta for a row that didn't survive the cap.
		};

		if delta.status() == Delta::Unreadable {
			continue;
		}
		if delta.new_file().size().max(delta.old_file().size()) > MAX_STAT_BYTES {
			continue; // Row stays, counts don't.
		}

		match Patch::from_diff(diff, idx) {
			Ok(Some(patch)) => {
				// libgit2 decides binary-ness *while* producing the patch, so the
				// delta we iterated a moment ago is still unflagged — probed and
				// confirmed. Ask the patch's own delta, or a binary file silently
				// reports `+0 -0` instead of no counts at all.
				if patch.delta().flags().contains(DiffFlags::BINARY) {
					slot.is_binary = true;
				} else if let Ok((_context, additions, deletions)) = patch.line_stats() {
					slot.additions = Some(additions);
					slot.deletions = Some(deletions);
				}
			}
			// A delta libgit2 refuses to patch at all is binary by the same token.
			Ok(None) => slot.is_binary = true,
			Err(_) => {}
		}
	}
}

fn branch_name(repo: &Repository) -> Option<String> {
	let head = repo.head().ok()?;
	// Detached HEAD and an unborn branch both mean "no branch to name".
	if !head.is_branch() {
		return None;
	}
	head.shorthand().ok().map(str::to_string)
}

fn discover(path: &str) -> Option<Repository> {
	// The path may not exist (a deleted file we're asked for the HEAD side of),
	// in which case discovery walks up from the nearest parent that does.
	let start = Path::new(path);
	let start = if start.exists() { start.to_path_buf() } else { start.parent()?.to_path_buf() };
	Repository::discover(start).ok()
}

fn group_order(group: GitGroup) -> u8 {
	match group {
		GitGroup::Conflicted => 0,
		GitGroup::Staged => 1,
		GitGroup::Unstaged => 2,
	}
}

fn canonical(path: &str) -> PathBuf {
	std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path))
}

/// `target` expressed relative to `base`, with `../` for each level it escapes.
///
/// This is what puts `../packages/types/index.ts` in the list when the agent
/// edits a sibling package: the path is relative to the *project*, so a change
/// above it is visibly not yours (F13). Always `/`-separated — it's display
/// text, not a path we hand back to the filesystem.
fn relative_from(base: &Path, target: &Path) -> String {
	let base: Vec<Component<'_>> = base.components().collect();
	let target: Vec<Component<'_>> = target.components().collect();

	let shared = base.iter().zip(target.iter()).take_while(|(a, b)| a == b).count();

	let mut parts: Vec<String> =
		std::iter::repeat_n("..".to_string(), base.len() - shared).collect();
	parts.extend(target[shared..].iter().map(|c| c.as_os_str().to_string_lossy().into_owned()));

	if parts.is_empty() {
		// target == base. Only reachable if a directory is somehow a change row.
		return ".".to_string();
	}
	parts.join("/")
}

fn git_err(e: git2::Error) -> AppError {
	AppError::Io(format!("git: {}", e.message()))
}

#[cfg(test)]
mod tests {
	use super::*;
	use git2::{IndexAddOption, Oid, Signature};
	use std::fs;
	use tempfile::{tempdir, TempDir};

	/// A repository with one commit containing `tracked.txt`, so tests start
	/// from a HEAD rather than an empty repo.
	fn repo_with_commit() -> (TempDir, Repository) {
		let dir = tempdir().unwrap();
		let repo = Repository::init(dir.path()).unwrap();
		write(dir.path(), "tracked.txt", "one\ntwo\nthree\n");
		commit_all(&repo, "initial");
		(dir, repo)
	}

	fn write(root: &Path, rel: &str, contents: &str) {
		let path = root.join(rel);
		if let Some(parent) = path.parent() {
			fs::create_dir_all(parent).unwrap();
		}
		fs::write(path, contents).unwrap();
	}

	fn stage(repo: &Repository, rel: &str) {
		let mut index = repo.index().unwrap();
		index.add_path(Path::new(rel)).unwrap();
		index.write().unwrap();
	}

	fn commit_all(repo: &Repository, message: &str) -> Oid {
		let mut index = repo.index().unwrap();
		index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None).unwrap();
		index.write().unwrap();
		let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
		let sig = Signature::now("factorai tests", "tests@example.invalid").unwrap();
		let parents = repo
			.head()
			.ok()
			.and_then(|h| h.peel_to_commit().ok())
			.map(|c| vec![c])
			.unwrap_or_default();
		let parent_refs: Vec<&git2::Commit<'_>> = parents.iter().collect();
		repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs).unwrap()
	}

	fn root(dir: &TempDir) -> String {
		dir.path().to_str().unwrap().to_string()
	}

	fn find<'a>(st: &'a GitStatus, rel: &str, group: GitGroup) -> &'a GitChange {
		st.changes
			.iter()
			.find(|c| c.rel_path == rel && c.group == group)
			.unwrap_or_else(|| panic!("no {rel} in {group:?}; got {:?}", st.changes))
	}

	#[test]
	fn a_project_outside_any_repository_reports_no_repo_rather_than_erroring() {
		let dir = tempdir().unwrap();
		write(dir.path(), "a.txt", "hi");

		let st = status(&root(&dir)).unwrap();

		assert!(st.repo_root.is_none(), "not versioned is an answer, not a failure");
		assert!(st.changes.is_empty());
		assert!(!st.truncated);
	}

	#[test]
	fn an_untracked_file_is_one_unstaged_row_with_every_line_as_an_addition() {
		let (dir, _repo) = repo_with_commit();
		write(dir.path(), "new.txt", "a\nb\n");

		let st = status(&root(&dir)).unwrap();
		let row = find(&st, "new.txt", GitGroup::Unstaged);

		assert_eq!(row.kind, GitChangeKind::Untracked);
		assert_eq!(row.additions, Some(2));
		assert_eq!(row.deletions, Some(0));
		assert!(st.repo_root.is_some());
	}

	#[test]
	fn a_new_directory_of_untracked_files_is_one_row_per_file() {
		// The VS Code reading (`-uall`) settled this: an agent writing three
		// files into a new folder should produce three rows, not one for the
		// folder. The cap is what protects us, not collapsing directories.
		let (dir, _repo) = repo_with_commit();
		write(dir.path(), "fresh/a.rs", "1\n");
		write(dir.path(), "fresh/b.rs", "2\n");
		write(dir.path(), "fresh/nested/c.rs", "3\n");

		let st = status(&root(&dir)).unwrap();

		for rel in ["fresh/a.rs", "fresh/b.rs", "fresh/nested/c.rs"] {
			assert_eq!(find(&st, rel, GitGroup::Unstaged).kind, GitChangeKind::Untracked);
		}
	}

	#[test]
	fn a_worktree_edit_is_unstaged_and_counts_both_directions() {
		let (dir, _repo) = repo_with_commit();
		write(dir.path(), "tracked.txt", "one\nTWO\nthree\nfour\n");

		let st = status(&root(&dir)).unwrap();
		let row = find(&st, "tracked.txt", GitGroup::Unstaged);

		assert_eq!(row.kind, GitChangeKind::Modified);
		assert_eq!(row.additions, Some(2), "the changed line plus the new one");
		assert_eq!(row.deletions, Some(1));
	}

	#[test]
	fn a_partly_staged_file_appears_in_both_groups_with_its_own_counts() {
		// The reason we model the index at all (Q19). Stage one edit, then make
		// another: neither row alone describes the file.
		let (dir, repo) = repo_with_commit();
		write(dir.path(), "tracked.txt", "one\ntwo\nthree\nstaged\n");
		stage(&repo, "tracked.txt");
		write(dir.path(), "tracked.txt", "one\ntwo\nthree\nstaged\nunstaged\n");

		let st = status(&root(&dir)).unwrap();
		let staged = find(&st, "tracked.txt", GitGroup::Staged);
		let unstaged = find(&st, "tracked.txt", GitGroup::Unstaged);

		assert_eq!(staged.kind, GitChangeKind::Modified);
		assert_eq!(staged.additions, Some(1));
		assert_eq!(unstaged.kind, GitChangeKind::Modified);
		assert_eq!(unstaged.additions, Some(1));
	}

	#[test]
	fn a_staged_new_file_is_added_not_untracked() {
		let (dir, repo) = repo_with_commit();
		write(dir.path(), "added.txt", "x\n");
		stage(&repo, "added.txt");

		let st = status(&root(&dir)).unwrap();

		assert_eq!(find(&st, "added.txt", GitGroup::Staged).kind, GitChangeKind::Added);
	}

	#[test]
	fn a_deleted_file_is_reported_with_its_lines_as_deletions() {
		let (dir, _repo) = repo_with_commit();
		fs::remove_file(dir.path().join("tracked.txt")).unwrap();

		let st = status(&root(&dir)).unwrap();
		let row = find(&st, "tracked.txt", GitGroup::Unstaged);

		assert_eq!(row.kind, GitChangeKind::Deleted);
		assert_eq!(row.deletions, Some(3));
	}

	#[test]
	fn a_staged_rename_carries_the_old_path() {
		let (dir, repo) = repo_with_commit();
		fs::rename(dir.path().join("tracked.txt"), dir.path().join("renamed.txt")).unwrap();
		let mut index = repo.index().unwrap();
		index.remove_path(Path::new("tracked.txt")).unwrap();
		index.add_path(Path::new("renamed.txt")).unwrap();
		index.write().unwrap();

		let st = status(&root(&dir)).unwrap();
		let row = find(&st, "renamed.txt", GitGroup::Staged);

		assert_eq!(row.kind, GitChangeKind::Renamed);
		assert_eq!(row.old_rel_path.as_deref(), Some("tracked.txt"));
	}

	#[test]
	fn a_binary_file_keeps_its_row_but_reports_no_counts() {
		let (dir, _repo) = repo_with_commit();
		fs::write(dir.path().join("blob.bin"), [0u8, 1, 2, 3, 0, 9]).unwrap();

		let st = status(&root(&dir)).unwrap();
		let row = find(&st, "blob.bin", GitGroup::Unstaged);

		assert!(row.is_binary);
		assert_eq!(row.additions, None);
		assert_eq!(row.deletions, None);
	}

	#[test]
	fn changes_above_the_project_are_listed_relative_to_it() {
		// A project that is a subdirectory of a monorepo sees its siblings'
		// changes, prefixed with `../` so they are visibly not its own (F13).
		let (dir, _repo) = repo_with_commit();
		write(dir.path(), "apps/desktop/keep.txt", "x\n");
		write(dir.path(), "packages/types/index.ts", "y\n");

		let project = dir.path().join("apps/desktop");
		let st = status(project.to_str().unwrap()).unwrap();

		let sibling = find(&st, "../../packages/types/index.ts", GitGroup::Unstaged);
		assert_eq!(sibling.kind, GitChangeKind::Untracked);
		assert!(sibling.path.ends_with("packages/types/index.ts"), "abs path stays absolute");
		// Its own file is not prefixed.
		find(&st, "keep.txt", GitGroup::Unstaged);
	}

	#[test]
	fn the_row_cap_truncates_deterministically_and_reports_the_true_total() {
		let (dir, _repo) = repo_with_commit();
		for i in 0..6 {
			write(dir.path(), &format!("f{i:02}.txt"), "x\n");
		}

		let st = status_capped(&root(&dir), 3).unwrap();

		assert!(st.truncated);
		assert_eq!(st.total, 6);
		assert_eq!(st.changes.len(), 3);
		let names: Vec<&str> = st.changes.iter().map(|c| c.rel_path.as_str()).collect();
		assert_eq!(names, vec!["f00.txt", "f01.txt", "f02.txt"], "sorted, then cut");
	}

	#[test]
	fn rows_cut_by_the_cap_cost_nothing_to_price() {
		// The ordering that makes a 3s poll affordable: stats are computed for
		// surviving rows only. Asserted through the seam rather than by timing —
		// a dropped row has no entry in the stats map, so it can't have been
		// patched.
		let (dir, _repo) = repo_with_commit();
		for i in 0..4 {
			write(dir.path(), &format!("f{i:02}.txt"), "x\n");
		}
		let repo = Repository::discover(dir.path()).unwrap();

		let mut rows = collect_rows(&repo).unwrap();
		rows.sort_by(|a, b| a.repo_rel.cmp(&b.repo_rel));
		rows.truncate(2);
		let stats = line_stats(&repo, &rows);

		assert_eq!(stats.len(), 2);
		assert!(stats.contains_key(&(GitGroup::Unstaged, "f00.txt".to_string())));
		assert!(!stats.contains_key(&(GitGroup::Unstaged, "f03.txt".to_string())));
	}

	#[test]
	fn an_empty_repository_reports_staged_files_without_a_head() {
		let dir = tempdir().unwrap();
		let repo = Repository::init(dir.path()).unwrap();
		write(dir.path(), "first.txt", "a\n");
		stage(&repo, "first.txt");

		let st = status(&root(&dir)).unwrap();

		assert_eq!(find(&st, "first.txt", GitGroup::Staged).kind, GitChangeKind::Added);
		assert!(st.branch.is_none(), "an unborn branch has no name to show");
	}

	#[test]
	fn a_conflicted_path_gets_its_own_group_and_no_counts() {
		let (dir, repo) = repo_with_commit();
		let base = repo.head().unwrap().peel_to_commit().unwrap();

		// Branch off, change the file, commit.
		repo.branch("other", &base, false).unwrap();
		write(dir.path(), "tracked.txt", "one\nOTHER\nthree\n");
		commit_all(&repo, "theirs");
		let theirs = repo.head().unwrap().peel_to_commit().unwrap();

		// Back to the base, change the same line differently.
		repo.reset(base.as_object(), git2::ResetType::Hard, None).unwrap();
		write(dir.path(), "tracked.txt", "one\nMINE\nthree\n");
		commit_all(&repo, "mine");

		let annotated = repo.find_annotated_commit(theirs.id()).unwrap();
		repo.merge(&[&annotated], None, None).unwrap();

		let st = status(&root(&dir)).unwrap();
		let row = find(&st, "tracked.txt", GitGroup::Conflicted);

		assert_eq!(row.kind, GitChangeKind::Conflicted);
		assert_eq!(row.additions, None, "no agreed base means no meaningful count");
	}

	#[test]
	fn blobs_read_from_head_and_index_and_are_absent_where_the_file_is_not() {
		let (dir, repo) = repo_with_commit();
		let path = dir.path().join("tracked.txt");
		let path_str = path.to_str().unwrap();

		// Stage a change: HEAD and index now differ, and the worktree differs again.
		write(dir.path(), "tracked.txt", "one\ntwo\nSTAGED\n");
		stage(&repo, "tracked.txt");
		write(dir.path(), "tracked.txt", "one\ntwo\nWORKTREE\n");

		let head = blob(path_str, GitRev::Head, None).unwrap().unwrap();
		let index = blob(path_str, GitRev::Index, None).unwrap().unwrap();

		assert_eq!(head.contents, "one\ntwo\nthree\n");
		assert_eq!(index.contents, "one\ntwo\nSTAGED\n");
		assert_eq!(head.line_count, 3);
		assert!(!head.is_binary);

		// A file that never existed at HEAD: absent, not an error.
		write(dir.path(), "brand-new.txt", "x\n");
		let missing = blob(dir.path().join("brand-new.txt").to_str().unwrap(), GitRev::Head, None);
		assert!(matches!(missing, Ok(None)));
	}

	#[test]
	fn blobs_outside_a_repository_are_absent_rather_than_an_error() {
		let dir = tempdir().unwrap();
		write(dir.path(), "loose.txt", "x\n");

		let got = blob(dir.path().join("loose.txt").to_str().unwrap(), GitRev::Head, None);

		assert!(matches!(got, Ok(None)));
	}

	#[test]
	fn the_ignore_checker_matches_gitignore_and_is_inert_outside_a_repo() {
		let (dir, _repo) = repo_with_commit();
		write(dir.path(), ".gitignore", "node_modules/\n*.log\n");
		fs::create_dir_all(dir.path().join("node_modules")).unwrap();
		write(dir.path(), "debug.log", "x");

		let checker = IgnoreChecker::open(dir.path().to_str().unwrap()).unwrap();

		assert!(checker.is_ignored(&dir.path().join("node_modules")));
		assert!(checker.is_ignored(&dir.path().join("debug.log")));
		assert!(!checker.is_ignored(&dir.path().join("tracked.txt")));

		let plain = tempdir().unwrap();
		assert!(IgnoreChecker::open(plain.path().to_str().unwrap()).is_none());
	}

	#[test]
	fn relative_paths_escape_upwards_and_stay_slash_separated() {
		let base = Path::new("/repo/apps/desktop");

		assert_eq!(relative_from(base, Path::new("/repo/apps/desktop/src/a.ts")), "src/a.ts");
		assert_eq!(
			relative_from(base, Path::new("/repo/packages/types/i.ts")),
			"../../packages/types/i.ts"
		);
		assert_eq!(relative_from(base, Path::new("/repo")), "../..");
		assert_eq!(relative_from(base, base), ".");
	}
}
