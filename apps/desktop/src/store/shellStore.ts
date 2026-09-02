import type { TerminalId } from '@factorai/types';
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
 * and its cwd, and the chip it is in respawns it there.
 */
export interface ShellPaneTab {
	/** `shell:<uuid>`. Prefixed so it can never collide with a session id in the
	 *  xterm pool, which both kinds of terminal share. */
	key: string;
	/** Where it was spawned, and where a dead pane respawns. Held rather than
	 *  looked up because the session may have moved checkout since. */
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
 * One chip in a session's footer: a **group** of one to `MAX_PANES` panes shown
 * side by side (F24). The chip is a layout; the pane is the process.
 */
export interface ShellTab {
	/** `chip:<uuid>`. Its own prefix, distinct from a pane's, so a chip key can
	 *  never be handed to the xterm pool by mistake — the pool is keyed by panes. */
	key: string;
	/** The session whose footer this is drawn in — the whole of a shell's
	 *  lifetime rule, and not a claim to be that session (ADR-0031). */
	sessionId: string;
	projectId: string;
	/** In row order, which is creation order. Never empty: a chip whose last
	 *  pane goes is removed with it. */
	panes: ShellPaneTab[];
	/** The pane whose shell has the caret — the one a click into the row last
	 *  landed in, or the newest split. Always one of `panes`. */
	focus: string;
}

interface ShellState {
	/** sessionId → its chips, in the order they were opened.
	 *
	 *  **Persisted, minus the live parts.** A chip survives a quit holding one
	 *  cwd per pane; a pane's `terminalId` does not, because an id from a
	 *  previous run names nothing — the same rule `terminalStore.bySession`
	 *  follows for the same reason. What comes back is therefore a dead chip. */
	bySession: Record<string, ShellTab[]>;
	/** sessionId → the key of the chip whose row fills the split, or `null`
	 *  when the split is collapsed and only the strip shows.
	 *
	 *  **Not persisted**, deliberately. Every restored chip is dead, and a footer
	 *  that came back expanded onto one would spawn shells at launch that nobody
	 *  asked for. What is restored is the chip; the row stays collapsed until it
	 *  is clicked. */
	activeBySession: Record<string, string | null>;
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
	/** Add a one-pane chip to a session's footer and make it the active one. */
	open: (sessionId: string, projectId: string, cwd: string) => ShellTab;
	/** Append a pane to a chip and focus it (F24). `null` at `MAX_PANES` — the
	 *  strip disables the control before this can answer that, so a `null` here
	 *  is a caller that did not look. */
	split: (chipKey: string, cwd: string) => ShellPaneTab | null;
	/** Record the PTY a pane spawned into, live again if it was dead. */
	attach: (paneKey: string, terminalId: TerminalId) => void;
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
	/** Drop every chip in a session's footer, because the session is closing. */
	closeSession: (sessionId: string) => void;
	/** Show a chip's row in the split. `null` collapses it. */
	setActive: (sessionId: string, chipKey: string | null) => void;
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
	bySession: Record<string, ShellTab[]>;
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

function newPane(cwd: string): ShellPaneTab {
	return { key: `${PANE_KEY_PREFIX}${crypto.randomUUID()}`, cwd, terminalId: null, dead: false };
}

export const useShellStore = create<ShellState>()(
	persist(
		(set, get) => ({
			bySession: {},
			activeBySession: {},
			shellName: null,
			widthsByChip: {},
			setShellName: (name) => set({ shellName: name }),
			open: (sessionId, projectId, cwd) => {
				const pane = newPane(cwd);
				const chip: ShellTab = {
					key: `${CHIP_KEY_PREFIX}${crypto.randomUUID()}`,
					sessionId,
					projectId,
					panes: [pane],
					focus: pane.key,
				};
				set((s) => ({
					bySession: {
						...s.bySession,
						[sessionId]: [...(s.bySession[sessionId] ?? []), chip],
					},
					activeBySession: { ...s.activeBySession, [sessionId]: chip.key },
				}));
				return chip;
			},
			split: (chipKey, cwd) => {
				const chip = findChip(get().bySession, chipKey);
				if (!chip || chip.panes.length >= MAX_PANES) return null;
				const pane = newPane(cwd);
				set((s) => ({
					bySession: mapChips(s.bySession, (c) =>
						c.key === chipKey ? { ...c, panes: [...c.panes, pane], focus: pane.key } : c,
					),
					// The fractions were of N panes; there are N+1 now (F24).
					widthsByChip: without(s.widthsByChip, chipKey),
				}));
				return pane;
			},
			attach: (paneKey, terminalId) =>
				set((s) => ({
					bySession: mapPanes(s.bySession, (p) =>
						p.key === paneKey ? { ...p, terminalId, dead: false } : p,
					),
				})),
			markDead: (terminalId) =>
				set((s) => ({
					bySession: mapPanes(s.bySession, (p) =>
						p.terminalId === terminalId ? { ...p, terminalId: null, dead: true } : p,
					),
				})),
			closeByTerminal: (terminalId) =>
				set((s) => {
					const key = allPanes(s.bySession).find((p) => p.terminalId === terminalId)?.key;
					// Every agent's exit reaches this too — there is one event for both
					// kinds — so no match is the normal case, not a lost pane.
					return key ? removePane(s, key) : s;
				}),
			closePane: (paneKey) => set((s) => removePane(s, paneKey)),
			close: (chipKey) => set((s) => removeChip(s, chipKey)),
			closeSession: (sessionId) =>
				set((s) => {
					const { [sessionId]: dropped, ...bySession } = s.bySession;
					const { [sessionId]: _wasActive, ...activeBySession } = s.activeBySession;
					let widthsByChip = s.widthsByChip;
					for (const chip of dropped ?? []) widthsByChip = without(widthsByChip, chip.key);
					return { bySession, activeBySession, widthsByChip };
				}),
			setActive: (sessionId, chipKey) =>
				set((s) => ({ activeBySession: { ...s.activeBySession, [sessionId]: chipKey } })),
			setFocus: (chipKey, paneKey) =>
				set((s) => ({
					bySession: mapChips(s.bySession, (c) =>
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
			version: 2,
			migrate: (persisted, version) => migratePersisted(persisted, version),
			// **The live half never round-trips.** A `terminalId` from a previous
			// run names nothing, so it is dropped on the way out and every restored
			// pane is dead — which is exactly what F23 asks for: the chip comes
			// back, the processes do not, and a click brings them back in the same
			// directories.
			partialize: (s): Persisted => ({
				shellName: s.shellName,
				bySession: mapPanes(s.bySession, (p) => ({ ...p, terminalId: null, dead: true })),
			}),
		},
	),
);

/**
 * Bring an older `factorai.shells` forward (F24).
 *
 * Version 1 stored one shell per chip. Each becomes a one-pane chip whose pane
 * **keeps the old key** — the pool was keyed by it, and a dead chip's cwd is
 * the whole of what it was keeping — under a new chip key. Anything that does
 * not look like a v1 tab is dropped rather than guessed at; a chip is a cwd and
 * a place, and a chip with neither is not worth a corrupt store.
 *
 * Exported for its test; `persist` calls it through `migrate`.
 */
export function migratePersisted(persisted: unknown, version: number): Persisted {
	const raw = isRecord(persisted) ? persisted : {};
	const shellName = typeof raw.shellName === 'string' ? raw.shellName : null;
	if (version >= 2) {
		return {
			shellName,
			bySession: isRecord(raw.bySession) ? (raw.bySession as Persisted['bySession']) : {},
		};
	}
	const bySession: Record<string, ShellTab[]> = {};
	if (isRecord(raw.bySession)) {
		for (const [sessionId, tabs] of Object.entries(raw.bySession)) {
			if (!Array.isArray(tabs)) continue;
			bySession[sessionId] = tabs.filter(isV1Tab).map((t) => ({
				key: `${CHIP_KEY_PREFIX}${crypto.randomUUID()}`,
				sessionId: t.sessionId,
				projectId: t.projectId,
				panes: [{ key: t.key, cwd: t.cwd, terminalId: null, dead: true }],
				focus: t.key,
			}));
		}
	}
	return { shellName, bySession };
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

function findChip(bySession: Record<string, ShellTab[]>, chipKey: string): ShellTab | undefined {
	return Object.values(bySession)
		.flat()
		.find((c) => c.key === chipKey);
}

function allPanes(bySession: Record<string, ShellTab[]>): ShellPaneTab[] {
	return Object.values(bySession).flatMap((chips) => chips.flatMap((c) => c.panes));
}

function without<T>(map: Record<string, T>, key: string): Record<string, T> {
	if (!(key in map)) return map;
	const { [key]: _dropped, ...rest } = map;
	return rest;
}

type Slice = Pick<ShellState, 'bySession' | 'activeBySession' | 'widthsByChip'>;

/** Remove one pane, and its chip with it when it was the last. */
function removePane(s: Slice, paneKey: string): Slice {
	const chip = Object.values(s.bySession)
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
		bySession: mapChips(s.bySession, (c) => (c.key === chip.key ? { ...c, panes, focus } : c)),
		widthsByChip: without(s.widthsByChip, chip.key),
	};
}

/** Remove one chip, and hand the split to whatever is left. */
function removeChip(s: Slice, chipKey: string): Slice {
	const bySession: Record<string, ShellTab[]> = {};
	const activeBySession = { ...s.activeBySession };
	for (const [sessionId, chips] of Object.entries(s.bySession)) {
		const next = chips.filter((c) => c.key !== chipKey);
		bySession[sessionId] = next;
		if (activeBySession[sessionId] === chipKey) {
			// Fall back to the last remaining chip rather than to nothing: a close
			// is not a request to collapse the split, and an empty row under a
			// footer that still has chips reads as a broken one.
			activeBySession[sessionId] = next.at(-1)?.key ?? null;
		}
	}
	return { bySession, activeBySession, widthsByChip: without(s.widthsByChip, chipKey) };
}

/** Apply `f` to every chip in every session, keeping identity where nothing
 *  changed so an unrelated session's list does not re-render. */
function mapChips(
	bySession: Record<string, ShellTab[]>,
	f: (chip: ShellTab) => ShellTab,
): Record<string, ShellTab[]> {
	const next: Record<string, ShellTab[]> = {};
	for (const [sessionId, chips] of Object.entries(bySession)) {
		const mapped = chips.map(f);
		next[sessionId] = mapped.some((c, i) => c !== chips[i]) ? mapped : chips;
	}
	return next;
}

/** Apply `f` to every pane of every chip, with the same identity rule. */
function mapPanes(
	bySession: Record<string, ShellTab[]>,
	f: (pane: ShellPaneTab) => ShellPaneTab,
): Record<string, ShellTab[]> {
	return mapChips(bySession, (chip) => {
		const panes = chip.panes.map(f);
		return panes.some((p, i) => p !== chip.panes[i]) ? { ...chip, panes } : chip;
	});
}
