# ADR-0024 — The sidebar is a tree of rows

**Date:** 2026-08-27
**Status:** Accepted

**Supersedes:** [ADR-0023 — project order is a stored ordinal the user writes](0023-project-order-is-a-stored-ordinal-the-user-writes.md)

Related, and **neither superseded**:
[ADR-0011 — a project is a folder in the workspace](0011-a-project-is-a-folder-in-the-workspace.md) ·
[ADR-0016 — dnd-kit for pointer-based reordering](0016-dnd-kit-for-pointer-based-reordering.md)

## Context

ADR-0023, one day old at the time of writing, put the sidebar's order on the
project row: `projects.sort_order`, an integer the user writes by dragging. That
is the right model for a flat list, and the sidebar was a flat list.

Groups make it two levels. The obvious extension — the one the roadmap entry for
this work proposed — is a `project_groups` table plus a `group_id` column on the
project, keeping `sort_order` where it is. Under that model the column means two
different things depending on a *different* column's value: position among
top-level rows when `group_id` is NULL, position within the group when it is set.
Every query that reads it has to know which case it is in, and a project's
position stops being a fact about the project.

There is a second problem underneath that one. With order split across two tables
(`project_groups.sort_order` for groups, `projects.sort_order` for loose
projects), a group row and a loose project cannot be compared — so they cannot
interleave, and "one ordered list of rows where some rows expand" becomes "groups
first, then everything else". That is the two-tier list ADR-0023 had just
flattened, reintroduced by the storage rather than by a design decision.

## Decision

**The sidebar's structure is one table of rows. A project has no position of its
own; it has a row, and the row has a position.**

```sql
CREATE TABLE sidebar_rows (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('group','project')),
  parent_id  TEXT REFERENCES sidebar_rows(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT,
  CHECK (kind = 'project' OR parent_id IS NULL),
  CHECK ((kind='group'   AND project_id IS NULL     AND name IS NOT NULL)
      OR (kind='project' AND project_id IS NOT NULL AND name IS NULL))
);
```

1. **`sort_order` is scoped to `parent_id`** and means one thing: position among
   siblings. NULL parent is the top level, where group rows and loose project
   rows sit in the same sequence and therefore interleave.

2. **A group *is* a row.** There is no `project_groups` table. A group has no
   attributes beyond a name today, so a second table would buy a join and the
   possibility of a group with no row, or a row pointing at no group. If a group
   later gains a colour, that column goes here.

3. **`projects.sort_order` is dropped** (migration 0012). Two columns holding one
   fact is the bug this model exists to prevent, and we had just removed `pinned`
   for the same reason. The order carries forward: 0012 seeds the rows from it
   before dropping it.

4. **No sub-groups, enforced by `CHECK (kind = 'project' OR parent_id IS NULL)`.**
   In the schema and not only in the commands, so nesting is unwritable whichever
   command has a bug — and so the constraint is stated where the next reader
   looks. The commands validate too, for a readable error instead of a constraint
   string.

5. **One command writes the whole tree.** `reorder_sidebar(rows)` replaces
   `reorder_projects(ids)` and keeps its rule: reject anything that is not exactly
   the current set of rows, each once. Extended to two levels, that rejection now
   also catches a row named at two levels at once, which a per-scope check cannot
   see. And it is the only shape where moving a project *between* groups is one
   atomic write — a scoped reorder plus a separate membership write would make one
   gesture two calls, either of which can be rejected while the other lands.

6. **`list_sidebar()` returns the tree, already ordered**, and carries **no
   ordinals**. `list_projects()` stays flat and alphabetical for the four surfaces
   that want a list of projects. The wire shape is ids and order, not numbers: the
   ordinals are sparse by design (a new row gets `MIN(sort_order) - 1` so it lands
   on top without renumbering), so a number the renderer could see would be one it
   must not do arithmetic with.

7. **`remove_group` splices the children into the group's own position**, keeping
   their internal order. `ON DELETE SET NULL` on `parent_id` is a safety net for a
   bug elsewhere, not the mechanism: relying on it would drop the freed projects at
   the top level still carrying their intra-group ordinals, colliding with whatever
   is up there.

Everything else ADR-0023 decided **survives and is restated**: the user writes the
order by dragging, the derived orders (`Name`, `Recent`) are views over it that
write nothing, the drag is `Manual`-only, and there is no pinned flag.

## Why this supersedes ADR-0023, when 0023 superseded nothing

Worth recording, because the two calls went opposite ways one day apart and the
reasoning is the same test in both directions: **is a shipped decision being
revised, or extended?**

ADR-0023 declined to supersede ADR-0011 and ADR-0016 because neither of their
decisions changed — 0011 decided project identity is a uuid (still true; it merely
*cited* pins as a benefit), and 0016 decided the drag library (still true; only
its sentence naming the future surface read stale). Marking them superseded would
have told a later reader that a project is no longer a folder in the workspace.

Here the decision itself is what changes. ADR-0023's sentence is "order is a
stored **per-project ordinal**", and that column is being deleted. A reader
following 0023 would go looking for `projects.sort_order` and for
`reorder_projects`, and find neither. That is exactly what a supersede link is
for, so it gets one.

## Consequences

**What gets better.** Group rows and loose projects interleave, so the sidebar
stays one list. One gesture covers reordering *and* filing, because the drop
target decides the level. And the ordering rule is one sentence again — position
among siblings — rather than one sentence per case.

**`Name` and `Recent` dissolve the groups.** They flatten every project into one
derived list, including the ones inside collapsed groups. A group row is part of
the *arrangement*, and those two modes are a way to find a row rather than a way
to view the arrangement; sorting within and among groups instead would make the
control mean one thing at the top level and another inside, which is the exact
criticism ADR-0023 made of the old pinned block. The cost is that switching mode
visibly changes the sidebar's shape.

**A drag and a keyboard nudge are not the same operation**, which was not obvious
until this landed. A drag *aims* at a target, so dropping on a group's header
sensibly means "the top of this group". A nudge *walks* the list, and the slot
above a group's first child is the top level, not the top of that group. Routing
the nudge through the drag's rule made `Alt`+ArrowUp on a first child a permanent
no-op. They are `moveRow` and `nudgeRow`, and the split is deliberate.

**Ordinals stay sparse, on purpose.** `add_project` and `create_group` write
`MIN(sort_order) - 1`; `remove_project` leaves a hole. Reads tie-break on the
project's `display_name` so the order is deterministic anyway, and only
`reorder_sidebar` renumbers. Nothing may assume `sort_order` is a permutation of
`0..n-1`.

**One thing deliberately left possible and not built.** Scoping search to a group
("search only Pro") is the obvious next ask. `name` living on the row rather than
in a renderer preference is what keeps it available; nothing here builds it.
