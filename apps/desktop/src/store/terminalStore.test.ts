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
		kind: 'agent',
		cwd: '/tmp',
		...over,
	};
}

const reset = () => useTerminalStore.setState({ bySession: {}, tabs: [], restartEpoch: {} });
const ids = () => useTerminalStore.getState().tabs.map((t) => t.sessionId);

describe('adoptLive', () => {
	beforeEach(reset);

	it("skips a shell, which shares its footer session's id (F23)", () => {
		useTerminalStore
			.getState()
			.adoptLive([dto('s1'), dto('s1', { id: 'pty-shell', kind: 'shell' })]);
		// Not "the shell is absent" — the point is that the *agent's* PTY is
		// still the one this session writes to and kills.
		expect(useTerminalStore.getState().bySession.s1?.terminalId).toBe('pty-s1');
	});

	it('colours the strip from the PTYs Rust is already running, and opens no tabs', () => {
		// **Changed by F22.** Adopting used to open a tab per live PTY, on the
		// reasoning that a live session was by definition an open one. A routine's
		// session is live and deliberately tabless (ADR-0026), and this runs on
		// every reload — so adopting one would hand it a tab nobody asked for.
		// The tabs themselves are persisted and come back on their own.
		useTerminalStore.getState().adoptLive([dto('a'), dto('b')]);

		const s = useTerminalStore.getState();
		expect(ids()).toEqual([]);
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
		// The spawn's own tab stays; adopting adds none of its own.
		expect(ids()).toEqual(['new']);
	});

	it('is idempotent, because StrictMode invokes the effect twice', () => {
		useTerminalStore.getState().adoptLive([dto('a'), dto('b')]);
		useTerminalStore.getState().adoptLive([dto('a'), dto('b')]);
		expect(Object.keys(useTerminalStore.getState().bySession).sort()).toEqual(['a', 'b']);
		expect(ids()).toEqual([]);
	});

	it('adopts a PTY onto the tab a previous run left behind, in place', () => {
		// The reload case: the tabs rehydrate from localStorage in their dragged
		// order, and the live list arrives after. Adopting must not append a
		// second entry or move the first — and, since F22, must not add one for
		// the live session that has no tab, which is what a routine's looks like.
		useTerminalStore.setState({ tabs: [{ sessionId: 'b', projectId: 'p1' }, ...[]] });
		useTerminalStore.getState().adoptLive([dto('a'), dto('b')]);
		expect(ids()).toEqual(['b']);
		expect(useTerminalStore.getState().bySession.a.terminalId).toBe('pty-a');
	});
});

describe('a routine session runs without a tab (F22)', () => {
	beforeEach(reset);

	it('attaches the PTY and opens no tab', () => {
		useTerminalStore.getState().attach('r1', 'pty-r1', 'p1', { openTab: false });
		expect(useTerminalStore.getState().bySession.r1.terminalId).toBe('pty-r1');
		expect(ids()).toEqual([]);
	});

	it('records which routine started it, for the origin icon', () => {
		useTerminalStore.getState().setRoutineOrigin('r1', 'routine-1', 'Nightly triage', 1000);
		expect(useTerminalStore.getState().routineBySession.r1).toEqual({
			routineId: 'routine-1',
			routineName: 'Nightly triage',
			startedAt: 1000,
		});
		// Repeating the same origin is a no-op, so a re-emitted fire costs no
		// render in the three lists that read this.
		const before = useTerminalStore.getState().routineBySession;
		useTerminalStore.getState().setRoutineOrigin('r1', 'routine-1', 'Nightly triage', 2000);
		expect(useTerminalStore.getState().routineBySession).toBe(before);
	});
});

describe('opening a tabless session puts it on the strip (F22)', () => {
	beforeEach(reset);

	it('adds the tab, and adding it twice does not move it', () => {
		useTerminalStore.getState().attach('r1', 'pty-r1', 'p1', { openTab: false });
		useTerminalStore.getState().attach('b', 'pty-b', 'p1');
		expect(ids()).toEqual(['b']);

		// Looking at the routine's session is what opens it.
		useTerminalStore.getState().openTab('r1', 'p1');
		expect(ids()).toEqual(['b', 'r1']);

		// Idempotent: re-mounting the route must not move a tab you dragged.
		useTerminalStore.getState().openTab('b', 'p1');
		expect(ids()).toEqual(['b', 'r1']);
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
