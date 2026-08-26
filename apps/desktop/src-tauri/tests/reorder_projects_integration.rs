//! `reorder_projects` — the one command that writes the sidebar's order (F1,
//! roadmap item 28).
//!
//! The interesting property is not that it reorders. It is that it **refuses**
//! to: the sidebar polls `list_projects` every 2s and the renderer sends back the
//! whole list it was looking at, so the one thing this command must never do is
//! apply an order derived from a list that has since changed. Every test below is
//! about the boundary between "this is the order the user chose" and "this is an
//! order assembled from something stale".

use std::path::Path;

use factorai_lib::commands::projects::{add_project_in, list_projects_in, reorder_projects_in};
use factorai_lib::db::Db;
use factorai_lib::error::AppError;
use tempfile::TempDir;

fn open_db(tmp: &Path) -> Db {
	Db::open(&tmp.join("data")).expect("open db")
}

/// Three projects, returned as (id, name) in the order `list_projects` gives
/// them — which, since each add lands on top, is the reverse of creation.
fn three_projects(tmp: &Path, db: &Db) -> Vec<(String, String)> {
	for name in ["alpha", "bravo", "charlie"] {
		let dir = tmp.join("code").join(name);
		std::fs::create_dir_all(&dir).unwrap();
		add_project_in(db, dir.to_str().unwrap()).expect("add");
	}
	db.with(list_projects_in).expect("list").into_iter().map(|p| (p.id, p.display_name)).collect()
}

fn names(db: &Db) -> Vec<String> {
	db.with(list_projects_in).expect("list").into_iter().map(|p| p.display_name).collect()
}

fn ordinals(db: &Db) -> Vec<i64> {
	db.with(list_projects_in).expect("list").into_iter().map(|p| p.sort_order).collect()
}

#[test]
fn writes_the_order_it_is_given() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let projects = three_projects(tmp.path(), &db);

	// Newest-first out of the box, so this is a real change rather than a no-op.
	assert_eq!(names(&db), vec!["charlie", "bravo", "alpha"]);

	let ids: Vec<String> = ["alpha", "charlie", "bravo"]
		.iter()
		.map(|want| projects.iter().find(|(_, name)| name == want).expect("project").0.clone())
		.collect();
	reorder_projects_in(&db, &ids).expect("reorder");

	assert_eq!(names(&db), vec!["alpha", "charlie", "bravo"]);
}

/// Dense from zero, whatever it was handed.
///
/// `add_project` writes `MIN(sort_order) - 1` rather than renumbering, so a
/// workspace that has only ever been added to holds negatives. The first drag is
/// what normalises them, and nothing else does — so if this ever stopped being
/// true the ordinals would drift further negative for the life of the install.
#[test]
fn renumbers_densely_from_zero() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let projects = three_projects(tmp.path(), &db);
	assert_eq!(ordinals(&db), vec![-3, -2, -1], "adds walk downwards");

	let ids: Vec<String> = projects.iter().map(|(id, _)| id.clone()).collect();
	reorder_projects_in(&db, &ids).expect("reorder");

	assert_eq!(ordinals(&db), vec![0, 1, 2]);
}

/// A project removed between the render and the drop.
///
/// The renderer's list is one longer than the table, so the order it computed
/// describes a sidebar that no longer exists. Nothing is written and the caller
/// is told, which is what lets the renderer invalidate and re-render the truth.
#[test]
fn rejects_an_order_naming_a_project_that_is_gone() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let projects = three_projects(tmp.path(), &db);
	let before = ordinals(&db);

	let mut ids: Vec<String> = projects.iter().map(|(id, _)| id.clone()).collect();
	ids.push("a-project-that-never-existed".into());

	let err = reorder_projects_in(&db, &ids).expect_err("must refuse");
	assert!(matches!(err, AppError::InvalidInput(_)), "got {err:?}");
	assert_eq!(ordinals(&db), before, "a rejected reorder writes nothing at all");
}

/// A project added between the render and the drop.
///
/// The mirror image of the case above, and the reason the check is set equality
/// rather than "every id I was given exists": an order that simply omits a row
/// would otherwise be applied, leaving the new project sharing an ordinal with
/// whichever row happens to hold the same number.
#[test]
fn rejects_an_order_that_omits_a_project() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let projects = three_projects(tmp.path(), &db);
	let before = ordinals(&db);

	let ids: Vec<String> = projects.iter().take(2).map(|(id, _)| id.clone()).collect();

	let err = reorder_projects_in(&db, &ids).expect_err("must refuse");
	assert!(matches!(err, AppError::InvalidInput(_)), "got {err:?}");
	assert_eq!(ordinals(&db), before);
}

/// A duplicate has the right *set* and the wrong *list*.
///
/// Set equality alone would accept `[a, a, b]` against three rows and write two
/// projects to the same ordinal while leaving the third where it was, which is a
/// sidebar order nobody asked for. The length check is what catches it.
#[test]
fn rejects_an_order_containing_a_duplicate() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let projects = three_projects(tmp.path(), &db);
	let before = ordinals(&db);

	let ids = vec![projects[0].0.clone(), projects[0].0.clone(), projects[1].0.clone()];

	let err = reorder_projects_in(&db, &ids).expect_err("must refuse");
	assert!(matches!(err, AppError::InvalidInput(_)), "got {err:?}");
	assert_eq!(ordinals(&db), before);
}

/// An empty workspace is not an error, and neither is reordering nothing.
#[test]
fn an_empty_order_against_an_empty_workspace_is_fine() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());

	reorder_projects_in(&db, &[]).expect("reorder nothing");

	assert!(names(&db).is_empty());
}
