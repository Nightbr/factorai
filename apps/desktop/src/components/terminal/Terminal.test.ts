import { describe, expect, it, vi } from 'vitest';
import { createOscLinkHandler, onLinkActivated } from '@components/terminal/Terminal';

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
