import type { GitWorktree } from '@factorai/types';
import { useQuery } from '@tanstack/react-query';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';

/**
 * How often the checkout list is re-read. The same 30s cadence as
 * `useGitBranch`, and for the same reason: worktrees appear when someone runs
 * `git worktree add`, not on every keystroke.
 *
 * **The poll is not how the panel follows the agent.** That is the
 * `session:worktree` event, which arrives immediately. This is the list the
 * badge and the graph's chips render from, and 30s is fine for it — with one
 * exception, below.
 */
const WORKTREE_POLL_MS = 30_000;

/**
 * Every checkout of the repository a project sits in (specs/05-features.md F21).
 *
 * **Not gated on the panel being open**, unlike `useGitStatus`. The session
 * header's badge needs this whether or not the panel is, which is the same
 * argument `useGitBranch` makes for not reusing `useGitStatus`.
 *
 * A project outside a repository resolves to an empty array — a success, not an
 * error, following `gitStatus`'s `repoRoot: null`.
 */
export function useWorktrees(projectPath: string | null): GitWorktree[] {
	const query = useQuery({
		queryKey: queryKeys.gitWorktrees(projectPath ?? ''),
		queryFn: () => cmd.gitWorktrees(projectPath ?? ''),
		enabled: Boolean(projectPath),
		refetchInterval: WORKTREE_POLL_MS,
		refetchOnWindowFocus: true,
	});
	return query.data ?? EMPTY;
}

/** Stable empty array: returned on every render before the query resolves, and a
 *  fresh `[]` each time would re-run every `useMemo` downstream of it. */
const EMPTY: GitWorktree[] = [];

/**
 * The checkout a path belongs to, by longest containment.
 *
 * Longest wins because a checkout nested inside another — legal, if unusual —
 * would otherwise resolve to its parent. Mirrors `scope::containing_root` in
 * Rust; the two answer the same question on the two sides of the bridge.
 *
 * Exported for its own test: the containment rule is the part of this file worth
 * pinning, and it needs no React to exercise.
 */
export function checkoutContaining(
	worktrees: readonly GitWorktree[],
	path: string | null,
): GitWorktree | undefined {
	if (!path) return undefined;
	return worktrees
		.filter((w) => w.exists && isWithin(path, w.path))
		.sort((a, b) => b.path.length - a.path.length)[0];
}

/**
 * Is `path` inside `root`, as paths rather than as strings?
 *
 * The separator check is what makes it a path test: `/repo-old/a.ts` starts with
 * `/repo` and is not in it, which a bare `startsWith` would get wrong — and
 * would get wrong in the direction that shows one checkout's files under
 * another's name.
 */
function isWithin(path: string, root: string): boolean {
	if (path === root) return true;
	const base = root.endsWith('/') ? root : `${root}/`;
	return path.startsWith(base);
}
