import { useQuery } from '@tanstack/react-query';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';

/**
 * How often the branch is re-read. Far slower than `useGitStatus`'s 3s, because
 * a branch changes when someone runs `git checkout` and a working tree changes
 * on every keystroke the agent makes. This is the "refresh on focus, poll
 * lazily" stance F12 took for the file tree (Q17), not the Changes tab's live
 * view.
 */
const BRANCH_POLL_MS = 30_000;

/**
 * The current branch of a project's repository, for the session header's badge
 * (specs/05-features.md F3).
 *
 * **Deliberately not `useGitStatus`.** That hook is gated on the right panel
 * being open — `enabled: Boolean(root) && open` — because its only consumers
 * are the Changes tab and the tree's decorations, and closing the panel should
 * stop the poll dead. The header badge is visible whether or not the panel is,
 * so reusing that hook would have meant deleting its gate and running a 3s
 * working-tree walk for every open session forever.
 *
 * It **does** share the query key, so when the panel is open there is still one
 * cache entry and one request in flight for the project — the two observers
 * just want it at different cadences, which is exactly what TanStack's
 * per-observer `refetchInterval` is for.
 *
 * Takes the project path as an argument rather than reading `useActiveProject`:
 * the session route already knows its own project, and a badge that named a
 * branch from somewhere else would be worse than no badge.
 */
export function useGitBranch(projectPath: string | null): string | null {
	const query = useQuery({
		queryKey: queryKeys.gitStatus(projectPath ?? ''),
		queryFn: () => cmd.gitStatus(projectPath ?? ''),
		enabled: Boolean(projectPath),
		refetchInterval: BRANCH_POLL_MS,
		refetchOnWindowFocus: true,
	});

	// Three states collapse to "show nothing", and none of them is an error:
	// still loading, not a repository at all (`repoRoot: null` resolves rather
	// than rejecting), and a repository with no branch to name — which
	// `GitStatus` cannot tell apart from an unborn one, so it stays quiet rather
	// than guessing "detached".
	return query.data?.branch ?? null;
}
