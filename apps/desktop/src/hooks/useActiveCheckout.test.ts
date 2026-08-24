import type { GitWorktree, SessionSummary } from '@factorai/types';
import { describe, expect, it } from 'vitest';
import { resolveCheckout } from '@hooks/useActiveCheckout';

const PROJECT = '/home/alice/code/foo';
const WORKTREE = '/home/alice/code/worktrees/feature-x';

const main: GitWorktree = {
	path: PROJECT,
	name: null,
	branch: 'main',
	head: 'a'.repeat(40),
	isMain: true,
	locked: false,
	prunable: false,
	exists: true,
};

const linked: GitWorktree = {
	path: WORKTREE,
	name: 'feature-x',
	branch: 'feature-x',
	head: 'b'.repeat(40),
	isMain: false,
	locked: false,
	prunable: false,
	exists: true,
};

const WORKTREES = [main, linked];

function session(over: Partial<SessionSummary> = {}): SessionSummary {
	return {
		id: 'session-1',
		projectId: 'project-1',
		title: 'A session',
		createdAt: 0,
		updatedAt: 0,
		turnCount: 1,
		cwd: PROJECT,
		subagentOf: null,
		worktree: null,
		lastCwd: PROJECT,
		lastTouched: null,
		...over,
	};
}

/** The precedence between four signals, which is the whole of F21's resolution
 *  and the part that keeps being got wrong by one step. */
describe('resolveCheckout', () => {
	it('prefers this run’s signal over the persisted row', () => {
		const resolved = resolveCheckout(WORKTREES, WORKTREE, session({ worktree: PROJECT }));
		expect(resolved?.path).toBe(WORKTREE);
	});

	it('falls through a signal naming a checkout that is gone', () => {
		// A row is a record, not a guarantee: `git worktree remove` leaves it
		// behind, and rooting the panel there re-discovers whatever repository sits
		// above the deleted directory with nothing on screen saying so.
		const removed = { ...linked, exists: false };
		const resolved = resolveCheckout([main, removed], WORKTREE, session());
		expect(resolved?.path).toBe(PROJECT);
	});

	it('follows an agent that moved its cwd without saying so', () => {
		const resolved = resolveCheckout(
			WORKTREES,
			undefined,
			session({ cwd: PROJECT, lastCwd: `${WORKTREE}/src` }),
		);
		expect(resolved?.path).toBe(WORKTREE);
	});

	it('follows an agent that never moved its cwd at all', () => {
		// **The shape that reached a user**: `git worktree add`, then `git -C` and
		// absolute paths. `lastCwd` is correct and useless — it names the checkout
		// the session started in, for ever.
		const resolved = resolveCheckout(
			WORKTREES,
			undefined,
			session({ lastCwd: PROJECT, lastTouched: `${WORKTREE}/src/switcher.ts` }),
		);
		expect(resolved?.path).toBe(WORKTREE);
	});

	it('ignores a touched path in the main checkout', () => {
		// An agent working in a worktree reads files in the main checkout all day —
		// a shared config, a sibling package, the spec it is working from. Letting
		// that count would flicker the panel between checkouts on every tool call.
		const resolved = resolveCheckout(
			WORKTREES,
			undefined,
			session({ lastCwd: `${WORKTREE}/src`, lastTouched: `${PROJECT}/biome.json` }),
		);
		expect(resolved?.path).toBe(WORKTREE);
	});

	it('ignores a touched path outside the repository entirely', () => {
		const resolved = resolveCheckout(WORKTREES, undefined, session({ lastTouched: '/etc/hosts' }));
		expect(resolved?.path).toBe(PROJECT);
	});

	it('resolves nothing when the session is outside every checkout', () => {
		const resolved = resolveCheckout(
			WORKTREES,
			undefined,
			session({ cwd: '/tmp/elsewhere', lastCwd: '/tmp/elsewhere' }),
		);
		expect(resolved).toBeUndefined();
	});
});
