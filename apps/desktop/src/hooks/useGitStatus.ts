import type { GitStatus } from '@factorai/types';
import { useQuery } from '@tanstack/react-query';
import { useActiveCheckout } from '@hooks/useActiveCheckout';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { usePanelStore } from '@store/panelStore';

/** How often the repository is re-read while the panel is open (Q20).
 *  `Sidebar` already polls at 2s, so neither the pattern nor its cost is new. */
const GIT_POLL_MS = 3000;

/**
 * The active **checkout's** repository state (specs/05-features.md F13, F21).
 *
 * One query per project, **shared** by the Changes tab and the file tree's
 * decorations — which is why the poll follows the panel being open rather than
 * the Changes tab being visible: the tree paints dots on the same data. Closing
 * the panel stops it entirely, and TanStack pauses intervals while the window
 * is hidden, so a backgrounded app is silent.
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
