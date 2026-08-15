import type { GitChange, GitChangeKind } from '@factorai/types';
import { useMemo } from 'react';
import { useGitStatus } from '@hooks/useGitStatus';

/** What a row's decoration says. Ordered by precedence — a directory takes the
 *  most severe status among its descendants. */
type Decoration = 'conflicted' | 'untracked' | 'modified';

const PRECEDENCE: Record<Decoration, number> = { conflicted: 0, untracked: 1, modified: 2 };

/** Git's own colour semantics, in the app's palette rather than new hex
 *  values (F12). */
export const DECORATION_CLASSES: Record<Decoration, string> = {
	conflicted: 'text-rose-500',
	untracked: 'text-emerald-500',
	modified: 'text-amber-500',
};

function decorationFor(kind: GitChangeKind): Decoration {
	if (kind === 'conflicted') return 'conflicted';
	if (kind === 'untracked' || kind === 'added') return 'untracked';
	return 'modified';
}

interface GitDecorations {
	/** Decoration for an exact path, file or directory. */
	get: (path: string) => Decoration | undefined;
}

const NONE: GitDecorations = { get: () => undefined };

/**
 * Index changes by path **and by every ancestor directory**, most-severe-wins.
 *
 * Pure and exported so it can be tested without rendering anything — the hook
 * below is a `useMemo` around this and nothing else.
 */
export function buildDecorations(
	changes: readonly GitChange[],
	repoRoot: string,
): Map<string, Decoration> {
	const map = new Map<string, Decoration>();
	const put = (path: string, next: Decoration) => {
		const current = map.get(path);
		if (!current || PRECEDENCE[next] < PRECEDENCE[current]) map.set(path, next);
	};

	for (const change of changes) {
		const decoration = decorationFor(change.kind);
		put(change.path, decoration);
		// Walk up to the repository root — not to the project root, because a
		// project inside a monorepo has changes above it and those ancestors are
		// still real directories the tree can show.
		let dir = parentOf(change.path);
		while (dir && dir.length >= repoRoot.length) {
			put(dir, decoration);
			const next = parentOf(dir);
			if (next === dir) break;
			dir = next;
		}
	}

	return map;
}

/**
 * Status decorations for the file tree (specs/05-features.md F12).
 *
 * **The whole point of this hook is the index.** A changed file decorates its
 * own row *and* every ancestor directory, so a collapsed folder tells you there
 * is something inside worth expanding. Doing that per row — asking "does any
 * change start with this directory?" — is O(rows × changes) on every render of
 * a tree that re-renders on every 3s poll.
 *
 * Instead the ancestor walk happens **once per status result**: each changed
 * path contributes its own entry plus one per ancestor, most-severe-wins, and a
 * row lookup is then a single Map hit. VS Code solves the same problem with a
 * TernarySearchTree and a `findSuperstr` subtree query, which it needs because
 * its decorations arrive as a sparse global map; ours arrive as one array we
 * can index in a `useMemo`.
 */
export function useGitDecorations(): GitDecorations {
	const { status } = useGitStatus();
	const changes = status?.changes;
	const repoRoot = status?.repoRoot;

	return useMemo(() => {
		if (!changes || !repoRoot) return NONE;
		const map = buildDecorations(changes, repoRoot);
		return { get: (path: string) => map.get(path) };
	}, [changes, repoRoot]);
}

function parentOf(path: string): string {
	const i = path.lastIndexOf('/');
	return i > 0 ? path.slice(0, i) : '';
}
