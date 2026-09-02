import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_PANES, migratePersisted, useShellStore } from '@store/shellStore';

const reset = () =>
	useShellStore.setState({ bySession: {}, activeBySession: {}, widthsByChip: {}, shellName: null });
const chips = (sessionId: string) => useShellStore.getState().bySession[sessionId] ?? [];
const keys = (sessionId: string) => chips(sessionId).map((c) => c.key);
const panes = (sessionId: string, chipKey: string) =>
	chips(sessionId).find((c) => c.key === chipKey)?.panes ?? [];
const active = (sessionId: string) => useShellStore.getState().activeBySession[sessionId] ?? null;

describe('open', () => {
	beforeEach(reset);

	it('appends a one-pane chip and selects it', () => {
		const first = useShellStore.getState().open('s1', 'p1', '/repo');
		const second = useShellStore.getState().open('s1', 'p1', '/repo');
		expect(keys('s1')).toEqual([first.key, second.key]);
		expect(active('s1')).toBe(second.key);
		expect(second.panes).toHaveLength(1);
		expect(second.focus).toBe(second.panes[0].key);
	});

	it('keys chips and panes in two spaces, and neither as a session id', () => {
		const chip = useShellStore.getState().open('s1', 'p1', '/repo');
		// The xterm pool is one map for agents and shells, keyed by session id for
		// the first — so a pane key that could be a session id would collide with
		// the agent it is drawn under (ADR-0031). And a chip is not a terminal at
		// all, so its key can never be mistaken for one the pool holds (F24).
		expect(chip.panes[0].key.startsWith('shell:')).toBe(true);
		expect(chip.key.startsWith('chip:')).toBe(true);
	});
});

describe('split', () => {
	beforeEach(reset);

	it('appends a pane, focuses it, and forgets the widths a drag had set', () => {
		const chip = useShellStore.getState().open('s1', 'p1', '/repo');
		useShellStore.getState().setWidths(chip.key, [1]);
		const pane = useShellStore.getState().split(chip.key, '/repo/worktree');
		expect(pane).not.toBeNull();
		const after = panes('s1', chip.key);
		expect(after.map((p) => p.key)).toEqual([chip.panes[0].key, pane?.key]);
		expect(after[1]?.cwd).toBe('/repo/worktree');
		expect(chips('s1')[0]?.focus).toBe(pane?.key);
		// The fractions were of one pane; there are two now.
		expect(useShellStore.getState().widthsByChip[chip.key]).toBeUndefined();
	});

	it(`stops at ${MAX_PANES}`, () => {
		const chip = useShellStore.getState().open('s1', 'p1', '/repo');
		for (let i = 1; i < MAX_PANES; i++) {
			expect(useShellStore.getState().split(chip.key, '/repo')).not.toBeNull();
		}
		expect(useShellStore.getState().split(chip.key, '/repo')).toBeNull();
		expect(panes('s1', chip.key)).toHaveLength(MAX_PANES);
	});

	it('answers null for a chip that does not exist', () => {
		expect(useShellStore.getState().split('chip:nope', '/repo')).toBeNull();
	});
});

describe('setActive', () => {
	beforeEach(reset);

	it('collapses to null and comes back', () => {
		const chip = useShellStore.getState().open('s1', 'p1', '/repo');
		useShellStore.getState().setActive('s1', null);
		expect(active('s1')).toBeNull();
		// Collapsing is not closing: the shell is still there to come back to.
		expect(keys('s1')).toEqual([chip.key]);
		useShellStore.getState().setActive('s1', chip.key);
		expect(active('s1')).toBe(chip.key);
	});
});

describe('setFocus', () => {
	beforeEach(reset);

	it('moves the caret between a chip’s own panes only', () => {
		const chip = useShellStore.getState().open('s1', 'p1', '/repo');
		const second = useShellStore.getState().split(chip.key, '/repo');
		useShellStore.getState().setFocus(chip.key, chip.panes[0].key);
		expect(chips('s1')[0]?.focus).toBe(chip.panes[0].key);
		// A pane of some other chip is not a place this chip's caret can be.
		useShellStore.getState().setFocus(chip.key, 'shell:elsewhere');
		expect(chips('s1')[0]?.focus).toBe(chip.panes[0].key);
		useShellStore.getState().setFocus(chip.key, second?.key ?? '');
		expect(chips('s1')[0]?.focus).toBe(second?.key);
	});
});

describe('shellName', () => {
	beforeEach(reset);

	it('is one value for every chip, not a field on any of them', () => {
		useShellStore.getState().setShellName('fish');
		const chip = useShellStore.getState().open('s1', 'p1', '/repo');
		expect(useShellStore.getState().shellName).toBe('fish');
		// The label is not on the chip: a chip has places and processes, and its
		// name is the shell's, which is the same for all of them (F24).
		expect('title' in chip).toBe(false);
	});
});

describe('closePane', () => {
	beforeEach(reset);

	it('hands focus to the pane on the left, or the first, and resets the widths', () => {
		const chip = useShellStore.getState().open('s1', 'p1', '/repo');
		const [a] = chip.panes;
		const b = useShellStore.getState().split(chip.key, '/repo');
		const c = useShellStore.getState().split(chip.key, '/repo');
		useShellStore.getState().setWidths(chip.key, [0.2, 0.3, 0.5]);

		// Closing the focused rightmost pane: focus goes left.
		useShellStore.getState().closePane(c?.key ?? '');
		expect(panes('s1', chip.key).map((p) => p.key)).toEqual([a.key, b?.key]);
		expect(chips('s1')[0]?.focus).toBe(b?.key);
		expect(useShellStore.getState().widthsByChip[chip.key]).toBeUndefined();

		// Closing the first pane while it is focused: focus goes to the new first.
		useShellStore.getState().setFocus(chip.key, a.key);
		useShellStore.getState().closePane(a.key);
		expect(panes('s1', chip.key).map((p) => p.key)).toEqual([b?.key]);
		expect(chips('s1')[0]?.focus).toBe(b?.key);
	});

	it('closing a pane that was not focused leaves the caret where it was', () => {
		const chip = useShellStore.getState().open('s1', 'p1', '/repo');
		const [a] = chip.panes;
		const b = useShellStore.getState().split(chip.key, '/repo');
		useShellStore.getState().closePane(a.key);
		expect(chips('s1')[0]?.focus).toBe(b?.key);
	});

	it('takes the chip with it when the pane was the last', () => {
		const chip = useShellStore.getState().open('s1', 'p1', '/repo');
		useShellStore.getState().closePane(chip.panes[0].key);
		expect(keys('s1')).toEqual([]);
		expect(active('s1')).toBeNull();
	});
});

describe('close', () => {
	beforeEach(reset);

	it('falls back to the last remaining chip, not to a collapsed row', () => {
		const first = useShellStore.getState().open('s1', 'p1', '/repo');
		const second = useShellStore.getState().open('s1', 'p1', '/repo');
		useShellStore.getState().setWidths(second.key, [1]);
		useShellStore.getState().close(second.key);
		expect(keys('s1')).toEqual([first.key]);
		// A close is not a request to collapse: an empty row under a strip that
		// still has chips reads as a broken one.
		expect(active('s1')).toBe(first.key);
		expect(useShellStore.getState().widthsByChip[second.key]).toBeUndefined();
	});

	it('collapses when the last chip goes', () => {
		const only = useShellStore.getState().open('s1', 'p1', '/repo');
		useShellStore.getState().close(only.key);
		expect(keys('s1')).toEqual([]);
		expect(active('s1')).toBeNull();
	});
});

describe('the two ways a shell dies', () => {
	beforeEach(reset);

	it('removes the pane when the shell ended itself, and the chip when it was alone', () => {
		const chip = useShellStore.getState().open('s1', 'p1', '/repo');
		const b = useShellStore.getState().split(chip.key, '/repo');
		useShellStore.getState().attach(chip.panes[0].key, 'pty-1');
		useShellStore.getState().attach(b?.key ?? '', 'pty-2');
		useShellStore.getState().closeByTerminal('pty-2');
		expect(panes('s1', chip.key).map((p) => p.key)).toEqual([chip.panes[0].key]);
		useShellStore.getState().closeByTerminal('pty-1');
		expect(keys('s1')).toEqual([]);
	});

	it('keeps the pane, dead and holding its cwd, when we killed it', () => {
		const chip = useShellStore.getState().open('s1', 'p1', '/repo');
		useShellStore.getState().attach(chip.panes[0].key, 'pty-1');
		useShellStore.getState().markDead('pty-1');
		const [pane] = panes('s1', chip.key);
		expect(pane?.dead).toBe(true);
		expect(pane?.terminalId).toBeNull();
		// The cwd is the whole point of keeping it.
		expect(pane?.cwd).toBe('/repo');
	});

	it('comes back to life on a respawn', () => {
		const chip = useShellStore.getState().open('s1', 'p1', '/repo');
		useShellStore.getState().attach(chip.panes[0].key, 'pty-1');
		useShellStore.getState().markDead('pty-1');
		useShellStore.getState().attach(chip.panes[0].key, 'pty-2');
		const [pane] = panes('s1', chip.key);
		expect(pane?.dead).toBe(false);
		expect(pane?.terminalId).toBe('pty-2');
	});

	it("ignores an agent's exit, which arrives on the same event", () => {
		const chip = useShellStore.getState().open('s1', 'p1', '/repo');
		useShellStore.getState().attach(chip.panes[0].key, 'pty-1');
		useShellStore.getState().closeByTerminal('pty-belonging-to-an-agent');
		expect(keys('s1')).toEqual([chip.key]);
	});
});

describe('closeSession', () => {
	beforeEach(reset);

	it('drops every chip of that session, its selection and its widths, and nothing of another', () => {
		const gone = useShellStore.getState().open('s1', 'p1', '/repo');
		useShellStore.getState().setWidths(gone.key, [1]);
		const kept = useShellStore.getState().open('s2', 'p1', '/repo');
		useShellStore.getState().closeSession('s1');
		expect(useShellStore.getState().bySession.s1).toBeUndefined();
		expect(useShellStore.getState().activeBySession.s1).toBeUndefined();
		expect(useShellStore.getState().widthsByChip[gone.key]).toBeUndefined();
		expect(keys('s2')).toEqual([kept.key]);
		expect(active('s2')).toBe(kept.key);
	});
});

describe('widths', () => {
	beforeEach(reset);

	it('are remembered per chip until equalised', () => {
		const chip = useShellStore.getState().open('s1', 'p1', '/repo');
		useShellStore.getState().setWidths(chip.key, [0.3, 0.7]);
		expect(useShellStore.getState().widthsByChip[chip.key]).toEqual([0.3, 0.7]);
		useShellStore.getState().equalize(chip.key);
		expect(useShellStore.getState().widthsByChip[chip.key]).toBeUndefined();
	});
});

describe('migratePersisted', () => {
	it('turns a version-1 shell into a one-pane chip that keeps its pane key and cwd', () => {
		const v1 = {
			bySession: {
				s1: [
					{
						key: 'shell:old',
						sessionId: 's1',
						projectId: 'p1',
						cwd: '/repo',
						terminalId: null,
						title: 'cargo test',
						dead: true,
					},
				],
			},
		};
		const out = migratePersisted(v1, 1);
		const [chip] = out.bySession.s1 ?? [];
		expect(chip?.key.startsWith('chip:')).toBe(true);
		expect(chip?.sessionId).toBe('s1');
		expect(chip?.projectId).toBe('p1');
		// The pool was keyed by the old key, and the cwd is what a dead chip
		// was keeping. The title is not carried: nothing reads it any more.
		expect(chip?.panes).toEqual([{ key: 'shell:old', cwd: '/repo', terminalId: null, dead: true }]);
		expect(chip?.focus).toBe('shell:old');
		expect(chip && 'title' in chip).toBe(false);
		expect(out.shellName).toBeNull();
	});

	it('drops what does not look like a shell rather than guessing', () => {
		const out = migratePersisted({ bySession: { s1: [{ key: 'shell:x' }, 42], s2: 'nope' } }, 1);
		expect(out.bySession.s1).toEqual([]);
		expect(out.bySession.s2).toBeUndefined();
		expect(migratePersisted(undefined, 1)).toEqual({ shellName: null, bySession: {} });
	});

	it('passes a current store through, name included', () => {
		const current = { shellName: 'zsh', bySession: { s1: [] } };
		expect(migratePersisted(current, 2)).toEqual(current);
	});
});
