import { beforeEach, describe, expect, it } from 'vitest';
import { useShellStore } from '@store/shellStore';

const reset = () => useShellStore.setState({ bySession: {}, activeBySession: {} });
const keys = (sessionId: string) =>
	(useShellStore.getState().bySession[sessionId] ?? []).map((t) => t.key);
const active = (sessionId: string) => useShellStore.getState().activeBySession[sessionId] ?? null;

describe('open', () => {
	beforeEach(reset);

	it('appends and selects the new shell', () => {
		const first = useShellStore.getState().open('s1', 'p1', '/repo');
		const second = useShellStore.getState().open('s1', 'p1', '/repo');
		expect(keys('s1')).toEqual([first.key, second.key]);
		expect(active('s1')).toBe(second.key);
	});

	it('keys every shell distinctly, and never as a session id', () => {
		const a = useShellStore.getState().open('s1', 'p1', '/repo');
		const b = useShellStore.getState().open('s1', 'p1', '/repo');
		expect(a.key).not.toBe(b.key);
		// The xterm pool is one map for agents and shells, keyed by session id for
		// the first — so a shell key that could be a session id would collide with
		// the agent it is drawn under (ADR-0031).
		expect(a.key.startsWith('shell:')).toBe(true);
	});
});

describe('setActive', () => {
	beforeEach(reset);

	it('collapses to null and comes back', () => {
		const tab = useShellStore.getState().open('s1', 'p1', '/repo');
		useShellStore.getState().setActive('s1', null);
		expect(active('s1')).toBeNull();
		// Collapsing is not closing: the shell is still there to come back to.
		expect(keys('s1')).toEqual([tab.key]);
		useShellStore.getState().setActive('s1', tab.key);
		expect(active('s1')).toBe(tab.key);
	});
});

describe('setTitle', () => {
	beforeEach(reset);

	it('labels by terminal id, and ignores a PTY nothing owns', () => {
		const tab = useShellStore.getState().open('s1', 'p1', '/repo');
		useShellStore.getState().attach(tab.key, 'pty-1');
		useShellStore.getState().setTitle('pty-1', 'cargo test');
		useShellStore.getState().setTitle('pty-other', 'not ours');
		const [shell] = useShellStore.getState().bySession.s1 ?? [];
		expect(shell?.title).toBe('cargo test');
	});
});

describe('close', () => {
	beforeEach(reset);

	it('falls back to the last remaining chip, not to a collapsed pane', () => {
		const first = useShellStore.getState().open('s1', 'p1', '/repo');
		const second = useShellStore.getState().open('s1', 'p1', '/repo');
		useShellStore.getState().close(second.key);
		expect(keys('s1')).toEqual([first.key]);
		// A close is not a request to collapse: an empty pane under a strip that
		// still has chips reads as a broken one.
		expect(active('s1')).toBe(first.key);
	});

	it('collapses when the last chip goes', () => {
		const only = useShellStore.getState().open('s1', 'p1', '/repo');
		useShellStore.getState().close(only.key);
		expect(keys('s1')).toEqual([]);
		expect(active('s1')).toBeNull();
	});
});

describe('closeSession', () => {
	beforeEach(reset);

	it("drops one session's shells and leaves another's", () => {
		useShellStore.getState().open('s1', 'p1', '/repo');
		const theirs = useShellStore.getState().open('s2', 'p1', '/repo');
		useShellStore.getState().closeSession('s1');
		expect(useShellStore.getState().bySession.s1).toBeUndefined();
		expect(keys('s2')).toEqual([theirs.key]);
	});
});
