import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Narrower than this and file names are unreadable; wider and the terminal
 *  loses more columns than the tree is worth. */
export const MIN_PANEL_WIDTH = 200;
export const MAX_PANEL_WIDTH = 600;
export const DEFAULT_PANEL_WIDTH = 288;

/** Pure so the drag maths can be unit-tested without a pointer. */
export function clampPanelWidth(width: number): number {
	if (!Number.isFinite(width)) return DEFAULT_PANEL_WIDTH;
	return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(width)));
}

interface PanelState {
	/** Is the file tree panel showing? Persisted. */
	open: boolean;
	/** Panel width in px. Persisted. */
	width: number;
	/** Expanded directory paths, per project. Deliberately NOT persisted: a
	 *  path that existed last session may be gone, and restoring a half-open
	 *  tree of stale paths is worse than starting collapsed. */
	expandedByProject: Record<string, Set<string>>;
	/** Selected row, for highlight only. */
	selectedPath: string | null;

	toggle: () => void;
	setOpen: (open: boolean) => void;
	setWidth: (width: number) => void;
	toggleExpanded: (projectId: string, path: string) => void;
	/** Expand the root once, the first time this project's tree is shown. A
	 *  project with an existing (even empty) entry has been seeded already, so a
	 *  deliberate collapse-all is not undone on the next render. */
	seedRoot: (projectId: string, rootPath: string) => void;
	collapseAll: (projectId: string) => void;
	select: (path: string | null) => void;
}

export const usePanelStore = create<PanelState>()(
	persist(
		(set) => ({
			open: false,
			width: DEFAULT_PANEL_WIDTH,
			expandedByProject: {},
			selectedPath: null,

			toggle: () => set((s) => ({ open: !s.open })),
			setOpen: (open) => set({ open }),
			setWidth: (width) => set({ width: clampPanelWidth(width) }),

			toggleExpanded: (projectId, path) =>
				set((s) => {
					const next = new Set(s.expandedByProject[projectId] ?? []);
					if (!next.delete(path)) next.add(path);
					return { expandedByProject: { ...s.expandedByProject, [projectId]: next } };
				}),

			seedRoot: (projectId, rootPath) =>
				set((s) =>
					s.expandedByProject[projectId]
						? s
						: {
								expandedByProject: {
									...s.expandedByProject,
									[projectId]: new Set([rootPath]),
								},
							},
				),

			collapseAll: (projectId) =>
				set((s) => ({
					expandedByProject: { ...s.expandedByProject, [projectId]: new Set<string>() },
				})),

			select: (selectedPath) => set({ selectedPath }),
		}),
		{
			name: 'factorai.panel',
			version: 1,
			// Only the two preferences round-trip to storage. Sets aren't
			// JSON-serialisable anyway, and see `expandedByProject` above.
			partialize: (s) => ({ open: s.open, width: s.width }),
		},
	),
);

/** Expanded paths for a project — stable empty set so selectors don't churn. */
const EMPTY: ReadonlySet<string> = new Set();

export function expandedFor(state: PanelState, projectId: string | undefined): ReadonlySet<string> {
	if (!projectId) return EMPTY;
	return state.expandedByProject[projectId] ?? EMPTY;
}
