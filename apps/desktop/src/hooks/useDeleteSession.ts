import { closeSessionShells } from '@components/terminal/shells';
import { disposeTerminal } from '@components/terminal/Terminal';
import { queryKeys } from '@lib/queryKeys';
import { cmd, events } from '@lib/tauri';
import type { TerminalId } from '@factorai/types';
import { useTerminalStore } from '@store/terminalStore';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

/** How long to wait for a killed PTY to actually exit before asking the backend
 *  anyway. Long enough for a SIGTERM the process accepts, short enough that one
 *  ignoring it produces an error you can act on rather than a spinner. */
const EXIT_GRACE_MS = 3000;

/**
 * Resolve when this terminal reports `terminal:exit`, or when the grace runs
 * out — whichever comes first.
 *
 * **`terminal_kill` is not synchronous and the backend's guard is.** The kill
 * signals through the killer handle and returns; the terminal leaves the
 * manager's map on its *waiter* thread, once `child.wait()` comes back. Call
 * `delete_session` in between and it refuses, correctly, for a session the user
 * has just stopped. So the wait lives here, where it costs a promise rather than
 * a blocked main thread — every Rust command in this app is synchronous, so
 * sleeping there freezes the window.
 *
 * Timing out is not an error: the command is called anyway and answers for
 * itself. A process that really is still running comes back as "still running",
 * which is the honest thing to show and the thing the tab is for.
 */
async function waitForExit(terminalId: TerminalId): Promise<void> {
	let unlisten: (() => void) | undefined;
	let settled = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await new Promise<void>((resolve) => {
			const done = () => {
				settled = true;
				resolve();
			};
			timer = setTimeout(done, EXIT_GRACE_MS);
			void events
				.onTerminalExit((e) => {
					if (e.id === terminalId) done();
				})
				.then((off) => {
					// **Attaching can lose the race**, and then `finally` has already
					// run with nothing to unlisten. Detaching here is what keeps a
					// listener from outliving the promise that owns it.
					if (settled) {
						off();
						return;
					}
					unlisten = off;
					// The exit can also beat the listener being attached — the kill is
					// already in flight. Ask once, now that we can.
					void cmd.terminalList().then((live) => {
						if (!live.some((t) => t.id === terminalId)) done();
					});
				});
		});
	} finally {
		if (timer) clearTimeout(timer);
		unlisten?.();
	}
}

/**
 * Delete a session (F2, ADR-0027) — the transcript to the OS trash, the index
 * rows with it.
 *
 * **The kill happens here, not in Rust**, and `delete_session` refuses while a
 * PTY is live so that stays true. It is the division `useRemoveProject` already
 * draws and for the same reason: a kill that fails must leave the tab standing,
 * because the tab is the only place you can still see and stop the process. A
 * backend that killed silently would turn a failure into an orphan you cannot
 * find (ADR-0005).
 *
 * **Throws rather than swallowing.** The caller is a confirm dialog, and a
 * delete that quietly does nothing is worse than one that says why — the trash
 * can legitimately refuse (a store on a filesystem without one), and the user
 * needs to know that nothing was deleted.
 */
export function useDeleteSession(): (sessionId: string, projectId: string) => Promise<void> {
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	return useCallback(
		async (sessionId: string, projectId: string) => {
			// Read at call time rather than subscribing: this runs from a dialog
			// that has been open for a few seconds, and a stale closure would miss a
			// session that started — or died — while it was.
			const { bySession, detach } = useTerminalStore.getState();
			const terminal = bySession[sessionId];

			if (terminal) {
				// Not caught: a kill that failed means the process may still be
				// running, and deleting its transcript from under it is exactly the
				// corruption ADR-0004 protects against. The dialog shows the error and
				// the tab is still there to stop it from.
				await cmd.terminalKill(terminal.terminalId);
				await waitForExit(terminal.terminalId);
			}
			// Unconditional, because a *stopped* tab points at this session too. A
			// tab is only ever removed by closing, and deleting the session **is**
			// closing it — leaving one would put a grey tab on the strip aimed at a
			// transcript that no longer exists. This is renderer state only; what
			// the backend's guard reads is its own terminal map, which is why the
			// wait above is the part that matters.
			detach(sessionId);
			disposeTerminal(sessionId);
			closeSessionShells(sessionId);

			await cmd.deleteSession(sessionId);

			await queryClient.invalidateQueries({ queryKey: queryKeys.sessions(projectId) });
			// `sessionCount` and `lastSessionAt` are aggregates over the rows that
			// just went, and the latter is the sidebar's default sort.
			await queryClient.invalidateQueries({ queryKey: queryKeys.projects() });

			// Only leave if you were looking at what you deleted. `window.location`
			// rather than a route match: this runs from the sidebar, which renders
			// outside any session route.
			if (window.location.hash.includes(`/sessions/${sessionId}`)) {
				await navigate({ to: '/projects/$id', params: { id: projectId } });
			}
		},
		[queryClient, navigate],
	);
}
