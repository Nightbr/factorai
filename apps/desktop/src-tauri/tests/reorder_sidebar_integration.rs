//! `reorder_sidebar` and the group commands — the sidebar's tree (F1, ADR-0025).
//!
//! The interesting property is not that it reorders. It is that it **refuses**
//! to: the sidebar polls every 2s and the renderer sends back the whole tree it
//! was looking at, so the one thing this command must never do is apply a
//! structure derived from a list that has since changed. Most of the file is
//! about the boundary between "this is the arrangement the user chose" and "this
//! is an arrangement assembled from something stale".
//!
//! Grew out of `reorder_projects_integration.rs`, whose stale-set, duplicate and
//! dense-renumber cases all still apply — they just have two levels to hold now.

use std::path::Path;

use factorai_lib::commands::projects::add_project_in;
use factorai_lib::commands::sidebar::{
	create_group_in, list_sidebar_in, remove_group_in, rename_group_in, reorder_sidebar_in,
	SidebarOrder,
};
use factorai_lib::db::Db;
use factorai_lib::error::AppError;
use factorai_lib::models::SidebarRow;
use rusqlite::params;
use tempfile::TempDir;

fn open_db(tmp: &Path) -> Db {
	Db::open(&tmp.join("data")).expect("open db")
}

/// Three projects. Returned as (row_id, name) in the order `list_sidebar` gives
/// them — which, since each add lands on top, is the reverse of creation.
fn three_projects(tmp: &Path, db: &Db) -> Vec<(String, String)> {
	for name in ["alpha", "bravo", "charlie"] {
		let dir = tmp.join("code").join(name);
		std::fs::create_dir_all(&dir).unwrap();
		add_project_in(db, dir.to_str().unwrap()).expect("add");
	}
	top_level(db)
}

/// (row_id, label) for every top-level row, in order. A group's label is its
/// name, a project's is its display name.
fn top_level(db: &Db) -> Vec<(String, String)> {
	db.with(list_sidebar_in)
		.expect("list sidebar")
		.into_iter()
		.map(|row| match row {
			SidebarRow::Project { row_id, project } => (row_id, project.display_name),
			SidebarRow::Group { row_id, name, .. } => (row_id, name),
		})
		.collect()
}

fn labels(db: &Db) -> Vec<String> {
	top_level(db).into_iter().map(|(_, label)| label).collect()
}

/// The names inside the group at this top-level index, in order.
fn children_of(db: &Db, index: usize) -> Vec<String> {
	match &db.with(list_sidebar_in).expect("list sidebar")[index] {
		SidebarRow::Group { children, .. } => {
			children.iter().map(|c| c.project.display_name.clone()).collect()
		}
		SidebarRow::Project { .. } => panic!("row {index} is a project, not a group"),
	}
}

/// Every `sort_order` in the table, top level first. Used where the point is the
/// numbering rather than the resulting order.
fn ordinals(db: &Db) -> Vec<i64> {
	db.with(|conn| {
		let mut stmt = conn.prepare(
			"SELECT sort_order FROM sidebar_rows ORDER BY parent_id IS NOT NULL, sort_order",
		)?;
		let rows = stmt.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<Vec<i64>>>()?;
		Ok(rows)
	})
	.expect("ordinals")
}

fn row_id(db: &Db, label: &str) -> String {
	top_level(db)
		.into_iter()
		.find(|(_, name)| name == label)
		.map(|(id, _)| id)
		.unwrap_or_else(|| panic!("no top-level row named {label}"))
}

fn project(row_id: &str) -> SidebarOrder {
	SidebarOrder::Project { row_id: row_id.to_string() }
}

fn group(row_id: &str, children: &[&str]) -> SidebarOrder {
	SidebarOrder::Group {
		row_id: row_id.to_string(),
		children: children.iter().map(|c| c.to_string()).collect(),
	}
}

// ── One level, which is where item 28 left off ──────────────────────────────

#[test]
fn writes_the_order_it_is_given() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let rows = three_projects(tmp.path(), &db);

	// Newest-first out of the box, so this is a real change rather than a no-op.
	assert_eq!(labels(&db), vec!["charlie", "bravo", "alpha"]);

	let want = ["alpha", "charlie", "bravo"];
	let order: Vec<SidebarOrder> = want
		.iter()
		.map(|label| project(&rows.iter().find(|(_, n)| n == label).expect("row").0))
		.collect();
	reorder_sidebar_in(&db, &order).expect("reorder");

	assert_eq!(labels(&db), want);
}

/// Dense from zero within each scope, whatever it was handed.
///
/// `add_project` and `create_group` write `MIN(sort_order) - 1` rather than
/// renumbering, so a sidebar that has only ever been added to holds negatives.
/// The first drag is what normalises them, and nothing else does.
#[test]
fn renumbers_densely_from_zero() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let rows = three_projects(tmp.path(), &db);
	assert_eq!(ordinals(&db), vec![-3, -2, -1], "adds walk downwards");

	let order: Vec<SidebarOrder> = rows.iter().map(|(id, _)| project(id)).collect();
	reorder_sidebar_in(&db, &order).expect("reorder");

	assert_eq!(ordinals(&db), vec![0, 1, 2]);
}

// ── Two levels ──────────────────────────────────────────────────────────────

#[test]
fn files_projects_into_a_group_and_orders_them_inside_it() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let rows = three_projects(tmp.path(), &db);
	let pro = match create_group_in(&db, Some("Pro")).expect("create") {
		SidebarRow::Group { row_id, .. } => row_id,
		SidebarRow::Project { .. } => panic!("create_group returned a project"),
	};

	// The group lands on top, as a newly added project does.
	assert_eq!(labels(&db)[0], "Pro");

	let alpha = &rows.iter().find(|(_, n)| n == "alpha").unwrap().0;
	let bravo = &rows.iter().find(|(_, n)| n == "bravo").unwrap().0;
	let charlie = &rows.iter().find(|(_, n)| n == "charlie").unwrap().0;
	reorder_sidebar_in(&db, &[group(&pro, &[bravo, alpha]), project(charlie)]).expect("reorder");

	assert_eq!(labels(&db), vec!["Pro", "charlie"]);
	assert_eq!(children_of(&db, 0), vec!["bravo", "alpha"]);
	// Each scope numbered from zero independently.
	assert_eq!(ordinals(&db), vec![0, 1, 0, 1]);
}

/// An empty group is a container you made on purpose (F1). It survives a
/// reorder rather than being tidied away.
#[test]
fn an_empty_group_survives_a_reorder() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let rows = three_projects(tmp.path(), &db);
	create_group_in(&db, Some("Perso")).expect("create");
	let perso = row_id(&db, "Perso");

	let mut order: Vec<SidebarOrder> = rows.iter().map(|(id, _)| project(id)).collect();
	order.push(group(&perso, &[]));
	reorder_sidebar_in(&db, &order).expect("reorder");

	assert_eq!(labels(&db), vec!["charlie", "bravo", "alpha", "Perso"]);
	assert_eq!(children_of(&db, 3), Vec::<String>::new());
}

/// Moving a project from one group to another is **one** write. That is the
/// whole reason this command takes the tree rather than a scope at a time.
#[test]
fn moves_a_project_between_groups_atomically() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let rows = three_projects(tmp.path(), &db);
	create_group_in(&db, Some("Pro")).expect("create");
	create_group_in(&db, Some("Perso")).expect("create");
	let pro = row_id(&db, "Pro");
	let perso = row_id(&db, "Perso");
	let alpha = &rows.iter().find(|(_, n)| n == "alpha").unwrap().0;
	let bravo = &rows.iter().find(|(_, n)| n == "bravo").unwrap().0;
	let charlie = &rows.iter().find(|(_, n)| n == "charlie").unwrap().0;

	reorder_sidebar_in(&db, &[group(&pro, &[alpha, bravo]), group(&perso, &[charlie])])
		.expect("first");
	assert_eq!(children_of(&db, 0), vec!["alpha", "bravo"]);
	assert_eq!(children_of(&db, 1), vec!["charlie"]);

	// bravo crosses over, in one call.
	reorder_sidebar_in(&db, &[group(&pro, &[alpha]), group(&perso, &[bravo, charlie])])
		.expect("second");
	assert_eq!(children_of(&db, 0), vec!["alpha"]);
	assert_eq!(children_of(&db, 1), vec!["bravo", "charlie"]);
}

/// A project can be pulled back out to the top level the same way.
#[test]
fn pulls_a_project_back_out_to_the_top_level() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let rows = three_projects(tmp.path(), &db);
	create_group_in(&db, Some("Pro")).expect("create");
	let pro = row_id(&db, "Pro");
	let ids: Vec<&String> = rows.iter().map(|(id, _)| id).collect();

	reorder_sidebar_in(&db, &[group(&pro, &[ids[0], ids[1], ids[2]])]).expect("file all");
	assert_eq!(labels(&db), vec!["Pro"]);

	reorder_sidebar_in(&db, &[project(ids[0]), group(&pro, &[ids[1], ids[2]])]).expect("pull out");
	assert_eq!(labels(&db), vec!["charlie", "Pro"]);
	assert_eq!(children_of(&db, 1), vec!["bravo", "alpha"]);
}

// ── Refusals ────────────────────────────────────────────────────────────────

/// A project removed between the render and the drop. The tree the renderer
/// computed describes a sidebar that no longer exists.
#[test]
fn rejects_an_order_naming_a_row_that_is_gone() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let rows = three_projects(tmp.path(), &db);
	let before = ordinals(&db);

	let mut order: Vec<SidebarOrder> = rows.iter().map(|(id, _)| project(id)).collect();
	order.push(project("a-row-that-never-existed"));

	let err = reorder_sidebar_in(&db, &order).expect_err("must refuse");
	assert!(matches!(err, AppError::InvalidInput(_)), "got {err:?}");
	assert_eq!(ordinals(&db), before, "a rejected reorder writes nothing at all");
}

/// The mirror image, and the reason the check is set equality rather than "every
/// id I was given exists": an order that omits a row would otherwise be applied,
/// leaving that row wherever it happened to be.
#[test]
fn rejects_an_order_that_omits_a_row() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let rows = three_projects(tmp.path(), &db);
	let before = ordinals(&db);

	let order: Vec<SidebarOrder> = rows.iter().take(2).map(|(id, _)| project(id)).collect();

	let err = reorder_sidebar_in(&db, &order).expect_err("must refuse");
	assert!(matches!(err, AppError::InvalidInput(_)), "got {err:?}");
	assert_eq!(ordinals(&db), before);
}

/// A duplicate has the right *set* and the wrong *list*.
#[test]
fn rejects_an_order_containing_a_duplicate() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let rows = three_projects(tmp.path(), &db);
	let before = ordinals(&db);

	let order = vec![project(&rows[0].0), project(&rows[0].0), project(&rows[1].0)];

	let err = reorder_sidebar_in(&db, &order).expect_err("must refuse");
	assert!(matches!(err, AppError::InvalidInput(_)), "got {err:?}");
	assert_eq!(ordinals(&db), before);
}

/// The two-level version of the duplicate case, and the one a per-scope check
/// would miss entirely: the row appears once at the top level and once inside a
/// group, so each scope on its own looks fine.
#[test]
fn rejects_a_row_that_appears_at_two_levels() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let rows = three_projects(tmp.path(), &db);
	create_group_in(&db, Some("Pro")).expect("create");
	let pro = row_id(&db, "Pro");
	let before = ordinals(&db);

	let order =
		vec![project(&rows[0].0), group(&pro, &[&rows[0].0, &rows[1].0]), project(&rows[2].0)];

	let err = reorder_sidebar_in(&db, &order).expect_err("must refuse");
	assert!(matches!(err, AppError::InvalidInput(_)), "got {err:?}");
	assert_eq!(ordinals(&db), before);
}

/// **No sub-groups.** The schema's `CHECK (kind = 'project' OR parent_id IS
/// NULL)` makes this unwritable; the command's own check is what turns it into a
/// sentence rather than a constraint-violation string.
#[test]
fn rejects_a_group_nested_inside_a_group() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	three_projects(tmp.path(), &db);
	create_group_in(&db, Some("Pro")).expect("create");
	create_group_in(&db, Some("Perso")).expect("create");
	let pro = row_id(&db, "Pro");
	let perso = row_id(&db, "Perso");
	let before = ordinals(&db);

	let mut order = vec![group(&pro, &[&perso])];
	for (id, _) in three_projects_ids(&db) {
		order.push(project(&id));
	}

	let err = reorder_sidebar_in(&db, &order).expect_err("must refuse");
	assert!(matches!(err, AppError::InvalidInput(_)), "got {err:?}");
	assert_eq!(ordinals(&db), before);
}

/// Top-level rows that are projects, for the nesting test above.
fn three_projects_ids(db: &Db) -> Vec<(String, String)> {
	top_level(db).into_iter().filter(|(_, n)| !matches!(n.as_str(), "Pro" | "Perso")).collect()
}

/// Calling a group a project, or a project a group, is a renderer bug rather
/// than a stale list — and it gets its own message so it reads as one.
#[test]
fn rejects_a_group_declared_as_a_project() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let rows = three_projects(tmp.path(), &db);
	create_group_in(&db, Some("Pro")).expect("create");
	let pro = row_id(&db, "Pro");

	let mut order = vec![project(&pro)];
	order.extend(rows.iter().map(|(id, _)| project(id)));

	let err = reorder_sidebar_in(&db, &order).expect_err("must refuse");
	assert!(matches!(err, AppError::InvalidInput(_)), "got {err:?}");
}

/// An empty sidebar is not an error, and neither is reordering nothing.
#[test]
fn an_empty_order_against_an_empty_sidebar_is_fine() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());

	reorder_sidebar_in(&db, &[]).expect("reorder nothing");

	assert!(labels(&db).is_empty());
}

// ── Group lifecycle ─────────────────────────────────────────────────────────

#[test]
fn a_new_group_lands_on_top_with_the_default_name() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	three_projects(tmp.path(), &db);

	create_group_in(&db, None).expect("create");

	assert_eq!(labels(&db)[0], "New group");
}

#[test]
fn renames_a_group_and_trims_the_name() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	create_group_in(&db, Some("Pro")).expect("create");
	let pro = row_id(&db, "Pro");

	rename_group_in(&db, &pro, "  Perso  ").expect("rename");

	assert_eq!(labels(&db), vec!["Perso"]);
}

/// A group with no name is a row you cannot see or address, so it is refused
/// rather than silently defaulted — the renderer's editor keeps the previous
/// name on Escape, so nothing needs an empty one accepted.
#[test]
fn refuses_an_empty_group_name() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	create_group_in(&db, Some("Pro")).expect("create");
	let pro = row_id(&db, "Pro");

	let err = rename_group_in(&db, &pro, "   ").expect_err("must refuse");
	assert!(matches!(err, AppError::InvalidInput(_)), "got {err:?}");
	assert_eq!(labels(&db), vec!["Pro"]);

	let err = create_group_in(&db, Some("")).expect_err("must refuse");
	assert!(matches!(err, AppError::InvalidInput(_)), "got {err:?}");
}

#[test]
fn renaming_a_row_that_is_not_a_group_is_not_found() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let rows = three_projects(tmp.path(), &db);

	let err = rename_group_in(&db, &rows[0].0, "Nope").expect_err("must refuse");
	assert!(matches!(err, AppError::NotFound(_)), "got {err:?}");
}

/// **Removing a group splices its children into the group's own position**,
/// keeping the order they had inside it. The list should look like the group's
/// box was erased — not like its contents were flung to one end.
#[test]
fn removing_a_group_splices_its_projects_into_its_place() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	// Four projects, so there is something both above and below the group.
	for name in ["one", "two", "three", "four"] {
		let dir = tmp.path().join("code").join(name);
		std::fs::create_dir_all(&dir).unwrap();
		add_project_in(&db, dir.to_str().unwrap()).expect("add");
	}
	create_group_in(&db, Some("Pro")).expect("create");
	let pro = row_id(&db, "Pro");
	let ids: Vec<String> =
		top_level(&db).into_iter().filter(|(_, n)| n != "Pro").map(|(id, _)| id).collect();

	// four, [Pro: three, two], one
	reorder_sidebar_in(
		&db,
		&[project(&ids[0]), group(&pro, &[&ids[1], &ids[2]]), project(&ids[3])],
	)
	.expect("arrange");
	assert_eq!(labels(&db), vec!["four", "Pro", "one"]);

	remove_group_in(&db, &pro).expect("remove");

	// The box is erased and its contents keep their order, in its slot.
	assert_eq!(labels(&db), vec!["four", "three", "two", "one"]);
	assert!(ordinals(&db).windows(2).all(|w| w[0] < w[1]), "no collisions: {:?}", ordinals(&db));
}

/// Removing an empty group is just a deletion — nothing to splice, nothing to
/// shift.
#[test]
fn removing_an_empty_group_leaves_everything_else_alone() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let rows = three_projects(tmp.path(), &db);
	create_group_in(&db, Some("Pro")).expect("create");
	let pro = row_id(&db, "Pro");
	let mut order = vec![project(&rows[0].0), group(&pro, &[]), project(&rows[1].0)];
	order.push(project(&rows[2].0));
	reorder_sidebar_in(&db, &order).expect("arrange");

	remove_group_in(&db, &pro).expect("remove");

	assert_eq!(labels(&db), vec!["charlie", "bravo", "alpha"]);
}

/// It un-files, it never deletes (F1). The projects are all still there.
#[test]
fn removing_a_group_keeps_every_project() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let rows = three_projects(tmp.path(), &db);
	create_group_in(&db, Some("Pro")).expect("create");
	let pro = row_id(&db, "Pro");
	let ids: Vec<&String> = rows.iter().map(|(id, _)| id).collect();
	reorder_sidebar_in(&db, &[group(&pro, &[ids[0], ids[1], ids[2]])]).expect("file all");

	remove_group_in(&db, &pro).expect("remove");

	let count: i64 = db
		.with(|conn| Ok(conn.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))?))
		.expect("count");
	assert_eq!(count, 3);
	assert_eq!(labels(&db), vec!["charlie", "bravo", "alpha"]);
}

#[test]
fn removing_a_row_that_is_not_a_group_is_not_found() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	let rows = three_projects(tmp.path(), &db);

	let err = remove_group_in(&db, &rows[0].0).expect_err("must refuse");
	assert!(matches!(err, AppError::NotFound(_)), "got {err:?}");
}

/// The schema is the backstop, not just the command: a hand-written INSERT that
/// nests a group is refused by the CHECK.
#[test]
fn the_schema_itself_forbids_a_nested_group() {
	let tmp = TempDir::new().unwrap();
	let db = open_db(tmp.path());
	create_group_in(&db, Some("Pro")).expect("create");
	let pro = row_id(&db, "Pro");

	let result = db.with(|conn| {
		conn.execute(
			"INSERT INTO sidebar_rows(id, kind, parent_id, sort_order, project_id, name)
			 VALUES('nested', 'group', ?1, 0, NULL, 'Sub')",
			params![pro],
		)?;
		Ok(())
	});

	assert!(result.is_err(), "the CHECK must refuse a group with a parent");
}
