import { describe, expect, it } from 'vitest';
import {
	IMAGE_ZOOM_FIT,
	IMAGE_ZOOM_MAX,
	IMAGE_ZOOM_MIN,
	clampImageZoom,
	imageZoomPercent,
	stepImageZoom,
} from '@components/viewer/ImageView';

describe('image zoom', () => {
	it('steps by a constant ratio, not a constant amount', () => {
		// The point of a ratio: the same button feels like the same step at both
		// ends of the range. An additive step would move a quarter of the image
		// at 1× and a fortieth of it at 8×.
		const fromFit = stepImageZoom(IMAGE_ZOOM_FIT, 1) / IMAGE_ZOOM_FIT;
		const fromFar = stepImageZoom(4, 1) / 4;
		expect(fromFit).toBeCloseTo(fromFar);
	});

	it('returns to where it started after a step out and back', () => {
		// Anywhere the clamp isn't involved, in and out have to be inverses, or
		// the readout drifts as you fiddle with it.
		for (const start of [0.5, 1, 2, 4]) {
			expect(stepImageZoom(stepImageZoom(start, 1), -1)).toBeCloseTo(start);
		}
	});

	it('stops at the bounds rather than running past them', () => {
		expect(stepImageZoom(IMAGE_ZOOM_MAX, 1)).toBe(IMAGE_ZOOM_MAX);
		expect(stepImageZoom(IMAGE_ZOOM_MIN, -1)).toBe(IMAGE_ZOOM_MIN);
	});

	it('clamps anything out of range, including nonsense', () => {
		expect(clampImageZoom(100)).toBe(IMAGE_ZOOM_MAX);
		expect(clampImageZoom(0)).toBe(IMAGE_ZOOM_MIN);
		expect(clampImageZoom(Number.NaN)).toBe(IMAGE_ZOOM_FIT);
		expect(clampImageZoom(Number.POSITIVE_INFINITY)).toBe(IMAGE_ZOOM_FIT);
	});

	it('reads out as whole percents', () => {
		expect(imageZoomPercent(IMAGE_ZOOM_FIT)).toBe('100%');
		expect(imageZoomPercent(1.25)).toBe('125%');
		// 1.25**3 is 1.953125 — the readout must not show that.
		expect(imageZoomPercent(1.25 ** 3)).toBe('195%');
	});
});
