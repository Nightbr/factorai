import type { AgentId } from '@factorai/types';
import { create } from 'zustand';

/**
 * Adding a folder to the workspace, shared by every door onto it (F1).
 *
 * The sidebar's header menu, the collapsed rail and the first-run hero in the
 * main pane all start the same two acts — the folder picker, and the import
 * dialog for one agent — so whether one is under way, and what went wrong,
 * belongs to none of them. The dialog is mounted once, at the app shell,
 * because the rail replaces the sidebar that used to mount it.
 */
interface AddProjectState {
	adding: boolean;
	error: string | null;
	importOpen: boolean;
	/** Whose store the import dialog reads. Kept after it closes, so the title
	 *  does not change under the closing animation. */
	importAgent: AgentId;
	setAdding: (adding: boolean) => void;
	setError: (error: string | null) => void;
	openImport: (agent: AgentId) => void;
	closeImport: () => void;
}

export const useAddProjectStore = create<AddProjectState>((set) => ({
	adding: false,
	error: null,
	importOpen: false,
	importAgent: 'claude',
	setAdding: (adding) => set({ adding }),
	setError: (error) => set({ error }),
	openImport: (agent) => set({ importOpen: true, importAgent: agent }),
	closeImport: () => set({ importOpen: false }),
}));
