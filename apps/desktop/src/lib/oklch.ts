/**
 * Our palette tokens are written in `oklch()`; three consumers cannot read that:
 * mermaid's colour arithmetic (`khroma`), Monaco's theme, and xterm's options.
 * These turn a token into the hex they can take.
 */

export interface Oklch {
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
