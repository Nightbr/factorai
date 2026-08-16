import type { SessionSummary } from '@factorai/types';
import { describe, expect, it } from 'vitest';
import { groupSessions } from './sessionGroups';

function session(id: string, subagentOf: string | null = null): SessionSummary {
	return {
		id,
		projectId: 'p1',
		title: id,
		createdAt: 0,
		updatedAt: 0,
		turnCount: 1,
		cwd: null,
		subagentOf,
	};
}

describe('groupSessions', () => {
	it('nests agents under the parent that spawned them', () => {
		const groups = groupSessions([
			session('s1'),
			session('a1', 's1'),
			session('a2', 's1'),
			session('s2'),
		]);

		expect(groups.map((g) => g.session.id)).toEqual(['s1', 's2']);
		expect(groups[0].agents.map((a) => a.id)).toEqual(['a1', 'a2']);
		expect(groups[1].agents).toEqual([]);
	});

	it('keeps the order the backend returned', () => {
		const groups = groupSessions([session('s2'), session('a1', 's2'), session('s1')]);
		expect(groups.map((g) => g.session.id)).toEqual(['s2', 's1']);
	});

	it('promotes an orphan to its own row rather than losing it', () => {
		// The parent transcript was deleted; the agent's own is still on disk and
		// still readable. Filing it under a parent that is not in the list would
		// hide it completely.
		const groups = groupSessions([session('s1'), session('a1', 'gone-parent')]);

		expect(groups.map((g) => g.session.id)).toEqual(['s1', 'a1']);
		expect(groups[1].session.subagentOf).toBe('gone-parent');
	});

	it('nests an agent that arrives before its parent', () => {
		// The backend orders parent-first, but nothing in this function should
		// depend on that — a single-pass version drops this agent silently.
		const groups = groupSessions([session('a1', 's1'), session('s1')]);

		expect(groups.map((g) => g.session.id)).toEqual(['s1']);
		expect(groups[0].agents.map((a) => a.id)).toEqual(['a1']);
	});

	it('handles an empty list', () => {
		expect(groupSessions([])).toEqual([]);
	});
});
