import type { GitWorktree } from '@factorai/types';
import { describe, expect, it } from 'vitest';
import { branchSubtitle, stateChip } from '@components/session/CheckoutMenu';

function worktree(over: Partial<GitWorktree> = {}): GitWorktree {
	return {
		path: '/home/alice/code/worktrees/factorai-eng-3759-arrow-enforce',
		name: 'factorai-eng-3759-arrow-enforce',
		branch: 'feature/eng-3759-arrow-enforce',
		head: 'b'.repeat(40),
		isMain: false,
		locked: false,
		prunable: false,
		exists: true,
		...over,
	};
}

/** What a row says about a checkout, which is the whole of this menu's crowding
 *  problem: a real repository's five worktrees are named after their branches,
 *  and printing both put two 40-character strings in one row. */
describe('branchSubtitle', () => {
	it('says nothing when the name already carries the branch', () => {
		expect(branchSubtitle(worktree())).toBeNull();
	});

	it('says the branch when the name does not', () => {
		// The shape a user actually had: a short directory beside a long branch.
		expect(
			branchSubtitle(
				worktree({
					name: 'pearl-eng-3834',
					branch: 'feature/eng-3834-scope-stuck-submitting-automation',
				}),
			),
		).toBe('feature/eng-3834-scope-stuck-submitting-automation');
	});

	it('names the main checkout’s branch, which its folder never does', () => {
		expect(
			branchSubtitle(worktree({ name: null, path: '/home/alice/code/foo', branch: 'main' })),
		).toBe('main');
	});

	it('reports having no branch rather than nothing at all', () => {
		expect(branchSubtitle(worktree({ branch: null }))).toBe('detached HEAD');
	});

	it('says the directory is gone before it says anything about a branch', () => {
		expect(branchSubtitle(worktree({ exists: false }))).toBe('directory is gone');
	});
});

describe('stateChip', () => {
	it('marks only what changes whether a row can be chosen', () => {
		expect(stateChip(worktree())).toBeNull();
		// **No `main` chip.** Git's main checkout is this list's first row, so the
		// position already says it — and beside a branch called `main` the word
		// read as a stutter.
		expect(stateChip(worktree({ isMain: true, branch: 'main' }))).toBeNull();
		expect(stateChip(worktree({ locked: true }))).toBe('locked');
		expect(stateChip(worktree({ exists: false, locked: true }))).toBe('missing');
	});
});
