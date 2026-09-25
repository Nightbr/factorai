import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginPanelDrag, endPanelDrag, isPanelDragging, onPanelDragEnd } from './panelDrag';

afterEach(() => endPanelDrag());

describe('panelDrag', () => {
	it('is not dragging until a drag begins', () => {
		expect(isPanelDragging()).toBe(false);
		beginPanelDrag();
		expect(isPanelDragging()).toBe(true);
	});

	it('notifies once per drag, however many end events arrive', () => {
		const fn = vi.fn();
		const off = onPanelDragEnd(fn);
		beginPanelDrag();
		endPanelDrag();
		// `lostpointercapture` follows `pointerup` for the same drag.
		endPanelDrag();
		expect(fn).toHaveBeenCalledTimes(1);
		expect(isPanelDragging()).toBe(false);
		off();
		beginPanelDrag();
		endPanelDrag();
		expect(fn).toHaveBeenCalledTimes(1);
	});
});
