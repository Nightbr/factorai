import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DiffMode } from '@hooks/useFileViewer';
import type { ViewerHost } from '@lib/viewerLayout';

/**
 * One open file in the viewer's strip (F7, ADR-0037).
 *
 * `diff` is on the tab rather than only in the URL so that switching away from
 * a diff and back returns to the diff: one path is one tab whichever way you
 * are reading it, and the mode belongs to the tab the way a scroll position
 * would.
 */
export interface ViewerTab {
	path: string;
	/** A preview tab is the one the next single click replaces — VSCode's
	 *  idiom, and the reason clicking through a tree does not leave forty tabs
	 *  behind. A double-click on the row or on the tab pins it. */
	preview: boolean;
	diff: DiffMode | null;
}

interface OpenOptions {
	preview?: boolean;
	diff?: DiffMode | null;
}

/**
 * `tabs` with `path` open.
 *
 * Pure so the one rule worth pinning can be tested without a store: a preview
 * open **replaces the existing preview tab in place** rather than appending, so
 * the strip does not grow while you browse, and the replacement keeps the
 * position the preview held.
 */
export function withOpenTab(tabs: ViewerTab[], path: string, opts: OpenOptions = {}): ViewerTab[] {
	const diff = opts.diff ?? null;
	const at = tabs.findIndex((t) => t.path === path);
	if (at >= 0) {
		const existing = tabs[at];
		// An explicit open pins a tab that was a preview; a preview open leaves a
		// pinned tab pinned. Reopening never demotes.
		const next: ViewerTab = { path, preview: existing.preview && opts.preview === true, diff };
		const copy = [...tabs];
		copy[at] = next;
		return copy;
	}
	const fresh: ViewerTab = { path, preview: opts.preview === true, diff };
	if (!opts.preview) return [...tabs, fresh];
	const previewAt = tabs.findIndex((t) => t.preview);
	if (previewAt === -1) return [...tabs, fresh];
	const copy = [...tabs];
	copy[previewAt] = fresh;
	return copy;
}

/** `tabs` without `path`. Returns the same array when nothing matched, so a
 *  close of something already closed doesn't churn subscribers. */
export function withoutTab(tabs: ViewerTab[], path: string): ViewerTab[] {
	const at = tabs.findIndex((t) => t.path === path);
	if (at === -1) return tabs;
	return [...tabs.slice(0, at), ...tabs.slice(at + 1)];
}

/** `tabs` with `path` pinned. */
export function withPinnedTab(tabs: ViewerTab[], path: string): ViewerTab[] {
	return tabs.map((t) => (t.path === path ? { ...t, preview: false } : t));
}

/**
 * What to show after closing `closed`.
 *
 * The tab that took the closed one's place, or the last one when the closed tab
 * was last — the same answer every editor gives, and the reason closing a run
 * of tabs from the right doesn't jump the selection to the far end. Null when
 * nothing is left, which closes the viewer.
 */
export function nextActivePath(
	tabs: ViewerTab[],
	closed: string,
	active: string | null,
): string | null {
	if (active !== closed) return active;
	const at = tabs.findIndex((t) => t.path === closed);
	if (at === -1) return active;
	const remaining = [...tabs.slice(0, at), ...tabs.slice(at + 1)];
	if (!remaining.length) return null;
	return remaining[Math.min(at, remaining.length - 1)].path;
}

interface ViewerState {
	/**
	 * The checkout the open files belong to (F21) — the store's actions read it
	 * rather than taking it, so every caller that opens a file (the tree, the
	 * Changes list, a terminal link, the IDE bridge) can stay ignorant of it.
	 *
	 * Keyed by checkout and not by project for the same reason
	 * `expandedByCheckout` is: the paths are absolute, and a project with two
	 * worktrees is two trees whose files only look the same.
	 */
	checkout: string | null;
	tabsByCheckout: Record<string, ViewerTab[]>;
	/** The last file shown per checkout, so a relaunch comes back to it. `?file=`
	 *  is the live answer and does not persist — this is what re-seeds it. */
	activeByCheckout: Record<string, string>;
	/** The shell row's measured width, for the host rule. Not persisted: it is a
	 *  measurement, and next launch's window may be another size. */
	shellWidth: number;
	/** Which host is showing. Held rather than derived on the fly because the
	 *  rule is sticky — see `resolveViewerHost`. */
	host: ViewerHost;
	/** The demoted modal (ADR-0037): an explicit expand, never where a file
	 *  lands. */
	expanded: boolean;

	setCheckout: (checkout: string | null) => void;
	setShellWidth: (width: number) => void;
	setHost: (host: ViewerHost) => void;
	setExpanded: (expanded: boolean) => void;
	openTab: (path: string, opts?: OpenOptions) => void;
	pinTab: (path: string) => void;
	/** Drops the tab and answers what should be shown instead — null to close
	 *  the viewer. The caller navigates, because `?file=` is the router's. */
	closeTab: (path: string, active: string | null) => string | null;
}

type PersistedViewerState = Pick<ViewerState, 'tabsByCheckout' | 'activeByCheckout'>;

export const useViewerStore = create<ViewerState>()(
	persist(
		(set, get) => ({
			checkout: null,
			tabsByCheckout: {},
			activeByCheckout: {},
			shellWidth: 0,
			host: 'column',
			expanded: false,

			setCheckout: (checkout) => set((s) => (s.checkout === checkout ? s : { checkout })),
			setShellWidth: (width) =>
				set((s) => (s.shellWidth === width ? s : { shellWidth: Math.round(width) })),
			setHost: (host) => set((s) => (s.host === host ? s : { host })),
			setExpanded: (expanded) => set((s) => (s.expanded === expanded ? s : { expanded })),

			openTab: (path, opts) =>
				set((s) => {
					if (!s.checkout) return s;
					const tabs = s.tabsByCheckout[s.checkout] ?? [];
					return {
						tabsByCheckout: { ...s.tabsByCheckout, [s.checkout]: withOpenTab(tabs, path, opts) },
						activeByCheckout: { ...s.activeByCheckout, [s.checkout]: path },
					};
				}),

			pinTab: (path) =>
				set((s) => {
					if (!s.checkout) return s;
					const tabs = s.tabsByCheckout[s.checkout] ?? [];
					return {
						tabsByCheckout: { ...s.tabsByCheckout, [s.checkout]: withPinnedTab(tabs, path) },
					};
				}),

			closeTab: (path, active) => {
				const s = get();
				if (!s.checkout) return active;
				const tabs = s.tabsByCheckout[s.checkout] ?? [];
				const next = nextActivePath(tabs, path, active);
				const remaining = withoutTab(tabs, path);
				set({
					tabsByCheckout: { ...s.tabsByCheckout, [s.checkout]: remaining },
					activeByCheckout: nextEntry(s.activeByCheckout, s.checkout, next),
				});
				return next;
			},
		}),
		{
			name: 'factorai.viewer',
			version: 1,
			// Only the open files round-trip. The measured width, the host and the
			// expanded modal all describe this window right now.
			partialize: (s): PersistedViewerState => ({
				tabsByCheckout: s.tabsByCheckout,
				activeByCheckout: s.activeByCheckout,
			}),
		},
	),
);

/** `map` with `checkout` set to `value`, or with the entry removed for a null —
 *  so a checkout whose last tab was closed doesn't keep a path that would
 *  reopen the viewer on the next launch. */
function nextEntry(
	map: Record<string, string>,
	checkout: string,
	value: string | null,
): Record<string, string> {
	if (value) return { ...map, [checkout]: value };
	const { [checkout]: _gone, ...rest } = map;
	return rest;
}

/** Stable empty list so selectors don't churn on a checkout with nothing open. */
const NO_TABS: ViewerTab[] = [];

export function tabsFor(state: ViewerState, checkout: string | null): ViewerTab[] {
	if (!checkout) return NO_TABS;
	return state.tabsByCheckout[checkout] ?? NO_TABS;
}
