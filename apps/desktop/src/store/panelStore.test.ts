import { describe, expect, it } from 'vitest';
import {
	clampPanelWidth,
	DEFAULT_PANEL_WIDTH,
	MAX_PANEL_WIDTH,
	MIN_PANEL_WIDTH,
} from './panelStore';

describe('clampPanelWidth', () => {
	it('passes through widths inside the range', () => {
		expect(clampPanelWidth(300)).toBe(300);
		expect(clampPanelWidth(MIN_PANEL_WIDTH)).toBe(MIN_PANEL_WIDTH);
		expect(clampPanelWidth(MAX_PANEL_WIDTH)).toBe(MAX_PANEL_WIDTH);
	});

	it('clamps a drag past either end', () => {
		expect(clampPanelWidth(10)).toBe(MIN_PANEL_WIDTH);
		expect(clampPanelWidth(-500)).toBe(MIN_PANEL_WIDTH);
		expect(clampPanelWidth(5000)).toBe(MAX_PANEL_WIDTH);
	});

	it('rounds sub-pixel drag deltas', () => {
		expect(clampPanelWidth(301.4)).toBe(301);
		expect(clampPanelWidth(301.6)).toBe(302);
	});

	it('falls back to the default for a non-finite width', () => {
		// A persisted NaN (or a pointer event mid-teardown) shouldn't collapse
		// the panel to zero.
		expect(clampPanelWidth(Number.NaN)).toBe(DEFAULT_PANEL_WIDTH);
		expect(clampPanelWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PANEL_WIDTH);
	});
});
