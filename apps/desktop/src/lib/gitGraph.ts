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

/** Padding, border and gap a chip costs beyond its label, in characters. */
const CHIP_OVERHEAD = 2;

/** What one 12px mark and its gap cost, in the same characters. Chips carry
 *  between one and three of them since the `HEAD→` / `≡origin` text became
 *  icons, and charging nothing for them is how a row ends up one chip over
 *  budget. */
const CHIP_ICON_COST = 2.5;

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

/** Radius of the author disc drawn on a commit's node. 9 gives an 18px disc
 *  inside a 26px row — the largest that still leaves air above and below. */
export const AVATAR_RADIUS = 9;

/** The ring around that disc. Half of it sits outside `AVATAR_RADIUS`, which is
 *  the part the rail has to leave room for. */
export const AVATAR_RING = 2;

/**
 * The pitch below which the node stays a plain dot.
 *
 * An avatar is 18px wide however tight the lanes get, so at a 6px pitch it
 * covers three of them and the rail stops being traceable — and tracing is the
 * job the rail exists to do (F18 § The rail). Wide repositories therefore keep
 * dots and read their authors off the hover card, which is the same trade the
 * subject makes when it truncates.
 */
export const AVATAR_MIN_PITCH = 10;

/**
 * Air between the rail's edge and the first lane's centre.
 *
 * **Half a pitch is not enough once the node is an avatar, and that was a bug**
 * (fixed 2026-08-18): lane 0 sat at `pitch / 2` = 6px with a disc of radius 9
 * plus a 1px ring outside it, so every avatar on the leftmost lane was clipped
 * 4px into the panel's edge. Widening the disc's own margin would have been the
 * wrong fix — the disc is sized against the 26px row, not against the rail.
 *
 * Only claimed when an avatar is actually drawn; below `AVATAR_MIN_PITCH` the
 * node is a 3px dot and half a pitch is exactly right.
 *
 * Deliberately not exported: `laneCentre` and `railWidth` are the two things
 * that have to agree about it, and a third caller computing its own inset is
 * exactly the drift this was pulled out to end.
 */
function laneInset(pitch: number): number {
	const air = pitch / 2;
	if (pitch < AVATAR_MIN_PITCH) return air;
	return Math.max(air, AVATAR_RADIUS + AVATAR_RING / 2);
}

/** Where lane `index` is drawn, in rail-local pixels. Exported so the rail's
 *  width and the rail's contents cannot drift apart — they used to derive this
 *  separately, which is how the clipping above went unnoticed. */
export function laneCentre(index: number, pitch: number): number {
	return laneInset(pitch) + index * pitch;
}

/** Width of the rail column: the lanes themselves, plus enough air at each end
 *  that the outermost node is drawn whole. */
export function railWidth(laneCount: number, pitch: number): number {
	return 2 * laneInset(pitch) + (Math.max(1, laneCount) - 1) * pitch;
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
export interface RefChip {
	/** Stable across polls, so React doesn't remount a chip that didn't change. */
	key: string;
	/** The ref's own name and nothing else — see `foldRefs` for why the two
	 *  decorations that used to live in here are marks now. */
	label: string;
	kind: GitRefKind;
	/** HEAD is here: drawn as a tick, the way a checked-out branch reads in every
	 *  other git UI. */
	isHead: boolean;
	/** The remote whose branch sits on this very commit, when local and remote are
	 *  in sync. Drawn as the forge's mark; the remote's name is in `title`. */
	syncedRemote: string | null;
	/** The whole of what the marks compress, spelled out for the chip's tooltip.
	 *  An icon is faster to scan and worse to learn, so the words stay one hover
	 *  away rather than being deleted. */
	title: string;
}

/**
 * The chips a commit's refs become, before any `+N` truncation.
 *
 * Three foldings, applied in this order, which between them mostly dissolve the
 * crowding rather than managing it:
 *
 * 1. `HEAD` merges into its branch chip rather than taking a slot of its own.
 * 2. A local branch whose upstream sits on this same commit absorbs it. This is
 *    the load-bearing one: a local branch and its remote crowd the same row
 *    *only when they are in sync*, because once they diverge they are on
 *    different rows and there is nothing to crowd.
 * 3. The remote ref that was absorbed is dropped, so it doesn't appear twice.
 *
 * **The first two used to fold into the label, and no longer do** (changed
 * 2026-08-18 on user feedback). `HEAD→main ≡origin` spent 17 characters — the
 * entire ref budget at 288px — on 4 characters of branch name, so the chip that
 * mattered most was the one guaranteed to truncate, and a tag on the same commit
 * was pushed into `+1`. Both decorations are marks now: a tick for HEAD, the
 * forge's own logo for the synced remote, beside the laptop already saying the
 * ref is local. The label is the branch name, which is the part you were reading.
 *
 * Nothing is lost, it moves: `title` carries the sentence the marks replace, so
 * "which remote is that" is a hover rather than a guess. Marks are faster to
 * scan and worse to learn, and that trade only works if the words stay reachable.
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

		const syncedRemote =
			ref.kind === 'localBranch' && ref.upstreamInSync
				? remoteOf(ref.upstreamInSync, ref.name)
				: null;
		chips.push({
			key: `${ref.kind}:${ref.name}`,
			label: ref.name,
			kind: ref.kind,
			isHead: ref.isHead,
			syncedRemote,
			title: chipTitle(ref),
		});
	}
	return chips;
}

/** What the chip's marks say, in words. Assembled here rather than in the
 *  component so the row and the hover card cannot describe the same ref
 *  differently. */
function chipTitle(ref: GitRef): string {
	const where =
		ref.kind === 'tag' ? 'Tag' : ref.kind === 'remoteBranch' ? 'Remote branch' : 'Local branch';
	const parts = [`${where} ${ref.name}`];
	if (ref.isHead) parts.push('checked out (HEAD)');
	if (ref.upstreamInSync) parts.push(`in sync with ${ref.upstreamInSync}`);
	return parts.join(' · ');
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
		const cost = chipCost(chip);
		// `shown.length === 0` is the always-show-one rule, not an off-by-one.
		if (shown.length > 0 && used + cost > budget) break;
		shown.push(chip);
		used += cost;
	}
	return { shown, hiddenCount: chips.length - shown.length };
}

/** A chip's width in characters: its label, its box, and one charge per mark —
 *  the kind icon always, plus HEAD's tick and the synced remote's logo when the
 *  chip carries them. */
function chipCost(chip: RefChip): number {
	const marks = 1 + (chip.isHead ? 1 : 0) + (chip.syncedRemote ? 1 : 0);
	return chip.label.length + CHIP_OVERHEAD + marks * CHIP_ICON_COST;
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
