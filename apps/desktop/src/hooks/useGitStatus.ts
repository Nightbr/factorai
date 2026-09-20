import type { GitStatus } from '@factorai/types';
import { useQuery } from '@tanstack/react-query';
import { useActiveCheckout } from '@hooks/useActiveCheckout';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { usePanelStore } from '@store/panelStore';

/** How often the repository is re-read while the panel is open **and the window
 *  is in front** (Q20, PERF-11).
 *
 *  Three seconds is a full `statuses()` walk with untracked recursion and two
 *  diffs — 100-120ms on an 8 900-commit repository per ADR-0035 — so this is
 *  the most expensive poll in the app and the one that most wants the change
 *  detection PERF-11 leaves open. What it no longer does is run while nobody
 *  is looking at the window. */
const GIT_POLL_MS = 3000;

/**
 * The active **checkout's** repository state (specs/05-features.md F13, F21).
 *
 * One query per project, **shared** by the Changes tab and the file tree's
 * decorations — which is why the poll follows the panel being open rather than
 * the Changes tab being visible: the tree paints dots on the same data. Closing
 * the panel stops it entirely, and TanStack pauses the interval while the
 * window is not focused — which since PERF-11 means *not in front*, rather than
 * the `visibilitychange` sense that a desktop window almost never reaches. See
 * `lib/queryFocus`.
 *
 * No watcher, deliberately. `.git/index` churns mid-operation — VS Code's own
 * watcher has to filter `index.lock` out — so a watcher would need debouncing
 * back into what this already is (Q17, Q20).
 */
export function useGitStatus(): {
	status: GitStatus | undefined;
	isPending: boolean;
	root: string | null;
} {
	// **The checkout, not the project folder** (F21). A worktree is a different
	// working tree with a different status, so this key has to move with it —
	// unlike the graph's, which stays on the repository because the commit list
	// does not change between checkouts.
	const { root } = useActiveCheckout();
	const open = usePanelStore((s) => s.open);

	const query = useQuery({
		queryKey: queryKeys.gitStatus(root ?? ''),
		queryFn: () => cmd.gitStatus(root ?? ''),
		enabled: Boolean(root) && open,
		refetchInterval: GIT_POLL_MS,
		// The list is a live view, not a snapshot: showing the previous project's
		// changes for a frame while the new one loads would be a lie.
		placeholderData: undefined,
	});

	return { status: query.data, isPending: query.isPending, root };
}
