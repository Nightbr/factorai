import { describe, expect, it } from 'vitest';
import { diagramPalette, mermaidThemeVariables, oklchToHex, parseOklch } from './mermaidTheme';

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

describe('diagramPalette', () => {
	const dark: Record<string, string> = {
		'--background': 'oklch(16% 0.008 250)',
		'--secondary': 'oklch(22% 0.008 250)',
		'--muted': 'oklch(20% 0.008 250)',
		'--border': 'oklch(25% 0.008 250)',
		'--foreground': 'oklch(96% 0.004 250)',
		'--muted-foreground': 'oklch(56% 0.006 250)',
	};

	it('resolves every token to hex', () => {
		const palette = diagramPalette((name) => dark[name] ?? '');
		expect(palette.background).toBe('#0b0e11');
		expect(palette.surface).toBe('#181b1e');
		expect(palette.text).toBe('#f0f2f4');
		expect(palette.darkMode).toBe(true);
	});

	it('notices a light background, since mermaid derives shades from it', () => {
		const light: Record<string, string> = { ...dark, '--background': 'oklch(98% 0.004 250)' };
		expect(diagramPalette((name) => light[name] ?? '').darkMode).toBe(false);
	});

	it('falls back to the dark theme when a token is missing', () => {
		// Black on black is indistinguishable from a diagram that never rendered,
		// so an unresolvable token must not become one.
		const palette = diagramPalette(() => '');
		expect(palette.background).toBe('#0b0e11');
		expect(palette.text).toBe('#f0f2f4');
		expect(palette.surface).not.toBe(palette.text);
	});

	it('falls back the same way for a token in a form it cannot read', () => {
		expect(diagramPalette(() => '#123456').text).toBe('#f0f2f4');
	});
});

describe('mermaidThemeVariables', () => {
	const palette = diagramPalette(() => '');

	it('seeds mermaid with hex, which is all khroma can do arithmetic on', () => {
		const vars = mermaidThemeVariables(palette, 'Inter, sans-serif');
		for (const [key, value] of Object.entries(vars)) {
			if (key === 'fontFamily' || key === 'fontSize' || key === 'darkMode') continue;
			expect(value, key).toMatch(/^#[0-9a-f]{6}$/);
		}
	});

	it('does not paint every node the brand colour', () => {
		// A diagram is content. Content coloured like chrome reads as chrome.
		const vars = mermaidThemeVariables(palette, 'Inter, sans-serif');
		expect(vars.primaryColor).not.toBe('#ffb020');
	});

	it('carries the font through', () => {
		expect(mermaidThemeVariables(palette, 'Inter, sans-serif').fontFamily).toBe(
			'Inter, sans-serif',
		);
	});
});
