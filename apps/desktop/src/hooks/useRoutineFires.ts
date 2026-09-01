import { startRoutineSession } from '@components/terminal/Terminal';
import { queryKeys } from '@lib/queryKeys';
import { cmd, events } from '@lib/tauri';
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
 *
 * **Two ways in, because an event has to be listened for at the moment it is
 * emitted** (ADR-0030). The listener catches every fire while this window is
 * alive; the drain below catches the ones decided before it was. The launch tick
 * is the whole reason — it runs from Rust's `setup()`, which is long before this
 * effect, and it is the tick that fires what was missed while the app was
 * closed. Every fire that mattered was emitted into an empty room.
 */
export function useRoutineFires(): void {
	const queryClient = useQueryClient();

	useEffect(() => {
		// The routines list shows "last run", and the project's session list is
		// about to grow a row. Neither is worth a poll; both are worth an
		// invalidate on the one event that changes them.
		const nudge = (projectId: string) => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.routines(projectId) });
			void queryClient.invalidateQueries({ queryKey: queryKeys.sessions(projectId) });
		};

		let mounted = true;
		const pending = events.onRoutineFire((fire) => {
			startRoutineSession(fire);
			nudge(fire.projectId);
		});
		// Idempotent against the listener: `startRoutineSession` does nothing for a
		// session that already has a terminal, so a fire that arrives both ways
		// cannot start two `claude` processes.
		void cmd
			.routinePendingFires()
			.then((fires) => {
				if (!mounted) return;
				for (const fire of fires) {
					startRoutineSession(fire);
					nudge(fire.projectId);
				}
			})
			.catch((e) => console.error('routine_pending_fires failed', e));

		return () => {
			mounted = false;
			void pending.then((un) => un());
		};
	}, [queryClient]);
}
