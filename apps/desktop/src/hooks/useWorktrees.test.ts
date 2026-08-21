import { describe, expect, it } from 'vitest';
import type { GitWorktree } from '@factorai/types';
import { checkoutContaining } from './useWorktrees';

function wt(path: string, over: Partial<GitWorktree> = {}): GitWorktree {
	return {
		path,
		name: null,
		branch: null,
		head: null,
		isMain: false,
		locked: false,
		prunable: false,
		exists: true,
		...over,
	};
}

describe('checkoutContaining', () => {
	it('@unit finds the checkout a file sits in', () => {
		const trees = [wt('/repo'), wt('/wt/feature-x')];
		expect(checkoutContaining(trees, '/wt/feature-x/src/a.ts')?.path).toBe('/wt/feature-x');
	});

	it('@unit treats the checkout root itself as inside it', () => {
		expect(checkoutContaining([wt('/repo')], '/repo')?.path).toBe('/repo');
	});

	it('@unit compares path segments, not string prefixes', () => {
		// `/repo-old/a.ts` starts with `/repo` and is not in it. Getting this
		// wrong shows one checkout's files under another's name, which is the
		// failure mode worth a test of its own.
		expect(checkoutContaining([wt('/repo')], '/repo-old/a.ts')).toBeUndefined();
	});

	it('@unit prefers the innermost checkout when one nests inside another', () => {
		// Legal, if unusual. Longest match wins, or a nested checkout resolves to
		// its parent and the panel roots one level too high.
		const trees = [wt('/repo'), wt('/repo/vendor/dep')];
		expect(checkoutContaining(trees, '/repo/vendor/dep/src/a.ts')?.path).toBe('/repo/vendor/dep');
	});

	it('@unit ignores a checkout that is not on disk', () => {
		// A `prunable` entry git still lists. It cannot contain anything, and
		// rooting the panel there shows an empty tree with no explanation.
		expect(
			checkoutContaining([wt('/wt/gone', { exists: false })], '/wt/gone/a.ts'),
		).toBeUndefined();
	});

	it('@unit collapses a transient cd into the checkout that contains it', () => {
		// The reason the sidebar and the panel can both read a session's *last* cwd
		// safely: it follows every `cd` a shell command makes, and one real
		// transcript churned through `apps/desktop/src-tauri` and
		// `node_modules/.pnpm/…`. Both are inside the main checkout, so both answer
		// "the project" — only a path in a linked worktree answers otherwise.
		const trees = [wt('/repo'), wt('/repo/.claude/worktrees/fix')];
		expect(checkoutContaining(trees, '/repo/apps/desktop/src-tauri')?.path).toBe('/repo');
		expect(checkoutContaining(trees, '/repo/node_modules/.pnpm/x')?.path).toBe('/repo');
		expect(checkoutContaining(trees, '/repo/.claude/worktrees/fix/src/a.ts')?.path).toBe(
			'/repo/.claude/worktrees/fix',
		);
	});

	it('@unit has no answer for a session with no recorded cwd', () => {
		expect(checkoutContaining([wt('/repo')], null)).toBeUndefined();
	});
});
