import type { SessionSummary } from '@factorai/types';
import { describe, expect, it } from 'vitest';
import {
	groupSessions,
	openSessions,
	pendingSessions,
	projectStatus,
	tabsInKnownProjects,
} from './sessionGroups';

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
		worktree: null,
		lastCwd: null,
		touchedPaths: [],
		routineId: null,
		routineName: null,
		routineStartedAt: null,
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
		'live-1': { projectId: 'p1', status: 'working' as const },
		'live-2': { projectId: 'p2', status: 'waiting_input' as const },
	};

	it('returns the live sessions this project has no row for', () => {
		expect(pendingSessions(live, 'p1', [])).toEqual([{ sessionId: 'live-1', status: 'working' }]);
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

describe('projectStatus', () => {
	const live = (pairs: [string, string, 'working' | 'waiting_input' | 'stopped'][]) =>
		Object.fromEntries(pairs.map(([id, projectId, status]) => [id, { projectId, status }]));

	it('is undefined for a project with nothing live', () => {
		// The absence of a state, not a state: renders as no dot rather than a
		// grey one, so the sidebar isn't a wall of dots for every project you
		// have ever opened.
		expect(projectStatus(live([['s1', 'p1', 'working']]), 'p2')).toBeUndefined();
	});

	it('surfaces the session that wants you over the one that is busy', () => {
		// Attention first: a working session resolves itself, a waiting one does
		// not, so the dot points at the one you have to do something about.
		expect(
			projectStatus(
				live([
					['s1', 'p1', 'working'],
					['s2', 'p1', 'waiting_input'],
				]),
				'p1',
			),
		).toBe('waiting_input');
		// waiting_input outranks stopped: it is the one that wants you.
		expect(
			projectStatus(
				live([
					['s1', 'p1', 'stopped'],
					['s2', 'p1', 'waiting_input'],
				]),
				'p1',
			),
		).toBe('waiting_input');
	});

	it("does not let another project's sessions decide this one", () => {
		expect(
			projectStatus(
				live([
					['s1', 'p1', 'waiting_input'],
					['s2', 'p2', 'working'],
				]),
				'p1',
			),
		).toBe('waiting_input');
	});

	it('is order-independent', () => {
		// A fixture that happens to be sorted would pass even if the rank
		// comparison were dropped for "first one wins".
		const pairs: [string, string, 'working' | 'waiting_input' | 'stopped'][] = [
			['s1', 'p1', 'stopped'],
			['s2', 'p1', 'working'],
			['s3', 'p1', 'waiting_input'],
		];
		expect(projectStatus(live(pairs), 'p1')).toBe('waiting_input');
		expect(projectStatus(live([...pairs].reverse()), 'p1')).toBe('waiting_input');
	});
});

describe('openSessions', () => {
	const tabs = [
		{ sessionId: 'a', projectId: 'p1' },
		{ sessionId: 'b', projectId: 'p2' },
	];

	it('calls a session with no live PTY stopped', () => {
		// The whole of the restore rule: a rehydrated store has an empty
		// `bySession`, so every restored tab comes out stopped by construction.
		expect(openSessions(tabs, {})).toEqual({
			a: { projectId: 'p1', status: 'stopped' },
			b: { projectId: 'p2', status: 'stopped' },
		});
	});

	it('takes the live status where there is one', () => {
		const out = openSessions(tabs, { a: { projectId: 'p1', status: 'working' } });
		expect(out.a.status).toBe('working');
		expect(out.b.status).toBe('stopped');
	});

	it('is a projection of the tabs, so a PTY with no tab is not open', () => {
		// Cannot happen through the reducers — `attach` writes both — but the
		// direction matters: `tabs` decides membership, `bySession` only colours.
		const out = openSessions([], { ghost: { projectId: 'p1', status: 'working' } });
		expect(out).toEqual({});
	});

	it('drops in where bySession did, so projectStatus needs no new signature', () => {
		const open = openSessions(tabs, { a: { projectId: 'p1', status: 'waiting_input' } });
		expect(projectStatus(open, 'p1')).toBe('waiting_input');
		expect(projectStatus(open, 'p2')).toBe('stopped');
	});
});

describe('tabsInKnownProjects', () => {
	const tabs = [
		{ sessionId: 'a', projectId: 'p1' },
		{ sessionId: 'b', projectId: 'gone' },
	];

	it('drops a tab whose project no longer exists, silently', () => {
		expect(tabsInKnownProjects(tabs, [{ id: 'p1' }])).toEqual([
			{ sessionId: 'a', projectId: 'p1' },
		]);
	});

	it('yields nothing until the project list has been fetched', () => {
		// `undefined` is "not asked yet", not "no projects" — painting first and
		// filtering after would show a stale tab and then take it away.
		expect(tabsInKnownProjects(tabs, undefined)).toEqual([]);
	});

	it('keeps order, since it is the order the tabs were dragged into', () => {
		const many = [
			{ sessionId: 'c', projectId: 'p2' },
			{ sessionId: 'a', projectId: 'p1' },
		];
		expect(tabsInKnownProjects(many, [{ id: 'p1' }, { id: 'p2' }]).map((t) => t.sessionId)).toEqual(
			['c', 'a'],
		);
	});
});
