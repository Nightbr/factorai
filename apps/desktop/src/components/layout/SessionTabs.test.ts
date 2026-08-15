import { dropIndex } from '@components/layout/SessionTabs';
import { describe, expect, it } from 'vitest';

/**
 * The tab strip reorders live, on `dragover`, so this arithmetic runs dozens of
 * times per drag. Two things have to hold: the index it returns has to be the
 * one you'd expect having watched the tab move, and hovering the tab's own
 * neighbourhood has to return the index it is already at — that identity is the
 * whole flicker guard, since a `to === from` result is what stops the reorder
 * from firing at all.
 */
describe('dropIndex', () => {
	// Strip is [A, B, C, D]; the arguments are always the *current* indices.
	describe('dragging rightwards', () => {
		it('lands after the hovered tab once the pointer is past its centre', () => {
			// A over C's right half → [B, C, A, D]: A lands at 2.
			expect(dropIndex(0, 2, true)).toBe(2);
		});

		it('lands before the hovered tab while the pointer is short of its centre', () => {
			// A over C's left half → [B, A, C, D]: A lands at 1.
			expect(dropIndex(0, 2, false)).toBe(1);
		});

		it('holds still over the neighbour it has just passed', () => {
			// A already sits directly before B, so B's left half means "stay".
			expect(dropIndex(0, 1, false)).toBe(0);
		});
	});

	describe('dragging leftwards', () => {
		it('lands before the hovered tab while the pointer is short of its centre', () => {
			// D over B's left half → [A, D, B, C]: D lands at 1.
			expect(dropIndex(3, 1, false)).toBe(1);
		});

		it('lands after the hovered tab once the pointer is past its centre', () => {
			// D over B's right half → [A, B, D, C]: D lands at 2.
			expect(dropIndex(3, 1, true)).toBe(2);
		});

		it('holds still over the neighbour it has just passed', () => {
			// D already sits directly after C, so C's right half means "stay".
			expect(dropIndex(3, 2, true)).toBe(3);
		});
	});

	it('never proposes an index outside the strip', () => {
		// Hovering the first tab's left half from the far end is the lowest it
		// goes, and the last tab's right half from the near end the highest.
		expect(dropIndex(3, 0, false)).toBe(0);
		expect(dropIndex(0, 3, true)).toBe(3);
	});
});
