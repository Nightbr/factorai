import type { Project, SidebarChild, SidebarOrder, SidebarRow } from '@factorai/types';
import type { ProjectSort } from '@store/sidebarStore';

/**
 * The sidebar's tree rules (specs/05-features.md F1, ADR-0025).
 *
 * Pure and exported, which is the whole point: the part with actual rules —
 * what order the rows are in, what a drop means, what a mode switch shows — is
 * testable without rendering a sidebar. It lives in `lib/` rather than beside
 * the component because the tree is now shared by the row component, the drag
 * and the query cache.
 *
 * Grew out of `sortProjects` / `moveProject` in `Sidebar.tsx`, which were the
 * flat-list version of the same two rules.
 */

/** Case-insensitive, locale-aware, and the tiebreak under every other rule. */
function byName(a: Project, b: Project): number {
	return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
}

/** Every project in the tree, groups flattened away, in the order they appear. */
export function flattenProjects(rows: SidebarRow[]): Project[] {
	return rows.flatMap((row) =>
		row.kind === 'project' ? [row.project] : row.children.map((c) => c.project),
	);
}

/**
 * Order projects by a derived rule — the `name` and `recent` modes.
 *
 * `recent` puts a project Claude has never run in **last** rather than first:
 * `lastSessionAt` is null for a folder with no sessions, and "never used" is not
 * "used most recently", which is what a naive numeric compare against null
 * would decide.
 */
export function sortProjects(projects: Project[], sort: 'name' | 'recent'): Project[] {
	if (sort === 'name') return [...projects].sort(byName);
	return [...projects].sort(
		(a, b) =>
			(b.lastSessionAt ?? Number.NEGATIVE_INFINITY) -
				(a.lastSessionAt ?? Number.NEGATIVE_INFINITY) || byName(a, b),
	);
}

/**
 * What the sidebar renders for a given sort mode.
 *
 * **`name` and `recent` dissolve the groups**, flattening every project — those
 * inside collapsed groups included — into one derived list. A group row is part
 * of the *arrangement*, and these two modes are a way to find a row rather than
 * a way to view the arrangement, so leaving group boxes in place while sorting
 * inside them would make the control mean one thing at the top level and another
 * inside. That was the exact criticism ADR-0023 made of the old pinned block.
 *
 * `manual` returns the tree untouched — `list_sidebar` already ordered it, and
 * unlike the flat model there is no ordinal on the wire for the renderer to
 * re-sort by. The order *is* the array's order.
 */
export function viewRows(rows: SidebarRow[], sort: ProjectSort): SidebarRow[] {
	if (sort === 'manual') return rows;
	return sortProjects(flattenProjects(rows), sort).map((project) => ({
		kind: 'project' as const,
		// The row id the project actually has, so a mode switch does not change a
		// row's identity — React keys and `expanded` both depend on it.
		rowId: rowIdOf(rows, project.id) ?? `project-${project.id}`,
		project,
	}));
}

/** The row id carrying this project, wherever it sits. */
function rowIdOf(rows: SidebarRow[], projectId: string): string | undefined {
	for (const row of rows) {
		if (row.kind === 'project') {
			if (row.project.id === projectId) return row.rowId;
			continue;
		}
		const child = row.children.find((c) => c.project.id === projectId);
		if (child) return child.rowId;
	}
	return undefined;
}

/** The tree as the ids-only shape `reorder_sidebar` accepts. */
export function toOrder(rows: SidebarRow[]): SidebarOrder[] {
	return rows.map((row) =>
		row.kind === 'project'
			? { kind: 'project' as const, rowId: row.rowId }
			: { kind: 'group' as const, rowId: row.rowId, children: row.children.map((c) => c.rowId) },
	);
}

/**
 * Every row id in the tree, top level then children, in visual order.
 *
 * This is the list dnd-kit's `SortableContext` needs, and it is also the list
 * `Alt`+arrows walks — so a nudge and a drag agree about what "the next row" is
 * without either of them knowing about groups.
 */
export function visibleRowIds(rows: SidebarRow[], expanded: Set<string>): string[] {
	return rows.flatMap((row) => {
		if (row.kind === 'project') return [row.rowId];
		// A collapsed group's children are not drop targets — you cannot drop onto
		// something you cannot see. The dwell springs it open first (F1).
		return expanded.has(row.rowId) ? [row.rowId, ...row.children.map((c) => c.rowId)] : [row.rowId];
	});
}

/** Where a row sits: which group holds it, and at what index. */
interface Position {
	/** The group's row id, or null for the top level. */
	parent: string | null;
	index: number;
}

function locate(rows: SidebarRow[], rowId: string): Position | undefined {
	const top = rows.findIndex((r) => r.rowId === rowId);
	if (top >= 0) return { parent: null, index: top };
	for (const row of rows) {
		if (row.kind !== 'group') continue;
		const index = row.children.findIndex((c) => c.rowId === rowId);
		if (index >= 0) return { parent: row.rowId, index };
	}
	return undefined;
}

/** Pull a project row out of the tree, returning it and the tree without it. */
function extract(
	rows: SidebarRow[],
	rowId: string,
): { child: SidebarChild; rest: SidebarRow[] } | undefined {
	const top = rows.find((r) => r.rowId === rowId);
	if (top?.kind === 'project') {
		return {
			child: { rowId: top.rowId, project: top.project },
			rest: rows.filter((r) => r.rowId !== rowId),
		};
	}
	for (const row of rows) {
		if (row.kind !== 'group') continue;
		const child = row.children.find((c) => c.rowId === rowId);
		if (!child) continue;
		return {
			child,
			rest: rows.map((r) =>
				r.kind === 'group' && r.rowId === row.rowId
					? { ...r, children: r.children.filter((c) => c.rowId !== rowId) }
					: r,
			),
		};
	}
	return undefined;
}

/**
 * Move a row to where `overId` currently sits, and return the new tree.
 *
 * `arrayMove` semantics — lift the row out, then insert it at the index the drop
 * landed on — which is what `terminalStore.reorder` does for the tab strip, so
 * every drag in the app agrees about what a drop means.
 *
 * **The target decides the level**, which is what makes one gesture cover both
 * reordering and filing:
 *
 * - dropped on a top-level row → the moved row joins the top level there;
 * - dropped on a row inside a group → it joins that group there;
 * - dropped on a group row → it goes to the **start** of that group, which is
 *   what dropping onto the group's own header should mean.
 *
 * A **group** being dragged only ever moves among the top-level rows: dropping
 * one onto a row inside a group would be nesting, which the schema forbids, so
 * it lands beside that group instead.
 *
 * Returns the same array identity when nothing moves, so a click that grazed the
 * activation distance costs no render and no write.
 */
export function moveRow(rows: SidebarRow[], activeId: string, overId: string): SidebarRow[] {
	if (activeId === overId) return rows;
	const from = locate(rows, activeId);
	const to = locate(rows, overId);
	if (!from || !to) return rows;

	const active = rows.find((r) => r.rowId === activeId);
	if (active?.kind === 'group') {
		// A group moves among groups and loose projects, never into one. If the
		// drop landed inside a group, use that group's own slot.
		const target = to.parent ? locate(rows, to.parent) : to;
		if (!target || target.index === from.index) return rows;
		const next = rows.filter((r) => r.rowId !== activeId);
		next.splice(target.index, 0, active);
		return next;
	}

	const pulled = extract(rows, activeId);
	if (!pulled) return rows;
	const { child, rest } = pulled;

	const overRow = rows.find((r) => r.rowId === overId);
	if (overRow?.kind === 'group') {
		// Dropped on the group's own header: the top of its list.
		return rest.map((r) =>
			r.kind === 'group' && r.rowId === overId ? { ...r, children: [child, ...r.children] } : r,
		);
	}

	// **The index comes from the original tree, not from `rest`.** That is what
	// makes this `arrayMove` rather than "insert before the target": remove first,
	// then insert at the position the target held *before* the removal, so
	// dragging downwards lands after the target and dragging upwards lands before
	// it. Recomputing against `rest` instead shifts every downward move one short —
	// `[a, b, c]` with a dropped on c would give `[b, a, c]`. The tab strip and the
	// flat version this grew from both do it this way.
	if (to.parent) {
		return rest.map((r) => {
			if (r.kind !== 'group' || r.rowId !== to.parent) return r;
			const children = [...r.children];
			children.splice(Math.min(to.index, children.length), 0, child);
			return { ...r, children };
		});
	}

	const next = [...rest];
	next.splice(Math.min(to.index, next.length), 0, {
		kind: 'project',
		rowId: child.rowId,
		project: child.project,
	});
	return next;
}

/**
 * Step a row one slot up or down the sidebar as it is drawn — the keyboard path.
 *
 * **Not `moveRow` with a neighbour's id**, and the difference is the whole
 * reason this function exists. A drag *aims* at a target, so dropping on a
 * group's header sensibly means "the top of this group". A nudge *walks* the
 * list, and the slot visually above a group's first child is not inside that
 * group at all — it is the top level, just above the group. Routing the nudge
 * through `moveRow` made `Alt`+ArrowUp on a first child a no-op forever: the row
 * above it is the group header, which put it back at the top of the group it was
 * already at the top of. Caught by a smoke test, which is why one exists.
 *
 * So the rules here are an outliner's, stated as boundaries:
 *
 * - up from a group's **first** child → out, to just above the group;
 * - down from a group's **last** child → out, to just below the group;
 * - up into an **expanded** group above → to the end of it;
 * - down into an **expanded** group below → to the start of it;
 * - anything else → swap with the neighbour in the current scope.
 *
 * A **collapsed** group is stepped over rather than entered, for the same reason
 * its children are not drop targets: you cannot aim at what you cannot see.
 * Groups themselves only ever move among the top-level rows.
 */
export function nudgeRow(
	rows: SidebarRow[],
	rowId: string,
	delta: -1 | 1,
	expanded: Set<string>,
): SidebarRow[] {
	const at = locate(rows, rowId);
	if (!at) return rows;

	// A group steps among the top-level rows, and nowhere else.
	const active = rows.find((r) => r.rowId === rowId);
	if (active?.kind === 'group') {
		const to = at.index + delta;
		if (to < 0 || to >= rows.length) return rows;
		const next = rows.filter((r) => r.rowId !== rowId);
		next.splice(to, 0, active);
		return next;
	}

	const pulled = extract(rows, rowId);
	if (!pulled) return rows;
	const { child, rest } = pulled;
	const asRow: SidebarRow = { kind: 'project', rowId: child.rowId, project: child.project };

	if (at.parent) {
		const group = rows.find((r) => r.rowId === at.parent);
		if (group?.kind !== 'group') return rows;
		const leavingUp = delta === -1 && at.index === 0;
		const leavingDown = delta === 1 && at.index === group.children.length - 1;
		if (leavingUp || leavingDown) {
			// Out of the group, to the slot immediately beside it.
			const groupIndex = rest.findIndex((r) => r.rowId === at.parent);
			const next = [...rest];
			next.splice(leavingUp ? groupIndex : groupIndex + 1, 0, asRow);
			return next;
		}
		// Inside the group: swap with the neighbour.
		return rest.map((r) => {
			if (r.kind !== 'group' || r.rowId !== at.parent) return r;
			const children = [...r.children];
			children.splice(at.index + delta, 0, child);
			return { ...r, children };
		});
	}

	// A top-level project. The neighbour decides whether we step into a group.
	const neighbourIndex = at.index + delta;
	if (neighbourIndex < 0 || neighbourIndex >= rows.length) return rows;
	const neighbour = rows[neighbourIndex];
	if (neighbour.kind === 'group' && expanded.has(neighbour.rowId)) {
		return rest.map((r) =>
			r.kind === 'group' && r.rowId === neighbour.rowId
				? {
						...r,
						// Entering from above lands at the start; from below, at the end.
						children: delta === 1 ? [child, ...r.children] : [...r.children, child],
					}
				: r,
		);
	}
	const next = [...rest];
	next.splice(neighbourIndex, 0, asRow);
	return next;
}

/** Move a project row into a group, at the end of it. The menu's path. */
export function fileIntoGroup(rows: SidebarRow[], rowId: string, groupRowId: string): SidebarRow[] {
	const pulled = extract(rows, rowId);
	if (!pulled) return rows;
	return pulled.rest.map((r) =>
		r.kind === 'group' && r.rowId === groupRowId
			? { ...r, children: [...r.children, pulled.child] }
			: r,
	);
}

/** Pull a project row out of whatever group holds it, to the end of the top level. */
export function unfile(rows: SidebarRow[], rowId: string): SidebarRow[] {
	const at = locate(rows, rowId);
	if (!at?.parent) return rows;
	const pulled = extract(rows, rowId);
	if (!pulled) return rows;
	return [
		...pulled.rest,
		{ kind: 'project', rowId: pulled.child.rowId, project: pulled.child.project },
	];
}

/** Every group in the tree, for the `Move to group ▸` submenu. */
export function groupsOf(rows: SidebarRow[]): { rowId: string; name: string }[] {
	return rows
		.filter((r): r is Extract<SidebarRow, { kind: 'group' }> => r.kind === 'group')
		.map((r) => ({ rowId: r.rowId, name: r.name }));
}

/** The group holding this row, if any — what decides whether the menu offers
 *  `Remove from group`, and whether the dwell is offered at all. */
export function parentOf(rows: SidebarRow[], rowId: string): string | null {
	return locate(rows, rowId)?.parent ?? null;
}
