import type { Project, SidebarRow } from '@factorai/types';
import {
	fileIntoGroup,
	flattenProjects,
	groupsOf,
	moveRow,
	nudgeRow,
	parentOf,
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

describe('moveRow', () => {
	it('reorders two top-level projects', () => {
		const rows = [projectRow('a'), projectRow('b'), projectRow('c')];

		expect(shape(moveRow(rows, 'r-a', 'r-c'))).toEqual(['b', 'c', 'a']);
	});

	it('reorders within a group', () => {
		const rows = [groupRow('Pro', ['a', 'b', 'c'])];

		expect(shape(moveRow(rows, 'r-a', 'r-c'))).toEqual(['Pro', '> b', '> c', '> a']);
	});

	it('files a top-level project into a group when dropped on a row inside it', () => {
		// The target decides the level — that is what makes one gesture cover both
		// reordering and filing.
		const rows = [groupRow('Pro', ['a']), projectRow('loose')];

		expect(shape(moveRow(rows, 'r-loose', 'r-a'))).toEqual(['Pro', '> loose', '> a']);
	});

	it('files into the top of a group when dropped on the group’s own row', () => {
		const rows = [groupRow('Pro', ['a', 'b']), projectRow('loose')];

		expect(shape(moveRow(rows, 'r-loose', 'g-Pro'))).toEqual(['Pro', '> loose', '> a', '> b']);
	});

	it('pulls a project out of a group when dropped on a top-level row', () => {
		const rows = [groupRow('Pro', ['a', 'b']), projectRow('loose')];

		expect(shape(moveRow(rows, 'r-a', 'r-loose'))).toEqual(['Pro', '> b', 'a', 'loose']);
	});

	it('moves a project straight from one group to another', () => {
		const rows = [groupRow('Pro', ['a', 'b']), groupRow('Perso', ['c'])];

		expect(shape(moveRow(rows, 'r-b', 'r-c'))).toEqual(['Pro', '> a', 'Perso', '> b', '> c']);
	});

	it('never nests a group, even when dropped inside one', () => {
		// The schema forbids it (`CHECK (kind = 'project' OR parent_id IS NULL)`),
		// so the drag must not be able to ask for it: the group lands beside the
		// group it was dropped into.
		const rows = [projectRow('loose'), groupRow('Pro', ['a']), groupRow('Perso', [])];

		const moved = moveRow(rows, 'g-Perso', 'r-a');

		expect(shape(moved)).toEqual(['loose', 'Perso', 'Pro', '> a']);
		expect(moved.every((r) => r.kind !== 'group' || r.children.every(() => true))).toBe(true);
	});

	it('returns the same array when nothing moves, so a grazed click writes nothing', () => {
		const rows = [projectRow('a'), projectRow('b')];

		expect(moveRow(rows, 'r-a', 'r-a')).toBe(rows);
	});

	it('returns the same array for a row it does not know', () => {
		// A row removed between the render and the drop. The caller treats identity
		// as "no change" and skips the mutation entirely.
		const rows = [projectRow('a'), projectRow('b')];

		expect(moveRow(rows, 'r-a', 'r-gone')).toBe(rows);
		expect(moveRow(rows, 'r-gone', 'r-a')).toBe(rows);
	});

	it('does not mutate the tree it was given', () => {
		const rows = [groupRow('Pro', ['a', 'b']), projectRow('loose')];

		moveRow(rows, 'r-a', 'r-loose');

		expect(shape(rows)).toEqual(['Pro', '> a', '> b', 'loose']);
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
