import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Narrower than this and file names are unreadable; wider and the terminal
 *  loses more columns than the tree is worth.
 *
 *  **256 rather than 200 since the panel's tab labels went to 14px.** The
 *  header has to lay out `Files Changes Graph` plus, on the Files tab, three
 *  icon buttons — collapse, refresh, close — and at 200px it no longer could.
 *  The floor exists to keep the panel usable, so a header that cannot fit its
 *  own tabs means the floor is wrong, not the labels.
 *
 *  **256 is measured, not estimated**: at 224 the header still overflowed
 *  (`scrollWidth` 243 against a 223px content box) and the close button was
 *  pushed to 2px off the panel edge, eating the `px-2` padding. 244 is the true
 *  minimum for the widest tab; 256 is that plus enough slack that a font
 *  fallback or a fourth control doesn't put it back over. A stored width below
 *  this is re-clamped on the next launch, so no migration is needed. */
export const MIN_PANEL_WIDTH = 256;
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

/**
 * **Raised from 200 on 2026-08-18, with the pane's tabs** (F18). At 200 the
 * chrome — subject, body, author, parents, the Changes heading — could fill the
 * pane on its own, so clicking a commit showed everything about it except the
 * thing you clicked for. Tabs fixed the cause; this fixes the symptom, and the
 * two are worth keeping separate because a 280px pane full of prose would still
 * have been wrong.
 *
 * 280 is about eight file rows once the ~54px of header and tab strip are taken
 * out. Deliberately not more: the graph above it is the reason the pane exists.
 */
export const DEFAULT_DETAIL_HEIGHT = 280;

/** What `DEFAULT_DETAIL_HEIGHT` used to be, kept only for the v1→v2 migration
 *  below. Do not use it for anything else. */
const LEGACY_DEFAULT_DETAIL_HEIGHT = 200;

export function clampDetailHeight(height: number): number {
	if (!Number.isFinite(height)) return DEFAULT_DETAIL_HEIGHT;
	return Math.min(MAX_DETAIL_HEIGHT, Math.max(MIN_DETAIL_HEIGHT, Math.round(height)));
}

/**
 * `current` plus every path in `paths`.
 *
 * Pure, like the clamps above, so the one property that matters can be pinned
 * without a store: revealing a path (F19) expands a whole ancestor chain of
 * which most entries are usually open already, and `toggleExpanded` would close
 * exactly those. Returns `current` untouched for an empty list so a no-op
 * reveal doesn't churn a new Set through every subscriber.
 */
export function withExpanded(
	current: ReadonlySet<string> | undefined,
	paths: string[],
): Set<string> {
	const next = new Set(current ?? []);
	for (const path of paths) next.add(path);
	return next;
}

/** The panel's three tabs (F12, F13, F18). Hardcoded rather than a registry —
 *  see 07-open-questions.md Q18, amended when the graph took a third slot. */
export type PanelTab = 'files' | 'changes' | 'graph';

interface PanelState {
	/** Is the file tree panel showing? Persisted. */
	open: boolean;
	/** Which tab is showing. Persisted app-wide rather than per project: a tab
	 *  choice is a habit, not a fact about a project. Not changed
	 *  programmatically — a strip that moves under you while you type into the
	 *  terminal below it is worse than no strip (Q18).
	 *
	 *  **One exception, added with F19**: revealing a directory you just clicked
	 *  in the terminal switches to `files`. The rule above is about a surface
	 *  moving *while you type*; this is the direct answer to a click you just
	 *  made, and taking you to a tree that isn't showing would be no answer at
	 *  all. `useRevealInTree` is the only caller allowed to do it. */
	tab: PanelTab;
	/** Panel width in px. Persisted. */
	width: number;
	/** Expanded directory paths, per project. Deliberately NOT persisted: a
	 *  path that existed last session may be gone, and restoring a half-open
	 *  tree of stale paths is worse than starting collapsed. */
	expandedByProject: Record<string, Set<string>>;
	/** Selected rows, for highlight and for what "add to agent context" acts on (F20).
	 *
	 *  A set rather than one path since multi-select landed. Not persisted, like
	 *  `expandedByProject` and for the same reason: it names paths that may not
	 *  exist next launch, and a restored selection nobody made is worse than
	 *  none. */
	selectedPaths: ReadonlySet<string>;
	/** The row a shift-click measures its range from — the last one selected
	 *  outright or toggled. Null when nothing has been clicked yet. */
	anchorPath: string | null;
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
	/** Expand all of these, idempotently. Revealing a path needs this rather
	 *  than `toggleExpanded`: most of the ancestors are usually open already,
	 *  and toggling would close exactly the ones you needed. */
	expandAll: (projectId: string, paths: string[]) => void;
	/** Expand the root once, the first time this project's tree is shown. A
	 *  project with an existing (even empty) entry has been seeded already, so a
	 *  deliberate collapse-all is not undone on the next render. */
	seedRoot: (projectId: string, rootPath: string) => void;
	collapseAll: (projectId: string) => void;
	/** Select exactly this row, dropping any other, and make it the anchor. The
	 *  plain-click case. */
	select: (path: string | null) => void;
	/** Add or remove one row, and make it the anchor. Ctrl/Cmd-click. */
	toggleSelected: (path: string) => void;
	/** Select exactly these, leaving the anchor where it is. Shift-click hands
	 *  in the run it worked out; the store does not know the tree's shape. */
	selectRange: (paths: string[]) => void;
}

/** Exactly what `partialize` writes, and therefore what `migrate` is handed and
 *  must hand back. Named so the two cannot drift: a field added to one and not
 *  the other is a migration that silently drops a preference. */
type PersistedPanelState = Pick<
	PanelState,
	'open' | 'width' | 'tab' | 'diffInline' | 'detailHeight'
>;

export const usePanelStore = create<PanelState>()(
	persist(
		(set) => ({
			open: false,
			tab: 'files',
			width: DEFAULT_PANEL_WIDTH,
			expandedByProject: {},
			selectedPaths: new Set<string>(),
			anchorPath: null,
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

			expandAll: (projectId, paths) =>
				set((s) => {
					if (!paths.length) return s;
					return {
						expandedByProject: {
							...s.expandedByProject,
							[projectId]: withExpanded(s.expandedByProject[projectId], paths),
						},
					};
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

			select: (path) =>
				set({ selectedPaths: path ? new Set([path]) : new Set<string>(), anchorPath: path }),

			toggleSelected: (path) =>
				set((s) => {
					const next = new Set(s.selectedPaths);
					if (!next.delete(path)) next.add(path);
					// The anchor moves even when the click *removed* the row: a shift
					// range afterwards should measure from where you last acted, which
					// is here either way.
					return { selectedPaths: next, anchorPath: path };
				}),

			selectRange: (paths) => set({ selectedPaths: new Set(paths) }),
		}),
		{
			name: 'factorai.panel',
			version: 2,
			/**
			 * v1 → v2: `DEFAULT_DETAIL_HEIGHT` went 200 → 280.
			 *
			 * A raised default reaches nobody on its own — this value has persisted
			 * since F18 shipped, so every existing install would have kept the 200
			 * the change exists to get away from, and the fix would have looked like
			 * it did nothing.
			 *
			 * **Only a height that is exactly the old default moves.** Any other
			 * number is one somebody dragged to, and overwriting a deliberate choice
			 * to deliver a new default is the worse failure of the two — it is also
			 * unrecoverable, since nothing records what they had.
			 */
			migrate: (persisted, version) => {
				const state = persisted as PersistedPanelState | undefined;
				if (state && version < 2 && state.detailHeight === LEGACY_DEFAULT_DETAIL_HEIGHT) {
					return { ...state, detailHeight: DEFAULT_DETAIL_HEIGHT };
				}
				return state;
			},
			// Only the preferences round-trip to storage. Sets aren't
			// JSON-serialisable anyway, and see `expandedByProject` above.
			partialize: (s): PersistedPanelState => ({
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
