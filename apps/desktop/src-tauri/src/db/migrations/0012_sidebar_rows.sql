-- The sidebar is a tree of rows, not a list of projects.
--
-- Migration 0011 put the sidebar's order on the project row itself, as
-- `projects.sort_order`. That works exactly as long as the sidebar is flat.
-- Groups make it two levels, and the shape 0011 implies — a `group_id` column
-- plus an ordinal that means "position at the top level" or "position inside my
-- group" depending on whether that column is set — is one column carrying two
-- facts. See ADR-0024, which supersedes ADR-0023 for this reason.
--
-- After this migration the order lives in one place and means one thing:
-- `sidebar_rows.sort_order`, scoped to `parent_id`.

-- ── The tree ────────────────────────────────────────────────────────────────

CREATE TABLE sidebar_rows (
	-- uuid v4, like a project's. A row id is durable: it survives a rename, and
	-- `sidebarStore.expanded` persists group ids against it.
	id         TEXT PRIMARY KEY,
	-- Denormalised on purpose. It is derivable from which of `project_id` /
	-- `name` is non-null, but naming the kind is what makes the CHECKs below
	-- readable and lets a query filter groups without testing for NULL.
	kind       TEXT NOT NULL CHECK (kind IN ('group', 'project')),
	-- NULL means top level. A project row's parent is the group holding it.
	--
	-- ON DELETE SET NULL is a **safety net, not the mechanism**: `remove_group`
	-- splices the children into the group's own position in one transaction,
	-- keeping the order they had inside it. Relying on the cascade alone would
	-- drop them at the top level still carrying their intra-group ordinals,
	-- which collide with whatever is already there — a sidebar that reshuffles
	-- itself on a delete. The clause exists so that a bug elsewhere loses a
	-- grouping rather than a project.
	parent_id  TEXT REFERENCES sidebar_rows(id) ON DELETE SET NULL,
	-- Position **within `parent_id`**. Sparse-tolerant, exactly as 0011's was:
	-- `create_group` and `add_project` write `MIN(sort_order) - 1` to land on
	-- top without renumbering, and `reorder_sidebar` renumbers each scope
	-- densely from zero. Reads tie-break on the project's `display_name`.
	sort_order INTEGER NOT NULL,
	-- Set on a project row, NULL on a group row.
	--
	-- ON DELETE CASCADE so `remove_project` retires the row with the project.
	-- Without it a row could point at nothing, and `list_sidebar` would have to
	-- decide what to render for it.
	project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
	-- Set on a group row, NULL on a project row. **A group is a row** — there is
	-- no `project_groups` table. A group has no attributes beyond its name
	-- today, so a second table would add a join and the possibility of a group
	-- with no row, or a row pointing at no group.
	name       TEXT,

	-- **This is what forbids sub-groups.** In the schema rather than only in the
	-- command, so nesting cannot be written whichever command has a bug — and so
	-- the constraint is stated where the next reader looks for it. The commands
	-- validate too, for a readable error.
	CHECK (kind = 'project' OR parent_id IS NULL),
	-- Exactly one of the two payloads, matching the kind. A row that is neither
	-- a group nor a project is not a row this app can draw.
	CHECK ((kind = 'group' AND project_id IS NULL AND name IS NOT NULL)
	    OR (kind = 'project' AND project_id IS NOT NULL AND name IS NULL))
);

-- One row per project in the workspace, keyed by uuid, carrying 0011's order
-- forward so nobody's sidebar reshuffles on upgrade. The standard randomblob()
-- v4 construction, the same one migration 0004 used to reissue project ids.
CREATE INDEX idx_sidebar_rows_parent ON sidebar_rows(parent_id, sort_order);
CREATE UNIQUE INDEX idx_sidebar_rows_project ON sidebar_rows(project_id)
	WHERE project_id IS NOT NULL;

-- ── Carry 0011's order forward ──────────────────────────────────────────────

INSERT INTO sidebar_rows(id, kind, parent_id, sort_order, project_id, name)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
		|| substr(lower(hex(randomblob(2))), 2) || '-'
		|| substr('89ab', abs(random()) % 4 + 1, 1)
		|| substr(lower(hex(randomblob(2))), 2) || '-'
		|| lower(hex(randomblob(6))),
	'project',
	NULL,
	sort_order,
	id,
	NULL
FROM projects;

-- ── And the column goes ─────────────────────────────────────────────────────
--
-- Simpler than 0011's drop of `pinned`: this column has no CHECK constraint at
-- all, so there is nothing for SQLite's DROP COLUMN restriction to catch. (That
-- restriction is on *table-level* CHECKs — see 0011's comment, which is where
-- the measurement is recorded.) Two columns holding one fact is the bug this
-- table exists to prevent, so the old one does not get to linger.

ALTER TABLE projects DROP COLUMN sort_order;
