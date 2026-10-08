/**
 * Pure helpers for the hashed-initials project tile (specs/07-open-questions.md
 * Q11, ADR-0072). Extracted so they can be unit-tested without a React
 * renderer.
 */
import { fnv1a } from '@lib/hash';

/**
 * The hues a project tile can take, in oklch degrees.
 *
 * **Eleven, hand-spaced, not 360 or an even twelve.** A continuous hue made
 * neighbouring projects "nearly the same" — the worst outcome for a mark whose
 * only job is to be told apart at 16px. An even spacing in oklch still stacks
 * three greens (120, 150, 180 all read as green) while leaving the red-to-orange
 * stretch thin; these are spaced by how far apart they *look*, and were judged
 * as a row of tiles on both grounds.
 *
 * **The band around 75 is deliberately empty.** Amber is the One Amber Rule
 * (DESIGN.md): the `waiting` badge sits on this tile's own corner, and a tile
 * that was itself amber would be a tile that always looked like your turn.
 */
export const PROJECT_HUES = [20, 45, 100, 140, 175, 205, 240, 270, 295, 320, 350] as const;

/**
 * Two weights per hue, so the palette is 22 swatches rather than 11 and two
 * projects on the same hue still differ in the tile's fill and the initials'
 * ink. Ink is tied to the fill here, not to a theme token, so the pair holds
 * in both themes — the same reasoning as `avatarInk` in `lib/avatar.ts`.
 *
 * - `deep` sits under the row text, near the weight the old `hsl(h 60% 35%)`
 *   tile had, with near-white initials.
 * - `bright` is a step lighter and a touch more saturated, with near-black
 *   initials: the ink flip is what makes the two tones read as different tiles
 *   rather than the same tile under a different light.
 */
const PROJECT_TONES = [
	{ fill: (h: number) => `oklch(46% 0.13 ${h})`, ink: (h: number) => `oklch(97% 0.015 ${h})` },
	{ fill: (h: number) => `oklch(60% 0.15 ${h})`, ink: (h: number) => `oklch(20% 0.03 ${h})` },
] as const;

/** How many distinct tiles there are. Exported so a test can assert the hash
 *  reaches every one of them rather than a lucky subset. */
export const PROJECT_SWATCH_COUNT = PROJECT_HUES.length * PROJECT_TONES.length;

interface ProjectSwatch {
	/** The tile's background. */
	fill: string;
	/** The initials' colour on that background. */
	ink: string;
}

/**
 * The tile for a project, keyed on its display name.
 *
 * **The name, not the path (ADR-0072).** The name is what the human reads next
 * to the tile, so it is the identity the colour should follow: a project moved
 * on disk keeps its colour, and the same project in two checkouts (a clone on
 * two machines, a worktree beside its repository) draws the same tile. Case and
 * surrounding whitespace are folded so `Factorai` and `factorai ` are one
 * project rather than two colours.
 */
export function projectSwatch(name: string): ProjectSwatch {
	const i = fnv1a(name.trim().toLowerCase()) % PROJECT_SWATCH_COUNT;
	const hue = PROJECT_HUES[i % PROJECT_HUES.length];
	const tone = PROJECT_TONES[Math.floor(i / PROJECT_HUES.length)];
	return { fill: tone.fill(hue), ink: tone.ink(hue) };
}

export function pickInitials(name: string): string {
	const clean = name.replace(/^[-_.]+/, '');
	if (!clean) return '?';
	const parts = clean.split(/[\s\-_]+/).filter(Boolean);
	if (parts.length >= 2) {
		return (parts[0][0] + parts[1][0]).toUpperCase();
	}
	return clean.slice(0, 2).toUpperCase();
}
