import type { TerminalId } from '@factorai/types';
import { create } from 'zustand';

/**
 * One shell in a session's footer (`specs/05-features.md` § F23).
 *
 * `key` is the pooled xterm's key and the chip's identity, and it outlives the
 * PTY: a chip whose process died keeps its key, its cwd and its scrollback, and
 * respawning writes a new `terminalId` into the same entry.
 */
export interface ShellTab {
	/** `shell:<uuid>`. Prefixed so it can never collide with a session id in the
	 *  xterm pool, which both kinds of terminal share. */
	key: string;
	/** The session whose footer this is drawn in — the whole of a shell's
	 *  lifetime rule, and not a claim to be that session (ADR-0031). */
	sessionId: string;
	projectId: string;
	/** Where it was spawned. Held rather than looked up because it is what a
	 *  dead chip respawns into, and the session may have moved checkout since. */
	cwd: string;
	/** `null` while the spawn is in flight, and again once the process is gone. */
	terminalId: TerminalId | null;
	/** The shell's own `OSC 0`, which labels the chip. `null` until it sets one
	 *  — most prompts do on the first paint, some never do. */
	title: string | null;
}

interface ShellState {
	/** sessionId → its shells, in the order they were opened.
	 *
	 *  **Not persisted yet.** Slice 4 of F23 persists the chips with their cwds
	 *  so a chip killed by a quit comes back dead; until then a relaunch starts
	 *  with an empty footer. */
	bySession: Record<string, ShellTab[]>;
	/** sessionId → the key of the chip whose terminal fills the split, or `null`
	 *  when the split is collapsed and only the strip shows. */
	activeBySession: Record<string, string | null>;
	/** Add a shell to a session's footer and make it the active one. Returns the
	 *  new tab so the caller can spawn against its key. */
	open: (sessionId: string, projectId: string, cwd: string) => ShellTab;
	/** Record the PTY a shell spawned into. */
	attach: (key: string, terminalId: TerminalId) => void;
	/** Label a chip from its `terminal:title`. Keyed by terminal id because that
	 *  is what the event carries; a title for a PTY nothing owns is ignored. */
	setTitle: (terminalId: TerminalId, title: string) => void;
	/** Drop a chip — the `×`, and `exit` from inside the shell. */
	close: (key: string) => void;
	/** Drop every chip in a session's footer, because the session is closing. */
	closeSession: (sessionId: string) => void;
	/** Show a chip's terminal in the split. `null` collapses it. */
	setActive: (sessionId: string, key: string | null) => void;
}

/** The pool key prefix, so the pool's two key spaces are stated in one place
 *  rather than spelled out at each call site. */
const SHELL_KEY_PREFIX = 'shell:';

export const useShellStore = create<ShellState>()((set) => ({
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
		};
		set((s) => ({
			bySession: { ...s.bySession, [sessionId]: [...(s.bySession[sessionId] ?? []), tab] },
			activeBySession: { ...s.activeBySession, [sessionId]: tab.key },
		}));
		return tab;
	},
	attach: (key, terminalId) =>
		set((s) => ({
			bySession: mapTabs(s.bySession, (t) => (t.key === key ? { ...t, terminalId } : t)),
		})),
	setTitle: (terminalId, title) =>
		set((s) => ({
			bySession: mapTabs(s.bySession, (t) => (t.terminalId === terminalId ? { ...t, title } : t)),
		})),
	close: (key) =>
		set((s) => {
			const bySession: Record<string, ShellTab[]> = {};
			const activeBySession = { ...s.activeBySession };
			for (const [sessionId, tabs] of Object.entries(s.bySession)) {
				const next = tabs.filter((t) => t.key !== key);
				bySession[sessionId] = next;
				if (activeBySession[sessionId] === key) {
					// Fall back to the last remaining chip rather than to nothing: a
					// close is not a request to collapse the split, and an empty pane
					// under a footer that still has chips reads as a broken one.
					activeBySession[sessionId] = next.at(-1)?.key ?? null;
				}
			}
			return { bySession, activeBySession };
		}),
	closeSession: (sessionId) =>
		set((s) => {
			const { [sessionId]: _dropped, ...bySession } = s.bySession;
			const { [sessionId]: _wasActive, ...activeBySession } = s.activeBySession;
			return { bySession, activeBySession };
		}),
	setActive: (sessionId, key) =>
		set((s) => ({ activeBySession: { ...s.activeBySession, [sessionId]: key } })),
}));

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
