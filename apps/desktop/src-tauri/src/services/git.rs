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
use std::sync::LazyLock;
use std::time::Instant;

use git2::{
	BranchType, Delta, Diff, DiffFindOptions, DiffFlags, DiffOptions, Oid, Patch, Repository, Sort,
	Status, StatusOptions, Tree, WorktreeLockStatus,
};

use crate::error::{AppError, AppResult};
use crate::models::{
	FileContents, GitChange, GitChangeKind, GitCommitDetail, GitCommitFile, GitGraph,
	GitGraphCommit, GitGraphEdge, GitGraphEdgeKind, GitGroup, GitRef, GitRefKind, GitRev,
	GitStatus, GitWorktree, RemoteHost,
};
use crate::services::files;
use parking_lot::Mutex;
use tracing::debug;

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
			head: None,
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
			head: None,
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
		head: head_sha(&repo),
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

// ── The graph (F18) ────────────────────────────────────────────────────────

/// Commits per page. The renderer mounts these as plain DOM rows rather than
/// virtualising, so this is chosen against our renderer like `MAX_CHANGES` is.
pub const GRAPH_PAGE: usize = 300;

/// Ceiling on what a caller may ask for in one page, so a hand-edited call can't
/// turn a 3-lane rail into a 200 000-row payload.
pub const MAX_GRAPH_PAGE: usize = 1000;

/// Pages already walked, per checkout, valid while the refs they were walked
/// against are unchanged (ADR-0035).
///
/// Keyed on the gitdir rather than the project folder: two linked worktrees have
/// distinct gitdirs and distinct `HEAD`s, so each keeps its own entry, while two
/// project folders inside one checkout share one. A whole entry is dropped the
/// moment its digest stops matching — a page walked against yesterday's refs is
/// never spliced onto one walked against today's, which is the same rule the
/// renderer applies across pages.
static GRAPH_CACHE: LazyLock<Mutex<HashMap<PathBuf, CachedGraph>>> =
	LazyLock::new(|| Mutex::new(HashMap::new()));

/// Enough for the first page plus a deep "Load more" run. Past this the entry is
/// cleared rather than evicted page by page; a reader that far down is rare and
/// a re-walk is the cost they already paid once.
const GRAPH_CACHE_PAGES: usize = 16;

struct CachedGraph {
	digest: String,
	pages: HashMap<(usize, usize), GitGraph>,
}

/// One page of the commit graph, laid out. See specs/05-features.md F18.
///
/// **Paging is an offset with a full re-walk.** Every call walks from the same
/// pushed refs and recomputes lanes over the whole prefix, returning only the
/// requested window. That is deterministic for a given set of refs, so page 4's
/// lanes cannot disagree with page 1's — the alternative, threading the open-lane
/// frontier through an opaque cursor, buys a few microseconds of libgit2 in
/// exchange for lane instability that is visible and permanent.
///
/// **The re-walk is paid once per set of refs, not once per call.** With
/// `TOPOLOGICAL` in the sort libgit2 traverses everything reachable before it
/// yields the first row, so the first page of a 200 000-commit repository costs
/// the whole history — every 30s poll, every switch back to the tab. Commits are
/// immutable and the refs digest already names exactly what the walk depends
/// on, so a page is served from `GRAPH_CACHE` while that digest holds. What a
/// call always pays is `collect_refs`, which is also what tells it whether the
/// cache is still true.
pub fn graph(project_path: &str, offset: usize, limit: usize) -> AppResult<GitGraph> {
	let started = Instant::now();
	let Some(repo) = discover(project_path) else {
		return Ok(empty_graph());
	};
	// A bare repository has no working directory, and the panel is bound to a
	// project folder — same call `status` makes, for the same reason.
	let Some(workdir) = repo.workdir().map(Path::to_path_buf) else {
		return Ok(empty_graph());
	};

	let refs = collect_refs(&repo);
	let refs_ms = started.elapsed().as_millis();
	let limit = limit.clamp(1, MAX_GRAPH_PAGE);
	let gitdir = repo.path().to_path_buf();

	{
		let cache = GRAPH_CACHE.lock();
		if let Some(hit) = cache
			.get(&gitdir)
			.filter(|entry| entry.digest == refs.digest)
			.and_then(|entry| entry.pages.get(&(offset, limit)))
		{
			debug!(
				project = project_path,
				offset,
				limit,
				refs_ms,
				total_ms = started.elapsed().as_millis(),
				"git_graph: page served from cache"
			);
			let mut page = hit.clone();
			// A config read, cheap, and the one field a cached page carries that
			// the digest does not cover.
			page.remote_host = remote_host(&repo);
			return Ok(page);
		}
	}

	let walked_at = Instant::now();
	let mut walk = repo.revwalk().map_err(git_err)?;
	// TOPOLOGICAL keeps a branch's commits contiguous instead of interleaving them
	// by date; TIME orders the branches themselves the way you'd expect to read
	// them. Neither alone gives a legible rail.
	walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME).map_err(git_err)?;
	for oid in &refs.tips {
		// A ref pointing at an object the walk refuses is skipped, not fatal: one
		// broken tag should not blank the graph.
		let _ = walk.push(*oid);
	}

	let mut lanes = Lanes::default();
	let mut commits = Vec::new();
	let mut walked = 0usize;
	let mut has_more = false;

	for oid in walk {
		let Ok(oid) = oid else { continue };
		let Ok(commit) = repo.find_commit(oid) else { continue };
		let parents: Vec<Oid> = commit.parent_ids().collect();

		// Placed for every commit in the prefix, including the ones we skip —
		// that is what makes the returned window's lanes correct.
		let (lane, edges) = lanes.place(oid, &parents);

		let index = walked;
		walked += 1;
		if index < offset {
			continue;
		}
		if commits.len() >= limit {
			has_more = true;
			break;
		}

		let author = commit.author();
		commits.push(GitGraphCommit {
			sha: oid.to_string(),
			short_sha: short_sha(oid),
			subject: subject_of(&commit),
			author_name: author.name().unwrap_or("unknown").to_string(),
			author_email: normalise_email(author.email().unwrap_or_default()),
			author_time: ms(author.when().seconds()),
			commit_time: ms(commit.time().seconds()),
			parents: parents.iter().map(|parent| parent.to_string()).collect(),
			refs: refs.by_oid.get(&oid).cloned().unwrap_or_default(),
			lane,
			edges,
		});
	}

	let page = GitGraph {
		repo_root: Some(workdir.to_string_lossy().into_owned()),
		commits,
		lane_count: lanes.width(),
		refs_digest: refs.digest.clone(),
		has_more,
		remote_host: remote_host(&repo),
	};
	debug!(
		project = project_path,
		offset,
		limit,
		refs = refs.tips.len(),
		walked,
		refs_ms,
		walk_ms = walked_at.elapsed().as_millis(),
		total_ms = started.elapsed().as_millis(),
		"git_graph: page walked"
	);

	let mut cache = GRAPH_CACHE.lock();
	let entry = cache
		.entry(gitdir)
		.or_insert_with(|| CachedGraph { digest: refs.digest.clone(), pages: HashMap::new() });
	if entry.digest != refs.digest || entry.pages.len() >= GRAPH_CACHE_PAGES {
		entry.digest = refs.digest;
		entry.pages.clear();
	}
	entry.pages.insert((offset, limit), page.clone());
	Ok(page)
}

/// An author email as an identity key: trimmed and lower-cased, because
/// `Ada@Example.com` and `ada@example.com` are one person and the renderer
/// derives one avatar per distinct value.
fn normalise_email(email: &str) -> String {
	email.trim().to_lowercase()
}

/// Which forge `origin` points at, from its configured URL.
///
/// A **config read**, not a network one — ADR-0009's read-only clause is intact
/// and `git2` still has no transport linked in. Falls back to the first remote
/// when there is no `origin`, since a clone renamed to `upstream` is still a
/// clone of something.
fn remote_host(repo: &Repository) -> RemoteHost {
	/// `Remote::url()` is a `Result` in git2 0.21, and a remote can exist with no
	/// URL at all, so both have to collapse to "nothing to go on".
	fn url_of(repo: &Repository, name: &str) -> Option<String> {
		let remote = repo.find_remote(name).ok()?;
		remote.url().ok().map(str::to_lowercase)
	}

	// `origin` first; otherwise the first remote that has a URL, since a clone
	// whose remote was renamed to `upstream` is still a clone of something.
	let mut url = url_of(repo, "origin");
	if url.is_none() {
		if let Ok(names) = repo.remotes() {
			// `StringArray::iter()` yields `Result<Option<&str>>`: an entry can fail
			// to decode, and a decoded entry can still be absent.
			for name in names.iter() {
				let Ok(Some(name)) = name else { continue };
				if let Some(found) = url_of(repo, name) {
					url = Some(found);
					break;
				}
			}
		}
	}

	match url.as_deref() {
		// Substring rather than host parsing: both `git@github.com:o/r.git` and
		// `https://github.com/o/r` have to match, and they are not the same URL
		// grammar. This only ever picks an icon, so a false positive is cosmetic.
		Some(url) if url.contains("github.com") => RemoteHost::GitHub,
		Some(url) if url.contains("gitlab") => RemoteHost::GitLab,
		_ => RemoteHost::Other,
	}
}

/// Everything the detail pane shows for one commit, or `None` if the SHA doesn't
/// resolve — a row clicked after a force-push is stale, not an error.
///
/// A merge's files are the diff against its **first parent**, which is precisely
/// "what did this merge bring in from the other branch". `diff_parent` names the
/// one used so the UI can label it rather than re-deriving the convention.
pub fn commit_detail(project_path: &str, sha: &str) -> AppResult<Option<GitCommitDetail>> {
	commit_detail_capped(project_path, sha, MAX_CHANGES)
}

fn commit_detail_capped(
	project_path: &str,
	sha: &str,
	cap: usize,
) -> AppResult<Option<GitCommitDetail>> {
	let Some(repo) = discover(project_path) else {
		return Ok(None);
	};
	let Some(workdir) = repo.workdir().map(Path::to_path_buf) else {
		return Ok(None);
	};
	// `revparse_single` rather than `Oid::from_str` so a short SHA works too.
	let Ok(commit) = repo.revparse_single(sha).and_then(|obj| obj.peel_to_commit()) else {
		return Ok(None);
	};

	let tree = commit.tree().map_err(git_err)?;
	let first_parent = commit.parents().next();
	// A root commit diffs against no tree at all, which libgit2 reads as the empty
	// tree — so every file is an addition, which is what a root commit is.
	let parent_tree = match first_parent.as_ref() {
		Some(parent) => Some(parent.tree().map_err(git_err)?),
		None => None,
	};

	let (files, total, truncated) =
		commit_files(&repo, parent_tree.as_ref(), &tree, project_path, &workdir, cap);

	let author = commit.author();
	let committer = commit.committer();
	Ok(Some(GitCommitDetail {
		sha: commit.id().to_string(),
		short_sha: short_sha(commit.id()),
		subject: subject_of(&commit),
		// `body()` is everything after the subject paragraph, which is why the
		// body can't be found by splitting the message on its first newline:
		// `summary()` collapses a wrapped first paragraph into one line.
		body: commit.body().ok().flatten().unwrap_or_default().trim().to_string(),
		author_name: author.name().unwrap_or("unknown").to_string(),
		author_email: author.email().unwrap_or_default().to_string(),
		author_time: ms(author.when().seconds()),
		committer_name: committer.name().unwrap_or("unknown").to_string(),
		commit_time: ms(commit.time().seconds()),
		parents: commit.parent_ids().map(|parent| parent.to_string()).collect(),
		diff_parent: first_parent.map(|p| p.id().to_string()),
		files,
		total,
		truncated,
	}))
}

/// One file's contents at an arbitrary commit — the left side of a commit's diff.
///
/// **A third command rather than widening `GitRev`.** That enum is a two-value
/// string union the viewer's plumbing already depends on, and turning it into a
/// string-or-object union to carry a SHA would churn every existing call site and
/// both halves of a hand-mirrored type to serve one new caller.
pub fn blob_at(
	path: &str,
	commit: &str,
	max_bytes: Option<usize>,
) -> AppResult<Option<FileContents>> {
	let Some(repo) = discover(path) else {
		return Ok(None);
	};
	let Some(workdir) = repo.workdir().map(Path::to_path_buf) else {
		return Ok(None);
	};
	let Ok(rel) = canonical(path).strip_prefix(&workdir).map(Path::to_path_buf) else {
		return Ok(None);
	};
	let Ok(commit) = repo.revparse_single(commit).and_then(|obj| obj.peel_to_commit()) else {
		return Ok(None);
	};

	let Ok(tree) = commit.tree() else {
		return Ok(None);
	};
	// Absent at this commit is an answer, not an error — the same rule `blob`
	// follows for a file that was added.
	let Ok(entry) = tree.get_path(&rel) else {
		return Ok(None);
	};
	let blob = repo.find_blob(entry.id()).map_err(git_err)?;
	let cap = max_bytes.unwrap_or(files::DEFAULT_MAX_BYTES);
	Ok(Some(files::contents_from_bytes(path, blob.content(), blob.size() as u64, cap)))
}

/// Lane assignment: the layout that turns a DAG into legible rails.
///
/// Walking newest-first, each lane holds the commit it is *waiting to reach*.
/// When that commit is emitted the lane arrives, and its first parent continues
/// in the same lane while any further parent takes a lane of its own. A lane whose
/// commit has arrived and which nothing continues is freed, and freed lanes are
/// reused left-first — so lane indices, and therefore colours, get recycled by
/// unrelated branches rather than marching rightwards forever.
///
/// The one invariant the renderer depends on: **a lane that merely passes through
/// a row never changes index**, because allocation only ever takes a free slot.
/// That is what lets a pass-through be drawn as a straight line.
#[derive(Default)]
struct Lanes {
	/// Per lane, the commit that lane is waiting to reach; `None` when free.
	pending: Vec<Option<Oid>>,
}

impl Lanes {
	/// Lanes ever live. Monotonic, so a page's pitch only widens as you load
	/// more and the rows above never reflow.
	fn width(&self) -> usize {
		self.pending.len()
	}

	fn place(&mut self, oid: Oid, parents: &[Oid]) -> (usize, Vec<GitGraphEdge>) {
		// More than one lane can be waiting for the same commit: in a newest-first
		// walk that means several already-emitted commits share this parent, i.e.
		// this row is where their branches forked.
		let waiting: Vec<usize> = self
			.pending
			.iter()
			.enumerate()
			.filter(|(_, slot)| **slot == Some(oid))
			.map(|(lane, _)| lane)
			.collect();

		let mut edges = Vec::new();
		for (lane, slot) in self.pending.iter().enumerate() {
			if slot.is_some() && !waiting.contains(&lane) {
				edges.push(GitGraphEdge {
					from_lane: lane,
					to_lane: lane,
					lane,
					kind: GitGraphEdgeKind::Through,
				});
			}
		}

		// The leftmost waiting lane is this commit's own; a commit nothing waits
		// for is a tip and starts a lane.
		let lane = match waiting.first() {
			Some(&leftmost) => leftmost,
			None => self.alloc(),
		};
		for &from in &waiting {
			// The converging branch keeps *its* colour into the node, which is what
			// makes it traceable back up the rail.
			edges.push(GitGraphEdge {
				from_lane: from,
				to_lane: lane,
				lane: from,
				kind: GitGraphEdgeKind::Incoming,
			});
			self.pending[from] = None;
		}

		for (n, parent) in parents.iter().enumerate() {
			let to = if n == 0 {
				// The first parent continues this lane, even if another lane is
				// already waiting for the same commit — those two converge further
				// down, and keeping them separate until then is what draws the fork.
				self.pending[lane] = Some(*parent);
				lane
			} else if let Some(existing) =
				self.pending.iter().position(|slot| *slot == Some(*parent))
			{
				existing
			} else {
				let fresh = self.alloc();
				self.pending[fresh] = Some(*parent);
				fresh
			};
			edges.push(GitGraphEdge {
				from_lane: lane,
				to_lane: to,
				lane: to,
				kind: GitGraphEdgeKind::Outgoing,
			});
		}

		(lane, edges)
	}

	fn alloc(&mut self) -> usize {
		match self.pending.iter().position(Option::is_none) {
			Some(free) => free,
			None => {
				self.pending.push(None);
				self.pending.len() - 1
			}
		}
	}
}

/// Refs grouped by the commit they point at, plus what to push into the walk.
struct RefTable {
	by_oid: HashMap<Oid, Vec<GitRef>>,
	tips: Vec<Oid>,
	digest: String,
}

fn collect_refs(repo: &Repository) -> RefTable {
	let mut by_oid: HashMap<Oid, Vec<GitRef>> = HashMap::new();
	let mut tips = Vec::new();
	let mut parts: Vec<String> = Vec::new();

	let head = repo.head().ok();
	let head_branch = head
		.as_ref()
		.filter(|h| h.is_branch())
		.and_then(|h| h.shorthand().ok())
		.map(str::to_string);

	if let Ok(references) = repo.references() {
		for reference in references.flatten() {
			let Ok(full) = reference.name() else { continue };
			// Peels an annotated tag through its tag object to the commit.
			let Ok(commit) = reference.peel_to_commit() else { continue };
			let oid = commit.id();

			let (kind, name) = if let Some(rest) = full.strip_prefix("refs/heads/") {
				(GitRefKind::LocalBranch, rest.to_string())
			} else if let Some(rest) = full.strip_prefix("refs/remotes/") {
				// `origin/HEAD` is a symbolic ref duplicating a ref we already
				// return, and the commonest cause of a row overflowing its chips.
				// Dropped here rather than in the UI so every consumer is spared
				// knowing to ignore it.
				if rest.rsplit('/').next() == Some("HEAD") {
					continue;
				}
				(GitRefKind::RemoteBranch, rest.to_string())
			} else if let Some(rest) = full.strip_prefix("refs/tags/") {
				(GitRefKind::Tag, rest.to_string())
			} else {
				continue; // notes, stash, replace — not part of the picture.
			};

			tips.push(oid);
			let is_head =
				kind == GitRefKind::LocalBranch && head_branch.as_deref() == Some(name.as_str());
			let upstream_in_sync = match kind {
				GitRefKind::LocalBranch => upstream_in_sync(repo, &name, oid),
				_ => None,
			};
			// The digest names everything a page depends on, because a cached
			// page lives exactly as long as it holds (ADR-0035). The oid alone
			// missed two moves that leave every ref in place: which branch `HEAD`
			// is on, and which upstream a branch tracks — both change a chip.
			parts.push(format!(
				"{full}:{oid}:{}:{}",
				is_head,
				upstream_in_sync.as_deref().unwrap_or("")
			));
			by_oid.entry(oid).or_default().push(GitRef { name, kind, is_head, upstream_in_sync });
		}
	}

	// A detached HEAD gets a chip of its own, since there is no branch to fold it
	// into. An unborn HEAD peels to nothing and contributes neither.
	if head_branch.is_none() {
		if let Some(oid) = head.as_ref().and_then(|h| h.peel_to_commit().ok()).map(|c| c.id()) {
			parts.push(format!("HEAD:{oid}"));
			tips.push(oid);
			by_oid.entry(oid).or_default().push(GitRef {
				name: "HEAD".to_string(),
				kind: GitRefKind::Head,
				is_head: true,
				upstream_in_sync: None,
			});
		}
	}

	// Ordered here, not in the renderer, so the `+N` cut is deterministic and the
	// same on every poll: HEAD's branch, then locals, remotes, tags.
	for refs in by_oid.values_mut() {
		refs.sort_by(|a, b| {
			b.is_head
				.cmp(&a.is_head)
				.then_with(|| ref_order(a.kind).cmp(&ref_order(b.kind)))
				.then_with(|| a.name.cmp(&b.name))
		});
	}

	RefTable { by_oid, tips, digest: digest_of(parts) }
}

fn ref_order(kind: GitRefKind) -> u8 {
	match kind {
		GitRefKind::Head => 0,
		GitRefKind::LocalBranch => 1,
		GitRefKind::RemoteBranch => 2,
		GitRefKind::Tag => 3,
	}
}

/// The short name of this branch's upstream when it sits on the same commit, so
/// the renderer can collapse `main` + `origin/main` into one `main ≡origin` chip.
fn upstream_in_sync(repo: &Repository, branch: &str, oid: Oid) -> Option<String> {
	let local = repo.find_branch(branch, BranchType::Local).ok()?;
	let upstream = local.upstream().ok()?;
	if upstream.get().peel_to_commit().ok()?.id() != oid {
		return None;
	}
	upstream.name().ok()?.map(str::to_string)
}

/// A cheap fingerprint of the refs a page was walked against. Sorted first so it
/// doesn't depend on libgit2's iteration order.
fn digest_of(mut parts: Vec<String>) -> String {
	use std::hash::{Hash, Hasher};
	parts.sort();
	let mut hasher = std::collections::hash_map::DefaultHasher::new();
	for part in &parts {
		part.hash(&mut hasher);
	}
	format!("{:016x}", hasher.finish())
}

/// The files one commit touched, priced the same way `status` prices its rows:
/// cap first, compute line stats only on what survived.
fn commit_files(
	repo: &Repository,
	parent_tree: Option<&Tree<'_>>,
	tree: &Tree<'_>,
	project_path: &str,
	workdir: &Path,
	cap: usize,
) -> (Vec<GitCommitFile>, usize, bool) {
	let mut opts = DiffOptions::new();
	opts.context_lines(0);
	let Ok(mut diff) = repo.diff_tree_to_tree(parent_tree, Some(tree), Some(&mut opts)) else {
		return (Vec::new(), 0, false);
	};
	// Renames are structural information, not something to infer from the paths.
	let _ = diff.find_similar(Some(DiffFindOptions::new().renames(true)));

	let total = diff.deltas().len();
	let truncated = total > cap;
	let project_root = canonical(project_path);

	let mut out = Vec::new();
	for (idx, delta) in diff.deltas().enumerate().take(cap) {
		let Some(new_path) = delta.new_file().path().or_else(|| delta.old_file().path()) else {
			continue;
		};
		let abs = workdir.join(new_path);
		let kind = delta_kind(delta.status());
		let old_rel_path = if kind == GitChangeKind::Renamed {
			delta
				.old_file()
				.path()
				.map(|old| relative_from(&project_root, &workdir.join(old)))
				.filter(|old| old != &relative_from(&project_root, &abs))
		} else {
			None
		};

		let mut stat = LineStat::default();
		if delta.new_file().size().max(delta.old_file().size()) <= MAX_STAT_BYTES {
			match Patch::from_diff(&diff, idx) {
				Ok(Some(patch)) => {
					// libgit2 only flags binary-ness while producing the patch, so
					// the patch's own delta is the one to ask — the delta we
					// iterated is still unprobed.
					if patch.delta().flags().contains(DiffFlags::BINARY) {
						stat.is_binary = true;
					} else if let Ok((_context, additions, deletions)) = patch.line_stats() {
						stat.additions = Some(additions);
						stat.deletions = Some(deletions);
					}
				}
				Ok(None) => stat.is_binary = true,
				Err(_) => {}
			}
		}

		out.push(GitCommitFile {
			rel_path: relative_from(&project_root, &abs),
			path: abs.to_string_lossy().into_owned(),
			kind,
			old_rel_path,
			additions: stat.additions,
			deletions: stat.deletions,
			is_binary: stat.is_binary,
		});
	}

	(out, total, truncated)
}

fn delta_kind(status: Delta) -> GitChangeKind {
	match status {
		Delta::Added => GitChangeKind::Added,
		Delta::Deleted => GitChangeKind::Deleted,
		Delta::Renamed => GitChangeKind::Renamed,
		Delta::Typechange => GitChangeKind::Typechange,
		// A copy is new content at a new path, which is what "added" means here;
		// nothing in the UI distinguishes the two and inventing a kind for it
		// would mean a TS union member with no rendering.
		Delta::Copied => GitChangeKind::Added,
		_ => GitChangeKind::Modified,
	}
}

fn empty_graph() -> GitGraph {
	GitGraph {
		repo_root: None,
		commits: Vec::new(),
		lane_count: 0,
		refs_digest: String::new(),
		remote_host: RemoteHost::Other,
		has_more: false,
	}
}

/// Seven characters, git's own default for `--abbrev-commit` in a small repo. The
/// renderer never abbreviates itself, so this is the one place the length lives.
fn short_sha(oid: Oid) -> String {
	let full = oid.to_string();
	full.chars().take(7).collect()
}

/// Git counts seconds; every other timestamp we hand the renderer is epoch
/// milliseconds (`DirEntry::modified_at`), so the conversion belongs here rather
/// than in three places on the TS side.
fn ms(seconds: i64) -> i64 {
	seconds.saturating_mul(1000)
}

/// The message's first paragraph, collapsed to one line by libgit2. Absent for a
/// commit with an empty message, which is legal and reads as a blank row rather
/// than an error.
fn subject_of(commit: &git2::Commit<'_>) -> String {
	commit.summary().ok().flatten().unwrap_or_default().to_string()
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

/// Every checkout of the repository a project sits in — the main working tree
/// and every linked worktree (F21, ADR-0019 § 1).
///
/// **Keyed by the repository, not by the project.** Discovery is the same
/// `Repository::discover()` from the project root that `status` uses, and the set
/// is then read off whatever repository that finds — so a project that *is* a
/// linked worktree returns the same set as one that is the main checkout. It is
/// the same repository whichever door you came in by.
///
/// **This is also the IDE bridge's path scope** (ADR-0019 § 2), which is why it
/// is derived here from git and never from anything a client sent. Not a
/// repository at all, or a repository with no checkouts, returns an empty vector
/// — and an empty scope refuses everything, which is the correct direction to
/// fail in.
pub fn worktrees(project_path: &str) -> AppResult<Vec<GitWorktree>> {
	let Some(repo) = discover(project_path) else {
		return Ok(Vec::new());
	};
	Ok(worktrees_of(&repo))
}

/// The paths in [`worktrees`], for callers that only need the scope.
///
/// Separate because the bridge asks this per path it resolves and has no use for
/// branches, locks or SHAs — each of which costs a `Repository::open` of the
/// checkout. A checkout that is not on disk is dropped here rather than
/// reported: the caller is about to compare a real path against these, and a
/// directory that does not exist cannot contain one.
pub fn worktree_paths(project_path: &str) -> Vec<PathBuf> {
	let Some(repo) = discover(project_path) else {
		return Vec::new();
	};
	main_worktree_path(&repo)
		.into_iter()
		.chain(linked_worktree_paths(&repo))
		.filter(|p| p.is_dir())
		.map(|p| canonical(&p.to_string_lossy()))
		.collect()
}

fn worktrees_of(repo: &Repository) -> Vec<GitWorktree> {
	let mut out = Vec::new();

	// The main checkout first, and it is deliberately not derived from
	// `worktrees()`: libgit2 lists only *linked* worktrees, so the main one has
	// to be found from the common directory. A bare repository has none, and
	// contributes no row rather than an empty-pathed one.
	if let Some(path) = main_worktree_path(repo) {
		out.push(describe(&path, None, true, false, false));
	}

	for name in worktree_names(repo) {
		let Ok(wt) = repo.find_worktree(&name) else { continue };
		let locked =
			wt.is_locked().map(|s| !matches!(s, WorktreeLockStatus::Unlocked)).unwrap_or(false);
		// `is_prunable` reports an *error* for a worktree it declines to consider —
		// a locked one, most often — and "we could not decide" is not "prunable".
		let prunable = wt.is_prunable(None).unwrap_or(false);
		out.push(describe(wt.path(), Some(name), false, locked, prunable));
	}

	out
}

/// Git's own names for the linked worktrees — the directories under
/// `.git/worktrees/`.
///
/// Collected rather than chained because `StringArray`'s iterator yields
/// `Result<Option<&str>>`, so it borrows from a value that has to outlive the
/// walk, and two levels of `flatten` in a call chain read as a puzzle.
fn worktree_names(repo: &Repository) -> Vec<String> {
	let Ok(names) = repo.worktrees() else {
		return Vec::new();
	};
	names.iter().flatten().flatten().map(str::to_string).collect()
}

/// The main working tree's path, or `None` for a bare repository.
///
/// For a linked worktree the repository's `commondir` is the *main* repository's
/// `.git`, so its parent is the main checkout — which is what makes this
/// symmetric. Opening the main repository just to call `workdir()` would be a
/// second open for a value one `parent()` already has.
fn main_worktree_path(repo: &Repository) -> Option<PathBuf> {
	if !repo.is_worktree() {
		return repo.workdir().map(Path::to_path_buf);
	}
	repo.commondir().parent().map(Path::to_path_buf).filter(|p| p.is_dir())
}

fn linked_worktree_paths(repo: &Repository) -> Vec<PathBuf> {
	worktree_names(repo)
		.into_iter()
		.filter_map(|name| repo.find_worktree(&name).ok().map(|wt| wt.path().to_path_buf()))
		.collect()
}

/// Fill in the fields that need the checkout itself opened.
///
/// A checkout whose directory is gone is still a row — `exists: false`, no branch
/// and no SHA. That is the `prunable` case you can see and reason about, rather
/// than one silently missing from the list.
fn describe(
	path: &Path,
	name: Option<String>,
	is_main: bool,
	locked: bool,
	prunable: bool,
) -> GitWorktree {
	let exists = path.is_dir();
	let opened = if exists { Repository::open(path).ok() } else { None };
	GitWorktree {
		path: canonical(&path.to_string_lossy()).to_string_lossy().to_string(),
		name,
		branch: opened.as_ref().and_then(branch_name),
		head: opened.as_ref().and_then(head_sha),
		is_main,
		locked,
		prunable,
		exists,
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

/// What HEAD resolves to, or `None` on an unborn branch. This is the field that
/// lets the header badge tell a detached HEAD from an unborn one (F18).
fn head_sha(repo: &Repository) -> Option<String> {
	Some(repo.head().ok()?.peel_to_commit().ok()?.id().to_string())
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

	// ── Worktrees (F21) ──────────────────────────────────────────────────────

	/// A repository with one linked worktree, checked out on a new branch.
	///
	/// The worktree directory lives in its *own* TempDir, deliberately: a
	/// worktree nested inside the main checkout is the case that accidentally
	/// passes a containment test it should not, and the real ones are siblings.
	fn repo_with_worktree() -> (TempDir, TempDir, Repository) {
		let (main, repo) = repo_with_commit();
		let wt_home = tempdir().unwrap();
		let wt_path = wt_home.path().join("feature-x");
		// Scoped so the `Branch` borrow of `repo` ends before `repo` is moved out.
		{
			let head = repo.head().unwrap().peel_to_commit().unwrap();
			let branch = repo.branch("feature-x", &head, false).unwrap();
			let mut opts = git2::WorktreeAddOptions::new();
			opts.reference(Some(branch.get()));
			repo.worktree("feature-x", &wt_path, Some(&opts)).unwrap();
		}
		(main, wt_home, repo)
	}

	#[test]
	fn a_repo_with_no_worktrees_is_one_row_for_the_main_checkout() {
		let (dir, _repo) = repo_with_commit();
		let wts = worktrees(&root(&dir)).unwrap();

		assert_eq!(wts.len(), 1, "the main checkout is a checkout");
		assert!(wts[0].is_main);
		assert_eq!(wts[0].name, None, "the main tree has no .git/worktrees entry");
		assert!(wts[0].exists);
		assert!(!wts[0].locked);
		assert!(wts[0].branch.is_some());
	}

	#[test]
	fn a_linked_worktree_is_listed_with_its_own_branch() {
		let (main, _wt_home, _repo) = repo_with_worktree();
		let wts = worktrees(&root(&main)).unwrap();

		assert_eq!(wts.len(), 2);
		let linked = wts.iter().find(|w| !w.is_main).expect("the linked worktree");
		assert_eq!(linked.name.as_deref(), Some("feature-x"));
		// The branch is the worktree's own HEAD, not the main checkout's — which
		// is the whole reason the panel has to follow the checkout.
		assert_eq!(linked.branch.as_deref(), Some("feature-x"));
		assert!(linked.exists);
		assert!(!linked.prunable);
	}

	#[test]
	fn the_set_is_the_same_seen_from_the_linked_worktree() {
		// ADR-0019 § 1: it is the same repository whichever door you came in by.
		// A project that *is* a linked worktree must see the main checkout too,
		// or the feature silently does nothing for anyone who added one.
		let (main, wt_home, _repo) = repo_with_worktree();
		let from_linked = worktrees(&wt_home.path().join("feature-x").to_string_lossy()).unwrap();

		assert_eq!(from_linked.len(), 2);
		let mut paths: Vec<_> = from_linked.iter().map(|w| w.path.clone()).collect();
		paths.sort();
		let mut expected = vec![
			canonical(&root(&main)).to_string_lossy().to_string(),
			canonical(&wt_home.path().join("feature-x").to_string_lossy())
				.to_string_lossy()
				.to_string(),
		];
		expected.sort();
		assert_eq!(paths, expected);
		assert!(from_linked.iter().any(|w| w.is_main), "the main checkout is still in the set");
	}

	#[test]
	fn a_worktree_whose_directory_is_gone_is_listed_as_missing() {
		let (main, wt_home, _repo) = repo_with_worktree();
		// What `git worktree remove` leaves behind if the directory is deleted by
		// hand — the `.git/worktrees` entry survives.
		fs::remove_dir_all(wt_home.path().join("feature-x")).unwrap();

		let wts = worktrees(&root(&main)).unwrap();
		let linked = wts.iter().find(|w| !w.is_main).expect("still a row, not filtered out");
		assert!(!linked.exists, "a checkout you can see and cannot use");
		assert_eq!(linked.branch, None, "nothing to open, so nothing to name");
	}

	#[test]
	fn worktree_paths_is_the_scope_and_drops_what_is_not_on_disk() {
		let (main, wt_home, _repo) = repo_with_worktree();
		let live = worktree_paths(&root(&main));
		assert_eq!(live.len(), 2, "both checkouts are in scope");

		fs::remove_dir_all(wt_home.path().join("feature-x")).unwrap();
		let after = worktree_paths(&root(&main));
		// A directory that is not there cannot contain the path we are about to
		// compare against it, so it is dropped from the scope rather than kept.
		assert_eq!(after.len(), 1);
		assert!(after[0].ends_with(main.path().file_name().unwrap()));
	}

	#[test]
	fn a_project_outside_any_repository_has_no_worktrees_and_so_no_scope() {
		let dir = tempdir().unwrap();
		// An empty scope refuses everything, which is the correct direction to
		// fail in for the bridge (ADR-0019 § 2).
		assert!(worktrees(&root(&dir)).unwrap().is_empty());
		assert!(worktree_paths(&root(&dir)).is_empty());
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

	// ── The graph (F18) ────────────────────────────────────────────────────

	/// Lane assignment driven by hand-built OIDs, with no repository at all — the
	/// algorithm is the feature, so it gets tested as a function rather than
	/// through a walk that could mask a layout bug as an ordering one.
	fn oid(n: u8) -> Oid {
		let mut bytes = [0u8; 20];
		bytes[19] = n;
		Oid::from_bytes(&bytes).unwrap()
	}

	/// Point `origin/<current branch>` at `oid` and set it as the upstream,
	/// returning the branch's name.
	///
	/// The remote has to exist in `.git/config` first: `set_upstream` resolves
	/// which remote a tracking ref belongs to through the config's fetch
	/// refspecs, so creating `refs/remotes/origin/…` alone fails with "could not
	/// determine remote". No network is involved — `remote()` only writes config.
	fn track_upstream(repo: &Repository, oid: Oid) -> String {
		let branch = repo.head().unwrap().shorthand().unwrap().to_string();
		repo.remote("origin", "https://example.invalid/repo.git").unwrap();
		repo.reference(&format!("refs/remotes/origin/{branch}"), oid, false, "test").unwrap();
		repo.find_branch(&branch, BranchType::Local)
			.unwrap()
			.set_upstream(Some(&format!("origin/{branch}")))
			.unwrap();
		branch
	}

	/// Every lane index this row draws in, so a test can assert shape without
	/// pinning the exact edge list.
	fn lanes_drawn(edges: &[GitGraphEdge]) -> Vec<usize> {
		let mut seen: Vec<usize> = edges.iter().flat_map(|e| [e.from_lane, e.to_lane]).collect();
		seen.sort_unstable();
		seen.dedup();
		seen
	}

	#[test]
	fn a_linear_history_is_one_lane_all_the_way_down() {
		let mut lanes = Lanes::default();

		// c3 → c2 → c1 → root, newest first.
		let (l3, e3) = lanes.place(oid(3), &[oid(2)]);
		let (l2, e2) = lanes.place(oid(2), &[oid(1)]);
		let (l1, e1) = lanes.place(oid(1), &[]);

		assert_eq!([l3, l2, l1], [0, 0, 0], "nothing forks, so nothing leaves lane 0");
		assert_eq!(lanes.width(), 1);
		// The tip has only an outgoing edge; the root only an incoming one.
		assert_eq!(e3.len(), 1);
		assert_eq!(e3[0].kind, GitGraphEdgeKind::Outgoing);
		assert_eq!(e2.len(), 2, "arrives and continues");
		assert_eq!(e1.len(), 1);
		assert_eq!(e1[0].kind, GitGraphEdgeKind::Incoming);
	}

	#[test]
	fn a_merge_opens_a_second_lane_and_the_fork_point_closes_it() {
		// b(4) is a merge of main(3) and side(5); both descend from base(1).
		//
		//   4  merge          lane 0
		//   |\
		//   3 |  main tip     lane 0, lane 1 opened for 5
		//   | 5  side tip     lane 1
		//   |/
		//   1  base           lane 0, lane 1 closes
		let mut lanes = Lanes::default();

		let (merge_lane, merge_edges) = lanes.place(oid(4), &[oid(3), oid(5)]);
		let (main_lane, _) = lanes.place(oid(3), &[oid(1)]);
		let (side_lane, side_edges) = lanes.place(oid(5), &[oid(1)]);
		let (base_lane, base_edges) = lanes.place(oid(1), &[]);

		assert_eq!(merge_lane, 0);
		assert_eq!(main_lane, 0, "the first parent keeps the merge's lane");
		assert_eq!(side_lane, 1, "the second parent got a lane of its own");
		assert_eq!(base_lane, 0, "the fork point takes the leftmost waiting lane");
		assert_eq!(lanes.width(), 2, "two lanes, and no more");

		// The merge row draws into both lanes: one outgoing per parent.
		assert_eq!(lanes_drawn(&merge_edges), vec![0, 1]);
		let outgoing: Vec<_> =
			merge_edges.iter().filter(|e| e.kind == GitGraphEdgeKind::Outgoing).collect();
		assert_eq!(outgoing.len(), 2);
		assert_eq!(outgoing[1].to_lane, 1, "the second parent's line leaves to lane 1");

		// The side tip is in lane 1 while lane 0 is still waiting for base, so
		// its row has to draw lane 0 passing straight through.
		assert!(
			side_edges
				.iter()
				.any(|e| e.kind == GitGraphEdgeKind::Through && e.from_lane == 0 && e.to_lane == 0),
			"lane 0 passes through the side tip's row: {side_edges:?}"
		);

		// Two branches converge on base, so it has two incoming edges — and each
		// keeps its own lane's colour so it can be traced back up.
		let incoming: Vec<_> =
			base_edges.iter().filter(|e| e.kind == GitGraphEdgeKind::Incoming).collect();
		assert_eq!(incoming.len(), 2);
		assert_eq!(incoming[0].lane, 0);
		assert_eq!(incoming[1].lane, 1, "the converging branch keeps lane 1's colour");
	}

	#[test]
	fn an_octopus_merge_opens_a_lane_per_extra_parent() {
		let mut lanes = Lanes::default();

		let (lane, edges) = lanes.place(oid(9), &[oid(1), oid(2), oid(3)]);

		assert_eq!(lane, 0);
		assert_eq!(lanes.width(), 3, "one lane for the commit, two more for the extra parents");
		let outgoing: Vec<usize> = edges
			.iter()
			.filter(|e| e.kind == GitGraphEdgeKind::Outgoing)
			.map(|e| e.to_lane)
			.collect();
		assert_eq!(outgoing, vec![0, 1, 2]);
	}

	#[test]
	fn a_freed_lane_is_reused_by_an_unrelated_branch() {
		// This is what stops lanes marching rightwards forever in a repo with a
		// long history of short-lived branches — and it is why lane colour is
		// recycled rather than unique per branch.
		let mut lanes = Lanes::default();

		lanes.place(oid(4), &[oid(3), oid(5)]); // opens lanes 0 and 1
		lanes.place(oid(3), &[oid(1)]);
		lanes.place(oid(5), &[oid(1)]); // lane 1 still waiting for 1
		lanes.place(oid(1), &[]); // both arrive; lane 1 frees

		let (orphan_lane, _) = lanes.place(oid(7), &[]);

		assert_eq!(orphan_lane, 0, "lane 0 freed first, so it is taken first");
		assert_eq!(lanes.width(), 2, "no third lane was ever needed");
	}

	#[test]
	fn an_orphan_branch_gets_its_own_lane_and_joins_nothing() {
		let mut lanes = Lanes::default();

		// A live main lane, then a tip nothing points at.
		lanes.place(oid(3), &[oid(2)]);
		let (orphan, edges) = lanes.place(oid(8), &[]);

		assert_eq!(orphan, 1, "lane 0 is still waiting for commit 2");
		assert!(
			!edges.iter().any(|e| e.kind == GitGraphEdgeKind::Incoming),
			"nothing converges on an orphan tip"
		);
		assert!(
			edges.iter().any(|e| e.kind == GitGraphEdgeKind::Through && e.from_lane == 0),
			"main's lane still passes through: {edges:?}"
		);
	}

	#[test]
	fn a_pass_through_lane_never_changes_index() {
		// The one invariant the renderer relies on: a lane that neither starts nor
		// ends in a row is drawn as a straight line, so it must not move.
		let mut lanes = Lanes::default();
		lanes.place(oid(20), &[oid(10), oid(11)]);
		lanes.place(oid(10), &[oid(1)]);

		for commit in [oid(11), oid(1)] {
			let (_, edges) = lanes.place(commit, &[oid(1)]);
			for edge in edges.iter().filter(|e| e.kind == GitGraphEdgeKind::Through) {
				assert_eq!(edge.from_lane, edge.to_lane, "a through edge moved: {edge:?}");
				assert_eq!(edge.lane, edge.from_lane, "and it must keep its own colour");
			}
		}
	}

	#[test]
	fn the_graph_walks_all_refs_and_reports_head_with_its_branch() {
		let (dir, repo) = repo_with_commit();
		write(dir.path(), "second.txt", "b\n");
		commit_all(&repo, "second");

		let g = graph(&root(&dir), 0, 10).unwrap();

		assert!(g.repo_root.is_some());
		assert_eq!(g.commits.len(), 2);
		assert_eq!(g.commits[0].subject, "second", "newest first");
		assert_eq!(g.commits[1].subject, "initial");
		assert!(!g.has_more);
		assert_eq!(g.lane_count, 1);
		assert!(!g.refs_digest.is_empty());

		// Full SHA in `sha`, seven characters in `short_sha`, and one is a prefix
		// of the other — the renderer never abbreviates for itself.
		let tip = &g.commits[0];
		assert_eq!(tip.sha.len(), 40);
		assert_eq!(tip.short_sha.len(), 7);
		assert!(tip.sha.starts_with(&tip.short_sha));
		assert!(tip.author_time > 1_000_000_000_000, "epoch milliseconds, not seconds");

		let head_ref = tip.refs.iter().find(|r| r.is_head).expect("HEAD is on a branch");
		assert_eq!(head_ref.kind, GitRefKind::LocalBranch);
		assert!(
			tip.refs.iter().all(|r| r.kind != GitRefKind::Head),
			"not detached, so no HEAD chip"
		);
	}

	#[test]
	fn a_project_outside_any_repository_gets_an_empty_graph_rather_than_an_error() {
		let dir = tempdir().unwrap();
		write(dir.path(), "a.txt", "hi");

		let g = graph(&root(&dir), 0, 10).unwrap();

		assert!(g.repo_root.is_none(), "not versioned is an answer the panel renders");
		assert!(g.commits.is_empty());
		assert!(!g.has_more);
	}

	#[test]
	fn a_repository_with_no_commits_walks_to_nothing() {
		let dir = tempdir().unwrap();
		let _repo = Repository::init(dir.path()).unwrap();

		let g = graph(&root(&dir), 0, 10).unwrap();

		// A repository, but an unborn HEAD: there is nothing to walk, and that is
		// the "No commits yet." empty state rather than an error.
		assert!(g.repo_root.is_some());
		assert!(g.commits.is_empty());
		assert!(!g.has_more);
	}

	#[test]
	fn paging_by_offset_keeps_lanes_consistent_across_pages() {
		// The reason paging re-walks instead of resuming a cursor: page 2 must
		// agree with page 1 about which lane a commit is in.
		let (dir, repo) = repo_with_commit();
		for i in 0..5 {
			write(dir.path(), &format!("f{i}.txt"), "x\n");
			commit_all(&repo, &format!("commit {i}"));
		}

		let whole = graph(&root(&dir), 0, 100).unwrap();
		let first = graph(&root(&dir), 0, 2).unwrap();
		let second = graph(&root(&dir), 2, 2).unwrap();

		assert_eq!(whole.commits.len(), 6);
		assert!(first.has_more, "there is more after two of six");
		assert_eq!(first.commits.len(), 2);
		assert_eq!(second.commits.len(), 2);

		let spliced: Vec<(&str, usize)> = first
			.commits
			.iter()
			.chain(second.commits.iter())
			.map(|c| (c.sha.as_str(), c.lane))
			.collect();
		let expected: Vec<(&str, usize)> =
			whole.commits.iter().take(4).map(|c| (c.sha.as_str(), c.lane)).collect();
		assert_eq!(spliced, expected, "two pages spliced must equal one walk");
		assert_eq!(first.refs_digest, second.refs_digest, "same refs, same digest");
	}

	#[test]
	fn a_page_is_cached_until_the_refs_move() {
		let (dir, repo) = repo_with_commit();
		write(dir.path(), "second.txt", "b\n");
		commit_all(&repo, "second");

		let first = graph(&root(&dir), 0, 10).unwrap();
		let again = graph(&root(&dir), 0, 10).unwrap();
		assert_eq!(first.refs_digest, again.refs_digest);
		assert_eq!(first.commits.len(), again.commits.len());

		// A commit moves the branch, so the digest changes and the page is walked
		// afresh rather than served stale.
		write(dir.path(), "third.txt", "c\n");
		commit_all(&repo, "third");
		let after = graph(&root(&dir), 0, 10).unwrap();
		assert_ne!(after.refs_digest, first.refs_digest, "a moved ref is a new digest");
		assert_eq!(after.commits.len(), 3);
		assert_eq!(after.commits[0].subject, "third");
	}

	#[test]
	fn switching_branches_without_moving_any_ref_still_invalidates_the_page() {
		let (dir, repo) = repo_with_commit();
		let head = repo.head().unwrap().peel_to_commit().unwrap();
		repo.branch("side", &head, false).unwrap();

		let on_main = graph(&root(&dir), 0, 10).unwrap();
		let chip = |g: &GitGraph, name: &str| {
			g.commits[0].refs.iter().find(|r| r.name == name).map(|r| r.is_head)
		};
		assert_eq!(chip(&on_main, "side"), Some(false));

		// Same two refs at the same oid; only which one HEAD names has changed.
		repo.set_head("refs/heads/side").unwrap();
		let on_side = graph(&root(&dir), 0, 10).unwrap();
		assert_ne!(on_side.refs_digest, on_main.refs_digest, "HEAD's branch is part of the digest");
		assert_eq!(chip(&on_side, "side"), Some(true), "the chip follows HEAD, not the cache");
	}

	#[test]
	fn a_detached_head_gets_its_own_chip_and_a_head_sha_in_status() {
		let (dir, repo) = repo_with_commit();
		write(dir.path(), "second.txt", "b\n");
		commit_all(&repo, "second");
		let first = repo.head().unwrap().peel_to_commit().unwrap().parent(0).unwrap();
		repo.set_head_detached(first.id()).unwrap();

		let g = graph(&root(&dir), 0, 10).unwrap();
		let st = status(&root(&dir)).unwrap();

		let detached = g
			.commits
			.iter()
			.find(|c| c.sha == first.id().to_string())
			.expect("the detached commit is in the walk");
		assert!(
			detached.refs.iter().any(|r| r.kind == GitRefKind::Head && r.name == "HEAD"),
			"a detached HEAD has no branch to fold into: {:?}",
			detached.refs
		);

		// The pair the badge needs to tell detached from unborn apart.
		assert!(st.branch.is_none(), "detached means no branch to name");
		assert_eq!(st.head.as_deref(), Some(first.id().to_string().as_str()));
	}

	#[test]
	fn an_unborn_head_reports_neither_a_branch_nor_a_sha() {
		let dir = tempdir().unwrap();
		let _repo = Repository::init(dir.path()).unwrap();

		let st = status(&root(&dir)).unwrap();

		assert!(st.branch.is_none());
		assert!(st.head.is_none(), "nothing to name, so the badge stays quiet");
	}

	#[test]
	fn a_tag_is_a_ref_on_its_commit_and_a_remote_head_is_dropped() {
		let (dir, repo) = repo_with_commit();
		let tip = repo.head().unwrap().peel_to_commit().unwrap();
		repo.tag_lightweight("v0.1.0", tip.as_object(), false).unwrap();
		// A remote-tracking branch plus the symbolic `origin/HEAD` beside it, which
		// is the commonest cause of a row overflowing its chips.
		repo.reference("refs/remotes/origin/main", tip.id(), false, "test").unwrap();
		repo.reference("refs/remotes/origin/HEAD", tip.id(), false, "test").unwrap();

		let g = graph(&root(&dir), 0, 10).unwrap();
		let refs = &g.commits[0].refs;

		assert!(refs.iter().any(|r| r.kind == GitRefKind::Tag && r.name == "v0.1.0"));
		assert!(refs.iter().any(|r| r.kind == GitRefKind::RemoteBranch && r.name == "origin/main"));
		assert!(
			!refs.iter().any(|r| r.name.ends_with("HEAD") && r.kind == GitRefKind::RemoteBranch),
			"origin/HEAD duplicates origin/main and is dropped in the service: {refs:?}"
		);
		// Ordered here so the renderer's `+N` cut is the same on every poll.
		let kinds: Vec<GitRefKind> = refs.iter().map(|r| r.kind).collect();
		let mut sorted = kinds.clone();
		sorted.sort_by_key(|k| ref_order(*k));
		assert_eq!(kinds, sorted, "HEAD's branch, then locals, remotes, tags: {refs:?}");
	}

	#[test]
	fn an_annotated_tag_peels_through_its_tag_object_to_the_commit() {
		let (dir, repo) = repo_with_commit();
		let tip = repo.head().unwrap().peel_to_commit().unwrap();
		let sig = Signature::now("factorai tests", "tests@example.invalid").unwrap();
		repo.tag("v1.0.0", tip.as_object(), &sig, "release", false).unwrap();

		let g = graph(&root(&dir), 0, 10).unwrap();

		assert!(
			g.commits[0].refs.iter().any(|r| r.name == "v1.0.0" && r.kind == GitRefKind::Tag),
			"an annotated tag points at a tag object, not a commit: {:?}",
			g.commits[0].refs
		);
	}

	#[test]
	fn a_branch_in_sync_with_its_upstream_says_so_once() {
		// What lets the renderer draw `main ≡origin` instead of spending two chips
		// saying the same thing. They only ever crowd a row when they agree.
		let (dir, repo) = repo_with_commit();
		let tip = repo.head().unwrap().peel_to_commit().unwrap();
		let branch = track_upstream(&repo, tip.id());

		let g = graph(&root(&dir), 0, 10).unwrap();
		let local = g.commits[0]
			.refs
			.iter()
			.find(|r| r.kind == GitRefKind::LocalBranch)
			.expect("the local branch is here");

		assert_eq!(local.upstream_in_sync.as_deref(), Some(format!("origin/{branch}").as_str()));
	}

	#[test]
	fn a_diverged_upstream_reports_no_sync_because_the_two_are_on_different_rows() {
		let (dir, repo) = repo_with_commit();
		let base = repo.head().unwrap().peel_to_commit().unwrap();
		// The remote stays on the first commit while the local branch moves on.
		let branch = track_upstream(&repo, base.id());
		write(dir.path(), "ahead.txt", "x\n");
		commit_all(&repo, "ahead");

		let g = graph(&root(&dir), 0, 10).unwrap();
		let local = g.commits[0]
			.refs
			.iter()
			.find(|r| r.kind == GitRefKind::LocalBranch)
			.expect("the local branch is on the new tip");

		assert_eq!(local.upstream_in_sync, None, "ahead of origin, so nothing to collapse");
		assert!(
			g.commits[1].refs.iter().any(|r| r.name == format!("origin/{branch}")),
			"the remote is a row further down, where there is nothing to crowd"
		);
	}

	#[test]
	fn commit_detail_lists_the_files_a_commit_touched_against_its_first_parent() {
		let (dir, repo) = repo_with_commit();
		write(dir.path(), "tracked.txt", "one\ntwo\nthree\nfour\n");
		write(dir.path(), "added.txt", "new\n");
		let second = commit_all(&repo, "second\n\nA body paragraph.\nAnd a second line.");

		let detail =
			commit_detail(&root(&dir), &second.to_string()).unwrap().expect("the commit resolves");

		assert_eq!(detail.subject, "second");
		assert_eq!(detail.body, "A body paragraph.\nAnd a second line.");
		assert_eq!(detail.sha.len(), 40);
		assert_eq!(detail.parents.len(), 1);
		assert_eq!(detail.diff_parent.as_ref(), detail.parents.first());
		assert!(!detail.truncated);

		let by_path = |rel: &str| {
			detail
				.files
				.iter()
				.find(|f| f.rel_path == rel)
				.unwrap_or_else(|| panic!("no {rel} in {:?}", detail.files))
		};
		assert_eq!(by_path("added.txt").kind, GitChangeKind::Added);
		let modified = by_path("tracked.txt");
		assert_eq!(modified.kind, GitChangeKind::Modified);
		assert_eq!(modified.additions, Some(1));
		assert!(modified.path.ends_with("tracked.txt"), "absolute path for the viewer");
	}

	#[test]
	fn a_root_commit_diffs_against_the_empty_tree_so_everything_is_an_addition() {
		let (dir, repo) = repo_with_commit();
		let root_commit = repo.head().unwrap().peel_to_commit().unwrap();

		let detail = commit_detail(&root(&dir), &root_commit.id().to_string()).unwrap().unwrap();

		assert!(detail.parents.is_empty());
		assert_eq!(detail.diff_parent, None, "nothing to diff against, and the UI says so");
		assert_eq!(detail.files.len(), 1);
		assert_eq!(detail.files[0].kind, GitChangeKind::Added);
		assert_eq!(detail.body, "", "no body is an empty string, not the subject again");
	}

	#[test]
	fn a_merge_lists_what_it_brought_in_from_the_other_branch() {
		// Why first-parent is the right default: the diff against parent 1 is
		// exactly the other branch's contribution.
		let (dir, repo) = repo_with_commit();
		let base = repo.head().unwrap().peel_to_commit().unwrap();

		repo.branch("side", &base, false).unwrap();
		repo.set_head("refs/heads/side").unwrap();
		write(dir.path(), "from-side.txt", "s\n");
		let side = commit_all(&repo, "side work");

		repo.set_head("refs/heads/master").or_else(|_| repo.set_head("refs/heads/main")).unwrap();
		repo.reset(base.as_object(), git2::ResetType::Hard, None).unwrap();
		write(dir.path(), "from-main.txt", "m\n");
		let main = commit_all(&repo, "main work");

		// A merge commit with main first and side second.
		let tree = repo.find_tree(repo.index().unwrap().write_tree().unwrap()).unwrap();
		let sig = Signature::now("factorai tests", "tests@example.invalid").unwrap();
		let main_commit = repo.find_commit(main).unwrap();
		let side_commit = repo.find_commit(side).unwrap();
		std::fs::write(dir.path().join("from-side.txt"), "s\n").unwrap();
		let mut index = repo.index().unwrap();
		index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None).unwrap();
		index.write().unwrap();
		let merged_tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
		let merge = repo
			.commit(
				Some("HEAD"),
				&sig,
				&sig,
				"merge side",
				&merged_tree,
				&[&main_commit, &side_commit],
			)
			.unwrap();
		drop(tree);

		let detail = commit_detail(&root(&dir), &merge.to_string()).unwrap().unwrap();

		assert_eq!(detail.parents.len(), 2, "a merge");
		assert_eq!(
			detail.diff_parent.as_deref(),
			Some(main.to_string().as_str()),
			"the first parent, named so the UI can label it"
		);
		assert!(
			detail.files.iter().any(|f| f.rel_path == "from-side.txt"),
			"the diff against parent 1 is what the merge brought in: {:?}",
			detail.files
		);
		assert!(
			!detail.files.iter().any(|f| f.rel_path == "from-main.txt"),
			"parent 1's own work is not part of what the merge introduced"
		);
	}

	#[test]
	fn a_commits_file_list_is_capped_and_says_so() {
		let (dir, repo) = repo_with_commit();
		for i in 0..5 {
			write(dir.path(), &format!("f{i}.txt"), "x\n");
		}
		let sha = commit_all(&repo, "many files");

		let detail = commit_detail_capped(&root(&dir), &sha.to_string(), 2).unwrap().unwrap();

		assert!(detail.truncated);
		assert_eq!(detail.total, 5);
		assert_eq!(detail.files.len(), 2);
	}

	#[test]
	fn an_unresolvable_sha_is_absent_rather_than_an_error() {
		let (dir, _repo) = repo_with_commit();

		let gone = commit_detail(&root(&dir), "0123456789abcdef0123456789abcdef01234567").unwrap();

		assert!(gone.is_none(), "a row clicked after a force-push is stale, not a failure");
	}

	#[test]
	fn a_blob_reads_at_an_arbitrary_commit_and_is_absent_where_the_file_was_not() {
		let (dir, repo) = repo_with_commit();
		let first = repo.head().unwrap().peel_to_commit().unwrap().id();
		write(dir.path(), "tracked.txt", "one\ntwo\nCHANGED\n");
		write(dir.path(), "later.txt", "l\n");
		let second = commit_all(&repo, "second");

		let path = dir.path().join("tracked.txt");
		let path_str = path.to_str().unwrap();

		let at_first = blob_at(path_str, &first.to_string(), None).unwrap().unwrap();
		let at_second = blob_at(path_str, &second.to_string(), None).unwrap().unwrap();
		assert_eq!(at_first.contents, "one\ntwo\nthree\n");
		assert_eq!(at_second.contents, "one\ntwo\nCHANGED\n");

		// A file that didn't exist yet at that commit: absent, not an error — the
		// same rule `git_blob` follows for an added file's missing HEAD side.
		let later = dir.path().join("later.txt");
		let missing = blob_at(later.to_str().unwrap(), &first.to_string(), None);
		assert!(matches!(missing, Ok(None)));
	}

	#[test]
	fn a_blob_outside_a_repository_or_at_a_bad_rev_is_absent() {
		let plain = tempdir().unwrap();
		write(plain.path(), "loose.txt", "x\n");
		assert!(matches!(
			blob_at(plain.path().join("loose.txt").to_str().unwrap(), "HEAD", None),
			Ok(None)
		));

		let (dir, _repo) = repo_with_commit();
		let tracked = dir.path().join("tracked.txt");
		assert!(matches!(blob_at(tracked.to_str().unwrap(), "not-a-rev", None), Ok(None)));
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
