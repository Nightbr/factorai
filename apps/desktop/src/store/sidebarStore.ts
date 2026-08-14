import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** How the project list is ordered (specs/05-features.md F1).
 *
 *  `recent` is what the backend already returns — `last_session_at DESC`, so
 *  whatever you touched last floats up. `name` is for when you know what you're
 *  looking for and want it to stay put. */
export type ProjectSort = 'recent' | 'name';

interface SidebarState {
	sort: ProjectSort;
	/** Expanded project ids. An array rather than a Set so it survives JSON —
	 *  and unlike the file tree's expanded *paths* (which go stale when a
	 *  directory is deleted), a project id stays valid, so this is persisted. */
	expanded: string[];

	setSort: (sort: ProjectSort) => void;
	toggleProject: (projectId: string) => void;
	expandAll: (projectIds: string[]) => void;
	collapseAll: () => void;
}

export const useSidebarStore = create<SidebarState>()(
	persist(
		(set) => ({
			sort: 'recent',
			expanded: [],

			setSort: (sort) => set({ sort }),
			toggleProject: (projectId) =>
				set((s) => ({
					expanded: s.expanded.includes(projectId)
						? s.expanded.filter((id) => id !== projectId)
						: [...s.expanded, projectId],
				})),
			expandAll: (projectIds) => set({ expanded: [...projectIds] }),
			collapseAll: () => set({ expanded: [] }),
		}),
		{ name: 'factorai.sidebar', version: 1 },
	),
);
