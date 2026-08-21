//! A session the agent ran in a `git worktree` belongs to the project that owns
//! the repository (F21, ADR-0019 § 1).
//!
//! The property under test is the *ordering* of two rules, not either one alone.
//! `claude` keys its store by cwd, so a session started in `~/wt/feature-x`
//! writes its transcript under a different `~/.claude/projects/` directory than
//! the one for `/repo`. ADR-0011 attaches those by exact canonical path, which
//! makes it a project nobody added. Pass 2 of `reconcile` claims it for the
//! project that owns the repository — but only if pass 1 left it unclaimed, which
//! is what keeps the existing workaround (adding the worktree yourself) working.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use factorai_lib::commands::projects::{add_project_in, list_projects_in};
use factorai_lib::db::Db;
use factorai_lib::services::indexer::Indexer;
use tempfile::TempDir;

fn open_db(tmp: &Path) -> Db {
	Db::open(&tmp.join("data")).expect("open db")
}

fn make_indexer(db: Db, claude_dir: PathBuf) -> Indexer {
	Indexer::with_callbacks(db, claude_dir, Arc::new(|_| {}), Arc::new(|_| {}))
}

/// A `~/.claude/projects/<encoded>/<session>.jsonl` for `cwd`, as Claude would
/// leave behind after a session there.
fn write_claude_session(claude_dir: &Path, cwd: &Path, session_id: &str) {
	let encoded = format!("-{}", cwd.to_string_lossy().trim_start_matches('/').replace('/', "-"));
	let project_dir = claude_dir.join("projects").join(&encoded);
	std::fs::create_dir_all(&project_dir).expect("mkdir project");
	let cwd = cwd.to_string_lossy();
	std::fs::write(
		project_dir.join(format!("{session_id}.jsonl")),
		format!(
			r#"{{"type":"user","uuid":"u1","timestamp":"2026-01-01T00:00:00Z","cwd":"{cwd}","message":{{"role":"user","content":"hello"}}}}"#
		),
	)
	.expect("write session");
}

/// A repository with one linked worktree, checked out on its own branch.
///
/// The worktree is a **sibling**, not nested inside the main checkout — which is
/// where real ones live, and the arrangement that would let a containment test
/// pass by accident.
fn repo_with_worktree(tmp: &Path) -> (PathBuf, PathBuf) {
	let main = tmp.join("repo");
	std::fs::create_dir_all(&main).unwrap();
	let repo = git2::Repository::init(&main).unwrap();
	std::fs::write(main.join("a.txt"), "one\n").unwrap();
	let mut index = repo.index().unwrap();
	index.add_path(Path::new("a.txt")).unwrap();
	index.write().unwrap();
	let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
	let sig = git2::Signature::now("t", "t@example.com").unwrap();
	repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[]).unwrap();

	// `git worktree add` will not create intermediate directories, only the leaf.
	std::fs::create_dir_all(tmp.join("worktrees")).unwrap();
	let wt_path = tmp.join("worktrees").join("feature-x");
	{
		let head = repo.head().unwrap().peel_to_commit().unwrap();
		let branch = repo.branch("feature-x", &head, false).unwrap();
		let mut opts = git2::WorktreeAddOptions::new();
		opts.reference(Some(branch.get()));
		repo.worktree("feature-x", &wt_path, Some(&opts)).unwrap();
	}
	(main.canonicalize().unwrap(), wt_path.canonicalize().unwrap())
}

fn sessions_of(db: &Db, project_id: &str) -> Vec<String> {
	db.with(|conn| {
		let mut stmt = conn.prepare(
			"SELECT s.cwd FROM sessions s
			   JOIN discovered_projects d ON d.id = s.discovered_id
			  WHERE d.project_id = ?1 ORDER BY s.cwd",
		)?;
		let rows: Vec<Option<String>> = stmt
			.query_map([project_id], |r| r.get::<_, Option<String>>(0))?
			.collect::<rusqlite::Result<Vec<_>>>()?;
		Ok(rows.into_iter().flatten().collect())
	})
	.expect("query")
}

#[test]
fn a_session_run_in_a_worktree_belongs_to_the_project_that_owns_the_repository() {
	let tmp = TempDir::new().unwrap();
	let claude = tmp.path().join("claude");
	let (main, worktree) = repo_with_worktree(tmp.path());

	// The agent worked in both trees. Two store directories, because Claude keys
	// them by cwd — which is the whole reason the worktree session is invisible
	// without this.
	write_claude_session(&claude, &main, "11111111-1111-4111-8111-111111111111");
	write_claude_session(&claude, &worktree, "22222222-2222-4222-8222-222222222222");

	let db = open_db(tmp.path());
	let project = add_project_in(&db, main.to_str().unwrap()).expect("add");
	make_indexer(db.clone(), claude).full_scan().expect("scan");

	let cwds = sessions_of(&db, &project.id);
	assert_eq!(
		cwds,
		vec![main.to_string_lossy().to_string(), worktree.to_string_lossy().to_string()],
		"both checkouts' sessions belong to the one project you added"
	);

	// And the worktree did not become a project of its own.
	let projects = db.with(list_projects_in).expect("list");
	assert_eq!(projects.len(), 1);
	assert_eq!(projects[0].session_count, 2);
}

#[test]
fn adding_the_worktree_yourself_keeps_its_sessions_where_they_were() {
	// ADR-0011's exact-match rule is tried first, so someone who has already
	// built a workflow out of adding the worktree keeps it. Nothing moves under
	// them.
	let tmp = TempDir::new().unwrap();
	let claude = tmp.path().join("claude");
	let (main, worktree) = repo_with_worktree(tmp.path());
	write_claude_session(&claude, &main, "11111111-1111-4111-8111-111111111111");
	write_claude_session(&claude, &worktree, "22222222-2222-4222-8222-222222222222");

	let db = open_db(tmp.path());
	let main_project = add_project_in(&db, main.to_str().unwrap()).expect("add main");
	let wt_project = add_project_in(&db, worktree.to_str().unwrap()).expect("add worktree");
	make_indexer(db.clone(), claude).full_scan().expect("scan");

	assert_eq!(sessions_of(&db, &main_project.id), vec![main.to_string_lossy().to_string()]);
	assert_eq!(sessions_of(&db, &wt_project.id), vec![worktree.to_string_lossy().to_string()]);
}

#[test]
fn the_roll_up_is_symmetric_so_adding_only_the_worktree_still_gathers_the_repository() {
	// The set is the repository's checkouts whichever door you came in by. Add
	// the linked worktree alone and the main checkout's sessions come with it —
	// otherwise the feature silently does nothing for anyone whose project
	// happens to be a worktree.
	let tmp = TempDir::new().unwrap();
	let claude = tmp.path().join("claude");
	let (main, worktree) = repo_with_worktree(tmp.path());
	write_claude_session(&claude, &main, "11111111-1111-4111-8111-111111111111");
	write_claude_session(&claude, &worktree, "22222222-2222-4222-8222-222222222222");

	let db = open_db(tmp.path());
	let project = add_project_in(&db, worktree.to_str().unwrap()).expect("add worktree");
	make_indexer(db.clone(), claude).full_scan().expect("scan");

	let cwds = sessions_of(&db, &project.id);
	assert_eq!(cwds.len(), 2, "got {cwds:?}");
}

#[test]
fn a_session_in_an_unrelated_repository_is_not_claimed() {
	// The boundary of pass 2: it links checkouts of *this* repository, not
	// neighbours on disk. Without this the roll-up would be the prefix scan
	// ADR-0011 rejected, wearing a different hat.
	let tmp = TempDir::new().unwrap();
	let claude = tmp.path().join("claude");
	let (main, _worktree) = repo_with_worktree(tmp.path());

	let stranger = tmp.path().join("elsewhere");
	std::fs::create_dir_all(&stranger).unwrap();
	git2::Repository::init(&stranger).unwrap();
	let stranger = stranger.canonicalize().unwrap();
	write_claude_session(&claude, &stranger, "33333333-3333-4333-8333-333333333333");

	let db = open_db(tmp.path());
	let project = add_project_in(&db, main.to_str().unwrap()).expect("add");
	make_indexer(db.clone(), claude).full_scan().expect("scan");

	assert!(sessions_of(&db, &project.id).is_empty());
}

#[test]
fn a_session_in_a_subdirectory_of_a_worktree_does_not_roll_up() {
	// Exact checkout match, not containment — symmetric with pass 1, where a
	// session in a subdirectory of the project does not roll up either.
	let tmp = TempDir::new().unwrap();
	let claude = tmp.path().join("claude");
	let (main, worktree) = repo_with_worktree(tmp.path());
	let inner = worktree.join("apps").join("web");
	std::fs::create_dir_all(&inner).unwrap();
	write_claude_session(&claude, &inner, "44444444-4444-4444-8444-444444444444");

	let db = open_db(tmp.path());
	let project = add_project_in(&db, main.to_str().unwrap()).expect("add");
	make_indexer(db.clone(), claude).full_scan().expect("scan");

	assert!(sessions_of(&db, &project.id).is_empty());
}
