import { describe, expect, it } from 'vitest';
import {
	clampSidebarWidth,
	DEFAULT_SIDEBAR_WIDTH,
	MAX_SIDEBAR_WIDTH,
	MIN_SIDEBAR_WIDTH,
	migrateSidebarState,
} from '@store/sidebarStore';

describe('clampSidebarWidth', () => {
	it('holds the range at both ends', () => {
		expect(clampSidebarWidth(50)).toBe(MIN_SIDEBAR_WIDTH);
		expect(clampSidebarWidth(2000)).toBe(MAX_SIDEBAR_WIDTH);
		expect(clampSidebarWidth(300)).toBe(300);
	});

	it('rounds sub-pixel drags to whole pixels', () => {
		// A pointer delta is fractional on a scaled display; a fractional width
		// would re-render on every mouse move without moving the edge.
		expect(clampSidebarWidth(300.4)).toBe(300);
		expect(clampSidebarWidth(300.6)).toBe(301);
	});

	it('falls back to the default for a value that is not a number', () => {
		expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH);
	});
});

describe('migrateSidebarState', () => {
	const v1 = { sort: 'name', width: 320, expanded: ['-home-alice-code-foo'] };

	it('drops v1 expansion state, which is keyed by ids that no longer exist', () => {
		expect(migrateSidebarState(v1, 1)).toEqual({ sort: 'name', width: 320, expanded: [] });
	});

	it('keeps the preferences that have nothing to do with project ids', () => {
		const out = migrateSidebarState(v1, 1) as typeof v1;
		expect(out.sort).toBe('name');
		expect(out.width).toBe(320);
	});

	it('leaves a current state alone', () => {
		const v2 = { sort: 'recent', width: 256, expanded: ['p0000001-0000-4000-8000-000000000001'] };
		expect(migrateSidebarState(v2, 2)).toBe(v2);
	});

	it('keeps a persisted `recent`, which adding `manual` did not invalidate', () => {
		// `ProjectSort` widened rather than changed, so there is no v3 and nothing
		// to remap: `recent` is still a mode on the menu. Migrating someone off it
		// would be discarding a preference they set. Only the default for a fresh
		// install moved to `manual`.
		const persisted = { sort: 'recent', width: 256, expanded: [] };

		expect(migrateSidebarState(persisted, 2)).toBe(persisted);
		expect((migrateSidebarState({ ...persisted }, 1) as typeof persisted).sort).toBe('recent');
	});

	it('survives a persisted blob that is not an object', () => {
		// Hand-edited or half-written localStorage shouldn't take the app down on
		// boot — the store falls back to its defaults instead.
		expect(migrateSidebarState(null, 1)).toBe(null);
		expect(migrateSidebarState('garbage', 1)).toBe('garbage');
	});
});
