import type { GitGraph, GitGraphCommit, GitRef } from '@factorai/types';
import { describe, expect, it } from 'vitest';
import {
	AVATAR_RADIUS,
	AVATAR_RING,
	fitRefs,
	foldRefs,
	LANE_COUNT,
	LANE_PITCH_MAX,
	LANE_PITCH_MIN,
	laneCentre,
	laneColour,
	lanePitch,
	railWidth,
	stitchPages,
} from './gitGraph';

function ref(partial: Partial<GitRef> & Pick<GitRef, 'name' | 'kind'>): GitRef {
	return { isHead: false, upstreamInSync: null, ...partial };
}

describe('laneColour', () => {
	it('maps each lane to its own token and cycles past the last one', () => {
		expect(laneColour(0)).toBe('var(--lane-0)');
		expect(laneColour(LANE_COUNT - 1)).toBe(`var(--lane-${LANE_COUNT - 1})`);
		expect(laneColour(LANE_COUNT)).toBe('var(--lane-0)');
		expect(laneColour(LANE_COUNT + 3)).toBe('var(--lane-3)');
	});

	it('never produces a negative token, whatever it is handed', () => {
		// A missing custom property paints nothing at all, so a `--lane--1` would
		// be an invisible line rather than a wrong-coloured one.
		expect(laneColour(-1)).toBe(`var(--lane-${LANE_COUNT - 1})`);
	});
});

describe('lanePitch', () => {
	it('gives a single lane the full pitch, however narrow the panel', () => {
		expect(lanePitch(1, 200)).toBe(LANE_PITCH_MAX);
		expect(lanePitch(0, 200)).toBe(LANE_PITCH_MAX);
	});

	it('keeps the full pitch while the rail fits its budget', () => {
		// 4 lanes at 12px is 48px, well inside 35% of 288.
		expect(lanePitch(4, 288)).toBe(LANE_PITCH_MAX);
	});

	it('compresses as lanes multiply rather than eating the subject', () => {
		const pitch = lanePitch(14, 288);
		expect(pitch).toBeLessThan(LANE_PITCH_MAX);
		expect(pitch).toBeGreaterThanOrEqual(LANE_PITCH_MIN);
	});

	it('stops compressing at the floor, so the rail grows instead', () => {
		// Below the floor adjacent lanes stop being separable however good the
		// colours are; a rail over its budget is the lesser failure.
		expect(lanePitch(40, 288)).toBe(LANE_PITCH_MIN);
		expect(lanePitch(200, 200)).toBe(LANE_PITCH_MIN);
	});

	it('is monotonic in lane count — more lanes never means a wider pitch', () => {
		let previous = Number.POSITIVE_INFINITY;
		for (let lanes = 1; lanes <= 30; lanes += 1) {
			const pitch = lanePitch(lanes, 288);
			expect(pitch).toBeLessThanOrEqual(previous);
			previous = pitch;
		}
	});
});

describe('railWidth / laneCentre', () => {
	it('leaves air either side so the outer nodes are not flush', () => {
		expect(railWidth(1, 12)).toBeGreaterThan(12);
		// Inset either side (10px each, for the avatar) plus two pitches between
		// three lane centres.
		expect(railWidth(3, 12)).toBe(44);
	});

	it('never collapses to nothing when there are no lanes to draw', () => {
		expect(railWidth(0, 12)).toBeGreaterThan(0);
	});

	it('draws the leftmost avatar whole — the clipping bug of 2026-08-18', () => {
		// Lane 0 used to sit at `pitch / 2` = 6px with a disc of radius 9 and a 1px
		// ring outside it, so 4px of every avatar on the leftmost lane was cut off
		// by the panel edge. The invariant: the disc's left edge is never negative.
		for (const pitch of [10, 11, 12]) {
			expect(laneCentre(0, pitch) - (AVATAR_RADIUS + AVATAR_RING / 2)).toBeGreaterThanOrEqual(0);
		}
	});

	it('spends nothing on that inset once the node is back to a dot', () => {
		// Below AVATAR_MIN_PITCH there is no disc to clear, and half a pitch of air
		// is exactly right — the rail should not keep paying for a shape it has
		// stopped drawing.
		expect(laneCentre(0, 8)).toBe(4);
		expect(railWidth(3, 8)).toBe(24);
	});

	it('keeps every lane inside the width the rail reserves', () => {
		// The two used to be derived separately, which is how the clipping went
		// unnoticed. Whatever the pitch, the last lane's node fits.
		for (const pitch of [6, 8, 10, 12]) {
			for (const lanes of [1, 3, 8]) {
				const edge = pitch >= 10 ? AVATAR_RADIUS + AVATAR_RING / 2 : 0;
				expect(laneCentre(lanes - 1, pitch) + edge).toBeLessThanOrEqual(railWidth(lanes, pitch));
			}
		}
	});
});

describe('foldRefs', () => {
	it('folds HEAD into its branch instead of spending a slot on it', () => {
		const chips = foldRefs([ref({ name: 'main', kind: 'localBranch', isHead: true })]);

		expect(chips).toHaveLength(1);
		// The label is the branch name; HEAD is the tick, and the words are in the
		// tooltip (changed 2026-08-18 — see `foldRefs`).
		expect(chips[0].label).toBe('main');
		expect(chips[0].isHead).toBe(true);
		expect(chips[0].title).toContain('checked out');
	});

	it('collapses a branch and its in-sync remote into one chip', () => {
		// The load-bearing folding: these two crowd a row only when they agree.
		const chips = foldRefs([
			ref({ name: 'main', kind: 'localBranch', isHead: true, upstreamInSync: 'origin/main' }),
			ref({ name: 'origin/main', kind: 'remoteBranch' }),
			ref({ name: 'v0.3.0', kind: 'tag' }),
		]);

		expect(chips.map((c) => c.label)).toEqual(['main', 'v0.3.0']);
		// The remote is a mark on the chip and a phrase in its tooltip, not 8
		// characters of the ref budget.
		expect(chips[0].syncedRemote).toBe('origin');
		expect(chips[0].title).toBe(
			'Local branch main · checked out (HEAD) · in sync with origin/main',
		);
		expect(chips[1].syncedRemote).toBeNull();
	});

	it('keeps both chips when the remote has diverged', () => {
		// Nothing to collapse: they are on different rows, so this only happens if
		// two unrelated refs share a commit, and then both deserve saying.
		const chips = foldRefs([
			ref({ name: 'main', kind: 'localBranch' }),
			ref({ name: 'origin/main', kind: 'remoteBranch' }),
		]);

		expect(chips.map((c) => c.label)).toEqual(['main', 'origin/main']);
	});

	it('finds the remote name when the branch itself contains slashes', () => {
		// `origin/feature/x` for branch `feature/x` — the remote is not simply the
		// first path segment of the branch name.
		const chips = foldRefs([
			ref({ name: 'feature/x', kind: 'localBranch', upstreamInSync: 'origin/feature/x' }),
		]);

		expect(chips[0].label).toBe('feature/x');
		expect(chips[0].syncedRemote).toBe('origin');
	});

	it('leaves a detached HEAD as its own chip, with no branch to fold into', () => {
		const chips = foldRefs([ref({ name: 'HEAD', kind: 'head', isHead: true })]);

		expect(chips.map((c) => c.label)).toEqual(['HEAD']);
	});

	it('preserves the order it was given, which Rust already sorted', () => {
		const chips = foldRefs([
			ref({ name: 'main', kind: 'localBranch', isHead: true }),
			ref({ name: 'origin/other', kind: 'remoteBranch' }),
			ref({ name: 'v1', kind: 'tag' }),
		]);

		expect(chips.map((c) => c.kind)).toEqual(['localBranch', 'remoteBranch', 'tag']);
	});

	it('gives every chip a key that survives a poll', () => {
		const refs = [ref({ name: 'main', kind: 'localBranch' }), ref({ name: 'main', kind: 'tag' })];

		const keys = foldRefs(refs).map((c) => c.key);

		expect(new Set(keys).size).toBe(2);
		expect(foldRefs(refs).map((c) => c.key)).toEqual(keys);
	});
});

describe('fitRefs', () => {
	const chips = foldRefs([
		ref({ name: 'main', kind: 'localBranch', isHead: true }),
		ref({ name: 'origin/other-branch', kind: 'remoteBranch' }),
		ref({ name: 'v0.3.0', kind: 'tag' }),
		ref({ name: 'v0.3.0-rc1', kind: 'tag' }),
	]);

	it('shows everything when there is room', () => {
		const { shown, hiddenCount } = fitRefs(chips, 2000);

		expect(shown).toHaveLength(chips.length);
		expect(hiddenCount).toBe(0);
	});

	it('collapses the overflow to a count', () => {
		const { shown, hiddenCount } = fitRefs(chips, 240);

		expect(shown.length).toBeLessThan(chips.length);
		expect(hiddenCount).toBe(chips.length - shown.length);
	});

	it('always shows the first chip, even when it alone exceeds the budget', () => {
		// A row whose only content is `+1` tells you a ref is here and refuses to
		// say which, which is worse than a label that truncates.
		const { shown, hiddenCount } = fitRefs(chips, 0);

		expect(shown).toHaveLength(1);
		expect(shown[0].label).toBe('main');
		expect(hiddenCount).toBe(chips.length - 1);
	});

	it('never loses a chip — shown plus hidden is always the whole list', () => {
		for (const width of [0, 40, 80, 120, 200, 400, 900]) {
			const { shown, hiddenCount } = fitRefs(chips, width);
			expect(shown.length + hiddenCount).toBe(chips.length);
		}
	});

	it('reports nothing for a commit with no refs at all, which is most of them', () => {
		expect(fitRefs([], 288)).toEqual({ shown: [], hiddenCount: 0 });
	});
});

/** A page whose commits are named by SHA alone — `Omit` because the real field
 *  is `GitGraphCommit[]` and taking strings here is the whole point. */
function page(over: Omit<Partial<GitGraph>, 'commits'> & { commits: string[] }): GitGraph {
	const commits: GitGraphCommit[] = over.commits.map((sha) => ({
		sha,
		shortSha: sha.slice(0, 7),
		subject: sha,
		authorName: 'a',
		authorEmail: 'a@example.com',
		authorTime: 0,
		commitTime: 0,
		parents: [],
		refs: [],
		lane: 0,
		edges: [],
	}));
	return {
		repoRoot: '/repo',
		laneCount: 1,
		refsDigest: 'aaaa',
		hasMore: false,
		remoteHost: 'other',
		...over,
		commits,
	};
}

describe('stitchPages', () => {
	it('joins loaded pages in order', () => {
		const { commits, hasMore, stale } = stitchPages([
			page({ commits: ['a', 'b'], hasMore: true }),
			page({ commits: ['c', 'd'] }),
		]);

		expect(commits.map((c) => c.sha)).toEqual(['a', 'b', 'c', 'd']);
		expect(hasMore).toBe(false);
		expect(stale).toBe(false);
	});

	it('reports nothing while the first page is still in flight', () => {
		const { commits, hasMore } = stitchPages([undefined]);

		expect(commits).toEqual([]);
		expect(hasMore).toBe(false);
	});

	it('stops at the first gap rather than promoting a later page to the top', () => {
		// The bug this function exists to prevent. Filtering out the pending page
		// would put page 2's commits at the top of the list — in order, and the
		// wrong rows, which for a history viewer is the worst kind of wrong.
		const { commits } = stitchPages([undefined, page({ commits: ['c', 'd'] })]);

		expect(commits).toEqual([]);
	});

	it('takes the widest lane count, so one pitch covers the whole list', () => {
		const { laneCount } = stitchPages([
			page({ commits: ['a'], laneCount: 2, hasMore: true }),
			page({ commits: ['b'], laneCount: 5 }),
		]);

		expect(laneCount).toBe(5);
	});

	it('follows the last loaded page for hasMore, not the first', () => {
		const { hasMore } = stitchPages([
			page({ commits: ['a'], hasMore: true }),
			page({ commits: ['b'], hasMore: true }),
		]);

		expect(hasMore).toBe(true);
	});

	it('collapses to the first page when a later one was walked against other refs', () => {
		// Refs moved mid-paging: splicing these would draw a history that never
		// existed, so the caller is told to refetch instead.
		const { commits, stale, hasMore } = stitchPages([
			page({ commits: ['a', 'b'], hasMore: true, refsDigest: 'aaaa' }),
			page({ commits: ['x', 'y'], refsDigest: 'bbbb' }),
		]);

		expect(stale).toBe(true);
		expect(commits.map((c) => c.sha)).toEqual(['a', 'b']);
		// The surviving page still had more, so the button stays — the refetch
		// replaces the list, it does not end it.
		expect(hasMore).toBe(true);
	});

	it('is not fooled by a single page, whatever its digest', () => {
		const { stale } = stitchPages([page({ commits: ['a'], refsDigest: 'zzzz' })]);

		expect(stale).toBe(false);
	});

	it('handles being asked about no pages at all', () => {
		expect(stitchPages([])).toEqual({ commits: [], laneCount: 0, hasMore: false, stale: false });
	});
});
