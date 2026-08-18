import type { SessionSummary } from '@factorai/types';
import { describe, expect, it } from 'vitest';
import { groupSessions, pendingSessions } from './sessionGroups';

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

describe('pendingSessions', () => {
	const live = {
		'live-1': { projectId: 'p1', status: 'running' as const },
		'live-2': { projectId: 'p2', status: 'idle' as const },
	};

	it('returns the live sessions this project has no row for', () => {
		expect(pendingSessions(live, 'p1', [])).toEqual([{ sessionId: 'live-1', status: 'running' }]);
	});

	it('drops a live session once the index has caught up with it', () => {
		// The watcher indexed the transcript, so the real row is about to render
		// with its title — showing both would be the same session twice.
		expect(pendingSessions(live, 'p1', [session('live-1')])).toEqual([]);
	});

	it('ignores live sessions in other projects', () => {
		expect(pendingSessions(live, 'p3', [])).toEqual([]);
	});

	it('says nothing while the list is still loading', () => {
		// `undefined` is "not fetched yet", not "nothing indexed": treating them
		// alike flashes every live session as a new one on first paint.
		expect(pendingSessions(live, 'p1', undefined)).toEqual([]);
	});

	it('carries the status through, so the row can show its dot', () => {
		const stopped = { 'live-3': { projectId: 'p1', status: 'stopped' as const } };
		expect(pendingSessions(stopped, 'p1', [])).toEqual([
			{ sessionId: 'live-3', status: 'stopped' },
		]);
	});
});
