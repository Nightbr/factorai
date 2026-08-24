import type { GitWorktree, SessionSummary } from '@factorai/types';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useActiveProject } from '@hooks/useActiveProject';
import { checkoutContaining, useWorktrees } from '@hooks/useWorktrees';
import { cmd } from '@lib/tauri';
import { queryKeys } from '@lib/queryKeys';
import { useTerminalStore } from '@store/terminalStore';

/** Not exported: every consumer destructures the call, so an exported name
 *  nothing imports is exactly what knip is for. */
interface ActiveCheckout {
	/** Project id from the route, if it has one. */
	projectId: string | undefined;
	/** **The directory the panel is rooted at** — tree, changes, decorations.
	 *  The project's own folder unless a session in front is working elsewhere. */
	root: string | null;
	/** The project's own folder, whatever the checkout is. The revert target, and
	 *  what tells the header whether to draw a worktree mark at all. */
	projectRoot: string | null;
	/** The checkout `root` names, when it is a worktree we know about. Carries the
	 *  branch, so the badge needs no second query. */
	worktree: GitWorktree | undefined;
	/** True when `root` is not the project's own folder — the one condition every
	 *  new piece of UI in F21 is behind. */
	isLinked: boolean;
	/** Every checkout of the repository, for the graph's chips and the badge's
	 *  title. */
	worktrees: GitWorktree[];
	isLoading: boolean;
}

/**
 * Which checkout of the project's repository the app is showing
 * (specs/05-features.md F21 § "Which checkout a session is showing").
 *
 * Three steps, first match wins:
 *
 * 1. The checkout the agent signalled for the session in front — from the live
 *    `session:worktree` event, else the `worktree` column the sessions query
 *    carries, so a resumed session comes back where it was working.
 * 2. The **linked** checkout containing the last absolute path the agent's tools
 *    named. Only a linked one: see `linkedContaining` below for why this step is
 *    asymmetric, and why that asymmetry is the whole of its safety.
 * 3. The checkout containing that session's **last** recorded `cwd`, then its
 *    first. This is what catches an agent that moved into a worktree without
 *    saying so — which, on the evidence of a real session, is what agents
 *    actually do: one created a worktree, `cd`'d into it, and never called
 *    `setWorktree` or opened a file there, so the bridge saw nothing at all.
 *
 *    Preferring the *last* cwd is only safe because this is containment, not
 *    equality: a session's cwd follows every `cd` a shell command makes, and one
 *    real transcript churned through `apps/desktop/src-tauri` and
 *    `node_modules/.pnpm/…` — all of which are inside the main checkout and so
 *    resolve to it. Only a path in a *linked* worktree resolves to the worktree.
 * 4. The project's own folder.
 *
 * **Steps 1 to 3 are all validated against `gitWorktrees` first.** A row is a
 * record, not a guarantee: the checkout can have been `git worktree remove`d
 * while the row survived. Falling through then is not politeness —
 * `Repository::discover()` walks up from a missing path's nearest existing
 * parent, so an unhandled removal quietly re-roots the panel on whatever
 * repository sits above the deleted directory, with nothing on screen saying the
 * subject changed.
 *
 * **A project route with no session always gets step 4.** There is no session
 * whose checkout could be meant, and guessing from the most recent one would
 * make the tree change when you navigated away from it.
 */
export function useActiveCheckout(): ActiveCheckout {
	const { projectId, root: projectRoot, isLoading } = useActiveProject();
	// `strict: false` so this works on the project route too, where there is no
	// session id — the same trick `useActiveProject` uses for its two param names.
	const { sessionId } = useParams({ strict: false }) as { sessionId?: string };

	const worktrees = useWorktrees(projectRoot);

	// The sessions list is already cached by the route that got here, so this is
	// normally free. It is where the *persisted* checkout arrives from.
	const sessionsQ = useQuery({
		queryKey: queryKeys.sessions(projectId ?? ''),
		queryFn: () => cmd.listSessions(projectId ?? ''),
		enabled: Boolean(projectId),
	});

	// Read as one scalar rather than through a selector building an object: a
	// selector that returns a fresh object hands zustand a new reference on every
	// store read.
	const signalled = useTerminalStore((s) =>
		sessionId ? s.worktreeBySession[sessionId] : undefined,
	);

	const session = sessionId ? sessionsQ.data?.find((s) => s.id === sessionId) : undefined;

	// Pulled out as four scalars, not passed as the row: `listSessions` hands back
	// a fresh array on every refetch, so a memo that depended on the object would
	// re-resolve on a poll that changed nothing.
	const recorded = session?.worktree ?? null;
	const lastTouched = session?.lastTouched ?? null;
	const lastCwd = session?.lastCwd ?? null;
	const cwd = session?.cwd ?? null;

	return useMemo(() => {
		const resolved = resolveCheckout(worktrees, signalled?.path, {
			worktree: recorded,
			lastTouched,
			lastCwd,
			cwd,
		});

		// Step 4 is *not* "the checkout containing the project root": a project
		// inside a monorepo is not its repository's checkout, and rooting the panel
		// on the repository would silently widen what F12 shows.
		const isLinked = Boolean(resolved && projectRoot && resolved.path !== projectRoot);

		return {
			projectId,
			root: isLinked ? (resolved?.path ?? projectRoot) : projectRoot,
			projectRoot,
			worktree: isLinked ? resolved : undefined,
			isLinked,
			worktrees,
			isLoading,
		};
	}, [
		projectId,
		projectRoot,
		worktrees,
		signalled?.path,
		recorded,
		lastTouched,
		lastCwd,
		cwd,
		isLoading,
	]);
}

/** What the hook above resolves, minus React. Exported for its own test: the
 *  precedence between four signals is the part of this file worth pinning, and
 *  it needs no render to exercise. */
export function resolveCheckout(
	worktrees: readonly GitWorktree[],
	signalledPath: string | undefined,
	session: Pick<SessionSummary, 'worktree' | 'lastTouched' | 'lastCwd' | 'cwd'> | undefined,
): GitWorktree | undefined {
	const known = (path: string | null | undefined) =>
		path ? worktrees.find((w) => w.path === path && w.exists) : undefined;

	return (
		// 1. What the agent said — this run's signal ahead of the stored row,
		//    since the two only differ while a signal is newer than the query. It
		//    is also where the human's own pick arrives, which is why a pick needs
		//    nothing else here to outrank the inferences below.
		known(signalledPath) ??
		known(session?.worktree) ??
		// 2. The last file the agent's tools touched, **if it is in a linked
		//    checkout**. Ahead of the cwds because the case it exists for is
		//    precisely one where they are *correct and useless*: an agent that
		//    creates a worktree and drives it by `git -C` and absolute paths never
		//    moves its cwd, so `lastCwd` keeps naming the checkout it started in
		//    for ever. Reading the cwd first would mean this step never runs in the
		//    one situation it was added for.
		linkedContaining(worktrees, session?.lastTouched ?? null) ??
		// 3. Where the session *is*, then where it started. `lastCwd` is what
		//    catches an agent that moved into a worktree and never said so —
		//    the case this feature was built for and, on the evidence, the
		//    common one. Safe to prefer because `checkoutContaining` resolves by
		//    containment: a transient `cd` into a subdirectory is still inside
		//    the main checkout and so still answers "the project".
		checkoutContaining(worktrees, session?.lastCwd ?? null) ??
		checkoutContaining(worktrees, session?.cwd ?? null)
	);
}

/**
 * The checkout containing `path`, but only if it is a **linked** one.
 *
 * The asymmetry is the safety of step 2, and it is deliberate. A touched path
 * that lands in the main checkout says nothing: reading one file there is what
 * an agent in a worktree does all day — a shared config, a sibling package, the
 * spec it is working from — and letting that pull the panel back would make the
 * tree flicker between checkouts on every tool call. A touched path in a
 * *linked* checkout is the opposite: nothing else in the session points there,
 * so it is the only evidence that exists, and the fallback below already answers
 * "the main checkout" for everything else.
 */
function linkedContaining(
	worktrees: readonly GitWorktree[],
	path: string | null,
): GitWorktree | undefined {
	const found = checkoutContaining(worktrees, path);
	return found && !found.isMain ? found : undefined;
}
