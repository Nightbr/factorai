import { moveProject, sortProjects } from '@components/layout/Sidebar';
import type { Project } from '@factorai/types';
import { describe, expect, it } from 'vitest';

/**
 * The sidebar's two ordering rules, tested without a render — which is the whole
 * reason they are pure and exported (F1, roadmap item 28). `sortProjects` decides
 * what the list looks like; `moveProject` decides what a drop means, and both the
 * pointer drag and the keyboard nudge go through it.
 *
 * These used to live in `SidebarProject.test.ts`, back when `sortProjects` was
 * the only rule here and the file next to it was where the sidebar's tests
 * happened to be.
 */
function project(
	id: string,
	displayName: string,
	{ sortOrder = 0, lastSessionAt = 0 as number | null } = {},
): Project {
	return {
		id,
		realPath: `/code/${displayName}`,
		displayName,
		lastSessionAt,
		missing: false,
		sessionCount: 1,
		sortOrder,
	};
}

function names(projects: Project[]): string[] {
	return projects.map((p) => p.displayName);
}

describe('sortProjects', () => {
	it('reads the stored ordinal under manual, not the order it was handed', () => {
		// The array arrives from `list_projects`, which orders by the same column —
		// so a rule that trusted the array would pass a naive test. Handing it a
		// deliberately wrong array order is what proves the field is being read.
		const projects = [
			project('1', 'zulu', { sortOrder: 2 }),
			project('2', 'alpha', { sortOrder: 0 }),
			project('3', 'mike', { sortOrder: 1 }),
		];

		expect(names(sortProjects(projects, 'manual'))).toEqual(['alpha', 'mike', 'zulu']);
	});

	it('breaks a tied ordinal on name, so a sparse list still renders in one order', () => {
		// Ordinals go sparse: `add_project` writes `MIN(sortOrder) - 1` rather than
		// renumbering, and `remove_project` leaves a hole. Two rows sharing a value
		// must not leave the row order up to `Array.prototype.sort`.
		const projects = [
			project('1', 'zulu', { sortOrder: 0 }),
			project('2', 'alpha', { sortOrder: 0 }),
		];

		expect(names(sortProjects(projects, 'manual'))).toEqual(['alpha', 'zulu']);
	});

	it('sorts by name case-insensitively', () => {
		const projects = [project('1', 'zulu'), project('2', 'Alpha'), project('3', 'mike')];

		expect(names(sortProjects(projects, 'name'))).toEqual(['Alpha', 'mike', 'zulu']);
	});

	it('derives recency itself rather than trusting the backend order', () => {
		// This is the branch that changed shape: `recent` used to return the array
		// untouched, because `PROJECT_SELECT` ordered by recency. It orders by
		// ordinal now, so the rule has to be here or `recent` silently becomes
		// `manual`.
		const projects = [
			project('1', 'stale', { lastSessionAt: 100 }),
			project('2', 'fresh', { lastSessionAt: 900 }),
			project('3', 'middling', { lastSessionAt: 500 }),
		];

		expect(names(sortProjects(projects, 'recent'))).toEqual(['fresh', 'middling', 'stale']);
	});

	it('puts a project Claude has never run in last, not first', () => {
		// `lastSessionAt` is null for a folder with no sessions, and "never used"
		// is not "used most recently" — which is what a naive numeric compare
		// against null would decide.
		const projects = [
			project('1', 'never', { lastSessionAt: null }),
			project('2', 'used', { lastSessionAt: 1 }),
		];

		expect(names(sortProjects(projects, 'recent'))).toEqual(['used', 'never']);
	});

	it('does not mutate the array it was given, in any mode', () => {
		const original = [
			project('1', 'zulu', { sortOrder: 1 }),
			project('2', 'alpha', { sortOrder: 0 }),
		];

		for (const sort of ['manual', 'name', 'recent'] as const) {
			sortProjects(original, sort);
			expect(names(original)).toEqual(['zulu', 'alpha']);
		}
	});
});

describe('moveProject', () => {
	const list = () => [
		project('a', 'alpha', { sortOrder: 0 }),
		project('b', 'bravo', { sortOrder: 1 }),
		project('c', 'charlie', { sortOrder: 2 }),
	];

	it('moves a row down to where the row it was dropped on sits', () => {
		expect(names(moveProject(list(), 'a', 'c'))).toEqual(['bravo', 'charlie', 'alpha']);
	});

	it('moves a row up the same way', () => {
		expect(names(moveProject(list(), 'c', 'a'))).toEqual(['charlie', 'alpha', 'bravo']);
	});

	it('renumbers the ordinals densely from zero', () => {
		// Not cosmetic: `sortProjects` reads `sortOrder`, so an array reordered
		// without renumbering would render in the *old* order and the optimistic
		// write would look like it did nothing.
		const moved = moveProject(list(), 'a', 'c');

		expect(moved.map((p) => p.sortOrder)).toEqual([0, 1, 2]);
		expect(moved.map((p) => p.id)).toEqual(['b', 'c', 'a']);
	});

	it('normalises ordinals that arrived sparse', () => {
		// What a workspace that has only ever been added to looks like:
		// `add_project` walks downwards from -1 and never renumbers.
		const sparse = [
			project('a', 'alpha', { sortOrder: -3 }),
			project('b', 'bravo', { sortOrder: -2 }),
			project('c', 'charlie', { sortOrder: -1 }),
		];

		expect(moveProject(sparse, 'c', 'a').map((p) => p.sortOrder)).toEqual([0, 1, 2]);
	});

	it('returns the same array when nothing moves, so a grazed click writes nothing', () => {
		const projects = list();

		expect(moveProject(projects, 'b', 'b')).toBe(projects);
	});

	it('returns the same array for an id it does not know', () => {
		// A row removed between the render and the drop. The caller treats identity
		// as "no change" and skips the mutation entirely.
		const projects = list();

		expect(moveProject(projects, 'a', 'gone')).toBe(projects);
		expect(moveProject(projects, 'gone', 'a')).toBe(projects);
	});

	it('does not mutate the array it was given', () => {
		const projects = list();

		moveProject(projects, 'a', 'c');

		expect(names(projects)).toEqual(['alpha', 'bravo', 'charlie']);
		expect(projects.map((p) => p.sortOrder)).toEqual([0, 1, 2]);
	});
});
