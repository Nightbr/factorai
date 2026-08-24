/**
 * The app palette, handed to mermaid in the one format mermaid can use.
 *
 * Mermaid derives most of a diagram's colours from a handful of seed values —
 * it darkens a node fill for its border, lightens it for a cluster background,
 * and so on — and it does that arithmetic with `khroma`, which parses hex,
 * `rgb()`, `hsl()` and named colours. Our tokens are `oklch()`, which khroma
 * does not parse: handing it one silently produces black. So the tokens are
 * read off the document and converted here.
 *
 * Converting rather than hardcoding is the point. A second copy of the palette
 * in hex is a copy that goes stale the first time a token moves, and the tokens
 * *have* moved — the amber was corrected by 3% lightness on 2026-08-19. This
 * also means the light theme (roadmap item 32) gets mermaid for free: it
 * redefines the same custom properties, and a diagram re-reads them.
 */

interface Oklch {
	/** Lightness, 0..1. */
	l: number;
	/** Chroma, unbounded in principle, ~0..0.4 in practice. */
	c: number;
	/** Hue, degrees. */
	h: number;
}

/**
 * Parse the `oklch(L C H)` form our tokens are written in.
 *
 * Deliberately narrow: this reads the palette in
 * `packages/ui/src/styles/globals.css`, not arbitrary CSS. Lightness may carry
 * a `%`; hue may be omitted, which CSS treats as 0 (a grey). Anything else —
 * `none`, an alpha channel, a different colour space — returns null and the
 * caller falls back rather than guessing.
 */
export function parseOklch(css: string): Oklch | null {
	const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s*(?:([\d.]+)(?:deg)?\s*)?\)$/i.exec(css.trim());
	if (!m) return null;
	const [, rawL, percent, rawC, rawH] = m;
	const l = Number(rawL) / (percent ? 100 : 1);
	const c = Number(rawC);
	const h = rawH === undefined ? 0 : Number(rawH);
	if (!Number.isFinite(l) || !Number.isFinite(c) || !Number.isFinite(h)) return null;
	return { l, c, h };
}

function srgbChannel(linear: number): number {
	const v = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
	return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

/**
 * `oklch(...)` as a `#rrggbb` string, clamped into sRGB.
 *
 * The clamp is a real conversion loss for a colour outside the sRGB gamut —
 * the palette's chroma stays well inside it, and a diagram is not the surface
 * to discover otherwise on.
 */
export function oklchToHex(css: string): string | null {
	const parsed = parseOklch(css);
	if (!parsed) return null;
	const { l: lightness, c, h } = parsed;
	const rad = (h * Math.PI) / 180;
	const a = c * Math.cos(rad);
	const b = c * Math.sin(rad);

	// OKLab → LMS (cube roots) → LMS → linear sRGB, Björn Ottosson's matrices.
	const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = lightness - 0.0894841775 * a - 1.291485548 * b;
	const lm = l_ ** 3;
	const mm = m_ ** 3;
	const sm = s_ ** 3;

	const r = 4.0767416621 * lm - 3.3077115913 * mm + 0.2309699292 * sm;
	const g = -1.2684380046 * lm + 2.6097574011 * mm - 0.3413193965 * sm;
	const bl = -0.0041960863 * lm - 0.7034186147 * mm + 1.707614701 * sm;

	const hex = [r, g, bl].map((channel) => srgbChannel(channel).toString(16).padStart(2, '0'));
	return `#${hex.join('')}`;
}

/** The palette values a diagram is built from, already resolved to hex. */
export interface DiagramPalette {
	background: string;
	surface: string;
	surfaceAlt: string;
	border: string;
	text: string;
	mutedText: string;
	line: string;
	/** True when the background is dark — mermaid derives shades in the
	 *  opposite direction depending on this. */
	darkMode: boolean;
}

type TokenReader = (name: string) => string;

/**
 * Resolve the palette from CSS custom properties.
 *
 * Every token is optional: a missing or unparseable one falls back to the dark
 * theme's value rather than to black, because a diagram drawn in black on a
 * black page is indistinguishable from a diagram that failed to render.
 */
export function diagramPalette(readToken: TokenReader): DiagramPalette {
	const token = (name: string, fallback: string): string =>
		oklchToHex(readToken(name) || '') ?? fallback;

	const background = token('--background', '#0b0e11');
	const lightness = parseOklch(readToken('--background') || '')?.l ?? 0;

	return {
		background,
		surface: token('--secondary', '#181b1e'),
		surfaceAlt: token('--muted', '#13161a'),
		border: token('--border', '#1f2225'),
		text: token('--foreground', '#f0f2f4'),
		mutedText: token('--muted-foreground', '#727578'),
		line: token('--muted-foreground', '#727578'),
		darkMode: lightness < 0.5,
	};
}

/**
 * Mermaid's `themeVariables`, for `theme: 'base'`.
 *
 * `base` is the only built-in theme meant to be re-seeded; the others ignore
 * most of what is passed here. The seeds are deliberately *neutral* — a node
 * is the same raised surface a code block is, not the brand amber. A diagram
 * is content, and content coloured like chrome reads as chrome.
 */
export function mermaidThemeVariables(
	palette: DiagramPalette,
	fontFamily: string,
): Record<string, string | boolean> {
	return {
		darkMode: palette.darkMode,
		background: palette.background,
		// Node fill, and the seed for most derived surfaces.
		primaryColor: palette.surface,
		primaryTextColor: palette.text,
		primaryBorderColor: palette.border,
		secondaryColor: palette.surfaceAlt,
		tertiaryColor: palette.background,
		// Edges and the arrowheads on them.
		lineColor: palette.line,
		textColor: palette.text,
		titleColor: palette.text,
		// A flowchart edge label is drawn on its own rect, which `base` derives
		// from a `labelBackground` it does not have here — leaving a black block
		// behind `yes` / `no` on a not-quite-black page. Seen in the app; the
		// smoke test cannot catch a colour.
		edgeLabelBackground: palette.background,
		clusterBkg: palette.surfaceAlt,
		clusterBorder: palette.border,
		// Sequence diagrams draw their arrows from `signalColor`, not `lineColor`,
		// and default it to white — so an unset one puts a bright arrow beside a
		// flowchart's muted edge in the same document.
		signalColor: palette.line,
		signalTextColor: palette.text,
		actorBkg: palette.surface,
		actorBorder: palette.border,
		actorTextColor: palette.text,
		actorLineColor: palette.line,
		activationBkgColor: palette.surfaceAlt,
		activationBorderColor: palette.border,
		labelBoxBkgColor: palette.surface,
		labelBoxBorderColor: palette.border,
		labelTextColor: palette.text,
		// Notes are the one thing mermaid defaults to a yellow sticky.
		noteBkgColor: palette.surfaceAlt,
		noteTextColor: palette.text,
		noteBorderColor: palette.border,
		fontFamily,
		fontSize: '14px',
	};
}
