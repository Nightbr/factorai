import { queryKeys } from '@lib/queryKeys';
import { events } from '@lib/tauri';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Keep an open routines list honest when something else writes one (F22 slice
 * 3, ADR-0028).
 *
 * The editor's own mutations already invalidate their query, so for those this
 * is a belt on braces. The case it exists for is the other caller: an agent
 * calling `createRoutine` or `setRoutineEnabled` over the IDE bridge writes a
 * row the renderer never hears about, and the human may be looking at that very
 * list while it happens.
 *
 * Mounted once at the shell rather than in the view, for the same reason
 * {@link useRoutineFires} is: the write lands in whichever project the agent is
 * working in, which is not necessarily the one on screen — and a stale cache
 * that is invalidated while nobody is watching costs nothing.
 */
export function useRoutinesChanged(): void {
	const queryClient = useQueryClient();

	useEffect(() => {
		const pending = events.onRoutinesChanged(({ projectId }) => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.routines(projectId) });
		});
		return () => {
			void pending.then((un) => un());
		};
	}, [queryClient]);
}
