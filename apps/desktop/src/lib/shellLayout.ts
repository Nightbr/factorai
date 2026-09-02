import { MAX_PANES } from '@store/shellStore';

/**
 * The geometry of a chip's row of panes (`specs/05-features.md` § F24), as pure
 * functions over fractions of the row so the store never sees a pixel and the
 * component never does arithmetic.
 */

/** Narrower than this and a terminal wraps every line it prints — about twenty
 *  columns at the pane's 13px mono. A pane is never dragged, or split, under it. */
export const MIN_PANE_WIDTH = 160;
/** The `PanelResizer` between two panes: `w-1`. */
export const PANE_DIVIDER_WIDTH = 4;

/** What the panes share once the dividers have taken theirs. */
export function availableWidth(rowWidth: number, panes: number): number {
	return Math.max(0, rowWidth - PANE_DIVIDER_WIDTH * Math.max(panes - 1, 0));
}

/**
 * How many panes fit in a row at the minimum width, capped at `MAX_PANES` —
 * the cap is **five, or what fits, whichever is lower** (F24). An unmeasured
 * row (`null`) does not refuse anything: the measurement lands before a click
 * can, and refusing on no evidence would read as a broken control.
 */
export function maxPanesFor(rowWidth: number | null): number {
	if (rowWidth === null) return MAX_PANES;
	const fit = Math.floor((rowWidth + PANE_DIVIDER_WIDTH) / (MIN_PANE_WIDTH + PANE_DIVIDER_WIDTH));
	return Math.min(MAX_PANES, Math.max(fit, 1));
}

/**
 * Why `Split` is disabled, or `null` when it is not. The reason goes in the
 * control's tooltip: a disabled control that does not say why is a control you
 * have to already understand.
 */
export function splitDisabledReason(
	paneCount: number | null,
	rowWidth: number | null,
): string | null {
	if (paneCount === null) return 'Select a shell to split it';
	if (paneCount >= MAX_PANES) return 'Five panes is the most a chip holds';
	if (paneCount >= maxPanesFor(rowWidth)) return 'No room for another pane';
	return null;
}

export function equalFractions(panes: number): number[] {
	return Array.from({ length: panes }, () => 1 / panes);
}

/** The fractions to draw: a drag's, when there is one that still fits the
 *  pane count, and equal otherwise. */
export function paneFractions(dragged: number[] | undefined, panes: number): number[] {
	return dragged && dragged.length === panes ? dragged : equalFractions(panes);
}

/**
 * Clamp a drag of the divider after pane `index` to the pixel range both
 * neighbours allow: neither the pane nor the one to its right goes under
 * `MIN_PANE_WIDTH`. The pair's total is what the two had, because a divider
 * moves width between its neighbours and nowhere else.
 */
export function clampPaneWidth(
	fractions: number[],
	index: number,
	px: number,
	rowWidth: number,
): number {
	const available = availableWidth(rowWidth, fractions.length);
	const pair = ((fractions[index] ?? 0) + (fractions[index + 1] ?? 0)) * available;
	const max = Math.max(MIN_PANE_WIDTH, pair - MIN_PANE_WIDTH);
	return Math.round(Math.min(max, Math.max(MIN_PANE_WIDTH, px)));
}

/** New fractions after the pane at `index` is dragged to `px` wide, its right
 *  neighbour absorbing the difference. `px` is assumed already clamped. */
export function resizePair(
	fractions: number[],
	index: number,
	px: number,
	rowWidth: number,
): number[] {
	const available = availableWidth(rowWidth, fractions.length);
	if (available <= 0 || index < 0 || index + 1 >= fractions.length) return fractions;
	const pair = fractions[index] + fractions[index + 1];
	const left = Math.min(pair, Math.max(0, px / available));
	const next = [...fractions];
	next[index] = left;
	next[index + 1] = pair - left;
	return next;
}
