import { describe, expect, it } from 'vitest';
import {
	nextActivePath,
	type ViewerTab,
	viewerHandoff,
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

describe('viewerHandoff', () => {
	const within = (path: string, root: string) => path === root || path.startsWith(`${root}/`);
	const factorai = { projectId: 'p1', root: '/dev/factorai' };
	const panora = { projectId: 'p2', root: '/dev/panora' };
	const handoff = (args: Parameters<typeof viewerHandoff>[0]) => viewerHandoff(args);

	it('closes a file carried in from another project', () => {
		expect(
			handoff({
				previous: panora,
				next: factorai,
				showing: '/dev/panora/apps/backoffice-api/src/health.module.ts',
				last: undefined,
				within,
			}),
		).toEqual({ kind: 'close' });
	});

	it('restores the new project own last file ahead of the carried one', () => {
		expect(
			handoff({
				previous: panora,
				next: factorai,
				showing: '/dev/panora/a.ts',
				last: '/dev/factorai/b.ts',
				within,
			}),
		).toEqual({ kind: 'restore', path: '/dev/factorai/b.ts' });
	});

	it('keeps a deep link into the checkout the project just resolved to', () => {
		// The two-step resolve for a session in a worktree: same project, new
		// root, and the file is in the tree that arrived.
		expect(
			handoff({
				previous: { projectId: 'p1', root: '/dev/factorai' },
				next: { projectId: 'p1', root: '/dev/factorai-wt' },
				showing: '/dev/factorai-wt/a.ts',
				last: undefined,
				within,
			}),
		).toEqual({ kind: 'keep' });
	});

	it('keeps a file from the main checkout when only the checkout changed', () => {
		expect(
			handoff({
				previous: { projectId: 'p1', root: '/dev/factorai' },
				next: { projectId: 'p1', root: '/dev/factorai-wt' },
				showing: '/dev/factorai/a.ts',
				last: undefined,
				within,
			}),
		).toEqual({ kind: 'keep' });
	});

	it('keeps a deep link on the first resolve of a run', () => {
		expect(
			handoff({
				previous: null,
				next: factorai,
				showing: '/dev/factorai/a.ts',
				last: '/dev/factorai/b.ts',
				within,
			}),
		).toEqual({ kind: 'keep' });
	});

	it('restores on launch when the URL names nothing', () => {
		expect(
			handoff({
				previous: null,
				next: factorai,
				showing: null,
				last: '/dev/factorai/b.ts',
				within,
			}),
		).toEqual({ kind: 'restore', path: '/dev/factorai/b.ts' });
	});

	it('does not reopen the file a close just cleared', () => {
		// Same subject, nothing showing: the effect re-ran because `?file=` moved.
		expect(
			handoff({
				previous: factorai,
				next: factorai,
				showing: null,
				last: '/dev/factorai/b.ts',
				within,
			}),
		).toEqual({ kind: 'keep' });
	});

	it('closes nothing when the project switched with an empty viewer', () => {
		expect(
			handoff({ previous: panora, next: factorai, showing: null, last: undefined, within }),
		).toEqual({ kind: 'keep' });
	});
});
