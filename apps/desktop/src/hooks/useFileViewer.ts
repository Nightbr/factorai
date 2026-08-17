import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback } from 'react';

/**
 * Which two revisions a diff compares (specs/05-features.md F13). The value
 * follows the Changes row's group, because a staged row has no side on disk.
 *
 * - `staged`   HEAD ↔ index
 * - `unstaged` index ↔ worktree
 * - `head`     HEAD ↔ worktree, used for conflicted rows
 *
 * A fourth form arrives with F18: `<parent>..<sha>`, a commit against its first
 * parent. Git's own range notation, with **both ends explicit** so nothing in the
 * renderer has to resolve `sha^`. The left side is empty for a root commit, whose
 * parent is the empty tree.
 */
export type DiffMode = 'staged' | 'unstaged' | 'head' | `${string}..${string}`;

const DIFF_MODES: DiffMode[] = ['staged', 'unstaged', 'head'];

/** A full SHA either side, and an empty left for a root commit. Strict on
 *  purpose: this validates a hand-edited URL, and a loose pattern would let
 *  `..` alone through as a diff of nothing against nothing. */
const COMMIT_RANGE = /^(?:[0-9a-f]{40})?\.\.[0-9a-f]{40}$/;

export function isDiffMode(value: unknown): value is DiffMode {
	if (typeof value !== 'string') return false;
	return DIFF_MODES.includes(value as DiffMode) || COMMIT_RANGE.test(value);
}

/** The two commits a range compares, or null when the mode isn't a range.
 *  A null `left` is the empty tree — a root commit's files are all additions. */
export function parseCommitRange(mode: DiffMode): { left: string | null; right: string } | null {
	if (!COMMIT_RANGE.test(mode)) return null;
	const [left, right] = mode.split('..');
	return { left: left || null, right };
}

/**
 * What the viewer is showing, held in the URL as `?file=<absolute path>` and
 * optionally `&diff=<mode>` (F7, F13).
 *
 * The URL rather than a store so it survives reload and HMR, so browser-back
 * closes the viewer, and because the per-project tab system grows out of the
 * same place — `?file=` becomes a list of open paths. `validateSearch` lives on
 * the root route, so every route inherits both params.
 */
export function useFileViewer(): {
	path: string | null;
	diff: DiffMode | null;
	open: (path: string, diff?: DiffMode) => void;
	close: () => void;
} {
	const search = useSearch({ strict: false }) as { file?: string; diff?: DiffMode };
	const navigate = useNavigate();

	const open = useCallback(
		(path: string, diff?: DiffMode) => {
			// `diff: undefined` matters: opening a file from the tree after a diff
			// must drop the mode, not inherit it.
			void navigate({ to: '.', search: (prev) => ({ ...prev, file: path, diff }) });
		},
		[navigate],
	);

	const close = useCallback(() => {
		void navigate({ to: '.', search: (prev) => ({ ...prev, file: undefined, diff: undefined }) });
	}, [navigate]);

	return {
		path: search.file ?? null,
		// A `diff` with no `file` is meaningless — treat it as absent rather than
		// letting a hand-edited URL open a diff of nothing.
		diff: search.file && isDiffMode(search.diff) ? search.diff : null,
		open,
		close,
	};
}
