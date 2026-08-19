import { describe, expect, it } from 'vitest';
import {
	PDF_ZOOM_MAX,
	PDF_ZOOM_MIN,
	clampPdfZoom,
	currentPage,
	fitWidthScale,
	pdfZoomPercent,
	stepPdfZoom,
} from '@components/viewer/pdfZoom';

describe('clampPdfZoom', () => {
	it('holds the bounds', () => {
		expect(clampPdfZoom(0.1)).toBe(PDF_ZOOM_MIN);
		expect(clampPdfZoom(99)).toBe(PDF_ZOOM_MAX);
		expect(clampPdfZoom(1.5)).toBe(1.5);
	});

	it('treats a non-number as 1 rather than propagating NaN', () => {
		// A NaN scale reaches a canvas width and pdf.js throws somewhere far from
		// here, so it stops at the boundary.
		expect(clampPdfZoom(Number.NaN)).toBe(1);
		expect(clampPdfZoom(Number.POSITIVE_INFINITY)).toBe(1);
	});
});

describe('stepPdfZoom', () => {
	it('steps by a constant ratio, not a constant amount', () => {
		expect(stepPdfZoom(1, 1)).toBeCloseTo(1.25);
		expect(stepPdfZoom(2, 1)).toBeCloseTo(2.5);
		expect(stepPdfZoom(1, -1)).toBeCloseTo(0.8);
	});

	it('cannot step outside the bounds', () => {
		expect(stepPdfZoom(PDF_ZOOM_MAX, 1)).toBe(PDF_ZOOM_MAX);
		expect(stepPdfZoom(PDF_ZOOM_MIN, -1)).toBe(PDF_ZOOM_MIN);
	});
});

describe('fitWidthScale', () => {
	it('fits the widest page, gutter included', () => {
		expect(fitWidthScale(1000, 800, 40)).toBeCloseTo(1.2);
	});

	it('answers 1 before anything has been measured', () => {
		// First render: the pane has no width yet and no page has been sized.
		expect(fitWidthScale(0, 800, 40)).toBe(1);
		expect(fitWidthScale(1000, 0, 40)).toBe(1);
	});

	it('will not go below the minimum in a very narrow pane', () => {
		expect(fitWidthScale(120, 2400, 40)).toBe(PDF_ZOOM_MIN);
	});
});

describe('currentPage', () => {
	const tops = [0, 1000, 2000, 3000];

	it('is the page covering the top of the pane', () => {
		expect(currentPage(tops, 0)).toBe(1);
		expect(currentPage(tops, 990)).toBe(1);
		expect(currentPage(tops, 1000)).toBe(2);
		expect(currentPage(tops, 2500)).toBe(3);
	});

	it('holds at the last page past the end', () => {
		expect(currentPage(tops, 99_999)).toBe(4);
	});

	it('is 1 for a document that has not been measured', () => {
		expect(currentPage([], 0)).toBe(1);
	});

	it('does not lag a page on a sub-pixel scroll', () => {
		// Scrolling to page 2 can land at 999.6 rather than 1000, which without
		// the slack reads as page 1 while page 2 fills the pane. The cost is a
		// boundary that is a pixel early — 999 also reads as page 2, and nobody
		// can see the difference.
		expect(currentPage(tops, 999.6)).toBe(2);
		expect(currentPage(tops, 999)).toBe(2);
	});
});

describe('pdfZoomPercent', () => {
	it('reads as a whole percentage', () => {
		expect(pdfZoomPercent(1)).toBe('100%');
		expect(pdfZoomPercent(1.2345)).toBe('123%');
	});
});
