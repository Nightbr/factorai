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

/** Shorter than this and the commit detail can't show a subject and one file
 *  row; taller and the graph it belongs to stops being a graph. */
export const MIN_DETAIL_HEIGHT = 96;
export const MAX_DETAIL_HEIGHT = 600;
export const DEFAULT_DETAIL_HEIGHT = 200;

export function clampDetailHeight(height: number): number {
	if (!Number.isFinite(height)) return DEFAULT_DETAIL_HEIGHT;
	return Math.min(MAX_DETAIL_HEIGHT, Math.max(MIN_DETAIL_HEIGHT, Math.round(height)));
}

/** The panel's three tabs (F12, F13, F18). Hardcoded rather than a registry —
 *  see 07-open-questions.md Q18, amended when the graph took a third slot. */
export type PanelTab = 'files' | 'changes' | 'graph';

interface PanelState {
	/** Is the file tree panel showing? Persisted. */
	open: boolean;
	/** Which tab is showing. Persisted app-wide rather than per project: a tab
	 *  choice is a habit, not a fact about a project. Never changed
	 *  programmatically — a strip that moves under you while you type into the
	 *  terminal below it is worse than no strip (Q18). */
	tab: PanelTab;
	/** Panel width in px. Persisted. */
	width: number;
	/** Expanded directory paths, per project. Deliberately NOT persisted: a
	 *  path that existed last session may be gone, and restoring a half-open
	 *  tree of stale paths is worse than starting collapsed. */
	expandedByProject: Record<string, Set<string>>;
	/** Selected row, for highlight only. */
	selectedPath: string | null;
	/** Diff viewer: inline (unified) rather than side-by-side. Persisted.
	 *  Parked here until `prefsStore` exists (roadmap item 4); it migrates with
	 *  `open`/`width` when F11 lands. */
	diffInline: boolean;
	/** Height of the commit detail docked under the graph, in px. Persisted: it
	 *  is a preference about how much history you want to see at once, and it
	 *  survives a reload the same way `width` does (F18). */
	detailHeight: number;

	toggle: () => void;
	setOpen: (open: boolean) => void;
	setTab: (tab: PanelTab) => void;
	setDiffInline: (inline: boolean) => void;
	setWidth: (width: number) => void;
	setDetailHeight: (height: number) => void;
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
			tab: 'files',
			width: DEFAULT_PANEL_WIDTH,
			expandedByProject: {},
			selectedPath: null,
			diffInline: false,
			detailHeight: DEFAULT_DETAIL_HEIGHT,

			toggle: () => set((s) => ({ open: !s.open })),
			setOpen: (open) => set({ open }),
			setTab: (tab) => set({ tab }),
			setDiffInline: (diffInline) => set({ diffInline }),
			setWidth: (width) => set({ width: clampPanelWidth(width) }),
			setDetailHeight: (height) => set({ detailHeight: clampDetailHeight(height) }),

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
			// Only the preferences round-trip to storage. Sets aren't
			// JSON-serialisable anyway, and see `expandedByProject` above.
			partialize: (s) => ({
				open: s.open,
				width: s.width,
				tab: s.tab,
				diffInline: s.diffInline,
				detailHeight: s.detailHeight,
			}),
		},
	),
);

/** Expanded paths for a project — stable empty set so selectors don't churn. */
const EMPTY: ReadonlySet<string> = new Set();

export function expandedFor(state: PanelState, projectId: string | undefined): ReadonlySet<string> {
	if (!projectId) return EMPTY;
	return state.expandedByProject[projectId] ?? EMPTY;
}
