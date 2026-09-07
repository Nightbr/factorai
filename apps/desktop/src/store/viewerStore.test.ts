import { describe, expect, it } from 'vitest';
import {
	nextActivePath,
	type ViewerTab,
	withOpenTab,
	withoutTab,
	withPinnedTab,
} from './viewerStore';

const tab = (path: string, preview = false): ViewerTab => ({ path, preview, diff: null });

describe('withOpenTab', () => {
	it('appends a pinned open', () => {
		expect(withOpenTab([tab('a')], 'b').map((t) => t.path)).toEqual(['a', 'b']);
	});

	it('replaces the preview tab in place rather than growing the strip', () => {
		const tabs = [tab('a'), tab('b', true), tab('c')];
		const next = withOpenTab(tabs, 'd', { preview: true });
		expect(next.map((t) => t.path)).toEqual(['a', 'd', 'c']);
		expect(next[1].preview).toBe(true);
	});

	it('appends a preview when nothing is a preview yet', () => {
		const next = withOpenTab([tab('a')], 'b', { preview: true });
		expect(next.map((t) => t.path)).toEqual(['a', 'b']);
		expect(next[1].preview).toBe(true);
	});

	it('pins a preview tab reopened explicitly', () => {
		const next = withOpenTab([tab('a', true)], 'a');
		expect(next).toHaveLength(1);
		expect(next[0].preview).toBe(false);
	});

	it('never demotes a pinned tab back to a preview', () => {
		const next = withOpenTab([tab('a')], 'a', { preview: true });
		expect(next[0].preview).toBe(false);
	});

	it('carries the mode the file was opened in, and drops it when reopened plain', () => {
		const withDiff = withOpenTab([], 'a', { diff: 'staged' });
		expect(withDiff[0].diff).toBe('staged');
		expect(withOpenTab(withDiff, 'a')[0].diff).toBeNull();
	});
});

describe('withoutTab', () => {
	it('drops the named tab', () => {
		expect(withoutTab([tab('a'), tab('b')], 'a').map((t) => t.path)).toEqual(['b']);
	});

	it('returns the same array when nothing matched', () => {
		const tabs = [tab('a')];
		expect(withoutTab(tabs, 'zzz')).toBe(tabs);
	});
});

describe('withPinnedTab', () => {
	it('pins one tab and leaves the others alone', () => {
		const next = withPinnedTab([tab('a', true), tab('b', true)], 'a');
		expect(next[0].preview).toBe(false);
		expect(next[1].preview).toBe(true);
	});
});

describe('nextActivePath', () => {
	const tabs = [tab('a'), tab('b'), tab('c')];

	it('leaves the active file alone when another tab closes', () => {
		expect(nextActivePath(tabs, 'a', 'c')).toBe('c');
	});

	it('takes the tab that moves into the closed one’s place', () => {
		expect(nextActivePath(tabs, 'b', 'b')).toBe('c');
	});

	it('takes the new last tab when the last one closes', () => {
		expect(nextActivePath(tabs, 'c', 'c')).toBe('b');
	});

	it('closes the viewer when the only tab closes', () => {
		expect(nextActivePath([tab('a')], 'a', 'a')).toBeNull();
	});
});
