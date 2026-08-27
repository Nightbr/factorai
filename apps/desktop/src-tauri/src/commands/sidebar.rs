//! The sidebar's tree: what order the rows are in, and which group holds which
//! project. See specs/05-features.md F1 and ADR-0024.
//!
//! **One command writes the whole tree.** `reorder_sidebar` receives the entire
//! structure and rejects anything that is not exactly the current set of rows.
//! That is ADR-0023's rule extended to two levels, and it is the only shape
//! where dragging a project from one group into another is a single atomic
//! write — a scoped "reorder within this group" plus a separate "reorder the top
//! level" would make that one gesture two calls, either of which can be rejected
//! while the other lands.
//!
//! Ordinals here are **sparse on purpose**, exactly as migration 0011's were:
//! `create_group` and `add_project` write `MIN(sort_order) - 1` to land a new row
//! on top without renumbering the table, and only `reorder_sidebar` makes them
//! dense again. Nothing may assume `sort_order` is a permutation of `0..n-1`.

use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Deserialize;
use tauri::State;

use crate::commands::projects::list_projects_in;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::{Project, SidebarChild, SidebarRow};
use crate::state::AppState;

/// The name a group gets before the user types one. The renderer opens the
/// inline editor with this selected, so it is a starting point rather than a
/// label anyone should have to live with.
pub const DEFAULT_GROUP_NAME: &str = "New group";

/// One top-level entry of the order the renderer is asking for.
///
/// Deliberately **not** [`SidebarRow`]: what comes back from the renderer is ids
/// in order and nothing else. Accepting the same struct it renders would mean
/// accepting names and project payloads on a command whose whole job is
/// ordering, and then deciding whether to trust them.
///
/// **`tag = "kind"` and `rename_all_fields` are both load-bearing.** Without the
/// tag serde uses its *externally tagged* representation — `{"Project":{…}}` —
/// so every call from the renderer, which sends `{"kind":"project","rowId":…}`,
/// failed to deserialize and the command never ran. And `rename_all` on an enum
/// renames only the variants, so the fields would have stayed `row_id`. Both
/// were wrong on the way in and neither was visible from the TS side; see
/// `tests/wire_shape.rs`.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SidebarOrder {
	/// A project at the top level, addressed by its row id.
	Project { row_id: String },
	/// A group and the row ids of the projects inside it, in order.
	Group { row_id: String, children: Vec<String> },
}

// ── Reading ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_sidebar(state: State<'_, AppState>) -> AppResult<Vec<SidebarRow>> {
	state.db.with(list_sidebar_in)
}

/// The tree, already ordered.
///
/// Two queries and an in-memory assembly rather than one recursive CTE: the rows
/// are counted in tens, the project payload is the same `PROJECT_SELECT` every
/// other command uses (so the shape cannot drift), and a CTE that had to carry
/// those aggregate subqueries through a join would be harder to read than this
/// is to write.
///
/// The `display_name` tie-break is doing real work — see this module's header on
/// sparse ordinals.
pub fn list_sidebar_in(conn: &Connection) -> AppResult<Vec<SidebarRow>> {
	let projects = list_projects_in(conn)?;
	let by_id: std::collections::HashMap<&str, &Project> =
		projects.iter().map(|p| (p.id.as_str(), p)).collect();

	let mut stmt = conn.prepare(
		"SELECT r.id, r.kind, r.parent_id, r.name, r.project_id
		   FROM sidebar_rows r
		   LEFT JOIN projects p ON p.id = r.project_id
		  ORDER BY r.sort_order, COALESCE(p.display_name, r.name) COLLATE NOCASE",
	)?;
	let rows: Vec<RawRow> = stmt
		.query_map([], |r| {
			Ok(RawRow {
				id: r.get(0)?,
				kind: r.get(1)?,
				parent_id: r.get(2)?,
				name: r.get(3)?,
				project_id: r.get(4)?,
			})
		})?
		.collect::<rusqlite::Result<_>>()?;
	drop(stmt);

	// Two passes so a child can be attached whatever order the flat result
	// arrived in — the ORDER BY above sorts within each scope, but a group's rows
	// and its children are interleaved in one result set.
	let mut out: Vec<SidebarRow> = Vec::new();
	let mut group_index: std::collections::HashMap<String, usize> =
		std::collections::HashMap::new();
	for row in rows.iter().filter(|r| r.parent_id.is_none()) {
		if row.kind == "group" {
			group_index.insert(row.id.clone(), out.len());
			out.push(SidebarRow::Group {
				row_id: row.id.clone(),
				// NOT NULL for a group row by CHECK; the fallback is for a
				// database somebody edited by hand.
				name: row.name.clone().unwrap_or_default(),
				children: Vec::new(),
			});
			continue;
		}
		// A row whose project is gone should be impossible — ON DELETE CASCADE
		// retires it — so skipping is a guard, not a branch the UI depends on.
		let Some(project) = row.project(&by_id) else { continue };
		out.push(SidebarRow::Project { row_id: row.id.clone(), project });
	}
	for row in &rows {
		let Some(parent) = row.parent_id.as_deref() else { continue };
		let Some(&index) = group_index.get(parent) else { continue };
		let Some(project) = row.project(&by_id) else { continue };
		if let Some(SidebarRow::Group { children, .. }) = out.get_mut(index) {
			children.push(SidebarChild { row_id: row.id.clone(), project });
		}
	}
	Ok(out)
}

/// One `sidebar_rows` row as the database hands it back, before it becomes a
/// [`SidebarRow`]. A named struct rather than a five-wide tuple, which clippy
/// objects to and which nobody could read at the call site anyway.
struct RawRow {
	id: String,
	kind: String,
	parent_id: Option<String>,
	name: Option<String>,
	project_id: Option<String>,
}

impl RawRow {
	fn project(&self, by_id: &std::collections::HashMap<&str, &Project>) -> Option<Project> {
		self.project_id.as_deref().and_then(|pid| by_id.get(pid)).map(|p| (*p).clone())
	}
}

// ── Writing the order ───────────────────────────────────────────────────────

#[tauri::command]
pub fn reorder_sidebar(state: State<'_, AppState>, rows: Vec<SidebarOrder>) -> AppResult<()> {
	reorder_sidebar_in(&state.db, &rows)
}

/// The body of [`reorder_sidebar`], taking the database directly so the rule can
/// be tested without a Tauri app.
///
/// **Strict on a stale set**, both directions and at both levels: the row ids it
/// is handed must be exactly the row ids in the table, each appearing once.
/// A project added or removed between the render and the drop is the case this
/// exists for — applying a partial order to a list the user never saw is worse
/// than doing nothing and saying so.
pub fn reorder_sidebar_in(db: &Db, rows: &[SidebarOrder]) -> AppResult<()> {
	db.with_mut(|conn| {
		let tx = conn.transaction()?;

		let mut stmt = tx.prepare("SELECT id, kind FROM sidebar_rows")?;
		let existing: Vec<(String, String)> =
			stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
		drop(stmt);
		let known: HashSet<&str> = existing.iter().map(|(id, _)| id.as_str()).collect();
		let groups: HashSet<&str> =
			existing.iter().filter(|(_, k)| k == "group").map(|(id, _)| id.as_str()).collect();

		// Flatten what we were given, so the set comparison is one pass and the
		// duplicate check covers a row named twice at two different levels — the
		// case a per-scope check would miss entirely.
		let mut seen: Vec<&str> = Vec::new();
		for row in rows {
			match row {
				SidebarOrder::Project { row_id } => seen.push(row_id),
				SidebarOrder::Group { row_id, children } => {
					seen.push(row_id);
					for child in children {
						seen.push(child);
					}
				}
			}
		}
		let unique: HashSet<&str> = seen.iter().copied().collect();
		if unique.len() != seen.len() || existing.len() != seen.len() {
			return Err(AppError::InvalidInput(format!(
				"reorder_sidebar: got {} rows ({} unique) for {} in the sidebar",
				seen.len(),
				unique.len(),
				existing.len()
			)));
		}
		if let Some(unknown) = seen.iter().find(|id| !known.contains(**id)) {
			return Err(AppError::InvalidInput(format!("reorder_sidebar: no such row {unknown}")));
		}

		// A group named as a top-level entry must actually be a group, and a
		// group can never be a child — the schema's CHECK would reject the
		// second, but a clear error beats a constraint violation surfacing as a
		// database error string.
		for row in rows {
			match row {
				SidebarOrder::Project { row_id } if groups.contains(row_id.as_str()) => {
					return Err(AppError::InvalidInput(format!(
						"reorder_sidebar: row {row_id} is a group, not a project"
					)));
				}
				SidebarOrder::Group { row_id, children } => {
					if !groups.contains(row_id.as_str()) {
						return Err(AppError::InvalidInput(format!(
							"reorder_sidebar: row {row_id} is not a group"
						)));
					}
					if let Some(nested) = children.iter().find(|c| groups.contains(c.as_str())) {
						return Err(AppError::InvalidInput(format!(
							"reorder_sidebar: {nested} is a group and groups do not nest"
						)));
					}
				}
				SidebarOrder::Project { .. } => {}
			}
		}

		// Dense from zero within each scope, so ordinals stay small and any gap
		// left by a removal is repaired by the next drag.
		let mut stmt =
			tx.prepare("UPDATE sidebar_rows SET parent_id = ?2, sort_order = ?3 WHERE id = ?1")?;
		for (index, row) in rows.iter().enumerate() {
			match row {
				SidebarOrder::Project { row_id } => {
					stmt.execute(params![row_id, None::<String>, index as i64])?;
				}
				SidebarOrder::Group { row_id, children } => {
					stmt.execute(params![row_id, None::<String>, index as i64])?;
					for (child_index, child) in children.iter().enumerate() {
						stmt.execute(params![child, Some(row_id), child_index as i64])?;
					}
				}
			}
		}
		drop(stmt);

		tx.commit()?;
		Ok(())
	})
}

// ── Groups ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn create_group(state: State<'_, AppState>, name: Option<String>) -> AppResult<SidebarRow> {
	create_group_in(&state.db, name.as_deref())
}

/// Create an empty group at the top of the sidebar.
///
/// **At the top, like a newly added project**: it is the thing you are about to
/// use, and the renderer opens its inline name editor immediately — which has to
/// be on screen to mean anything. `MIN(sort_order) - 1` rather than renumbering,
/// so this is one scalar read instead of an UPDATE over every top-level row.
pub fn create_group_in(db: &Db, name: Option<&str>) -> AppResult<SidebarRow> {
	let name = normalise_name(name.unwrap_or(DEFAULT_GROUP_NAME))?;
	let id = uuid::Uuid::new_v4().to_string();
	db.with(|conn| {
		conn.execute(
			"INSERT INTO sidebar_rows(id, kind, parent_id, sort_order, project_id, name)
			 VALUES(?1, 'group', NULL,
			        (SELECT COALESCE(MIN(sort_order), 0) - 1
			           FROM sidebar_rows WHERE parent_id IS NULL),
			        NULL, ?2)",
			params![id, name],
		)?;
		Ok(())
	})?;
	Ok(SidebarRow::Group { row_id: id, name, children: Vec::new() })
}

#[tauri::command]
pub fn rename_group(state: State<'_, AppState>, row_id: String, name: String) -> AppResult<()> {
	rename_group_in(&state.db, &row_id, &name)
}

pub fn rename_group_in(db: &Db, row_id: &str, name: &str) -> AppResult<()> {
	let name = normalise_name(name)?;
	db.with(|conn| {
		let changed = conn.execute(
			"UPDATE sidebar_rows SET name = ?2 WHERE id = ?1 AND kind = 'group'",
			params![row_id, name],
		)?;
		if changed == 0 {
			return Err(AppError::NotFound(format!("group {row_id}")));
		}
		Ok(())
	})
}

#[tauri::command]
pub fn remove_group(state: State<'_, AppState>, row_id: String) -> AppResult<()> {
	remove_group_in(&state.db, &row_id)
}

/// Remove a group, returning its projects to the top level.
///
/// **The children are spliced into the group's own position**, keeping the order
/// they had inside it, so the list looks like the group's box was erased rather
/// than like its contents were flung somewhere. `ON DELETE SET NULL` on
/// `parent_id` would technically survive this without the splice, but the
/// children would arrive at the top level still carrying their intra-group
/// ordinals — `0, 1, 2` colliding with whatever is already up there — which is a
/// sidebar that reshuffles itself on a delete.
///
/// Nothing about a project is touched: this un-files, it never deletes (F1).
pub fn remove_group_in(db: &Db, row_id: &str) -> AppResult<()> {
	db.with_mut(|conn| {
		let tx = conn.transaction()?;

		let position: Option<i64> = tx
			.query_row(
				"SELECT sort_order FROM sidebar_rows WHERE id = ?1 AND kind = 'group'",
				params![row_id],
				|r| r.get(0),
			)
			.optional()?;
		let Some(position) = position else {
			return Err(AppError::NotFound(format!("group {row_id}")));
		};

		let mut stmt = tx.prepare(
			"SELECT r.id FROM sidebar_rows r
			   LEFT JOIN projects p ON p.id = r.project_id
			  WHERE r.parent_id = ?1
			  ORDER BY r.sort_order, p.display_name COLLATE NOCASE",
		)?;
		let children: Vec<String> = stmt
			.query_map(params![row_id], |r| r.get::<_, String>(0))?
			.collect::<rusqlite::Result<_>>()?;
		drop(stmt);

		// Open a gap the size of the group's contents at the group's position, so
		// the freed projects land exactly where the group was rather than on top
		// of its former neighbours. One row wide already (the group itself), so
		// the shift is `len - 1` and a group holding one project needs none.
		if children.len() > 1 {
			tx.execute(
				"UPDATE sidebar_rows SET sort_order = sort_order + ?2
				  WHERE parent_id IS NULL AND sort_order > ?1",
				params![position, (children.len() - 1) as i64],
			)?;
		}
		let mut stmt =
			tx.prepare("UPDATE sidebar_rows SET parent_id = NULL, sort_order = ?2 WHERE id = ?1")?;
		for (offset, child) in children.iter().enumerate() {
			stmt.execute(params![child, position + offset as i64])?;
		}
		drop(stmt);

		tx.execute("DELETE FROM sidebar_rows WHERE id = ?1", params![row_id])?;
		tx.commit()?;
		Ok(())
	})
}

/// Trim a group name and refuse an empty one.
///
/// A group with no name is a row you cannot see or address, so this is an error
/// rather than a silent default — the renderer's editor already keeps the
/// previous name on Escape, so there is no flow that needs an empty one accepted.
fn normalise_name(name: &str) -> AppResult<String> {
	let trimmed = name.trim();
	if trimmed.is_empty() {
		return Err(AppError::InvalidInput("a group needs a name".into()));
	}
	Ok(trimmed.to_string())
}

/// Give a project a row at the top of the sidebar, or leave the one it has.
///
/// Called by `add_project`, which is idempotent by path — so this has to be too,
/// or re-adding a folder would give it a second row and `list_sidebar` would
/// draw it twice. The UNIQUE index on `project_id` would catch that; returning
/// early is what stops it becoming an error the user sees for doing something
/// reasonable.
pub fn ensure_project_row(tx: &Transaction<'_>, project_id: &str) -> AppResult<()> {
	let exists: bool = tx
		.query_row("SELECT 1 FROM sidebar_rows WHERE project_id = ?1", params![project_id], |_| {
			Ok(true)
		})
		.optional()?
		.unwrap_or(false);
	if exists {
		return Ok(());
	}
	tx.execute(
		"INSERT INTO sidebar_rows(id, kind, parent_id, sort_order, project_id, name)
		 VALUES(?1, 'project', NULL,
		        (SELECT COALESCE(MIN(sort_order), 0) - 1
		           FROM sidebar_rows WHERE parent_id IS NULL),
		        ?2, NULL)",
		params![uuid::Uuid::new_v4().to_string(), project_id],
	)?;
	Ok(())
}
