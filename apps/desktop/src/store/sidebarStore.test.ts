import { describe, expect, it } from 'vitest';
import {
	clampSidebarWidth,
	DEFAULT_SIDEBAR_WIDTH,
	MAX_SIDEBAR_WIDTH,
	MIN_SIDEBAR_WIDTH,
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
