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

/** A 1-based position, or null for "wherever the file starts".
 *
 *  1-based because that is what `foo.ts:42:7` means to everyone who writes one,
 *  and what Monaco's `setPosition` expects — no off-by-one lives in between. */
export interface ViewerPosition {
	line: number;
	col: number | null;
}

/** A line or column out of the URL. Rejects 0, negatives, fractions and
 *  anything non-numeric, so a hand-edited URL cannot reach Monaco with a
 *  position no file has. */
export function parsePosition(value: unknown): number | undefined {
	if (typeof value !== 'string' && typeof value !== 'number') return undefined;
	const n = Number(value);
	return Number.isInteger(n) && n >= 1 ? n : undefined;
}

/** How the viewer is opened. All optional: the tree passes none of it, the
 *  Changes tab passes `diff`, a terminal link (F19) passes a position. */
interface OpenOptions {
	diff?: DiffMode;
	line?: number;
	col?: number;
}

/**
 * What the viewer is showing, held in the URL as `?file=<absolute path>` and
 * optionally `&diff=<mode>` (F7, F13) or `&line=`/`&col=` (F19).
 *
 * The URL rather than a store so it survives reload and HMR, so browser-back
 * closes the viewer, and because the per-project tab system grows out of the
 * same place — `?file=` becomes a list of open paths. `validateSearch` lives on
 * the root route, so every route inherits all four params.
 */
export function useFileViewer(): {
	path: string | null;
	diff: DiffMode | null;
	position: ViewerPosition | null;
	open: (path: string, opts?: OpenOptions) => void;
	close: () => void;
} {
	const search = useSearch({ strict: false }) as {
		file?: string;
		diff?: DiffMode;
		line?: number;
		col?: number;
	};
	const navigate = useNavigate();

	const open = useCallback(
		(path: string, opts?: OpenOptions) => {
			// Every field is spelled out, `undefined` included: opening a file from
			// the tree after a diff must drop the mode, and clicking a plain path
			// after a `foo.ts:42` link must drop the position. Inheriting either
			// would put the viewer somewhere nobody asked it to go.
			void navigate({
				to: '.',
				search: (prev) => ({
					...prev,
					file: path,
					diff: opts?.diff,
					line: opts?.line,
					col: opts?.col,
				}),
			});
		},
		[navigate],
	);

	const close = useCallback(() => {
		void navigate({
			to: '.',
			search: (prev) => ({
				...prev,
				file: undefined,
				diff: undefined,
				line: undefined,
				col: undefined,
			}),
		});
	}, [navigate]);

	const line = search.file ? parsePosition(search.line) : undefined;

	return {
		path: search.file ?? null,
		// A `diff` with no `file` is meaningless — treat it as absent rather than
		// letting a hand-edited URL open a diff of nothing.
		diff: search.file && isDiffMode(search.diff) ? search.diff : null,
		// A column without a line is the same kind of nonsense, so the line is
		// what gates the whole position.
		position: line ? { line, col: parsePosition(search.col) ?? null } : null,
		open,
		close,
	};
}
