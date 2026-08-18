import { queryKeys } from '@lib/queryKeys';
import { events } from '@lib/tauri';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Refetch the session lists when the index changes.
 *
 * The backend has emitted `sessions:changed` since M1 (specs/03-backend-rust.md
 * § Events) and **nothing in the renderer listened**, which left every reader of
 * `list_sessions` to notice by polling — and only two of them poll. That is one
 * bug wearing two faces:
 *
 * - A session started in a project whose sidebar row is collapsed appeared
 *   nowhere: `SessionList` is the only 5s poll, and it isn't mounted until you
 *   expand the row.
 * - A tab kept the short id it was born with, because the tab strip has no poll
 *   at all — the title claude derives a few seconds later never arrived.
 *
 * Mounted once in `__root.tsx`, not per route: the whole point is to reach the
 * lists that are *not* currently mounted-and-polling, and a listener that lives
 * on a route misses exactly those.
 *
 * `projects` is invalidated too. `session_count` and `last_session_at` are
 * aggregates over the same rows, and the latter is the sidebar's default sort,
 * so a new session moves the row it belongs to.
 *
 * Only the *lists* are invalidated, not `session` / `session-tail`: those are
 * read by the transcript viewer, where a refetch under a reader who is scrolling
 * costs more than the freshness is worth.
 */
export function useSessionsSync(): void {
	const queryClient = useQueryClient();

	useEffect(() => {
		let cancelled = false;
		let unlisten: (() => void) | undefined;
		events
			.onSessionsChanged(({ projectId }) => {
				void queryClient.invalidateQueries({ queryKey: queryKeys.sessions(projectId) });
				void queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
			})
			.then((fn) => {
				// The effect can be torn down while `listen` is still in flight — a
				// StrictMode double-mount does exactly that — and the handle would
				// then never be released.
				if (cancelled) fn();
				else unlisten = fn;
			});
		return () => {
			cancelled = true;
			unlisten?.();
		};
	}, [queryClient]);
}
