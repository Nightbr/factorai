import { describe, expect, it } from 'vitest';
import {
	availableWidth,
	clampPaneWidth,
	equalFractions,
	maxPanesFor,
	MIN_PANE_WIDTH,
	PANE_DIVIDER_WIDTH,
	paneFractions,
	resizePair,
	splitDisabledReason,
} from '@lib/shellLayout';
import { MAX_PANES } from '@store/shellStore';

describe('maxPanesFor', () => {
	it('is five, or what fits at the minimum width, whichever is lower', () => {
		const five = 5 * MIN_PANE_WIDTH + 4 * PANE_DIVIDER_WIDTH;
		expect(maxPanesFor(five)).toBe(5);
		expect(maxPanesFor(five - 1)).toBe(4);
		expect(maxPanesFor(2 * MIN_PANE_WIDTH + PANE_DIVIDER_WIDTH)).toBe(2);
		// A very wide row still stops at five.
		expect(maxPanesFor(5000)).toBe(MAX_PANES);
	});

	it('never refuses the first pane, and refuses nothing before the row is measured', () => {
		expect(maxPanesFor(10)).toBe(1);
		expect(maxPanesFor(null)).toBe(MAX_PANES);
	});
});

describe('splitDisabledReason', () => {
	it('names the reason, in the order a user would hit them', () => {
		expect(splitDisabledReason(null, 2000)).toBe('Select a shell to split it');
		expect(splitDisabledReason(5, 2000)).toBe('Five panes is the most a chip holds');
		expect(splitDisabledReason(2, 2 * MIN_PANE_WIDTH + PANE_DIVIDER_WIDTH)).toBe(
			'No room for another pane',
		);
		expect(splitDisabledReason(2, 2000)).toBeNull();
	});
});

describe('fractions', () => {
	it('are equal until a drag says otherwise, and equal again when the count moves on', () => {
		expect(equalFractions(4)).toEqual([0.25, 0.25, 0.25, 0.25]);
		expect(paneFractions(undefined, 2)).toEqual([0.5, 0.5]);
		expect(paneFractions([0.3, 0.7], 2)).toEqual([0.3, 0.7]);
		// A drag of two panes says nothing about three.
		expect(paneFractions([0.3, 0.7], 3)).toEqual(equalFractions(3));
	});
});

describe('a divider moves width between its two neighbours', () => {
	// Two panes in a 1004px row: 1000px between them.
	const row = 2 * 500 + PANE_DIVIDER_WIDTH;

	it('leaves the other panes alone', () => {
		const next = resizePair([1 / 3, 1 / 3, 1 / 3], 0, 200, 3 * 300 + 2 * PANE_DIVIDER_WIDTH);
		expect(next[0]).toBeCloseTo(200 / 900);
		expect(next[1]).toBeCloseTo(400 / 900);
		expect(next[2]).toBeCloseTo(1 / 3);
	});

	it('clamps so neither neighbour goes under the minimum', () => {
		expect(availableWidth(row, 2)).toBe(1000);
		expect(clampPaneWidth([0.5, 0.5], 0, 10, row)).toBe(MIN_PANE_WIDTH);
		expect(clampPaneWidth([0.5, 0.5], 0, 990, row)).toBe(1000 - MIN_PANE_WIDTH);
		expect(clampPaneWidth([0.5, 0.5], 0, 600, row)).toBe(600);
	});

	it('is a no-op on a divider that does not exist, or a row that has no width', () => {
		expect(resizePair([0.5, 0.5], 1, 300, row)).toEqual([0.5, 0.5]);
		expect(resizePair([0.5, 0.5], 0, 300, 0)).toEqual([0.5, 0.5]);
	});
});
