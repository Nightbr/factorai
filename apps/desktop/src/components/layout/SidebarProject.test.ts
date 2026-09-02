import {
	SIDEBAR_SESSION_LIMIT,
	countHidden,
	countSubagents,
	orderSessions,
} from '@components/layout/SidebarProject';
import type { SessionSummary } from '@factorai/types';
import type { LiveTerminal } from '@store/terminalStore';
import { describe, expect, it } from 'vitest';

function session(
	id: string,
	updatedAt: number,
	subagentOf: string | null = null,
	pinned = false,
): SessionSummary {
	return {
		id,
		projectId: 'p',
		title: id,
		createdAt: 0,
		updatedAt,
		turnCount: 1,
		cwd: '/p',
		subagentOf,
		worktree: null,
		lastCwd: null,
		touchedPaths: [],
		routineId: null,
		routineName: null,
		routineStartedAt: null,
		pinned,
	};
}

function live(...ids: string[]): Record<string, LiveTerminal> {
	return Object.fromEntries(
		ids.map((id) => [id, { terminalId: `t-${id}`, projectId: 'p', status: 'working' as const }]),
	);
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

	it('floats an open session that is not running, alongside the running ones', () => {
		// F16: what you have on the strip clusters at the top of its project,
		// whether or not it is mid-task. `orderSessions` takes the open record
		// now, so a stopped tab floats exactly as a working one does.
		const ordered = orderSessions([session('fresh', 900), session('stopped', 1)], {
			stopped: { projectId: 'p', status: 'stopped' },
		});

		expect(ordered.map((s) => s.id)).toEqual(['stopped', 'fresh']);
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

	it('leaves sub-agents out — they are part of the session that spawned them', () => {
		// The sidebar's slots are for sessions you can go back into; an agent
		// transcript is readable but not resumable, and the project page nests
		// it under its parent.
		const ordered = orderSessions(
			[session('parent', 100), session('agent-1', 900, 'parent'), session('top', 50)],
			{},
		);

		expect(ordered.map((s) => s.id)).toEqual(['parent', 'top']);
	});

	it('puts a pinned session above everything, running sessions included', () => {
		// The pin is the outermost key: it says "exempt this row from recency",
		// and a live session that displaced it would take the top slot away
		// exactly when the project is busy.
		const ordered = orderSessions(
			[session('fresh', 900), session('running', 5), session('bookmark', 1, null, true)],
			live('running'),
		);

		expect(ordered.map((s) => s.id)).toEqual(['bookmark', 'running', 'fresh']);
	});

	it('orders several pinned sessions among themselves by recency', () => {
		// One ordering rule for the whole list: the pin decides which side of the
		// divider a row is on, not how the rows inside a block sort.
		const ordered = orderSessions(
			[
				session('newer-pin', 500, null, true),
				session('older-pin', 100, null, true),
				session('unpinned', 900),
			],
			{},
		);

		expect(ordered.map((s) => s.id)).toEqual(['newer-pin', 'older-pin', 'unpinned']);
	});

	it('never drops a pinned session to honour the cap', () => {
		// A pin you can be pushed out of view by is not a pin, so the limit caps
		// the unpinned remainder. Twelve pins in a ten-slot list show twelve rows
		// — the user's own doing, and visible.
		const many = [
			...Array.from({ length: 25 }, (_, i) => session(`s${i}`, 1000 + i)),
			...Array.from({ length: 12 }, (_, i) => session(`pin-${i}`, i, null, true)),
		];

		const ordered = orderSessions(many, {});

		expect(ordered).toHaveLength(12);
		expect(ordered.every((s) => s.pinned)).toBe(true);
	});

	it('gives the unpinned rows the slots the pins did not take', () => {
		const many = [
			...Array.from({ length: 25 }, (_, i) => session(`s${i}`, 1000 + i)),
			session('bookmark', 1, null, true),
		];

		const ordered = orderSessions(many, {});

		expect(ordered).toHaveLength(SIDEBAR_SESSION_LIMIT);
		expect(ordered[0]?.id).toBe('bookmark');
		expect(ordered[1]?.id).toBe('s24');
	});

	it('does not let sub-agents crowd the cap either', () => {
		// Nine real sessions plus twenty agents: the ten slots stay real
		// sessions, not a wall of agent rows.
		const many = [
			...Array.from({ length: 9 }, (_, i) => session(`s${i}`, i)),
			...Array.from({ length: 20 }, (_, i) => session(`agent-${i}`, 900 + i, 's8')),
		];

		const ordered = orderSessions(many, {});

		expect(ordered).toHaveLength(9);
		expect(ordered.every((s) => s.subagentOf === null)).toBe(true);
	});
});

describe('countSubagents', () => {
	it("counts each parent's agents and leaves top-level sessions out", () => {
		const counts = countSubagents([
			session('parent', 300),
			session('agent-1', 250, 'parent'),
			session('agent-2', 240, 'parent'),
			session('lonely', 200),
		]);

		expect(counts).toEqual({ parent: 2 });
	});

	it('reports nothing for a list with no sub-agents', () => {
		// The ordinary case, and the one the dialog must not put a sentence in
		// for: `?? 0` at the call site plus this is what keeps "0 sub-agent
		// transcripts go with it" off the screen.
		expect(countSubagents([session('a', 100), session('b', 200)])).toEqual({});
	});

	it('counts an orphan against the parent it names', () => {
		// The parent's transcript is gone but the agent row survives with its
		// marking (F2). Deleting the parent is not on offer — it is not in the
		// list — and nothing here should pretend otherwise by dropping the count.
		expect(countSubagents([session('agent-1', 100, 'deleted-parent')])).toEqual({
			'deleted-parent': 1,
		});
	});
});

describe('countHidden', () => {
	it('counts the top-level sessions the cap left out', () => {
		const many = Array.from({ length: SIDEBAR_SESSION_LIMIT + 3 }, (_, i) => session(`s${i}`, i));

		const shown = orderSessions(many, {});

		expect(countHidden(many, shown.length)).toBe(3);
	});

	it('does not count sub-agents as hidden rows', () => {
		// Four sessions and one sub-agent fit the cap with room to spare. The
		// sidebar said "1 more…" here, and the link led to a page listing the
		// same four — the agent only appears nested under its parent.
		const few = [
			session('a', 1),
			session('b', 2),
			session('c', 3),
			session('d', 4, null, true),
			session('agent-1', 5, 'a'),
		];

		const shown = orderSessions(few, {});

		expect(shown).toHaveLength(4);
		expect(countHidden(few, shown.length)).toBe(0);
	});

	it('leaves sub-agents out of the count even when real sessions overflow', () => {
		const many = [
			...Array.from({ length: SIDEBAR_SESSION_LIMIT + 2 }, (_, i) => session(`s${i}`, i)),
			...Array.from({ length: 5 }, (_, i) => session(`agent-${i}`, 900 + i, 's0')),
		];

		const shown = orderSessions(many, {});

		expect(countHidden(many, shown.length)).toBe(2);
	});
});
