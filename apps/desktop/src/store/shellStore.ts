import type { TerminalId } from '@factorai/types';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * One shell in a session's footer (`specs/05-features.md` § F23).
 *
 * `key` is the pooled xterm's key and the chip's identity, and it **outlives the
 * PTY**: a chip whose process the app killed on the way out keeps its key and
 * its cwd, and clicking it spawns a new shell there.
 */
export interface ShellTab {
	/** `shell:<uuid>`. Prefixed so it can never collide with a session id in the
	 *  xterm pool, which both kinds of terminal share. */
	key: string;
	/** The session whose footer this is drawn in — the whole of a shell's
	 *  lifetime rule, and not a claim to be that session (ADR-0031). */
	sessionId: string;
	projectId: string;
	/** Where it was spawned, and where a dead chip respawns. Held rather than
	 *  looked up because the session may have moved checkout since. */
	cwd: string;
	/** `null` while a spawn is in flight, and again once the process is gone. */
	terminalId: TerminalId | null;
	/** The shell's own `OSC 0`, which labels the chip. Rust seeds it with the
	 *  shell's basename at spawn, so a chip is never nameless. */
	title: string | null;
	/** The process is gone and factorai is the one that killed it — the app
	 *  quitting, in practice. The chip stays, muted, and respawns on a click.
	 *
	 *  A shell that ended *itself* never reaches this state: its chip is
	 *  removed. `TerminalExitEvent.killed` is what tells the two apart, and it
	 *  is decided in Rust because on the quit path this renderer may be gone
	 *  before the event lands. */
	dead: boolean;
}

interface ShellState {
	/** sessionId → its shells, in the order they were opened.
	 *
	 *  **Persisted, minus the live parts.** A chip survives a quit holding its
	 *  cwd and its name; its `terminalId` does not, because an id from a
	 *  previous run names nothing — the same rule `terminalStore.bySession`
	 *  follows for the same reason. What comes back is therefore a dead chip. */
	bySession: Record<string, ShellTab[]>;
	/** sessionId → the key of the chip whose terminal fills the split, or `null`
	 *  when the split is collapsed and only the strip shows.
	 *
	 *  **Not persisted**, deliberately. Every restored chip is dead, and a footer
	 *  that came back expanded onto one would spawn a shell at launch that nobody
	 *  asked for. What is restored is the chip; the pane stays collapsed until
	 *  it is clicked. */
	activeBySession: Record<string, string | null>;
	/** Add a shell to a session's footer and make it the active one. Returns the
	 *  new tab so the caller can spawn against its key. */
	open: (sessionId: string, projectId: string, cwd: string) => ShellTab;
	/** Record the PTY a shell spawned into, live again if it was dead. */
	attach: (key: string, terminalId: TerminalId) => void;
	/** Label a chip from its `terminal:title`. Keyed by terminal id because that
	 *  is what the event carries; a title for a PTY nothing owns is ignored. */
	setTitle: (terminalId: TerminalId, title: string) => void;
	/** The shell ended itself — its chip goes. */
	closeByTerminal: (terminalId: TerminalId) => void;
	/** We killed it — the chip stays, dead, holding its cwd. */
	markDead: (terminalId: TerminalId) => void;
	/** Drop a chip — the `×`. */
	close: (key: string) => void;
	/** Drop every chip in a session's footer, because the session is closing. */
	closeSession: (sessionId: string) => void;
	/** Show a chip's terminal in the split. `null` collapses it. */
	setActive: (sessionId: string, key: string | null) => void;
}

/** The pool key prefix, so the pool's two key spaces are stated in one place
 *  rather than spelled out at each call site. */
const SHELL_KEY_PREFIX = 'shell:';

export const useShellStore = create<ShellState>()(
	persist(
		(set) => ({
			bySession: {},
			activeBySession: {},
			open: (sessionId, projectId, cwd) => {
				const tab: ShellTab = {
					key: `${SHELL_KEY_PREFIX}${crypto.randomUUID()}`,
					sessionId,
					projectId,
					cwd,
					terminalId: null,
					title: null,
					dead: false,
				};
				set((s) => ({
					bySession: {
						...s.bySession,
						[sessionId]: [...(s.bySession[sessionId] ?? []), tab],
					},
					activeBySession: { ...s.activeBySession, [sessionId]: tab.key },
				}));
				return tab;
			},
			attach: (key, terminalId) =>
				set((s) => ({
					bySession: mapTabs(s.bySession, (t) =>
						t.key === key ? { ...t, terminalId, dead: false } : t,
					),
				})),
			setTitle: (terminalId, title) =>
				set((s) => ({
					bySession: mapTabs(s.bySession, (t) =>
						t.terminalId === terminalId ? { ...t, title } : t,
					),
				})),
			markDead: (terminalId) =>
				set((s) => ({
					bySession: mapTabs(s.bySession, (t) =>
						t.terminalId === terminalId ? { ...t, terminalId: null, dead: true } : t,
					),
				})),
			closeByTerminal: (terminalId) =>
				set((s) => {
					const key = Object.values(s.bySession)
						.flat()
						.find((t) => t.terminalId === terminalId)?.key;
					// Every agent's exit reaches this too — there is one event for both
					// kinds — so no match is the normal case, not a lost chip.
					return key ? removeKey(s, key) : s;
				}),
			close: (key) => set((s) => removeKey(s, key)),
			closeSession: (sessionId) =>
				set((s) => {
					const { [sessionId]: _dropped, ...bySession } = s.bySession;
					const { [sessionId]: _wasActive, ...activeBySession } = s.activeBySession;
					return { bySession, activeBySession };
				}),
			setActive: (sessionId, key) =>
				set((s) => ({ activeBySession: { ...s.activeBySession, [sessionId]: key } })),
		}),
		{
			name: 'factorai.shells',
			version: 1,
			// **The live half never round-trips.** A `terminalId` from a previous
			// run names nothing, so it is dropped on the way out and every restored
			// chip is dead — which is exactly what F23 asks for: the chip comes
			// back, the process does not, and a click brings one back in the same
			// directory.
			partialize: (s) => ({
				bySession: mapTabs(s.bySession, (t) => ({ ...t, terminalId: null, dead: true })),
			}),
		},
	),
);

/** Remove one chip, and hand the split to whatever is left. */
function removeKey(
	s: Pick<ShellState, 'bySession' | 'activeBySession'>,
	key: string,
): Pick<ShellState, 'bySession' | 'activeBySession'> {
	const bySession: Record<string, ShellTab[]> = {};
	const activeBySession = { ...s.activeBySession };
	for (const [sessionId, tabs] of Object.entries(s.bySession)) {
		const next = tabs.filter((t) => t.key !== key);
		bySession[sessionId] = next;
		if (activeBySession[sessionId] === key) {
			// Fall back to the last remaining chip rather than to nothing: a close
			// is not a request to collapse the split, and an empty pane under a
			// footer that still has chips reads as a broken one.
			activeBySession[sessionId] = next.at(-1)?.key ?? null;
		}
	}
	return { bySession, activeBySession };
}

/** Apply `f` to every tab in every session, keeping identity where nothing
 *  changed so an unrelated session's list does not re-render. */
function mapTabs(
	bySession: Record<string, ShellTab[]>,
	f: (tab: ShellTab) => ShellTab,
): Record<string, ShellTab[]> {
	const next: Record<string, ShellTab[]> = {};
	for (const [sessionId, tabs] of Object.entries(bySession)) {
		const mapped = tabs.map(f);
		next[sessionId] = mapped.some((t, i) => t !== tabs[i]) ? mapped : tabs;
	}
	return next;
}
