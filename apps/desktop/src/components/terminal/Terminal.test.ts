import { describe, expect, it, vi } from 'vitest';
import {
	createOscLinkHandler,
	onLinkActivated,
	proposeGeometry,
} from '@components/terminal/Terminal';

function click(mods: Partial<MouseEvent> = {}): MouseEvent {
	return { ctrlKey: false, metaKey: false, ...mods } as MouseEvent;
}

describe('onLinkActivated', () => {
	it('opens on ctrl-click (Linux) and cmd-click (macOS)', () => {
		const open = vi.fn();

		onLinkActivated(click({ ctrlKey: true }), 'https://example.com', open);
		onLinkActivated(click({ metaKey: true }), 'https://example.com/2', open);

		expect(open).toHaveBeenCalledTimes(2);
		expect(open).toHaveBeenCalledWith('https://example.com');
		expect(open).toHaveBeenCalledWith('https://example.com/2');
	});

	it('ignores a plain click', () => {
		// Claude Code is a TUI: bare clicks land on its interactive output all the
		// time, and opening a browser on one would be an ambush.
		const open = vi.fn();

		onLinkActivated(click(), 'https://example.com', open);

		expect(open).not.toHaveBeenCalled();
	});
});

/**
 * OSC 8 links — the path that was not wired, so xterm's own default handled
 * them by calling `window.confirm`. That resolves to
 * `invoke('plugin:dialog|confirm')`, a command plugin-dialog does not register,
 * so it rejected and (before F17's window-level fix) blanked the app. Claude
 * Code emits its login URL this way.
 */
describe('createOscLinkHandler', () => {
	it('sends an OSC 8 link through the shell, on a modifier click', () => {
		const open = vi.fn();

		createOscLinkHandler(open).activate(click({ metaKey: true }), 'https://claude.ai/login');

		expect(open).toHaveBeenCalledWith('https://claude.ai/login');
	});

	it('applies the same plain-click gate as a regex link', () => {
		// One terminal, two kinds of link: they must not disagree about what a
		// click means.
		const open = vi.fn();

		createOscLinkHandler(open).activate(click(), 'https://claude.ai/login');

		expect(open).not.toHaveBeenCalled();
	});

	it('never reaches window.confirm — the bug it exists to fix', () => {
		// If anything in this path ever called it again, this would throw here the
		// way it rejected in the app.
		const confirmSpy = vi.fn(() => {
			throw new Error('window.confirm must not be used: no such Tauri command');
		});
		vi.stubGlobal('confirm', confirmSpy);

		const open = vi.fn();
		expect(() =>
			createOscLinkHandler(open).activate(click({ ctrlKey: true }), 'https://claude.ai/login'),
		).not.toThrow();
		expect(confirmSpy).not.toHaveBeenCalled();

		vi.unstubAllGlobals();
	});
});

/**
 * Grid sizing — the arithmetic that replaced `@xterm/addon-fit`.
 *
 * The addon reserved 14px of every terminal for an overview ruler we never draw
 * in, and against xterm 5.5.0 that reservation could not be configured off (see
 * the long note above `proposeGeometry`). These pin the property that matters:
 * the grid fills its host and holds nothing back.
 */
describe('proposeGeometry', () => {
	it('reserves no gutter — the 14px the fit addon kept', () => {
		// 1002px of host at a 7.8016px cell is 128.4 columns. The addon proposed
		// floor((1002 - 14) / 7.8016) = 126, and the two missing columns were the
		// dead strip down the right of the session.
		expect(proposeGeometry(1002, 600, 7.8016, 17)).toEqual({ cols: 128, rows: 35 });
	});

	it('floors rather than overflowing, leaving under one cell spare', () => {
		// A character grid cannot fill a box that is not a whole number of cells
		// wide. Up to `cellWidth - 1` px is unavoidable; more than that is a bug.
		const { cols } = proposeGeometry(1000, 100, 7, 10) ?? { cols: 0 };
		expect(cols).toBe(142);
		expect(1000 - cols * 7).toBeLessThan(7);
	});

	it('declines to guess when there is nothing to measure', () => {
		// A detached or not-yet-rendered terminal measures zero, and dividing by it
		// would propose Infinity columns. Callers leave the size alone instead.
		expect(proposeGeometry(1002, 600, 0, 17)).toBeNull();
		expect(proposeGeometry(1002, 600, 7.8, 0)).toBeNull();
		expect(proposeGeometry(0, 600, 7.8, 17)).toBeNull();
		expect(proposeGeometry(1002, 0, 7.8, 17)).toBeNull();
		expect(proposeGeometry(Number.NaN, 600, 7.8, 17)).toBeNull();
	});

	it('never proposes a grid too small to render into', () => {
		// xterm's own floor. A pane dragged to nothing must not propose 0 columns.
		expect(proposeGeometry(3, 4, 7.8, 17)).toEqual({ cols: 2, rows: 1 });
	});
});
