import { createContext, useContext } from 'react';
import type { GitDecorations } from '@hooks/useGitDecorations';

/**
 * What every row of the file tree needs and none of them should fetch.
 *
 * **Why this exists** (PERF-10, `specs/10-performance.md`). Each `FileTreeNode`
 * used to call `useGitDecorations`, `useFileViewer` and `useParams` for itself.
 * The first of those reaches `useGitStatus` → `useActiveCheckout`, which is four
 * more query observers — so a row cost five, and every one of them was notified
 * on each 3-second `git_status`, 5-second `list_sessions` and 30-second
 * `git_worktrees` result. `list_dir` caps a directory at 2 000 entries, so one
 * expanded `node_modules` was ten thousand observers being told the same thing.
 *
 * Worse, `useGitDecorations` builds its ancestor index in a `useMemo`, and a
 * `useMemo` is per component instance: the "once per status result" its own
 * comment promises was once per row per status result — the O(rows × changes)
 * walk it exists to avoid, reintroduced by where it was called.
 *
 * `PanelBody` computes all of it once and puts it here. A row reads the context,
 * which React does not treat as a subscription that can re-render it
 * independently — when the value changes every consumer re-renders together,
 * which is the correct behaviour for a decoration set that applies to the whole
 * tree.
 */
// Not exported: the provider and the hook are the surface, and the shape is
// reached through them by inference. An exported type nobody imports is one
// `knip` is right to call out.
interface FileTreeContextValue {
	/** The checkout the tree is rooted at — not the project folder (F21). */
	root: string;
	projectId: string;
	/** The session in front, for "Add to agent context" (F20). `null` on the
	 *  project list or in settings, where there is no agent to hand a file to. */
	activeSessionId: string | null;
	/** Open a path in the viewer (F7). The options carry the preview/pin
	 *  distinction a second click makes (ADR-0037). */
	openViewer: (path: string, opts?: { preview?: boolean }) => void;
	decorations: GitDecorations;
}

const FileTreeContext = createContext<FileTreeContextValue | null>(null);

export const FileTreeProvider = FileTreeContext.Provider;

/**
 * The tree's shared context, or a throw.
 *
 * A row outside the provider is a programming error rather than a state worth
 * rendering: it would silently lose its decorations, its viewer and the session
 * its menu hands files to.
 */
export function useFileTreeContext(): FileTreeContextValue {
	const value = useContext(FileTreeContext);
	if (!value) {
		throw new Error('FileTreeNode must be rendered inside a FileTreeProvider');
	}
	return value;
}
