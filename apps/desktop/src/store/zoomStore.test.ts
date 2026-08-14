import { describe, expect, it } from 'vitest';
import { clampZoom, DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, zoomPercent } from '@store/zoomStore';

describe('clampZoom', () => {
	it('holds the range at both ends', () => {
		expect(clampZoom(5)).toBe(MAX_ZOOM);
		expect(clampZoom(0.01)).toBe(MIN_ZOOM);
		expect(clampZoom(1.2)).toBe(1.2);
	});

	it('rounds away float drift from repeated steps', () => {
		// 0.8 - 0.1 is 0.7000000000000001 in binary floating point, which would
		// render as "70.00000000000001%" and never equal MIN_ZOOM on the way down.
		expect(clampZoom(0.8 - 0.1)).toBe(0.7);
		expect(clampZoom(1.1 + 0.1)).toBe(1.2);
	});

	it('falls back to the default for a value that is not a number', () => {
		// A persisted store from an older/edited build can hand back anything.
		expect(clampZoom(Number.NaN)).toBe(DEFAULT_ZOOM);
		expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(DEFAULT_ZOOM);
	});

	it('survives stepping to the boundary and back', () => {
		let zoom: number = DEFAULT_ZOOM;
		for (let i = 0; i < 20; i++) zoom = clampZoom(zoom - 0.1);
		expect(zoom).toBe(MIN_ZOOM);
		for (let i = 0; i < 40; i++) zoom = clampZoom(zoom + 0.1);
		expect(zoom).toBe(MAX_ZOOM);
	});
});

describe('zoomPercent', () => {
	it('reads as a whole percentage', () => {
		expect(zoomPercent(1)).toBe('100%');
		expect(zoomPercent(0.9)).toBe('90%');
		expect(zoomPercent(1.25)).toBe('125%');
	});
});
