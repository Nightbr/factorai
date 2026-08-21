import { useCallback } from 'react';
import { usePanelStore } from '@store/panelStore';

/**
 * Every directory between `root` and `path`, inclusive of both.
 *
 * Pure and exported so the arithmetic is testable without a store. A path that
 * isn't under the root yields nothing: a symlink target somewhere else has no
 * ancestors in this tree, and half-expanding towards it would be worse than
 * doing nothing.
 */
export function ancestorsWithin(path: string, root: string): string[] {
	if (!root || !path) return [];
	const base = root.endsWith('/') ? root.slice(0, -1) : root;
	const target = path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;
	if (target === base) return [base];
	if (!target.startsWith(`${base}/`)) return [];

	const out = [base];
	for (const segment of target.slice(base.length + 1).split('/')) {
		out.push(`${out[out.length - 1]}/${segment}`);
	}
	return out;
}

/**
 * Show a directory in the file tree (F12), for a terminal link that turned out
 * to point at one (F19).
 *
 * Opens the panel, switches to the Files tab, expands every ancestor and
 * selects the row. The tab switch is the one place `panelStore`'s "the strip
 * never moves under you" rule is deliberately broken, and the store's own
 * comment records why: this is the direct answer to a click, not a surface
 * moving while you type.
 *
 * **It does not scroll the tree to the row.** The tree virtualises nothing and
 * rows mount lazily as their parents expand, so there is no node to scroll to
 * at the moment this runs. The expansion is what makes the row reachable; that
 * is the useful half, and a scroll would need the tree to own it.
 */
export function useRevealInTree(root: string | null): (path: string) => void {
	const setOpen = usePanelStore((s) => s.setOpen);
	const setTab = usePanelStore((s) => s.setTab);
	const expandAll = usePanelStore((s) => s.expandAll);
	const select = usePanelStore((s) => s.select);

	return useCallback(
		(path: string) => {
			if (!root) return;
			const chain = ancestorsWithin(path, root);
			if (!chain.length) return;
			setOpen(true);
			setTab('files');
			expandAll(root, chain);
			select(path);
		},
		[root, setOpen, setTab, expandAll, select],
	);
}
