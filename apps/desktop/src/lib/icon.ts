/**
 * Pure helpers for the hashed-initials project tile (specs/07-open-questions.md
 * Q11, ADR-0072, ADR-0073). Extracted so they can be unit-tested without a React
 * renderer.
 */
import { fnv1a } from '@lib/hash';

/**
 * The hues a project tile can take, in oklch degrees.
 *
 * **Fifteen, hand-spaced, not 360.** A continuous hue made neighbouring
 * projects "nearly the same" — the worst outcome for a mark whose only job is
 * to be told apart at 16px. These were judged as a row of tiles on both
 * grounds; neighbours are close (ADR-0073 widened the set from eleven so the
 * workspace allocator has room), which is why a bumped project moves several
 * hues on rather than to the next one.
 *
 * **The band around 75 is deliberately empty.** Amber is the One Amber Rule
 * (DESIGN.md): the `waiting` badge sits on this tile's own corner, and a tile
 * that was itself amber would be a tile that always looked like your turn.
 */
export const PROJECT_HUES = [
	10, 32, 50, 100, 120, 140, 160, 180, 200, 220, 245, 270, 295, 320, 345,
] as const;

/**
 * Two weights per hue, so the palette is 30 swatches rather than 15. Both take
 * near-white initials: ADR-0072 flipped the brighter tone to dark ink for
 * variety, and it read worse, not more distinct, so ADR-0073 took it back.
 * Ink is tied to the fill here, not to a theme token, so the pair holds in
 * both themes — the same reasoning as `avatarInk` in `lib/avatar.ts`.
 *
 * - `deep` sits under the row text, near the weight the old `hsl(h 60% 35%)`
 *   tile had.
 * - `vivid` is a step lighter and more saturated, and still carries white at
 *   16px bold.
 */
const PROJECT_TONES = [
	{ fill: (h: number) => `oklch(45% 0.12 ${h})`, ink: (h: number) => `oklch(97% 0.015 ${h})` },
	{ fill: (h: number) => `oklch(56% 0.17 ${h})`, ink: (h: number) => `oklch(97% 0.015 ${h})` },
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
	return swatchAt(preferredSlot(name));
}

/** The identity two projects share when they are "the same project" to the
 *  tile: the display name, case and surrounding whitespace folded. */
export function projectSwatchKey(name: string): string {
	return name.trim().toLowerCase();
}

function preferredSlot(name: string): number {
	return fnv1a(projectSwatchKey(name)) % PROJECT_SWATCH_COUNT;
}

function swatchAt(slot: number): ProjectSwatch {
	const hue = PROJECT_HUES[slot % PROJECT_HUES.length];
	const tone = PROJECT_TONES[Math.floor(slot / PROJECT_HUES.length)];
	return { fill: tone.fill(hue), ink: tone.ink(hue) };
}

/**
 * Where a project goes when its preferred slot is taken: seven slots on, not
 * the next one. The palette is laid out hue by hue, so the next slot is the
 * neighbouring hue — red bumped to orange — which is the near-miss the palette
 * exists to avoid. Seven is coprime with 30, so probing visits every slot
 * before it repeats.
 */
const PROBE_STRIDE = 7;

/**
 * The tile for every project in a workspace, with collisions resolved
 * (ADR-0073).
 *
 * Each project asks for its hashed slot first, so a workspace with no
 * collisions draws exactly what `projectSwatch` would, and a project keeps its
 * colour across restarts, renames of *other* projects, and reorders of the
 * sidebar. When two projects want one slot, the later one by `id` is bumped to
 * the next free slot `PROBE_STRIDE` away. Under 30 projects no two tiles are
 * ever the same; past that the palette is full and the hashed slot stands.
 *
 * **Ordered by `id`, not by sidebar position or recency.** Both of those
 * change under the user's hands, and a tile that changed colour because its
 * project was dragged up the list would be a tile nobody could learn. The id
 * is arbitrary but fixed, which is the property that matters here.
 *
 * Keyed by `projectSwatchKey`, so two projects with one name are one entry and
 * one tile, as ADR-0072 decided.
 */
export function assignProjectSwatches(
	projects: ReadonlyArray<{ id: string; displayName: string }>,
): Map<string, ProjectSwatch> {
	const byKey = new Map<string, string>();
	for (const p of projects) {
		const key = projectSwatchKey(p.displayName);
		const held = byKey.get(key);
		if (held === undefined || p.id < held) byKey.set(key, p.id);
	}
	const ordered = [...byKey.entries()].sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0));

	const taken = new Set<number>();
	const out = new Map<string, ProjectSwatch>();
	for (const [key] of ordered) {
		let slot = preferredSlot(key);
		if (taken.size < PROJECT_SWATCH_COUNT) {
			while (taken.has(slot)) slot = (slot + PROBE_STRIDE) % PROJECT_SWATCH_COUNT;
		}
		taken.add(slot);
		out.set(key, swatchAt(slot));
	}
	return out;
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
