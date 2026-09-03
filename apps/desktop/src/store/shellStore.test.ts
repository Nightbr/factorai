import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_PANES, migratePersisted, useShellStore } from '@store/shellStore';

const reset = () =>
	useShellStore.setState({ byProject: {}, activeByProject: {}, widthsByChip: {}, shellName: null });
const chips = (projectId: string) => useShellStore.getState().byProject[projectId] ?? [];
const keys = (projectId: string) => chips(projectId).map((c) => c.key);
const panes = (projectId: string, chipKey: string) =>
	chips(projectId).find((c) => c.key === chipKey)?.panes ?? [];
const active = (projectId: string) => useShellStore.getState().activeByProject[projectId] ?? null;

describe('open', () => {
	beforeEach(reset);

	it('appends a one-pane chip and selects it', () => {
		const first = useShellStore.getState().open('p1', '/repo');
		const second = useShellStore.getState().open('p1', '/repo');
		expect(keys('p1')).toEqual([first.key, second.key]);
		expect(active('p1')).toBe(second.key);
		expect(second.panes).toHaveLength(1);
		expect(second.focus).toBe(second.panes[0].key);
	});

	it('keys chips and panes in two spaces, and neither as a session id', () => {
		const chip = useShellStore.getState().open('p1', '/repo');
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
		const chip = useShellStore.getState().open('p1', '/repo');
		useShellStore.getState().setWidths(chip.key, [1]);
		const pane = useShellStore.getState().split(chip.key, '/repo/worktree');
		expect(pane).not.toBeNull();
		const after = panes('p1', chip.key);
		expect(after.map((p) => p.key)).toEqual([chip.panes[0].key, pane?.key]);
		expect(after[1]?.cwd).toBe('/repo/worktree');
		expect(chips('p1')[0]?.focus).toBe(pane?.key);
		// The fractions were of one pane; there are two now.
		expect(useShellStore.getState().widthsByChip[chip.key]).toBeUndefined();
	});

	it(`stops at ${MAX_PANES}`, () => {
		const chip = useShellStore.getState().open('p1', '/repo');
		for (let i = 1; i < MAX_PANES; i++) {
			expect(useShellStore.getState().split(chip.key, '/repo')).not.toBeNull();
		}
		expect(useShellStore.getState().split(chip.key, '/repo')).toBeNull();
		expect(panes('p1', chip.key)).toHaveLength(MAX_PANES);
	});

	it('answers null for a chip that does not exist', () => {
		expect(useShellStore.getState().split('chip:nope', '/repo')).toBeNull();
	});
});

describe('setActive', () => {
	beforeEach(reset);

	it('collapses to null and comes back', () => {
		const chip = useShellStore.getState().open('p1', '/repo');
		useShellStore.getState().setActive('p1', null);
		expect(active('p1')).toBeNull();
		// Collapsing is not closing: the shell is still there to come back to.
		expect(keys('p1')).toEqual([chip.key]);
		useShellStore.getState().setActive('p1', chip.key);
		expect(active('p1')).toBe(chip.key);
	});
});

describe('setFocus', () => {
	beforeEach(reset);

	it('moves the caret between a chip’s own panes only', () => {
		const chip = useShellStore.getState().open('p1', '/repo');
		const second = useShellStore.getState().split(chip.key, '/repo');
		useShellStore.getState().setFocus(chip.key, chip.panes[0].key);
		expect(chips('p1')[0]?.focus).toBe(chip.panes[0].key);
		// A pane of some other chip is not a place this chip's caret can be.
		useShellStore.getState().setFocus(chip.key, 'shell:elsewhere');
		expect(chips('p1')[0]?.focus).toBe(chip.panes[0].key);
		useShellStore.getState().setFocus(chip.key, second?.key ?? '');
		expect(chips('p1')[0]?.focus).toBe(second?.key);
	});
});

describe('shellName', () => {
	beforeEach(reset);

	it('is one value for every chip, not a field on any of them', () => {
		useShellStore.getState().setShellName('fish');
		const chip = useShellStore.getState().open('p1', '/repo');
		expect(useShellStore.getState().shellName).toBe('fish');
		// The label is not on the chip: a chip has places and processes, and its
		// name is the shell's, which is the same for all of them (F24).
		expect('title' in chip).toBe(false);
	});
});

describe('closePane', () => {
	beforeEach(reset);

	it('hands focus to the pane on the left, or the first, and resets the widths', () => {
		const chip = useShellStore.getState().open('p1', '/repo');
		const [a] = chip.panes;
		const b = useShellStore.getState().split(chip.key, '/repo');
		const c = useShellStore.getState().split(chip.key, '/repo');
		useShellStore.getState().setWidths(chip.key, [0.2, 0.3, 0.5]);

		// Closing the focused rightmost pane: focus goes left.
		useShellStore.getState().closePane(c?.key ?? '');
		expect(panes('p1', chip.key).map((p) => p.key)).toEqual([a.key, b?.key]);
		expect(chips('p1')[0]?.focus).toBe(b?.key);
		expect(useShellStore.getState().widthsByChip[chip.key]).toBeUndefined();

		// Closing the first pane while it is focused: focus goes to the new first.
		useShellStore.getState().setFocus(chip.key, a.key);
		useShellStore.getState().closePane(a.key);
		expect(panes('p1', chip.key).map((p) => p.key)).toEqual([b?.key]);
		expect(chips('p1')[0]?.focus).toBe(b?.key);
	});

	it('closing a pane that was not focused leaves the caret where it was', () => {
		const chip = useShellStore.getState().open('p1', '/repo');
		const [a] = chip.panes;
		const b = useShellStore.getState().split(chip.key, '/repo');
		useShellStore.getState().closePane(a.key);
		expect(chips('p1')[0]?.focus).toBe(b?.key);
	});

	it('takes the chip with it when the pane was the last', () => {
		const chip = useShellStore.getState().open('p1', '/repo');
		useShellStore.getState().closePane(chip.panes[0].key);
		expect(keys('p1')).toEqual([]);
		expect(active('p1')).toBeNull();
	});
});

describe('close', () => {
	beforeEach(reset);

	it('falls back to the last remaining chip, not to a collapsed row', () => {
		const first = useShellStore.getState().open('p1', '/repo');
		const second = useShellStore.getState().open('p1', '/repo');
		useShellStore.getState().setWidths(second.key, [1]);
		useShellStore.getState().close(second.key);
		expect(keys('p1')).toEqual([first.key]);
		// A close is not a request to collapse: an empty row under a strip that
		// still has chips reads as a broken one.
		expect(active('p1')).toBe(first.key);
		expect(useShellStore.getState().widthsByChip[second.key]).toBeUndefined();
	});

	it('collapses when the last chip goes', () => {
		const only = useShellStore.getState().open('p1', '/repo');
		useShellStore.getState().close(only.key);
		expect(keys('p1')).toEqual([]);
		expect(active('p1')).toBeNull();
	});
});

describe('the two ways a shell dies', () => {
	beforeEach(reset);

	it('removes the pane when the shell ended itself, and the chip when it was alone', () => {
		const chip = useShellStore.getState().open('p1', '/repo');
		const b = useShellStore.getState().split(chip.key, '/repo');
		useShellStore.getState().attach(chip.panes[0].key, 'pty-1');
		useShellStore.getState().attach(b?.key ?? '', 'pty-2');
		useShellStore.getState().closeByTerminal('pty-2');
		expect(panes('p1', chip.key).map((p) => p.key)).toEqual([chip.panes[0].key]);
		useShellStore.getState().closeByTerminal('pty-1');
		expect(keys('p1')).toEqual([]);
	});

	it('keeps the pane, dead and holding its cwd, when we killed it', () => {
		const chip = useShellStore.getState().open('p1', '/repo');
		useShellStore.getState().attach(chip.panes[0].key, 'pty-1');
		useShellStore.getState().markDead('pty-1');
		const [pane] = panes('p1', chip.key);
		expect(pane?.dead).toBe(true);
		expect(pane?.terminalId).toBeNull();
		// The cwd is the whole point of keeping it.
		expect(pane?.cwd).toBe('/repo');
	});

	it('comes back to life on a respawn', () => {
		const chip = useShellStore.getState().open('p1', '/repo');
		useShellStore.getState().attach(chip.panes[0].key, 'pty-1');
		useShellStore.getState().markDead('pty-1');
		useShellStore.getState().attach(chip.panes[0].key, 'pty-2');
		const [pane] = panes('p1', chip.key);
		expect(pane?.dead).toBe(false);
		expect(pane?.terminalId).toBe('pty-2');
	});

	it("ignores an agent's exit, which arrives on the same event", () => {
		const chip = useShellStore.getState().open('p1', '/repo');
		useShellStore.getState().attach(chip.panes[0].key, 'pty-1');
		useShellStore.getState().closeByTerminal('pty-belonging-to-an-agent');
		expect(keys('p1')).toEqual([chip.key]);
	});
});

describe('closeProject', () => {
	beforeEach(reset);

	it('drops every chip of that project, its selection and its widths, and nothing of another', () => {
		const gone = useShellStore.getState().open('p1', '/repo');
		useShellStore.getState().setWidths(gone.key, [1]);
		const kept = useShellStore.getState().open('p2', '/other');
		useShellStore.getState().closeProject('p1');
		expect(useShellStore.getState().byProject.p1).toBeUndefined();
		expect(useShellStore.getState().activeByProject.p1).toBeUndefined();
		expect(useShellStore.getState().widthsByChip[gone.key]).toBeUndefined();
		expect(keys('p2')).toEqual([kept.key]);
		expect(active('p2')).toBe(kept.key);
	});
});

describe('adoptLive', () => {
	beforeEach(reset);

	it('re-binds the panes whose PTYs are still running, and leaves the rest alone', () => {
		// A renderer reload keeps every PTY alive and throws this store away, so
		// the chips come back from `persist` dead while their shells are running.
		// Rust hands each shell's pane key back as `clientKey` (ADR-0032); without
		// this the chip read dead and a click spawned a *second* shell beside the
		// one already there, which then ran on unreachable until the app quit.
		const chip = useShellStore.getState().open('p1', '/repo');
		const second = useShellStore.getState().split(chip.key, '/repo/worktree');
		useShellStore.setState({
			byProject: mapDead(useShellStore.getState().byProject),
		});

		useShellStore.getState().adoptLive([
			{
				id: 'pty-live',
				sessionId: null,
				projectId: 'p1',
				status: 'working',
				lastActivity: 0,
				kind: 'shell',
				clientKey: chip.panes[0].key,
				cwd: '/repo',
			},
			// An agent's row carries no pane key, so it matches nothing here.
			{
				id: 'pty-agent',
				sessionId: 's1',
				projectId: 'p1',
				status: 'working',
				lastActivity: 0,
				kind: 'agent',
				clientKey: null,
				cwd: '/repo',
			},
		]);

		const [first, rest] = panes('p1', chip.key);
		expect(first?.terminalId).toBe('pty-live');
		expect(first?.dead).toBe(false);
		// The second pane's shell really is gone — Rust did not report it — so it
		// stays dead and respawns on a click.
		expect(rest?.key).toBe(second?.key);
		expect(rest?.dead).toBe(true);
		expect(rest?.terminalId).toBeNull();
	});
});

/** What `persist` writes on the way out: every pane dead, no terminal ids. */
function mapDead(byProject: ReturnType<typeof useShellStore.getState>['byProject']) {
	return Object.fromEntries(
		Object.entries(byProject).map(([projectId, chips]) => [
			projectId,
			chips.map((c) => ({
				...c,
				panes: c.panes.map((pane) => ({ ...pane, terminalId: null, dead: true })),
			})),
		]),
	);
}

describe('widths', () => {
	beforeEach(reset);

	it('are remembered per chip until equalised', () => {
		const chip = useShellStore.getState().open('p1', '/repo');
		useShellStore.getState().setWidths(chip.key, [0.3, 0.7]);
		expect(useShellStore.getState().widthsByChip[chip.key]).toEqual([0.3, 0.7]);
		useShellStore.getState().equalize(chip.key);
		expect(useShellStore.getState().widthsByChip[chip.key]).toBeUndefined();
	});
});

describe('migratePersisted', () => {
	it('turns a version-1 shell into a one-pane chip under its project', () => {
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
		const [chip] = out.byProject.p1 ?? [];
		expect(chip?.key.startsWith('chip:')).toBe(true);
		expect(chip?.projectId).toBe('p1');
		// The pool was keyed by the old key, and the cwd is what a dead chip
		// was keeping. The title is not carried: nothing reads it any more, and
		// neither is the session id: a chip belongs to a project (ADR-0032).
		expect(chip?.panes).toEqual([{ key: 'shell:old', cwd: '/repo', terminalId: null, dead: true }]);
		expect(chip?.focus).toBe('shell:old');
		expect(chip && 'title' in chip).toBe(false);
		expect(chip && 'sessionId' in chip).toBe(false);
		expect(out.shellName).toBeNull();
	});

	it('re-keys a version-2 store by project, keeping the groups the user built', () => {
		// **Re-keyed rather than dropped** (ADR-0032). Two sessions of one project
		// had a chip each, one of them a three-pane row; both move to the project
		// with their panes, cwds and order intact. Dropping the store instead
		// would have thrown away exactly the group F24 says the user built.
		const pane = (key: string, cwd: string) => ({ key, cwd, terminalId: 'pty-x', dead: false });
		const v2 = {
			shellName: 'fish',
			bySession: {
				s1: [
					{
						key: 'chip:a',
						sessionId: 's1',
						projectId: 'p1',
						panes: [pane('shell:1', '/repo'), pane('shell:2', '/repo/crates')],
						focus: 'shell:2',
					},
				],
				s2: [
					{
						key: 'chip:b',
						sessionId: 's2',
						projectId: 'p1',
						panes: [pane('shell:3', '/repo-wt')],
						focus: 'shell:3',
					},
				],
				s3: [
					{
						key: 'chip:c',
						sessionId: 's3',
						projectId: 'p2',
						panes: [pane('shell:4', '/other')],
						focus: 'shell:4',
					},
				],
			},
		};
		const out = migratePersisted(v2, 2);
		expect(out.shellName).toBe('fish');
		expect(out.byProject.p1?.map((c) => c.key)).toEqual(['chip:a', 'chip:b']);
		expect(out.byProject.p2?.map((c) => c.key)).toEqual(['chip:c']);
		expect(out.byProject.p1?.[0]?.panes.map((p) => p.cwd)).toEqual(['/repo', '/repo/crates']);
		expect(out.byProject.p1?.[0]?.focus).toBe('shell:2');
		// A terminal id from a previous run names nothing, so what comes back is
		// dead whatever was on disk — the rule the store's own `partialize` keeps.
		expect(out.byProject.p1?.[0]?.panes.every((p) => p.dead && p.terminalId === null)).toBe(true);
	});

	it('drops what does not look like a chip rather than guessing', () => {
		const v1 = migratePersisted({ bySession: { s1: [{ key: 'shell:x' }, 42], s2: 'nope' } }, 1);
		expect(v1.byProject).toEqual({});
		// A v2 chip with no panes is not a chip: a chip is a group of processes.
		const v2 = migratePersisted(
			{ bySession: { s1: [{ key: 'chip:x', projectId: 'p1', panes: [], focus: 'shell:1' }] } },
			2,
		);
		expect(v2.byProject).toEqual({});
		expect(migratePersisted(undefined, 1)).toEqual({ shellName: null, byProject: {} });
	});

	it('passes a current store through, name included', () => {
		const current = { shellName: 'zsh', byProject: { p1: [] } };
		expect(migratePersisted(current, 3)).toEqual(current);
	});
});
