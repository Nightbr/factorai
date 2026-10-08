import { describe, expect, it } from 'vitest';
import { oklchToHex, parseOklch } from './oklch';

describe('parseOklch', () => {
	it('reads the percent form the palette is written in', () => {
		expect(parseOklch('oklch(81.3% 0.165 75)')).toEqual({ l: 0.813, c: 0.165, h: 75 });
	});

	it('reads a unit-interval lightness', () => {
		expect(parseOklch('oklch(0.16 0.008 250)')).toEqual({ l: 0.16, c: 0.008, h: 250 });
	});

	it('takes a missing hue as 0, which is what CSS does', () => {
		expect(parseOklch('oklch(100% 0)')).toEqual({ l: 1, c: 0, h: 0 });
	});

	it('tolerates the surrounding whitespace getComputedStyle leaves', () => {
		expect(parseOklch('  oklch(25% 0.008 250) ')).toEqual({ l: 0.25, c: 0.008, h: 250 });
	});

	it('refuses anything that is not a plain oklch triple', () => {
		expect(parseOklch('')).toBeNull();
		expect(parseOklch('#ffb020')).toBeNull();
		expect(parseOklch('rgb(255 176 32)')).toBeNull();
		// An alpha channel would silently be dropped, so it is refused instead.
		expect(parseOklch('oklch(81.3% 0.165 75 / 50%)')).toBeNull();
		expect(parseOklch('oklch(none 0.165 75)')).toBeNull();
	});
});

describe('oklchToHex', () => {
	it('round-trips the brand amber', () => {
		// specs/09-branding.md B4: --primary is the icon's fill, exactly.
		expect(oklchToHex('oklch(81.3% 0.165 75)')).toBe('#ffb020');
	});

	it('converts the achromatic ends', () => {
		expect(oklchToHex('oklch(0% 0 0)')).toBe('#000000');
		expect(oklchToHex('oklch(100% 0 0)')).toBe('#ffffff');
	});

	it('converts the dark theme surfaces', () => {
		expect(oklchToHex('oklch(16% 0.008 250)')).toBe('#0b0e11');
		expect(oklchToHex('oklch(96% 0.004 250)')).toBe('#f0f2f4');
	});

	it('clamps out-of-gamut chroma rather than emitting a broken channel', () => {
		const hex = oklchToHex('oklch(60% 0.4 140)');
		expect(hex).toMatch(/^#[0-9a-f]{6}$/);
	});

	it('is null for anything it cannot parse', () => {
		expect(oklchToHex('var(--primary)')).toBeNull();
	});
});
