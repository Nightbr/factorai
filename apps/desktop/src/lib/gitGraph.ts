import type { GitGraph, GitGraphCommit, GitRef, GitRefKind } from '@factorai/types';

/**
 * The rail's geometry and the row's ref-chip folding (specs/05-features.md F18).
 *
 * Pure, and here rather than inside the components, because these are the two
 * decisions that make a commit graph legible at 288px and both are worth testing
 * without mounting anything. Lane *assignment* is not here — that runs in Rust
 * and arrives in the payload (Q23).
 */

/** How many `--lane-N` tokens exist in `packages/ui/src/styles/globals.css`.
 *  **The two must agree**: a ninth token there without a bump here would never be
 *  drawn, and a ninth lane here would resolve to an undefined custom property and
 *  paint nothing at all. See ADR-0012. */
export const LANE_COUNT = 8;

/** Lane pitch when there is room for it — enough for a 3px node with clear air
 *  either side. */
export const LANE_PITCH_MAX = 12;

/** The floor. Below this, adjacent lanes stop being separable however good the
 *  colours are, so the rail grows past its budget instead of compressing further. */
export const LANE_PITCH_MIN = 6;

/** The share of panel width the rail may take before it starts compressing.
 *  Everything left over belongs to the refs and the subject. */
const RAIL_BUDGET_RATIO = 0.35;

/** The share of the *text* column refs may take before the rest becomes `+N`.
 *  The subject keeps the remainder, which is the floor that stops a tagged
 *  release being the one commit whose message you cannot read. */
const REF_BUDGET_RATIO = 0.5;

/** Rough average glyph width at `text-sm`, for turning a pixel budget into a
 *  character budget. Approximate on purpose: it decides how many chips fit, and
 *  being one chip out costs a `+1` rather than a broken layout. */
const CHAR_PX = 6.5;

/** Padding and gap a chip costs beyond its label, in characters. */
const CHIP_OVERHEAD = 2;

/** Which lane colour a lane index paints in, cycling once past the last token.
 *  Lanes are allocated left-first and recycled, so a wrap puts the same colour a
 *  long way across the rail from its twin rather than beside it. */
export function laneColour(lane: number): string {
	return `var(--lane-${((lane % LANE_COUNT) + LANE_COUNT) % LANE_COUNT})`;
}

/**
 * Pixels between lane centres, given how many lanes are live and how wide the
 * panel is.
 *
 * Compresses from `LANE_PITCH_MAX` toward `LANE_PITCH_MIN` as lanes multiply, so
 * four lanes look generous and fourteen still fit. Past what the floor can hold
 * the rail exceeds its budget rather than compressing further — no commit is ever
 * hidden and the subject always keeps a floor, which are the two ways this goes
 * wrong.
 */
export function lanePitch(laneCount: number, panelWidth: number): number {
	if (laneCount <= 1) return LANE_PITCH_MAX;
	const budgetPx = Math.max(LANE_PITCH_MIN, panelWidth * RAIL_BUDGET_RATIO);
	const fits = Math.floor(budgetPx / laneCount);
	return Math.min(LANE_PITCH_MAX, Math.max(LANE_PITCH_MIN, fits));
}

/** Width of the rail column. One pitch per lane, plus half a pitch of air so the
 *  leftmost and rightmost nodes aren't flush against the edge. */
export function railWidth(laneCount: number, pitch: number): number {
	return Math.max(1, laneCount) * pitch + pitch;
}

/** Loaded pages, joined into one list. */
interface StitchedGraph {
	commits: GitGraphCommit[];
	laneCount: number;
	hasMore: boolean;
	/** A later page was walked against a different set of refs than the first, so
	 *  the caller should drop back to one page and refetch rather than splice. */
	stale: boolean;
}

/**
 * Join the loaded pages into one list.
 *
 * **Only the contiguous prefix counts.** Filtering out the pages that have no
 * data yet would silently promote page 2 to the top of the list while page 1 is
 * refetching — the rows would be in order and simply be the wrong rows, which is
 * the worst kind of wrong for a history viewer. Stopping at the first gap shows a
 * shorter list instead, which is honest.
 *
 * **A digest mismatch collapses to page 1.** Refs moving mid-paging means the
 * later pages were walked against a different set than the first, and splicing
 * those would draw a history that never existed.
 */
export function stitchPages(pages: (GitGraph | undefined)[]): StitchedGraph {
	const contiguous: GitGraph[] = [];
	for (const page of pages) {
		if (!page) break;
		contiguous.push(page);
	}

	const digest = contiguous[0]?.refsDigest;
	const stale = contiguous.some((page) => page.refsDigest !== digest);
	const usable = stale ? contiguous.slice(0, 1) : contiguous;

	return {
		commits: usable.flatMap((page) => page.commits),
		// Lanes live anywhere in the prefix walked, so the newest page knows about
		// the most. The max keeps one pitch for the whole list, and it only ever
		// grows as you load more, so the rows above never reflow.
		laneCount: usable.reduce((widest, page) => Math.max(widest, page.laneCount), 0),
		hasMore: Boolean(usable.at(-1)?.hasMore),
		stale,
	};
}

/** A ref as the row draws it, after folding. */
interface RefChip {
	/** Stable across polls, so React doesn't remount a chip that didn't change. */
	key: string;
	label: string;
	kind: GitRefKind;
	isHead: boolean;
}

/**
 * The chips a commit's refs become, before any `+N` truncation.
 *
 * Three foldings, applied in this order, which between them mostly dissolve the
 * crowding rather than managing it:
 *
 * 1. `HEAD` merges into its branch chip as `HEAD→main`, rather than taking a slot.
 * 2. A local branch whose upstream sits on this same commit absorbs it as
 *    `main ≡origin`. This is the load-bearing one: a local branch and its remote
 *    crowd the same row *only when they are in sync*, because once they diverge
 *    they are on different rows and there is nothing to crowd.
 * 3. The remote ref that was absorbed is dropped, so it doesn't appear twice.
 *
 * `origin/HEAD` never arrives — it is dropped in Rust, being a symbolic ref
 * duplicating one we already return. Order is Rust's too, so the `+N` cut is the
 * same on every poll.
 */
export function foldRefs(refs: GitRef[]): RefChip[] {
	const absorbed = new Set(
		refs
			.filter((ref) => ref.kind === 'localBranch' && ref.upstreamInSync)
			.map((ref) => ref.upstreamInSync as string),
	);

	const chips: RefChip[] = [];
	for (const ref of refs) {
		if (ref.kind === 'remoteBranch' && absorbed.has(ref.name)) continue;

		let label = ref.name;
		if (ref.kind === 'localBranch') {
			if (ref.isHead) label = `HEAD→${label}`;
			if (ref.upstreamInSync) label = `${label} ≡${remoteOf(ref.upstreamInSync, ref.name)}`;
		}
		chips.push({ key: `${ref.kind}:${ref.name}`, label, kind: ref.kind, isHead: ref.isHead });
	}
	return chips;
}

/** `origin` out of `origin/main` for branch `main` — which is not the same as
 *  "the first path segment", because a branch can itself contain slashes and
 *  `feature/x` tracked from `origin` gives `origin/feature/x`. */
function remoteOf(upstream: string, branch: string): string {
	const suffix = `/${branch}`;
	if (upstream.endsWith(suffix)) return upstream.slice(0, -suffix.length);
	const [first] = upstream.split('/');
	return first;
}

/**
 * How many chips fit in the space refs are allowed, and how many are left over.
 *
 * **The first chip is always shown**, even when it alone exceeds the budget: a
 * row whose only content is `+1` tells you a ref is here and refuses to say
 * which, which is worse than a truncated label.
 */
export function fitRefs(
	chips: RefChip[],
	textWidthPx: number,
): { shown: RefChip[]; hiddenCount: number } {
	if (chips.length === 0) return { shown: [], hiddenCount: 0 };

	const budget = Math.max(0, (textWidthPx * REF_BUDGET_RATIO) / CHAR_PX);
	const shown: RefChip[] = [];
	let used = 0;
	for (const chip of chips) {
		const cost = chip.label.length + CHIP_OVERHEAD;
		// `shown.length === 0` is the always-show-one rule, not an off-by-one.
		if (shown.length > 0 && used + cost > budget) break;
		shown.push(chip);
		used += cost;
	}
	return { shown, hiddenCount: chips.length - shown.length };
}

/**
 * Tailwind classes per chip kind.
 *
 * These are **badges** as of 2026-08-17 — a tinted ground and a hairline border,
 * rather than the bare coloured label this shipped with. A ref is an object on
 * the row, not an adjective describing the subject beside it, and at 288px the
 * bare labels ran into the subject text often enough to read as one string. The
 * tint is 12% so it stays a ground rather than a block: `IconButton`'s no-fill
 * rule is about controls, and a badge is not one.
 */
export const CHIP_CLASSES: Record<GitRefKind, string> = {
	localBranch: 'border-primary/30 bg-primary/12 text-primary',
	remoteBranch: 'border-sky-500/30 bg-sky-500/12 text-sky-400',
	tag: 'border-emerald-500/30 bg-emerald-500/12 text-emerald-400',
	head: 'border-primary/30 bg-primary/12 text-primary',
};

/** Shared badge geometry: the border, radius, padding and the icon gap. Split
 *  from the per-kind colour so a new kind cannot accidentally get a different
 *  shape. */
export const CHIP_SHAPE =
	'inline-flex items-center gap-1 rounded border px-1 py-px font-medium text-xs leading-tight';

/**
 * How wide one chip may get before it truncates.
 *
 * A branch called `feature/some-very-long-description` used to push the subject
 * off the row entirely, because chips were `shrink-0` with nothing capping them.
 * Capped against the *text* column rather than a constant, so a 600px panel
 * shows more of the name than a 288px one, and never past 55% — two long
 * branches on one row still have to leave the subject something. 55 rather than
 * 40 because the chips grew icons: at 288px a 40% cap cut `HEAD→main ≡origin`
 * down to `HEAD→…`, which names nothing.
 */
export function chipMaxWidth(textWidthPx: number): number {
	return Math.round(Math.min(220, Math.max(64, textWidthPx * 0.55)));
}
