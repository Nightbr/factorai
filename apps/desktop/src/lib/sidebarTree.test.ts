import type { Project, SidebarRow } from '@factorai/types';
import {
	applyDrop,
	dropTarget,
	fileIntoGroup,
	flattenProjects,
	groupsOf,
	indicatorFor,
	nudgeRow,
	parentOf,
	rowFor,
	sortProjects,
	toOrder,
	unfile,
	viewRows,
	visibleRowIds,
} from '@lib/sidebarTree';
import { describe, expect, it } from 'vitest';

/**
 * The sidebar's tree rules, tested without a render — which is the whole reason
 * they are pure and exported (F1, ADR-0025). `viewRows` decides what the list
 * looks like in each sort mode; `moveRow` decides what a drop means, and the
 * pointer drag, the keyboard nudge and the menu all go through it.
 *
 * These grew out of `Sidebar.test.ts`'s `sortProjects` / `moveProject` cases,
 * which were the flat-list version of the same two rules. The flat cases that
 * still make sense are kept, because they are still the behaviour at the top
 * level of a sidebar with no groups in it.
 */
function project(name: string, { lastSessionAt = 0 as number | null } = {}): Project {
	return {
		id: `p-${name}`,
		realPath: `/code/${name}`,
		displayName: name,
		lastSessionAt,
		missing: false,
		sessionCount: 1,
		profileId: null,
		profileName: null,
	};
}

function projectRow(name: string, opts?: { lastSessionAt?: number | null }): SidebarRow {
	return { kind: 'project', rowId: `r-${name}`, project: project(name, opts) };
}

function groupRow(name: string, children: string[]): SidebarRow {
	return {
		kind: 'group',
		rowId: `g-${name}`,
		name,
		children: children.map((c) => ({ rowId: `r-${c}`, project: project(c) })),
	};
}

/** Row labels, top level then each group's children indented with a `>`. */
function shape(rows: SidebarRow[]): string[] {
	return rows.flatMap((row) =>
		row.kind === 'project'
			? [row.project.displayName]
			: [row.name, ...row.children.map((c) => `> ${c.project.displayName}`)],
	);
}

describe('viewRows', () => {
	const tree = () => [
		groupRow('Pro', ['pearl', 'limova']),
		projectRow('factorai'),
		groupRow('Perso', []),
		projectRow('scratch'),
	];

	it('returns the tree untouched under manual', () => {
		const rows = tree();

		// Identity, not just equality: `list_sidebar` already ordered it, and there
		// is no ordinal on the wire to re-sort by.
		expect(viewRows(rows, 'manual')).toBe(rows);
	});

	it('dissolves the groups under name, flattening every project', () => {
		// The projects inside Pro appear in the flat list — including when the
		// group is collapsed, which is the stated cost of this mode (F1).
		expect(shape(viewRows(tree(), 'name'))).toEqual(['factorai', 'limova', 'pearl', 'scratch']);
	});

	it('dissolves the groups under recent too, newest first', () => {
		const rows: SidebarRow[] = [
			groupRow('Pro', ['stale']),
			projectRow('fresh', { lastSessionAt: 900 }),
		];
		// `stale` comes from `groupRow`, whose projects default to lastSessionAt 0.
		expect(shape(viewRows(rows, 'recent'))).toEqual(['fresh', 'stale']);
	});

	it('keeps each project on its own row id across a mode switch', () => {
		// React keys and `sidebarStore.expanded` both depend on the row id, so a
		// mode switch must not reissue them — a project would collapse and lose
		// its place in the expansion set.
		const rows = tree();
		const manual = viewRows(rows, 'manual');
		const byName = viewRows(rows, 'name');

		const idOf = (list: SidebarRow[], name: string) =>
			list.find((r) => r.kind === 'project' && r.project.displayName === name)?.rowId;
		expect(idOf(byName, 'factorai')).toBe(idOf(manual, 'factorai'));
		// And a project that was inside a group keeps the row id it has in the tree.
		expect(idOf(byName, 'pearl')).toBe('r-pearl');
	});
});

describe('sortProjects', () => {
	it('sorts by name case-insensitively', () => {
		const projects = [project('zulu'), project('Alpha'), project('mike')];

		expect(sortProjects(projects, 'name').map((p) => p.displayName)).toEqual([
			'Alpha',
			'mike',
			'zulu',
		]);
	});

	it('puts a project Claude has never run in last, not first', () => {
		// `lastSessionAt` is null for a folder with no sessions, and "never used" is
		// not "used most recently" — which is what a naive numeric compare against
		// null would decide.
		const projects = [
			project('never', { lastSessionAt: null }),
			project('used', { lastSessionAt: 1 }),
		];

		expect(sortProjects(projects, 'recent').map((p) => p.displayName)).toEqual(['used', 'never']);
	});

	it('does not mutate the array it was given', () => {
		const projects = [project('zulu'), project('alpha')];

		sortProjects(projects, 'name');

		expect(projects.map((p) => p.displayName)).toEqual(['zulu', 'alpha']);
	});
});

describe('visibleRowIds', () => {
	const tree = () => [groupRow('Pro', ['pearl', 'limova']), projectRow('factorai')];

	it('hides a collapsed group’s children, which are not drop targets', () => {
		// You cannot drop onto something you cannot see; the dwell springs the group
		// open first (F1).
		expect(visibleRowIds(tree(), new Set())).toEqual(['g-Pro', 'r-factorai']);
	});

	it('lists an expanded group’s children in order, after its own row', () => {
		expect(visibleRowIds(tree(), new Set(['g-Pro']))).toEqual([
			'g-Pro',
			'r-pearl',
			'r-limova',
			'r-factorai',
		]);
	});
});

describe('fileIntoGroup and unfile', () => {
	it('appends to the end of the group, which is what a menu pick should mean', () => {
		const rows = [groupRow('Pro', ['a']), projectRow('loose')];

		expect(shape(fileIntoGroup(rows, 'r-loose', 'g-Pro'))).toEqual(['Pro', '> a', '> loose']);
	});

	it('moves a project straight between groups', () => {
		const rows = [groupRow('Pro', ['a']), groupRow('Perso', [])];

		expect(shape(fileIntoGroup(rows, 'r-a', 'g-Perso'))).toEqual(['Pro', 'Perso', '> a']);
	});

	it('unfiles to the end of the top level', () => {
		const rows = [groupRow('Pro', ['a', 'b']), projectRow('loose')];

		expect(shape(unfile(rows, 'r-a'))).toEqual(['Pro', '> b', 'loose', 'a']);
	});

	it('leaves a project that is already at the top level alone', () => {
		const rows = [projectRow('a'), projectRow('b')];

		expect(unfile(rows, 'r-a')).toBe(rows);
	});
});

describe('toOrder', () => {
	it('carries ids and nothing else', () => {
		// The command's whole job is ordering; sending it names and project payloads
		// would mean deciding whether to trust them.
		const rows = [groupRow('Pro', ['a', 'b']), projectRow('loose')];

		expect(toOrder(rows)).toEqual([
			{ kind: 'group', rowId: 'g-Pro', children: ['r-a', 'r-b'] },
			{ kind: 'project', rowId: 'r-loose' },
		]);
	});

	it('keeps an empty group, which is a container the user made on purpose', () => {
		expect(toOrder([groupRow('Perso', [])])).toEqual([
			{ kind: 'group', rowId: 'g-Perso', children: [] },
		]);
	});
});

describe('flattenProjects, groupsOf and parentOf', () => {
	const rows = () => [groupRow('Pro', ['a', 'b']), projectRow('loose'), groupRow('Perso', [])];

	it('flattens every project, grouped or not', () => {
		expect(flattenProjects(rows()).map((p) => p.displayName)).toEqual(['a', 'b', 'loose']);
	});

	it('lists the groups for the Move to group submenu', () => {
		expect(groupsOf(rows())).toEqual([
			{ rowId: 'g-Pro', name: 'Pro' },
			{ rowId: 'g-Perso', name: 'Perso' },
		]);
	});

	it('names the group holding a row, or null at the top level', () => {
		expect(parentOf(rows(), 'r-a')).toBe('g-Pro');
		expect(parentOf(rows(), 'r-loose')).toBe(null);
		expect(parentOf(rows(), 'r-nope')).toBe(null);
	});
});

describe('nudgeRow', () => {
	const tree = () => [groupRow('Pro', ['a', 'b']), projectRow('loose'), groupRow('Perso', ['c'])];
	const allOpen = () => new Set(['g-Pro', 'g-Perso']);

	it('swaps with the neighbour inside a group', () => {
		expect(shape(nudgeRow(tree(), 'r-a', 1, allOpen()))).toEqual([
			'Pro',
			'> b',
			'> a',
			'loose',
			'Perso',
			'> c',
		]);
	});

	it('leaves a group upward from its first child', () => {
		// The regression this function exists for. Routed through `moveRow` this was
		// a permanent no-op: the row above a first child is the group's own header,
		// and dropping there means "the top of this group" — where it already was.
		expect(shape(nudgeRow(tree(), 'r-a', -1, allOpen()))).toEqual([
			'a',
			'Pro',
			'> b',
			'loose',
			'Perso',
			'> c',
		]);
	});

	it('leaves a group downward from its last child', () => {
		expect(shape(nudgeRow(tree(), 'r-b', 1, allOpen()))).toEqual([
			'Pro',
			'> a',
			'b',
			'loose',
			'Perso',
			'> c',
		]);
	});

	it('steps down into an expanded group, at its start', () => {
		expect(shape(nudgeRow(tree(), 'r-loose', 1, allOpen()))).toEqual([
			'Pro',
			'> a',
			'> b',
			'Perso',
			'> loose',
			'> c',
		]);
	});

	it('steps up into an expanded group, at its end', () => {
		expect(shape(nudgeRow(tree(), 'r-loose', -1, allOpen()))).toEqual([
			'Pro',
			'> a',
			'> b',
			'> loose',
			'Perso',
			'> c',
		]);
	});

	it('steps over a collapsed group rather than into it', () => {
		// You cannot aim at what you cannot see — the same rule that keeps a
		// collapsed group's children out of `visibleRowIds`.
		expect(shape(nudgeRow(tree(), 'r-loose', 1, new Set(['g-Pro'])))).toEqual([
			'Pro',
			'> a',
			'> b',
			'Perso',
			'> c',
			'loose',
		]);
	});

	it('moves a group among the top-level rows only', () => {
		expect(shape(nudgeRow(tree(), 'g-Perso', -1, allOpen()))).toEqual([
			'Pro',
			'> a',
			'> b',
			'Perso',
			'> c',
			'loose',
		]);
	});

	it('does nothing at either end of the list', () => {
		const rows = tree();

		expect(nudgeRow(rows, 'g-Pro', -1, allOpen())).toBe(rows);
		expect(nudgeRow(rows, 'g-Perso', 1, allOpen())).toBe(rows);
	});

	it('does nothing for a row it does not know', () => {
		const rows = tree();

		expect(nudgeRow(rows, 'r-nope', 1, allOpen())).toBe(rows);
	});

	it('does not mutate the tree it was given', () => {
		const rows = tree();

		nudgeRow(rows, 'r-a', -1, allOpen());

		expect(shape(rows)).toEqual(['Pro', '> a', '> b', 'loose', 'Perso', '> c']);
	});
});

describe('rowFor', () => {
	const rows = () => [groupRow('Pro', ['a']), projectRow('loose')];

	it('finds a top-level row', () => {
		expect(rowFor(rows(), 'r-loose')?.rowId).toBe('r-loose');
		expect(rowFor(rows(), 'g-Pro')?.kind).toBe('group');
	});

	it('finds a row inside a group, which a plain find cannot', () => {
		// The bug: a group's children are `SidebarChild`, not `SidebarRow`, so
		// `rows.find(...)` sees only the top level — and the drag overlay had nothing
		// to draw for any project inside a group.
		const found = rowFor(rows(), 'r-a');

		expect(found?.kind).toBe('project');
		expect(found?.kind === 'project' && found.project.displayName).toBe('a');
	});

	it('returns null for a row it does not know', () => {
		expect(rowFor(rows(), 'r-nope')).toBe(null);
	});
});

describe('dropTarget', () => {
	const tree = () => [groupRow('Pro', ['a', 'b']), projectRow('loose'), groupRow('Perso', [])];

	it('splits an ordinary row in two: top half before, bottom half after', () => {
		expect(dropTarget(tree(), 'r-loose', 'r-a', 0.2)).toEqual({ kind: 'before', rowId: 'r-a' });
		expect(dropTarget(tree(), 'r-loose', 'r-a', 0.8)).toEqual({ kind: 'after', rowId: 'r-a' });
	});

	it('gives a group row three zones, so it is a position as well as a container', () => {
		// **The report this exists for**: a group row used to mean only "into", so
		// there was no way to put a project between two groups or beside one.
		expect(dropTarget(tree(), 'r-loose', 'g-Pro', 0.1)).toEqual({
			kind: 'before',
			rowId: 'g-Pro',
		});
		expect(dropTarget(tree(), 'r-loose', 'g-Pro', 0.5)).toEqual({ kind: 'into', rowId: 'g-Pro' });
		expect(dropTarget(tree(), 'r-loose', 'g-Pro', 0.9)).toEqual({
			kind: 'after',
			rowId: 'g-Pro',
		});
	});

	it('never offers "into" for a group being dragged, at any position', () => {
		for (const fraction of [0.1, 0.5, 0.9]) {
			const target = dropTarget(tree(), 'g-Perso', 'g-Pro', fraction);
			expect(target?.kind).not.toBe('into');
		}
	});

	it('sends a dragged group beside the group holding the row it was dropped on', () => {
		// Dropping a group onto a project inside a group cannot nest it, so it lands
		// beside the group instead — which is the nearest thing the user can have.
		expect(dropTarget(tree(), 'g-Perso', 'r-a', 0.8)).toEqual({ kind: 'after', rowId: 'g-Pro' });
	});

	it('says nothing when the row is over itself', () => {
		expect(dropTarget(tree(), 'r-a', 'r-a', 0.5)).toBe(null);
	});
});

describe('indicatorFor', () => {
	it('turns each target into the mark that says it', () => {
		expect(indicatorFor({ kind: 'before', rowId: 'r-a' })).toEqual({
			kind: 'edge',
			rowId: 'r-a',
			edge: 'above',
		});
		expect(indicatorFor({ kind: 'after', rowId: 'r-a' })).toEqual({
			kind: 'edge',
			rowId: 'r-a',
			edge: 'below',
		});
		// A containment is not a position, so it is a ring rather than a line.
		expect(indicatorFor({ kind: 'into', rowId: 'g-Pro' })).toEqual({
			kind: 'into',
			rowId: 'g-Pro',
		});
		expect(indicatorFor({ kind: 'end' })).toEqual({ kind: 'end' });
		expect(indicatorFor(null)).toBe(null);
	});
});

describe('applyDrop', () => {
	const tree = () => [groupRow('Pro', ['a', 'b']), projectRow('loose'), groupRow('Perso', [])];

	it('places a project before a top-level row', () => {
		expect(shape(applyDrop(tree(), 'r-loose', { kind: 'before', rowId: 'g-Pro' }))).toEqual([
			'loose',
			'Pro',
			'> a',
			'> b',
			'Perso',
		]);
	});

	it('places a project between two groups', () => {
		// The other half of the report: "after Pro" is a real position now.
		expect(shape(applyDrop(tree(), 'r-loose', { kind: 'after', rowId: 'g-Pro' }))).toEqual([
			'Pro',
			'> a',
			'> b',
			'loose',
			'Perso',
		]);
	});

	it('places a project at the end of the top level', () => {
		expect(shape(applyDrop(tree(), 'r-a', { kind: 'end' }))).toEqual([
			'Pro',
			'> b',
			'loose',
			'Perso',
			'a',
		]);
	});

	it('files a project into a group, at the end', () => {
		expect(shape(applyDrop(tree(), 'r-loose', { kind: 'into', rowId: 'g-Pro' }))).toEqual([
			'Pro',
			'> a',
			'> b',
			'> loose',
			'Perso',
		]);
	});

	it('places a project inside the group that holds the target', () => {
		expect(shape(applyDrop(tree(), 'r-loose', { kind: 'before', rowId: 'r-b' }))).toEqual([
			'Pro',
			'> a',
			'> loose',
			'> b',
			'Perso',
		]);
	});

	it('reorders inside a group without leaving it', () => {
		expect(shape(applyDrop(tree(), 'r-a', { kind: 'after', rowId: 'r-b' }))).toEqual([
			'Pro',
			'> b',
			'> a',
			'loose',
			'Perso',
		]);
	});

	it('is insert-before/after, not arrayMove — direction does not change the result', () => {
		// The old rule inferred the position from which way you had come, which
		// cannot be drawn honestly. The same target now gives the same tree whether
		// the row travelled up or down to reach it.
		const fromAbove = applyDrop(tree(), 'r-a', { kind: 'after', rowId: 'r-loose' });
		const fromBelow = applyDrop(
			[groupRow('Pro', ['b']), projectRow('loose'), projectRow('a'), groupRow('Perso', [])],
			'r-a',
			{ kind: 'after', rowId: 'r-loose' },
		);
		expect(shape(fromAbove)).toEqual(shape(fromBelow));
	});

	it('moves a group among the top-level rows', () => {
		expect(shape(applyDrop(tree(), 'g-Perso', { kind: 'before', rowId: 'g-Pro' }))).toEqual([
			'Perso',
			'Pro',
			'> a',
			'> b',
			'loose',
		]);
	});

	it('refuses to nest a group', () => {
		const rows = tree();

		expect(applyDrop(rows, 'g-Perso', { kind: 'into', rowId: 'g-Pro' })).toBe(rows);
	});

	it('returns the same array when the drop changes nothing', () => {
		const rows = tree();

		// `loose` is already immediately after Pro.
		expect(applyDrop(rows, 'r-loose', { kind: 'after', rowId: 'g-Pro' })).toBe(rows);
		expect(applyDrop(rows, 'r-loose', null)).toBe(rows);
	});

	it('does not mutate the tree it was given', () => {
		const rows = tree();

		applyDrop(rows, 'r-a', { kind: 'end' });

		expect(shape(rows)).toEqual(['Pro', '> a', '> b', 'loose', 'Perso']);
	});
});
