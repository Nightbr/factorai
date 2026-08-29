import { startRoutineSession } from '@components/terminal/Terminal';
import { queryKeys } from '@lib/queryKeys';
import { events } from '@lib/tauri';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Start the sessions the routine runner asks for (F22, ADR-0026).
 *
 * Mounted once at the shell, not per route: a routine fires for a project you
 * are not looking at, which is the whole point of scheduling one. The session
 * appears in the sidebar and the project's list because it is live — the
 * pending-session union already covers a session the index has not seen — so
 * this only has to spawn it and nudge the list.
 *
 * **It does not navigate and it does not open a tab.** An agent starting work
 * you scheduled is not a reason to take the window away from what you are
 * doing; the dot is the signal, and opening the session is the human's move.
 */
export function useRoutineFires(): void {
	const queryClient = useQueryClient();

	useEffect(() => {
		const pending = events.onRoutineFire((fire) => {
			startRoutineSession(fire);
			// The routines list shows "last run", and the project's session list is
			// about to grow a row. Neither is worth a poll; both are worth an
			// invalidate on the one event that changes them.
			void queryClient.invalidateQueries({ queryKey: queryKeys.routines(fire.projectId) });
			void queryClient.invalidateQueries({ queryKey: queryKeys.sessions(fire.projectId) });
		});
		return () => {
			void pending.then((un) => un());
		};
	}, [queryClient]);
}
