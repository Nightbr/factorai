import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** How the project list is ordered (specs/05-features.md F1).
 *
 *  `manual` is the order you dragged the rows into — the stored `sortOrder` on
 *  each project. It is the default, because a list that stays where you put it
 *  is the point of being able to put it anywhere.
 *
 *  `name` and `recent` are **views over the same list**: they derive an order
 *  from fields the row already carries and write nothing. `recent` used to mean
 *  "keep whatever `list_projects` returned", because that query ordered by
 *  recency; it now orders by ordinal, so `recent` derives its own order from
 *  `lastSessionAt`.
 *
 *  The union widened from `'recent' | 'name'` without a store version bump: both
 *  old values are still valid, so a persisted state needs no migration. Only the
 *  default for a fresh install changed. */
export type ProjectSort = 'manual' | 'name' | 'recent';

/** Narrower and project names truncate to nothing; wider and it eats the pane
 *  the terminal needs. */
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 480;
export const DEFAULT_SIDEBAR_WIDTH = 256;

/** Pure, so the drag maths is testable without a pointer — same rule as the
 *  file panel's `clampPanelWidth`. */
export function clampSidebarWidth(width: number): number {
	if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH;
	return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

interface SidebarState {
	sort: ProjectSort;
	/** Expanded project ids. An array rather than a Set so it survives JSON —
	 *  and unlike the file tree's expanded *paths* (which go stale when a
	 *  directory is deleted), a project id stays valid, so this is persisted.
	 *  Dropped once, at version 2: see the store's `migrate`. */
	expanded: string[];
	/** Sidebar width in px. Persisted, like the file panel's. */
	width: number;

	setSort: (sort: ProjectSort) => void;
	setWidth: (width: number) => void;
	toggleProject: (projectId: string) => void;
	expandAll: (projectIds: string[]) => void;
	collapseAll: () => void;
}

/**
 * Bring a persisted sidebar state forward.
 *
 * v1 → v2: ADR-0011 reissued every project id as a uuid, so v1's `expanded`
 * holds encoded paths that match nothing. They are **dropped rather than
 * remapped**: what that costs is the sidebar starting collapsed once, and the
 * alternative is a one-shot async lookup in the renderer that has to finish
 * before the first paint or the list renders wrong and then jumps. `sort` and
 * `width` are id-free and carry over untouched.
 *
 * **There is no v2 → v3, deliberately.** Adding `manual` widened `ProjectSort`
 * rather than replacing it, so every persisted `sort` — `'recent'` included — is
 * still a value the store accepts. A migration here could only move someone off
 * a mode that is still on the menu, which is discarding a preference they set,
 * so the version stays at 2 and only the default for a fresh install changed.
 *
 * Pure and exported so the rule is testable without a storage round-trip.
 */
export function migrateSidebarState(state: unknown, from: number): unknown {
	if (from >= 2) return state;
	if (!state || typeof state !== 'object') return state;
	return { ...(state as Record<string, unknown>), expanded: [] };
}

export const useSidebarStore = create<SidebarState>()(
	persist(
		(set) => ({
			sort: 'manual',
			expanded: [],
			width: DEFAULT_SIDEBAR_WIDTH,

			setSort: (sort) => set({ sort }),
			setWidth: (width) => set({ width: clampSidebarWidth(width) }),
			toggleProject: (projectId) =>
				set((s) => ({
					expanded: s.expanded.includes(projectId)
						? s.expanded.filter((id) => id !== projectId)
						: [...s.expanded, projectId],
				})),
			expandAll: (projectIds) => set({ expanded: [...projectIds] }),
			collapseAll: () => set({ expanded: [] }),
		}),
		{
			name: 'factorai.sidebar',
			version: 2,
			migrate: migrateSidebarState,
		},
	),
);
