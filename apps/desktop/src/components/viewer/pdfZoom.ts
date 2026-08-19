/**
 * The arithmetic behind `PdfView`'s zoom and page counter, kept pure so it can
 * be tested without a document, a canvas or a worker (F7).
 */

/**
 * Zoom bounds, deliberately narrower than `ImageView`'s 0.25–8.
 *
 * That view exists to look at a screenshot's pixels; this one shows a document,
 * where 8× is past the point at which a page stops being readable as a page and
 * 0.25× is smaller than the thumbnail we don't have yet.
 */
export const PDF_ZOOM_MIN = 0.5;
export const PDF_ZOOM_MAX = 4;

/** Fit-width — what the view opens at — is `null` rather than a number: the
 *  scale is measured from the pane, so it has to be recomputed on every resize,
 *  and a stored number would silently stop being "fit" the moment the pane
 *  changed. `fitWidthScale` below turns it into one. */

export function clampPdfZoom(scale: number): number {
	if (!Number.isFinite(scale)) return 1;
	return Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, scale));
}

/** One step, multiplicatively — the same ×1.25 `ImageView` uses, and for the
 *  same reason: a constant ratio is a constant apparent step at every scale,
 *  where a constant increment is coarse at the bottom and useless at the top. */
export function stepPdfZoom(scale: number, direction: 1 | -1): number {
	return clampPdfZoom(scale * 1.25 ** direction);
}

export function pdfZoomPercent(scale: number): string {
	return `${Math.round(scale * 100)}%`;
}

/**
 * The scale at which the widest page fills the pane.
 *
 * Measured off the *widest* page rather than the first: a document with one
 * landscape figure in it would otherwise open with that page overflowing
 * sideways, and a horizontal scrollbar in a reader is a bug you have to
 * discover by scrolling.
 *
 * Clamped like any other scale, so a very narrow pane can't ask for 0.1×.
 */
export function fitWidthScale(paneWidth: number, widestPage: number, gutter: number): number {
	if (paneWidth <= 0 || widestPage <= 0) return 1;
	return clampPdfZoom((paneWidth - gutter) / widestPage);
}

/**
 * Which page the reader is looking at, from the page tops and the scroll
 * position.
 *
 * "The last page whose top is at or above the viewport's own top, plus a
 * hair" — so a page counts as current the moment it covers the top of the
 * pane, and the counter reads 2 when page 2 has just filled the view rather
 * than when page 1 has fully left it.
 *
 * `tops` are offsets within the scroll container, ascending. The result is
 * 1-based, because it is shown to a person.
 */
const ARRIVAL_SLACK = 1;

export function currentPage(tops: number[], scrollTop: number): number {
	if (tops.length === 0) return 1;
	// A page counts as arrived within `ARRIVAL_SLACK` of the top. Without it a
	// browser's sub-pixel `scrollTop` — 999.6 for a page that starts at 1000 —
	// leaves the counter a page behind at rest. It also makes the boundary
	// deliberately fuzzy by a pixel, which no reader can see.
	const probe = scrollTop + ARRIVAL_SLACK;
	let page = 1;
	for (let i = 0; i < tops.length; i++) {
		if (tops[i] <= probe) page = i + 1;
		else break;
	}
	return page;
}
