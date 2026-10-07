import type { ITheme } from '@xterm/xterm';
import { oklchToHex } from '@lib/oklch';
import type { Theme } from '@lib/theme';

/**
 * The palette → xterm mapper Q8 decided on (`specs/07-open-questions.md`): two
 * themes, light and dark, following the app's rather than offering a picker.
 *
 * xterm draws to a canvas and takes its colours as an options object, so it
 * cannot read a CSS variable. The ground, the text and the cursor are read off
 * the tokens and converted, which keeps one palette rather than a hex copy that
 * goes stale; `--terminal` and `--terminal-foreground` exist for this.
 */

type TokenReader = (name: string) => string;

/**
 * The token values each theme ships with, used when a token cannot be read —
 * before the stylesheet has loaded, or in a test. Mirrors `@factorai/ui`'s
 * `globals.css`; a mismatch only matters for the frame before CSS arrives.
 */
const FALLBACK: Record<Theme, Record<string, string>> = {
	dark: {
		'--terminal': 'oklch(16.3% 0.009 264)',
		'--terminal-foreground': 'oklch(87.1% 0.005 286)',
		'--primary': 'oklch(81.3% 0.165 75)',
	},
	light: {
		'--terminal': 'oklch(100% 0 0)',
		'--terminal-foreground': 'oklch(24% 0.008 250)',
		'--primary': 'oklch(58% 0.17 75)',
	},
};

/**
 * ANSI colours for a white ground.
 *
 * **xterm's defaults are a dark-ground palette**: its `white` is near-white and
 * its `yellow` is a light yellow, so on paper a `git status`, a test runner's
 * warnings and half of a prompt simply disappear. These are GitHub's light
 * terminal colours (Primer), which are tuned for exactly this — every hue holds
 * at least 4.5:1 on white except the deliberately faint `brightWhite`.
 *
 * The dark theme sets none, on purpose: xterm's defaults are what every
 * terminal in the app has always drawn there.
 */
const LIGHT_ANSI: ITheme = {
	black: '#24292f',
	red: '#cf222e',
	green: '#116329',
	yellow: '#4d2d00',
	blue: '#0969da',
	magenta: '#8250df',
	cyan: '#1b7c83',
	white: '#6e7781',
	brightBlack: '#57606a',
	brightRed: '#a40e26',
	brightGreen: '#1a7f37',
	brightYellow: '#633c01',
	brightBlue: '#218bff',
	brightMagenta: '#a475f9',
	brightCyan: '#3192aa',
	brightWhite: '#8c959f',
};

export function xtermTheme(readToken: TokenReader, theme: Theme): ITheme {
	const token = (name: string): string =>
		oklchToHex(readToken(name)) ?? oklchToHex(FALLBACK[theme][name] ?? '') ?? '#000000';

	const background = token('--terminal');
	const foreground = token('--terminal-foreground');
	return {
		background,
		foreground,
		cursor: token('--primary'),
		cursorAccent: background,
		// The text colour at 30%: a selection that reads on both grounds, where
		// xterm's own default is a white wash that vanishes on paper.
		selectionBackground: `${foreground}4d`,
		...(theme === 'light' ? LIGHT_ANSI : {}),
	};
}

/** The theme for the document as it is now. */
export function documentXtermTheme(theme: Theme): ITheme {
	const style = getComputedStyle(document.documentElement);
	return xtermTheme((name) => style.getPropertyValue(name), theme);
}
