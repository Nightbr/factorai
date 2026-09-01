import { queryKeys } from '@lib/queryKeys';
import { cmd } from '@lib/tauri';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

/**
 * Pin or unpin a session (F2).
 *
 * **Invalidates rather than writing an optimistic row**, unlike a toggle whose
 * result is a single flag: a pin changes the *order* of two lists, and the order
 * lives in the backend's `ORDER BY` — pinned group first, then recency, with
 * sub-agents kept under their parent. Reproducing that here would be a second
 * copy of a sort rule that has to agree with SQL, which is the drift 0011's
 * comment warns about for `PROJECT_SELECT`.
 *
 * The command also emits `sessions:changed`, which `useSessionsSync` already
 * turns into the same invalidation — this one is the local echo, so the row
 * moves on the click rather than on the round trip through the event.
 *
 * **Throws.** The only caller is a row control that can say so, and a pin that
 * silently did nothing is a mark you would believe you had made.
 */
export function useSetSessionPinned(): (
	sessionId: string,
	projectId: string,
	pinned: boolean,
) => Promise<void> {
	const queryClient = useQueryClient();

	return useCallback(
		async (sessionId: string, projectId: string, pinned: boolean) => {
			await cmd.setSessionPinned(sessionId, pinned);
			await queryClient.invalidateQueries({ queryKey: queryKeys.sessions(projectId) });
		},
		[queryClient],
	);
}
