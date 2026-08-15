import { sortProjects } from '@components/layout/Sidebar';
import { SIDEBAR_SESSION_LIMIT, orderSessions } from '@components/layout/SidebarProject';
import type { Project, SessionSummary } from '@factorai/types';
import type { LiveTerminal } from '@store/terminalStore';
import { describe, expect, it } from 'vitest';

function session(id: string, updatedAt: number): SessionSummary {
	return {
		id,
		projectId: 'p',
		title: id,
		createdAt: 0,
		updatedAt,
		turnCount: 1,
		cwd: '/p',
	};
}

function live(...ids: string[]): Record<string, LiveTerminal> {
	return Object.fromEntries(
		ids.map((id) => [id, { terminalId: `t-${id}`, projectId: 'p', status: 'running' as const }]),
	);
}

function project(id: string, displayName: string): Project {
	return {
		id,
		realPath: `/code/${displayName}`,
		displayName,
		lastSessionAt: 0,
		missing: false,
		sessionCount: 1,
		pinned: false,
	};
}

describe('orderSessions', () => {
	it('puts the most recently updated first', () => {
		const ordered = orderSessions([session('old', 100), session('new', 300)], {});

		expect(ordered.map((s) => s.id)).toEqual(['new', 'old']);
	});

	it('puts running sessions above everything, however stale', () => {
		// The whole point of the ordering: what an agent is doing right now
		// matters more than what you touched most recently.
		const ordered = orderSessions(
			[session('fresh', 900), session('running', 1), session('older', 500)],
			live('running'),
		);

		expect(ordered.map((s) => s.id)).toEqual(['running', 'fresh', 'older']);
	});

	it('orders several running sessions among themselves by recency', () => {
		const ordered = orderSessions(
			[session('a', 10), session('b', 20), session('c', 999)],
			live('a', 'b'),
		);

		expect(ordered.map((s) => s.id)).toEqual(['b', 'a', 'c']);
	});

	it('caps the list and keeps the top of it', () => {
		const many = Array.from({ length: 25 }, (_, i) => session(`s${i}`, i));

		const ordered = orderSessions(many, {});

		expect(ordered).toHaveLength(SIDEBAR_SESSION_LIMIT);
		expect(ordered[0]?.id).toBe('s24');
	});

	it('keeps a running session even when it would fall outside the cap', () => {
		const many = Array.from({ length: 25 }, (_, i) => session(`s${i}`, 100 + i));

		const ordered = orderSessions(many, live('s0'));

		expect(ordered[0]?.id).toBe('s0');
		expect(ordered).toHaveLength(SIDEBAR_SESSION_LIMIT);
	});

	it('does not mutate the array it was given', () => {
		const input = [session('a', 1), session('b', 2)];

		orderSessions(input, {});

		expect(input.map((s) => s.id)).toEqual(['a', 'b']);
	});
});

describe('sortProjects', () => {
	it('leaves recent order exactly as the backend returned it', () => {
		// `list_projects` already orders by last_session_at DESC; re-sorting
		// client-side would only risk disagreeing with the indexer.
		const projects = [project('1', 'zulu'), project('2', 'alpha')];

		expect(sortProjects(projects, 'recent').map((p) => p.displayName)).toEqual(['zulu', 'alpha']);
	});

	it('sorts by name case-insensitively', () => {
		const projects = [project('1', 'zulu'), project('2', 'Alpha'), project('3', 'mike')];

		expect(sortProjects(projects, 'name').map((p) => p.displayName)).toEqual([
			'Alpha',
			'mike',
			'zulu',
		]);
	});

	it('does not mutate the array it was given', () => {
		const projects = [project('1', 'zulu'), project('2', 'alpha')];

		sortProjects(projects, 'name');

		expect(projects.map((p) => p.displayName)).toEqual(['zulu', 'alpha']);
	});
});
