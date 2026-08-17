import type { GitGraph, GitGraphCommit } from '@factorai/types';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useActiveProject } from '@hooks/useActiveProject';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { stitchPages } from '@lib/gitGraph';
import { usePanelStore } from '@store/panelStore';

/** Commits per page, matching `GRAPH_PAGE` in `services/git.rs`. */
const GRAPH_PAGE = 300;

/**
 * How often the graph is re-walked while its tab is showing.
 *
 * `useGitBranch`'s cadence, not `useGitStatus`'s 3s: a commit landing is a
 * `git checkout`-class event, not a keystroke-class one. A revwalk plus full ref
 * enumeration is also more work than a status walk, and rows shifting under a
 * line you are reading is the annoyance Q18 legislated against for tabs.
 */
const GRAPH_POLL_MS = 30_000;

/**
 * The active project's commit graph, paged (specs/05-features.md F18).
 *
 * **Gated on the tab, not just the panel.** `useGitStatus` polls whenever the
 * panel is open because the tree's decorations read the same data; nothing else
 * reads this, so switching to Files stops the revwalk dead.
 *
 * Pages are separate queries under separate keys, so loading more doesn't discard
 * what is already on screen and each page refreshes on its own. They are stitched
 * here rather than with `useInfiniteQuery`, which would refetch every loaded page
 * on each poll — at 30s over a re-walking backend that is the one thing worth
 * avoiding.
 */
export function useGitGraph(): {
	commits: GitGraphCommit[];
	laneCount: number;
	/** Null while the first page is still loading, so callers can tell "no
	 *  repository" from "not asked yet". */
	graph: GitGraph | undefined;
	isPending: boolean;
	hasMore: boolean;
	isLoadingMore: boolean;
	loadMore: () => void;
	root: string | null;
} {
	const { root } = useActiveProject();
	const open = usePanelStore((s) => s.open);
	const tab = usePanelStore((s) => s.tab);
	const enabled = Boolean(root) && open && tab === 'graph';
	const queryClient = useQueryClient();

	// Plain state: `GraphView` remounts this whole subtree when the project
	// changes, so the page count cannot outlive the history it counts pages of.
	const [pageCount, setPageCount] = useState(1);

	const pages = useQueries({
		queries: Array.from({ length: pageCount }, (_unused, page) => ({
			queryKey: queryKeys.gitGraph(root ?? '', page),
			queryFn: () => cmd.gitGraph(root ?? '', page * GRAPH_PAGE, GRAPH_PAGE),
			enabled,
			refetchInterval: GRAPH_POLL_MS,
			refetchOnWindowFocus: true,
		})),
	});

	const first = pages[0]?.data;
	// Joining pages is pure and has the interesting edge cases, so it lives in
	// `lib/gitGraph` with tests rather than inline here.
	const { commits, laneCount, hasMore, stale } = stitchPages(pages.map((page) => page.data));

	// Refs moved mid-paging. Drop back to one page and let it refetch — cheap, and
	// the only answer that cannot be subtly wrong.
	useEffect(() => {
		if (!stale) return;
		setPageCount(1);
		void queryClient.invalidateQueries({ queryKey: ['git-graph', root ?? ''] });
	}, [stale, root, queryClient]);

	const loadMore = useCallback(() => {
		setPageCount((count) => count + 1);
	}, []);

	return {
		commits,
		laneCount,
		graph: first,
		isPending: pages[0]?.isPending ?? true,
		hasMore,
		isLoadingMore: pages.length > 1 && pages[pages.length - 1].isPending,
		loadMore,
		root,
	};
}
