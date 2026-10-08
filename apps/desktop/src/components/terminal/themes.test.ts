import { describe, expect, it } from 'vitest';
import { xtermTheme } from './themes';

/** The tokens as `getComputedStyle` hands them over: the declared text. */
const DARK: Record<string, string> = {
	'--terminal': 'oklch(16.3% 0.009 264)',
	'--terminal-foreground': 'oklch(87.1% 0.005 286)',
	'--primary': 'oklch(81.3% 0.165 75)',
};
const LIGHT: Record<string, string> = {
	'--terminal': 'oklch(100% 0 0)',
	'--terminal-foreground': 'oklch(24% 0.008 250)',
	'--primary': 'oklch(58% 0.17 75)',
};

const reader = (tokens: Record<string, string>) => (name: string) => tokens[name] ?? '';

describe('xtermTheme', () => {
	it('reads the ground, text and cursor off the palette', () => {
		const theme = xtermTheme(reader(DARK), 'dark');
		expect(theme.background).toBe('#0c0e12');
		expect(theme.foreground).toBe('#d4d4d8');
		// The brand amber, exactly — the cursor is the accent.
		expect(theme.cursor).toBe('#ffb020');
		// A block cursor draws the glyph under it in this colour.
		expect(theme.cursorAccent).toBe(theme.background);
	});

	it('leaves the ANSI colours to xterm in the dark theme', () => {
		// xterm's defaults are a dark-ground palette, and they are what every
		// terminal in the app has always drawn.
		expect(xtermTheme(reader(DARK), 'dark').yellow).toBeUndefined();
	});

	it('gives the light theme ANSI colours that read on white', () => {
		const theme = xtermTheme(reader(LIGHT), 'light');
		expect(theme.background).toBe('#ffffff');
		for (const key of ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan'] as const) {
			expect(theme[key], key).toMatch(/^#[0-9a-f]{6}$/);
		}
		// `white` is the one that would vanish if left to xterm's default.
		expect(theme.white).not.toBe('#ffffff');
	});

	it('falls back to the dark values rather than to black when a token is missing', () => {
		const theme = xtermTheme(() => '', 'dark');
		expect(theme.background).toBe('#0c0e12');
		expect(theme.foreground).toBe('#d4d4d8');
	});

	it('falls back to the light values in the light theme', () => {
		const theme = xtermTheme(() => '', 'light');
		expect(theme.background).toBe('#ffffff');
	});
});
