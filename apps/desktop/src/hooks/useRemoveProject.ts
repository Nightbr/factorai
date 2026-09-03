import { closeProjectShells } from '@components/terminal/shells';
import { disposeTerminal } from '@components/terminal/Terminal';
import { queryKeys } from '@lib/queryKeys';
import { cmd } from '@lib/tauri';
import { type LiveTerminal, useTerminalStore } from '@store/terminalStore';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

/**
 * Sessions of one project that currently have a live PTY.
 *
 * Pure and exported: the count decides whether removing asks first, and that
 * rule is worth testing without a store.
 */
export function liveSessionsIn(
	bySession: Record<string, LiveTerminal>,
	projectId: string,
): string[] {
	return Object.entries(bySession)
		.filter(([, t]) => t.projectId === projectId)
		.map(([sessionId]) => sessionId);
}

/**
 * Remove a project from the workspace (F1, ADR-0011).
 *
 * Nothing on disk is touched — ADR-0004 — so this destroys no work. What it
 * does destroy is *this project's place in the index*, since search is scoped
 * to the workspace; adding the folder back re-parses it from transcripts that
 * never moved.
 *
 * The part that is not bookkeeping: a live PTY in this project must be killed,
 * not orphaned. Leaving `claude` running with no row and no tab is exactly the
 * invisible-agent state the quit guard exists to prevent (ADR-0005), so the
 * caller confirms first when `liveSessionsIn` is non-empty and this then does
 * what the dialog promised.
 */
export function useRemoveProject(): (projectId: string) => Promise<void> {
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	return useCallback(
		async (projectId: string) => {
			// Read at call time rather than subscribing: this runs from a menu
			// selection, and a stale closure over `bySession` would miss a session
			// that started while the menu was open.
			const { bySession, detach, closeProject } = useTerminalStore.getState();
			const live = liveSessionsIn(bySession, projectId);

			for (const sessionId of live) {
				const terminal = bySession[sessionId];
				if (!terminal) continue;
				try {
					await cmd.terminalKill(terminal.terminalId);
				} catch (e) {
					// The kill failed, so the process may well still be running. Stop:
					// removing the row now would produce precisely the orphan this
					// whole branch exists to avoid, and the tab is where you can still
					// see and stop it.
					console.error('terminal_kill failed; project not removed', e);
					return;
				}
				// Drop it now rather than waiting for `terminal:exit` — we know what we
				// just did, and a tab that waits for an event lingers forever if the
				// event is missed. The later event finds nothing to remove.
				detach(sessionId);
				disposeTerminal(sessionId);
			}

			// **The one gesture that kills a project's shells** (ADR-0032). Once per
			// project rather than once per session: a shell belongs to the project,
			// not to whichever session it happened to be opened under, and Rust owns
			// the question of which PTYs those are.
			closeProjectShells(projectId);

			// Any tab this project still has is stopped — a live one was killed and
			// detached above. It has to go too: a tab is only removed by closing, and
			// removing the project *is* closing every session in it. Leaving them
			// would put grey tabs on the strip pointing at a project that is no
			// longer in `list_projects`, which the strip would then filter out on the
			// next launch anyway — silently, and one launch too late.
			closeProject(projectId);

			await cmd.removeProject(projectId);
			await queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
			// The candidate list has a new importable row now, so a dialog opened
			// next must not show a stale `alreadyOpen`.
			await queryClient.invalidateQueries({ queryKey: queryKeys.importCandidates() });

			// Only leave if you were looking at what you removed. `window.location`
			// rather than a route match: this hook is called from the sidebar, which
			// renders outside any project route.
			if (window.location.hash.includes(`/projects/${projectId}`)) {
				await navigate({ to: '/' });
			}
		},
		[queryClient, navigate],
	);
}
