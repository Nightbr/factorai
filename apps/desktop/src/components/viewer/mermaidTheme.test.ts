import { describe, expect, it } from 'vitest';
import { diagramPalette, mermaidThemeVariables } from './mermaidTheme';

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
