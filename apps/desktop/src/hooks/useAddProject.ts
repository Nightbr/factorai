import { formatError } from '@lib/errors';
import { queryKeys } from '@lib/queryKeys';
import { cmd, pickFolder } from '@lib/tauri';
import { useAddProjectStore } from '@store/addProjectStore';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

/**
 * The folder-picker door onto the workspace (F1). Since ADR-0011 adding is the
 * *only* way a project appears — nothing arrives because an agent touched a
 * directory — and the picker is one of its two doors, the other being the
 * import dialog. Every button that offers it calls this.
 */
export function useAddProject(): () => Promise<void> {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	return useCallback(async () => {
		const { setAdding, setError } = useAddProjectStore.getState();
		setError(null);
		setAdding(true);
		try {
			const path = await pickFolder();
			// Cancelling the picker is an answer, not a failure.
			if (!path) return;
			const project = await cmd.addProject(path);
			// Await the refetch before navigating: the project route reads the same
			// cache, and landing there before the row exists renders "not found"
			// for a beat.
			await queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
			// The tree is its own key (ADR-0025) — see `useRemoveProject`.
			await queryClient.invalidateQueries({ queryKey: queryKeys.sidebar() });
			await navigate({ to: '/projects/$id', params: { id: project.id } });
		} catch (e) {
			setError(formatError(e));
		} finally {
			setAdding(false);
		}
	}, [queryClient, navigate]);
}
