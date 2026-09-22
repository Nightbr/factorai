import type { AgentId } from '@factorai/types';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { cmd } from '@lib/tauri';
import { useTerminalStore } from '@store/terminalStore';

/**
 * Start a new session in a project and go to it.
 *
 * The id comes from the backend, not from `crypto.randomUUID()` here:
 * `start_session` hands back a live session that has never been messaged when
 * there is one, so an impatient double-click lands on one `claude` rather than
 * two (ADR-0008). It probes the transcript on disk to know that, which the
 * renderer can't do — the sidebar's button fires on projects whose session
 * list was never fetched.
 *
 * `agent` is the launch override (F30): the `+` menu naming an agent other
 * than the project's. It is remembered against the id so the session route's
 * `Terminal`, which spawns for whatever id is in the URL, passes it on — the
 * URL carries the id and nothing else.
 *
 * Nothing else is needed to get a terminal: the session route mounts
 * `Terminal`, which spawns the PTY for whatever id is in the URL. This only
 * picks the id and navigates.
 *
 * Failures propagate — `main.tsx` turns an unhandled rejection into a visible
 * error pane, which is the right outcome for "the backend is unreachable".
 */
export function useStartSession(): (projectId: string, agent?: AgentId) => Promise<void> {
	const navigate = useNavigate();

	return useCallback(
		async (projectId: string, agent?: AgentId) => {
			const sessionId = await cmd.startSession(projectId, agent);
			if (agent) useTerminalStore.getState().setLaunchAgent(sessionId, agent);
			await navigate({
				to: '/projects/$projectId/sessions/$sessionId',
				params: { projectId, sessionId },
			});
		},
		[navigate],
	);
}
