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

/**
 * The row with this id, wherever it sits — top level or inside a group.
 *
 * A group's children are `SidebarChild`, not `SidebarRow`, so a plain
 * `rows.find(...)` sees only the top level. That is exactly the bug this exists to
 * stop: `onDragStart` looked a row up that way, so dragging a project *inside* a
 * group produced no active row and the drag overlay rendered nothing at all.
 * A child is returned as the project row it is.
 */
export function rowFor(rows: SidebarRow[], rowId: string): SidebarRow | null {
	const top = rows.find((r) => r.rowId === rowId);
	if (top) return top;
	for (const row of rows) {
		if (row.kind !== 'group') continue;
		const child = row.children.find((c) => c.rowId === rowId);
		if (child) return { kind: 'project', rowId: child.rowId, project: child.project };
	}
	return null;
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

/**
 * Where a drop will land — computed once, then used for **both** the line the
 * user sees and the tree the drop writes.
 *
 * **This replaced a rule that inferred the position from the drag's direction.**
 * That rule had two failures the user hit immediately. Dropping on a group row
 * always meant *into* the group, so there was no way to put a project between two
 * groups or beside one — the only thing near a group you could target was its
 * inside. And nothing addressed the space after the last row, so a project could
 * not be moved to the bottom of the list at all.
 *
 * Now the pointer's position **within** the row decides, which is how every tree
 * with drag-and-drop does it: a container row has three zones and an ordinary row
 * has two. One descriptor, so the line cannot disagree with the outcome — they are
 * read from the same value.
 */
export type DropTarget =
	/** Immediately before or after `rowId`, **in `rowId`'s own scope** — inside a
	 *  group if that is where `rowId` lives. */
	| { kind: 'before' | 'after'; rowId: string }
	/** Into the group `rowId`, at the end of it. */
	| { kind: 'into'; rowId: string }
	/** The end of the top level. What the area below the last row means. */
	| { kind: 'end' }
	| null;

/** How much of a group row's height, at each end, means "beside" rather than
 *  "into". A quarter each: the middle half is the group itself, which is the
 *  common intent, and the edges are wide enough to hit without care. */
const GROUP_EDGE_ZONE = 0.25;

/**
 * Decide the drop from the row under the pointer and how far down it the pointer
 * sits (`fraction`, 0 at the row's top edge and 1 at its bottom).
 *
 * A **group** row gets three zones — before / into / after — because it is both a
 * position and a container. An ordinary row gets two. A **group being dragged**
 * never gets `into` from anything, since groups do not nest; dropped on a row
 * inside a group it lands beside that group, at the top level.
 */
export function dropTarget(
	rows: SidebarRow[],
	activeId: string,
	overId: string,
	fraction: number,
): DropTarget {
	if (activeId === overId) return null;
	const overRow = rowFor(rows, overId);
	const activeRow = rowFor(rows, activeId);
	if (!overRow || !activeRow) return null;

	const draggingAGroup = activeRow.kind === 'group';

	if (overRow.kind === 'group') {
		// Its own children are not a target while it is the thing under the pointer.
		if (draggingAGroup || fraction < GROUP_EDGE_ZONE) {
			return { kind: fraction < 0.5 ? 'before' : 'after', rowId: overId };
		}
		if (fraction > 1 - GROUP_EDGE_ZONE) return { kind: 'after', rowId: overId };
		return { kind: 'into', rowId: overId };
	}

	// A project row. If a *group* is being dragged onto a project that lives
	// inside a group, the group cannot go there — it lands beside the group that
	// holds the target instead.
	if (draggingAGroup) {
		const parent = parentOf(rows, overId);
		if (parent) return { kind: fraction < 0.5 ? 'before' : 'after', rowId: parent };
	}
	return { kind: fraction < 0.5 ? 'before' : 'after', rowId: overId };
}

/** What the sidebar draws for a target: a line on an edge, or a ring on a group. */
export type DropIndicator =
	| { kind: 'edge'; rowId: string; edge: 'above' | 'below' }
	| { kind: 'into'; rowId: string }
	| { kind: 'end' }
	| null;

export function indicatorFor(target: DropTarget): DropIndicator {
	if (!target) return null;
	if (target.kind === 'end') return { kind: 'end' };
	if (target.kind === 'into') return { kind: 'into', rowId: target.rowId };
	return {
		kind: 'edge',
		rowId: target.rowId,
		edge: target.kind === 'before' ? 'above' : 'below',
	};
}

/**
 * Apply a drop, returning the new tree.
 *
 * Insert-before / insert-after semantics, **not** `arrayMove`: the line said
 * "here", so the row goes exactly there. `arrayMove` was the old model and it made
 * the outcome depend on which way you had come from, which is impossible to draw
 * honestly and surprising to use.
 *
 * Returns the same array identity when nothing would change, so a click that
 * grazed the activation distance costs no render and no write.
 */
export function applyDrop(rows: SidebarRow[], activeId: string, target: DropTarget): SidebarRow[] {
	if (!target) return rows;
	const pulled = extract(rows, activeId);

	// A group being moved: only ever among the top-level rows.
	const activeRow = rows.find((r) => r.rowId === activeId);
	if (activeRow?.kind === 'group') {
		if (target.kind === 'into') return rows;
		const rest = rows.filter((r) => r.rowId !== activeId);
		if (target.kind === 'end') return [...rest, activeRow];
		const index = rest.findIndex((r) => r.rowId === target.rowId);
		if (index < 0) return rows;
		const next = [...rest];
		next.splice(target.kind === 'before' ? index : index + 1, 0, activeRow);
		return sameOrder(rows, next) ? rows : next;
	}

	if (!pulled) return rows;
	const { child, rest } = pulled;
	const asRow: SidebarRow = { kind: 'project', rowId: child.rowId, project: child.project };

	if (target.kind === 'end') {
		const next = [...rest, asRow];
		return sameOrder(rows, next) ? rows : next;
	}

	if (target.kind === 'into') {
		const next = rest.map((r) =>
			r.kind === 'group' && r.rowId === target.rowId
				? { ...r, children: [...r.children, child] }
				: r,
		);
		return sameOrder(rows, next) ? rows : next;
	}

	// Before or after a sibling, in that sibling's own scope.
	const parent = parentOf(rest, target.rowId);
	if (parent) {
		const next = rest.map((r) => {
			if (r.kind !== 'group' || r.rowId !== parent) return r;
			const index = r.children.findIndex((c) => c.rowId === target.rowId);
			if (index < 0) return r;
			const children = [...r.children];
			children.splice(target.kind === 'before' ? index : index + 1, 0, child);
			return { ...r, children };
		});
		return sameOrder(rows, next) ? rows : next;
	}
	const index = rest.findIndex((r) => r.rowId === target.rowId);
	if (index < 0) return rows;
	const next = [...rest];
	next.splice(target.kind === 'before' ? index : index + 1, 0, asRow);
	return sameOrder(rows, next) ? rows : next;
}

/** Do these two trees list the same rows in the same places? Used only to return
 *  the original array when a drop changes nothing, which is what lets the caller
 *  skip the optimistic write and the command. */
function sameOrder(a: SidebarRow[], b: SidebarRow[]): boolean {
	const flat = (rows: SidebarRow[]) =>
		rows
			.map((r) => (r.kind === 'group' ? `${r.rowId}(${r.children.map((c) => c.rowId)})` : r.rowId))
			.join(',');
	return flat(a) === flat(b);
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
