import { describe, expect, it, vi } from 'vitest';
import {
	activateFileLink,
	fileLinkContext,
	type FileLinkTargets,
	onFileLinkActivated,
	setFileLinkWiring,
} from '@components/terminal/fileLinkWiring';
import type { ResolvedLink } from '@lib/fileLinks';

function click(mods: Partial<MouseEvent> = {}): MouseEvent {
	return { ctrlKey: false, metaKey: false, ...mods } as MouseEvent;
}

function targets(): FileLinkTargets & {
	openInViewer: ReturnType<typeof vi.fn>;
	revealInTree: ReturnType<typeof vi.fn>;
} {
	return { openInViewer: vi.fn(), revealInTree: vi.fn() };
}

function link(over: Partial<ResolvedLink> = {}): ResolvedLink {
	return {
		start: 0,
		end: 10,
		raw: 'src/a.ts',
		path: '/proj/src/a.ts',
		kind: 'file',
		line: null,
		col: null,
		...over,
	};
}

/**
 * File links — the third kind of link a terminal carries (F19). Same gate as
 * the other two, different destination: a path a terminal printed belongs in
 * our viewer, not in whatever the OS says owns `.ts`.
 */
describe('onFileLinkActivated', () => {
	it('opens a file in the viewer on a modifier click', () => {
		const t = targets();

		onFileLinkActivated(click({ ctrlKey: true }), link(), t);

		expect(t.openInViewer).toHaveBeenCalledWith('/proj/src/a.ts', {
			line: undefined,
			col: undefined,
		});
	});

	it('carries a :line:col through to the viewer', () => {
		const t = targets();

		onFileLinkActivated(click({ metaKey: true }), link({ line: 42, col: 7 }), t);

		expect(t.openInViewer).toHaveBeenCalledWith('/proj/src/a.ts', { line: 42, col: 7 });
	});

	it('reveals a directory in the tree instead of opening an empty editor', () => {
		const t = targets();

		onFileLinkActivated(
			click({ ctrlKey: true }),
			link({ kind: 'directory', path: '/proj/src' }),
			t,
		);

		expect(t.revealInTree).toHaveBeenCalledWith('/proj/src');
		expect(t.openInViewer).not.toHaveBeenCalled();
	});

	it('applies the same plain-click gate as the other two kinds', () => {
		// The ambush argument is stronger here, not weaker: a near-fullscreen
		// viewer over the terminal you were reading is more disruptive than a
		// browser opening beside it.
		const t = targets();

		onFileLinkActivated(click(), link(), t);

		expect(t.openInViewer).not.toHaveBeenCalled();
		expect(t.revealInTree).not.toHaveBeenCalled();
	});
});

/**
 * The map the provider reads through, and the reason it is not keyed by session
 * id: a footer shell's pane is keyed by its pane key, and the version that
 * lived in `Terminal.tsx` left every path a plain command printed dead text.
 */
describe('the wiring map', () => {
	it('resolves nothing for a terminal nothing has wired', () => {
		expect(fileLinkContext('shell:never-mounted')).toEqual({ bases: [], home: null });

		// And a click on a link found before the unmount reaches nobody rather
		// than throwing inside an xterm callback.
		expect(() =>
			activateFileLink('shell:never-mounted', click({ ctrlKey: true }), link()),
		).not.toThrow();
	});

	it('keys an agent and a pane independently', () => {
		const agent = setFileLinkWiring('session-1', {
			context: () => ({ bases: ['/proj'], home: null }),
			activate: () => {},
		});
		const pane = setFileLinkWiring('shell:pane-1', {
			context: () => ({ bases: ['/proj/terraform/prod'], home: '/home/alice' }),
			activate: () => {},
		});

		expect(fileLinkContext('session-1').bases).toEqual(['/proj']);
		expect(fileLinkContext('shell:pane-1').bases).toEqual(['/proj/terraform/prod']);

		agent();
		pane();
	});

	it('clears on unmount, so a terminal nobody is looking at has no links', () => {
		const dispose = setFileLinkWiring('shell:pane-2', {
			context: () => ({ bases: ['/proj'], home: null }),
			activate: () => {},
		});

		dispose();

		expect(fileLinkContext('shell:pane-2')).toEqual({ bases: [], home: null });
	});

	it('survives a re-register followed by the previous cleanup', () => {
		// The order a remount can produce. An unguarded delete would leave the
		// live pane silently linkless.
		const first = setFileLinkWiring('shell:pane-3', {
			context: () => ({ bases: ['/old'], home: null }),
			activate: () => {},
		});
		setFileLinkWiring('shell:pane-3', {
			context: () => ({ bases: ['/new'], home: null }),
			activate: () => {},
		});

		first();

		expect(fileLinkContext('shell:pane-3').bases).toEqual(['/new']);
	});

	it('hands a click to whatever is mounted on that key', () => {
		const activate = vi.fn();
		const dispose = setFileLinkWiring('shell:pane-4', {
			context: () => ({ bases: [], home: null }),
			activate,
		});
		const event = click({ ctrlKey: true });
		const resolved = link();

		activateFileLink('shell:pane-4', event, resolved);

		expect(activate).toHaveBeenCalledWith(event, resolved);
		dispose();
	});
});
