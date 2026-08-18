import type { TerminalStatusDto } from '@factorai/types';
import { useTerminalStore } from '@store/terminalStore';
import { beforeEach, describe, expect, it } from 'vitest';

function dto(sessionId: string, over: Partial<TerminalStatusDto> = {}): TerminalStatusDto {
	return {
		id: `pty-${sessionId}`,
		sessionId,
		projectId: 'p1',
		status: 'waiting_input',
		lastActivity: 0,
		...over,
	};
}

const reset = () => useTerminalStore.setState({ bySession: {}, tabs: [], restartEpoch: {} });
const ids = () => useTerminalStore.getState().tabs.map((t) => t.sessionId);

describe('adoptLive', () => {
	beforeEach(reset);

	it('rebuilds the strip from the PTYs Rust is already running', () => {
		useTerminalStore.getState().adoptLive([dto('a'), dto('b')]);

		const s = useTerminalStore.getState();
		expect(ids()).toEqual(['a', 'b']);
		expect(s.bySession.a).toEqual({
			terminalId: 'pty-a',
			projectId: 'p1',
			status: 'waiting_input',
		});
	});

	it('keeps the real status rather than assuming working, unlike attach', () => {
		// `attach` is a spawn we just made, so `working` is a fair guess. These
		// are processes of unknown age and the backend already knows what they
		// are doing (F10) — guessing here would flash a green dot on a session
		// that has been waiting for you since before the reload.
		useTerminalStore.getState().adoptLive([dto('a', { status: 'stopped' })]);
		expect(useTerminalStore.getState().bySession.a.status).toBe('stopped');
	});

	it('merges rather than replacing, so a spawn racing the call survives', () => {
		// `terminal_list` is async and a Terminal can mount while it is in flight.
		useTerminalStore.getState().attach('new', 'pty-new', 'p2');
		useTerminalStore.getState().adoptLive([dto('old')]);

		expect(Object.keys(useTerminalStore.getState().bySession).sort()).toEqual(['new', 'old']);
		expect(ids()).toEqual(['new', 'old']);
	});

	it('is idempotent, because StrictMode invokes the effect twice', () => {
		useTerminalStore.getState().adoptLive([dto('a'), dto('b')]);
		useTerminalStore.getState().adoptLive([dto('a'), dto('b')]);
		expect(ids()).toEqual(['a', 'b']);
	});

	it('adopts a PTY onto the tab a previous run left behind, in place', () => {
		// The reload case: the tabs rehydrate from localStorage in their dragged
		// order, and the live list arrives after. Adopting must not append a
		// second entry or move the first.
		useTerminalStore.setState({ tabs: [{ sessionId: 'b', projectId: 'p1' }, ...[]] });
		useTerminalStore.getState().adoptLive([dto('a'), dto('b')]);
		expect(ids()).toEqual(['b', 'a']);
	});
});

describe('a tab goes when you close it, and only then (F16)', () => {
	beforeEach(reset);

	it('keeps the tab when the process exits on its own', () => {
		useTerminalStore.getState().attach('a', 'pty-a', 'p1');
		useTerminalStore.getState().removeByTerminal('pty-a');

		// The PTY is gone; the tab is not. It is stopped, and clicking it restarts.
		expect(useTerminalStore.getState().bySession.a).toBeUndefined();
		expect(ids()).toEqual(['a']);
	});

	it('removes the tab when the session is closed', () => {
		useTerminalStore.getState().attach('a', 'pty-a', 'p1');
		useTerminalStore.getState().detach('a');

		expect(useTerminalStore.getState().bySession.a).toBeUndefined();
		expect(ids()).toEqual([]);
	});

	it('closes a stopped tab, which has no live terminal to key off', () => {
		// The path that matters for a restored tab: `detach` used to bail out
		// early when `bySession` had no entry, which would leave the × inert on
		// every tab restored from a previous run.
		useTerminalStore.setState({ tabs: [{ sessionId: 'a', projectId: 'p1' }] });
		useTerminalStore.getState().detach('a');
		expect(ids()).toEqual([]);
	});

	it('drops every tab of a project that has been removed', () => {
		useTerminalStore.getState().attach('a', 'pty-a', 'p1');
		useTerminalStore.getState().attach('b', 'pty-b', 'p2');
		useTerminalStore.getState().closeProject('p1');

		expect(ids()).toEqual(['b']);
	});
});

describe('reorder', () => {
	beforeEach(reset);

	it('lifts a tab out and inserts it at the index dropped on', () => {
		for (const id of ['a', 'b', 'c']) useTerminalStore.getState().attach(id, `pty-${id}`, 'p1');
		useTerminalStore.getState().reorder('c', 0);
		expect(ids()).toEqual(['c', 'a', 'b']);
	});

	it('ignores a session with no tab', () => {
		useTerminalStore.getState().attach('a', 'pty-a', 'p1');
		useTerminalStore.getState().reorder('ghost', 0);
		expect(ids()).toEqual(['a']);
	});

	it('clamps an index past either end rather than dropping the tab', () => {
		for (const id of ['a', 'b']) useTerminalStore.getState().attach(id, `pty-${id}`, 'p1');
		useTerminalStore.getState().reorder('a', 99);
		expect(ids()).toEqual(['b', 'a']);
	});
});

describe('restartEpoch', () => {
	beforeEach(reset);

	it('bumps per session, so one restart does not remount the others', () => {
		useTerminalStore.getState().requestRestart('a');
		useTerminalStore.getState().requestRestart('a');

		expect(useTerminalStore.getState().restartEpoch).toEqual({ a: 2 });
	});
});
