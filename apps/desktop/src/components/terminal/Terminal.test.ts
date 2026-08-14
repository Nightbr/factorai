import { describe, expect, it, vi } from 'vitest';
import { onLinkActivated } from '@components/terminal/Terminal';

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
