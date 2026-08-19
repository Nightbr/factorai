import { describe, expect, it } from 'vitest';
import {
	clampDetailHeight,
	clampPanelWidth,
	DEFAULT_DETAIL_HEIGHT,
	DEFAULT_PANEL_WIDTH,
	MAX_DETAIL_HEIGHT,
	MAX_PANEL_WIDTH,
	MIN_DETAIL_HEIGHT,
	MIN_PANEL_WIDTH,
	withExpanded,
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

describe('clampDetailHeight', () => {
	it('passes through heights inside the range', () => {
		expect(clampDetailHeight(240)).toBe(240);
		expect(clampDetailHeight(MIN_DETAIL_HEIGHT)).toBe(MIN_DETAIL_HEIGHT);
		expect(clampDetailHeight(MAX_DETAIL_HEIGHT)).toBe(MAX_DETAIL_HEIGHT);
	});

	it('clamps a drag past either end', () => {
		// The floor matters more here than for width: dragged to nothing, the
		// commit detail would still be mounted and fetching, just invisible.
		expect(clampDetailHeight(0)).toBe(MIN_DETAIL_HEIGHT);
		expect(clampDetailHeight(-200)).toBe(MIN_DETAIL_HEIGHT);
		expect(clampDetailHeight(5000)).toBe(MAX_DETAIL_HEIGHT);
	});

	it('rounds sub-pixel drag deltas', () => {
		expect(clampDetailHeight(200.4)).toBe(200);
		expect(clampDetailHeight(200.6)).toBe(201);
	});

	it('falls back to the default for a non-finite height', () => {
		expect(clampDetailHeight(Number.NaN)).toBe(DEFAULT_DETAIL_HEIGHT);
		expect(clampDetailHeight(Number.POSITIVE_INFINITY)).toBe(DEFAULT_DETAIL_HEIGHT);
	});
});

/**
 * Revealing a path (F19) expands a whole ancestor chain, most of which is
 * usually open already — which is the entire reason `toggleExpanded` is the
 * wrong tool for it.
 */
describe('withExpanded', () => {
	it('adds every path', () => {
		expect([...withExpanded(undefined, ['/p', '/p/src'])]).toEqual(['/p', '/p/src']);
	});

	it('leaves the ones already open open', () => {
		const before = new Set(['/p', '/p/src']);
		expect([...withExpanded(before, ['/p', '/p/src', '/p/src/lib'])]).toEqual([
			'/p',
			'/p/src',
			'/p/src/lib',
		]);
	});

	it('never mutates the set it was given', () => {
		const before = new Set(['/p']);
		withExpanded(before, ['/p/src']);
		expect([...before]).toEqual(['/p']);
	});
});
