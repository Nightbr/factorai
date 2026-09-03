import type { TerminalId, TerminalStatusDto } from '@factorai/types';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** The most panes one chip holds (`specs/05-features.md` § F24). */
export const MAX_PANES = 5;

/**
 * One shell — one PTY, one pooled xterm, one cwd — inside a chip's row
 * (`specs/05-features.md` § F23, F24).
 *
 * `key` is the pooled xterm's key and the pane's identity, and it **outlives
 * the PTY**: a pane whose process the app killed on the way out keeps its key
 * and its cwd, and the chip it is in respawns it there. It is also what Rust
 * hands back as `clientKey`, which is how a reloaded renderer finds the pane a
 * still-running shell belongs to (ADR-0032).
 */
export interface ShellPaneTab {
	/** `shell:<uuid>`. Prefixed so it can never collide with a session id in the
	 *  xterm pool, which both kinds of terminal share. */
	key: string;
	/** Where it was spawned, and where a dead pane respawns. Held rather than
	 *  looked up because the route may be showing a different checkout since —
	 *  a pane opened in a worktree stays in it (F23, ADR-0032). */
	cwd: string;
	/** `null` while a spawn is in flight, and again once the process is gone. */
	terminalId: TerminalId | null;
	/** The process is gone and factorai is the one that killed it — the app
	 *  quitting, in practice. The pane stays and respawns with its chip.
	 *
	 *  A shell that ended *itself* never reaches this state: its pane is
	 *  removed. `TerminalExitEvent.killed` is what tells the two apart, and it
	 *  is decided in Rust because on the quit path this renderer may be gone
	 *  before the event lands. */
	dead: boolean;
}

/**
 * One chip in a project's footer: a **group** of one to `MAX_PANES` panes shown
 * side by side (F24). The chip is a layout; the pane is the process.
 */
export interface ShellTab {
	/** `chip:<uuid>`. Its own prefix, distinct from a pane's, so a chip key can
	 *  never be handed to the xterm pool by mistake — the pool is keyed by panes. */
	key: string;
	/** The project this chip belongs to — the whole of a shell's lifetime rule,
	 *  and not a claim to be that project (ADR-0031, ADR-0032). It carried a
	 *  `sessionId` until 2026-09-03; a session is a unit of conversation and a
	 *  shell is a unit of workspace, and binding the second lifetime to the
	 *  first killed the terminals you keep on a gesture about the agent. */
	projectId: string;
	/** In row order, which is creation order. Never empty: a chip whose last
	 *  pane goes is removed with it. */
	panes: ShellPaneTab[];
	/** The pane whose shell has the caret — the one a click into the row last
	 *  landed in, or the newest split. Always one of `panes`. */
	focus: string;
}

interface ShellState {
	/** projectId → its chips, in the order they were opened.
	 *
	 *  **Persisted, minus the live parts.** A chip survives a quit holding one
	 *  cwd per pane; a pane's `terminalId` does not, because an id from a
	 *  previous run names nothing — the same rule `terminalStore.bySession`
	 *  follows for the same reason. What comes back is therefore a dead chip. */
	byProject: Record<string, ShellTab[]>;
	/** projectId → the key of the chip whose row fills the split, or `null`
	 *  when the split is collapsed and only the strip shows.
	 *
	 *  **Per project, so the row follows you** (ADR-0032): switching session
	 *  inside a project, or stepping out to the project page, leaves the same
	 *  panes on screen in the same hosts.
	 *
	 *  **Not persisted**, deliberately. Every restored chip is dead, and a footer
	 *  that came back expanded onto one would spawn shells at launch that nobody
	 *  asked for. What is restored is the chip; the row stays collapsed until it
	 *  is clicked. */
	activeByProject: Record<string, string | null>;
	/** What every chip is labelled: the basename of the shell `shell_spawn`
	 *  runs (F23 as amended by F24). Asked of Rust once at boot and **persisted**,
	 *  so a chip restored from a previous run has its name before the answer
	 *  comes back — a label that arrives a frame late steps the chip's width,
	 *  which is the one thing a chip must not do. `null` only before the first
	 *  answer ever, when there are no chips to label. */
	shellName: string | null;
	/** chip key → its panes' widths as fractions of the row, **only for a chip
	 *  somebody dragged**. Absent means equal. **Not persisted** (F24): a row
	 *  that comes back after a relaunch comes back with fresh processes and
	 *  comes back equal. Reset by a split and by a pane's close, which change
	 *  what the fractions were of. */
	widthsByChip: Record<string, number[]>;
	setShellName: (name: string) => void;
	/** Add a one-pane chip to a project's footer and make it the active one. */
	open: (projectId: string, cwd: string) => ShellTab;
	/** Append a pane to a chip and focus it (F24). `null` at `MAX_PANES` — the
	 *  strip disables the control before this can answer that, so a `null` here
	 *  is a caller that did not look. */
	split: (chipKey: string, cwd: string) => ShellPaneTab | null;
	/** Record the PTY a pane spawned into, live again if it was dead. */
	attach: (paneKey: string, terminalId: TerminalId) => void;
	/** Re-bind the panes whose PTYs are still running, after a renderer reload
	 *  (ADR-0032). A pane Rust does not report is left exactly as it is. */
	adoptLive: (live: TerminalStatusDto[]) => void;
	/** The shell ended itself — its pane goes, and its chip with it if it was
	 *  the last one. */
	closeByTerminal: (terminalId: TerminalId) => void;
	/** We killed it — the pane stays, dead, holding its cwd. */
	markDead: (terminalId: TerminalId) => void;
	/** Drop one pane — the corner `×` (F24). Focus falls to the pane that was to
	 *  its left, or the first. The caller kills the process. */
	closePane: (paneKey: string) => void;
	/** Drop a chip and every pane in it — the chip's `×`. The caller kills the
	 *  processes. */
	close: (chipKey: string) => void;
	/** Drop every chip in a project's footer, because the project is being
	 *  removed. Nothing about a session reaches this (ADR-0032). */
	closeProject: (projectId: string) => void;
	/** Show a chip's row in the split. `null` collapses it. */
	setActive: (projectId: string, chipKey: string | null) => void;
	/** Which pane of a chip has the caret. */
	setFocus: (chipKey: string, paneKey: string) => void;
	/** A drag's result: one fraction per pane, summing to one. */
	setWidths: (chipKey: string, fractions: number[]) => void;
	/** Back to equal — a divider's double-click. */
	equalize: (chipKey: string) => void;
}

/** The two key spaces, stated once. The pool only ever sees the first. */
const PANE_KEY_PREFIX = 'shell:';
const CHIP_KEY_PREFIX = 'chip:';

/** What `factorai.shells` holds on disk: the chips minus their live half. */
interface Persisted {
	byProject: Record<string, ShellTab[]>;
	shellName: string | null;
}

/** The shape `factorai.shells` had at version 1 (F23): one shell per chip, no
 *  panes, and a `title` that F24 stopped reading. */
interface PersistedV1Tab {
	key: string;
	sessionId: string;
	projectId: string;
	cwd: string;
}

/** The shape version 2 had (F24): chips with panes, keyed by session. */
interface PersistedV2Chip {
	key: string;
	projectId: string;
	panes: ShellPaneTab[];
	focus: string;
}

function newPane(cwd: string): ShellPaneTab {
	return { key: `${PANE_KEY_PREFIX}${crypto.randomUUID()}`, cwd, terminalId: null, dead: false };
}

export const useShellStore = create<ShellState>()(
	persist(
		(set, get) => ({
			byProject: {},
			activeByProject: {},
			shellName: null,
			widthsByChip: {},
			setShellName: (name) => set({ shellName: name }),
			open: (projectId, cwd) => {
				const pane = newPane(cwd);
				const chip: ShellTab = {
					key: `${CHIP_KEY_PREFIX}${crypto.randomUUID()}`,
					projectId,
					panes: [pane],
					focus: pane.key,
				};
				set((s) => ({
					byProject: {
						...s.byProject,
						[projectId]: [...(s.byProject[projectId] ?? []), chip],
					},
					activeByProject: { ...s.activeByProject, [projectId]: chip.key },
				}));
				return chip;
			},
			split: (chipKey, cwd) => {
				const chip = findChip(get().byProject, chipKey);
				if (!chip || chip.panes.length >= MAX_PANES) return null;
				const pane = newPane(cwd);
				set((s) => ({
					byProject: mapChips(s.byProject, (c) =>
						c.key === chipKey ? { ...c, panes: [...c.panes, pane], focus: pane.key } : c,
					),
					// The fractions were of N panes; there are N+1 now (F24).
					widthsByChip: without(s.widthsByChip, chipKey),
				}));
				return pane;
			},
			attach: (paneKey, terminalId) =>
				set((s) => ({
					byProject: mapPanes(s.byProject, (p) =>
						p.key === paneKey ? { ...p, terminalId, dead: false } : p,
					),
				})),
			adoptLive: (live) =>
				set((s) => {
					// **Keyed by the pane key Rust round-tripped** (ADR-0032). A reload
					// keeps every PTY alive and throws this store away, so without this
					// a live shell came back as a dead chip and its process ran on
					// unreachable until the app quit — clicking the chip spawned a
					// second one beside it.
					const byPane = new Map<string, TerminalId>();
					for (const t of live) {
						if (t.kind === 'shell' && t.clientKey) byPane.set(t.clientKey, t.id);
					}
					if (byPane.size === 0) return s;
					return {
						byProject: mapPanes(s.byProject, (p) => {
							const terminalId = byPane.get(p.key);
							return terminalId ? { ...p, terminalId, dead: false } : p;
						}),
					};
				}),
			markDead: (terminalId) =>
				set((s) => ({
					byProject: mapPanes(s.byProject, (p) =>
						p.terminalId === terminalId ? { ...p, terminalId: null, dead: true } : p,
					),
				})),
			closeByTerminal: (terminalId) =>
				set((s) => {
					const key = allPanes(s.byProject).find((p) => p.terminalId === terminalId)?.key;
					// Every agent's exit reaches this too — there is one event for both
					// kinds — so no match is the normal case, not a lost pane.
					return key ? removePane(s, key) : s;
				}),
			closePane: (paneKey) => set((s) => removePane(s, paneKey)),
			close: (chipKey) => set((s) => removeChip(s, chipKey)),
			closeProject: (projectId) =>
				set((s) => {
					const { [projectId]: dropped, ...byProject } = s.byProject;
					const { [projectId]: _wasActive, ...activeByProject } = s.activeByProject;
					let widthsByChip = s.widthsByChip;
					for (const chip of dropped ?? []) widthsByChip = without(widthsByChip, chip.key);
					return { byProject, activeByProject, widthsByChip };
				}),
			setActive: (projectId, chipKey) =>
				set((s) => ({ activeByProject: { ...s.activeByProject, [projectId]: chipKey } })),
			setFocus: (chipKey, paneKey) =>
				set((s) => ({
					byProject: mapChips(s.byProject, (c) =>
						c.key === chipKey && c.focus !== paneKey && c.panes.some((p) => p.key === paneKey)
							? { ...c, focus: paneKey }
							: c,
					),
				})),
			setWidths: (chipKey, fractions) =>
				set((s) => ({ widthsByChip: { ...s.widthsByChip, [chipKey]: fractions } })),
			equalize: (chipKey) => set((s) => ({ widthsByChip: without(s.widthsByChip, chipKey) })),
		}),
		{
			name: 'factorai.shells',
			version: 3,
			migrate: (persisted, version) => migratePersisted(persisted, version),
			// **The live half never round-trips.** A `terminalId` from a previous
			// run names nothing, so it is dropped on the way out and every restored
			// pane is dead — which is exactly what F23 asks for: the chip comes
			// back, the processes do not, and a click brings them back in the same
			// directories.
			partialize: (s): Persisted => ({
				shellName: s.shellName,
				byProject: mapPanes(s.byProject, (p) => ({ ...p, terminalId: null, dead: true })),
			}),
		},
	),
);

/**
 * Bring an older `factorai.shells` forward (F24, ADR-0032).
 *
 * **Version 3 re-keys the store from sessions to projects.** Every chip already
 * carried the project it was opened in, so this loses nothing: a session's
 * chips move to their project with their panes, their cwds and their order
 * intact. Dropping the store instead was considered and refused — F24 made a
 * chip a group of up to five panes and said the group is what the user built,
 * and throwing that away to save a crowded strip is the wrong side of that
 * trade. A project whose sessions each had a chip does restore them all into
 * one strip, dead, and the `×` is right there.
 *
 * **Version 1** stored one shell per chip. Each becomes a one-pane chip whose
 * pane **keeps the old key** — the pool was keyed by it, and a dead chip's cwd
 * is the whole of what it was keeping — under a new chip key.
 *
 * Anything that does not look like a chip of its version is dropped rather than
 * guessed at; a chip is a cwd and a place, and a chip with neither is not worth
 * a corrupt store.
 *
 * Exported for its test; `persist` calls it through `migrate`.
 */
export function migratePersisted(persisted: unknown, version: number): Persisted {
	const raw = isRecord(persisted) ? persisted : {};
	const shellName = typeof raw.shellName === 'string' ? raw.shellName : null;
	if (version >= 3) {
		return {
			shellName,
			byProject: isRecord(raw.byProject) ? (raw.byProject as Persisted['byProject']) : {},
		};
	}
	// v1 and v2 were both keyed by session, so both arrive here as chips to be
	// filed under the project each one names.
	const chips = version >= 2 ? v2Chips(raw.bySession) : v1Chips(raw.bySession);
	const byProject: Record<string, ShellTab[]> = {};
	for (const chip of chips) {
		byProject[chip.projectId] = [...(byProject[chip.projectId] ?? []), chip];
	}
	return { shellName, byProject };
}

/** v2's chips, in the order the sessions and their strips were stored. */
function v2Chips(bySession: unknown): ShellTab[] {
	if (!isRecord(bySession)) return [];
	const out: ShellTab[] = [];
	for (const chips of Object.values(bySession)) {
		if (!Array.isArray(chips)) continue;
		for (const chip of chips.filter(isV2Chip)) {
			out.push({
				key: chip.key,
				projectId: chip.projectId,
				panes: chip.panes.map((p) => ({ ...p, terminalId: null, dead: true })),
				focus: chip.focus,
			});
		}
	}
	return out;
}

/** v1's one-shell tabs, each becoming a one-pane chip. */
function v1Chips(bySession: unknown): ShellTab[] {
	if (!isRecord(bySession)) return [];
	const out: ShellTab[] = [];
	for (const tabs of Object.values(bySession)) {
		if (!Array.isArray(tabs)) continue;
		for (const tab of tabs.filter(isV1Tab)) {
			out.push({
				key: `${CHIP_KEY_PREFIX}${crypto.randomUUID()}`,
				projectId: tab.projectId,
				panes: [{ key: tab.key, cwd: tab.cwd, terminalId: null, dead: true }],
				focus: tab.key,
			});
		}
	}
	return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isV1Tab(v: unknown): v is PersistedV1Tab {
	return (
		isRecord(v) &&
		typeof v.key === 'string' &&
		typeof v.sessionId === 'string' &&
		typeof v.projectId === 'string' &&
		typeof v.cwd === 'string'
	);
}

function isV2Chip(v: unknown): v is PersistedV2Chip {
	return (
		isRecord(v) &&
		typeof v.key === 'string' &&
		typeof v.projectId === 'string' &&
		typeof v.focus === 'string' &&
		Array.isArray(v.panes) &&
		v.panes.length > 0 &&
		v.panes.every((p) => isRecord(p) && typeof p.key === 'string' && typeof p.cwd === 'string')
	);
}

function findChip(byProject: Record<string, ShellTab[]>, chipKey: string): ShellTab | undefined {
	return Object.values(byProject)
		.flat()
		.find((c) => c.key === chipKey);
}

function allPanes(byProject: Record<string, ShellTab[]>): ShellPaneTab[] {
	return Object.values(byProject).flatMap((chips) => chips.flatMap((c) => c.panes));
}

function without<T>(map: Record<string, T>, key: string): Record<string, T> {
	if (!(key in map)) return map;
	const { [key]: _dropped, ...rest } = map;
	return rest;
}

type Slice = Pick<ShellState, 'byProject' | 'activeByProject' | 'widthsByChip'>;

/** Remove one pane, and its chip with it when it was the last. */
function removePane(s: Slice, paneKey: string): Slice {
	const chip = Object.values(s.byProject)
		.flat()
		.find((c) => c.panes.some((p) => p.key === paneKey));
	if (!chip) return s;
	if (chip.panes.length === 1) return removeChip(s, chip.key);
	const index = chip.panes.findIndex((p) => p.key === paneKey);
	const panes = chip.panes.filter((p) => p.key !== paneKey);
	// Focus falls to the pane that was to its left, or the first (F24): the
	// caret goes somewhere near where it was, and never nowhere.
	const focus = chip.focus === paneKey ? panes[Math.max(index - 1, 0)].key : chip.focus;
	return {
		...s,
		byProject: mapChips(s.byProject, (c) => (c.key === chip.key ? { ...c, panes, focus } : c)),
		widthsByChip: without(s.widthsByChip, chip.key),
	};
}

/** Remove one chip, and hand the split to whatever is left. */
function removeChip(s: Slice, chipKey: string): Slice {
	const byProject: Record<string, ShellTab[]> = {};
	const activeByProject = { ...s.activeByProject };
	for (const [projectId, chips] of Object.entries(s.byProject)) {
		const next = chips.filter((c) => c.key !== chipKey);
		byProject[projectId] = next;
		if (activeByProject[projectId] === chipKey) {
			// Fall back to the last remaining chip rather than to nothing: a close
			// is not a request to collapse the split, and an empty row under a
			// footer that still has chips reads as a broken one.
			activeByProject[projectId] = next.at(-1)?.key ?? null;
		}
	}
	return { byProject, activeByProject, widthsByChip: without(s.widthsByChip, chipKey) };
}

/** Apply `f` to every chip in every project, keeping identity where nothing
 *  changed so an unrelated project's list does not re-render. */
function mapChips(
	byProject: Record<string, ShellTab[]>,
	f: (chip: ShellTab) => ShellTab,
): Record<string, ShellTab[]> {
	const next: Record<string, ShellTab[]> = {};
	for (const [projectId, chips] of Object.entries(byProject)) {
		const mapped = chips.map(f);
		next[projectId] = mapped.some((c, i) => c !== chips[i]) ? mapped : chips;
	}
	return next;
}

/** Apply `f` to every pane of every chip, with the same identity rule. */
function mapPanes(
	byProject: Record<string, ShellTab[]>,
	f: (pane: ShellPaneTab) => ShellPaneTab,
): Record<string, ShellTab[]> {
	return mapChips(byProject, (chip) => {
		const panes = chip.panes.map(f);
		return panes.some((p, i) => p !== chip.panes[i]) ? { ...chip, panes } : chip;
	});
}
