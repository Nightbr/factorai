import type { TerminalId, TerminalStatus, TerminalStatusDto } from '@factorai/types';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** A PTY that is (or was) live for a session. Present in the store iff the
 *  process has not exited. */
export interface LiveTerminal {
	terminalId: TerminalId;
	projectId: string;
	status: TerminalStatus;
}

/** A session you have open, whether or not it is running (F16). Carries its
 *  project because that is what the tab needs to render an avatar and what the
 *  spawn needs for a cwd — and looking it up from the index at boot would mean
 *  an async round trip before the strip could paint. */
export interface OpenTab {
	sessionId: string;
	projectId: string;
}

interface TerminalState {
	/** sessionId → live terminal. The single source of truth for "is this
	 *  session running" across the whole app. Kept current by a global
	 *  `terminal:status` / `terminal:exit` listener (see routes/__root).
	 *
	 *  **Not persisted**, and that is the load-bearing half of the split below:
	 *  a `terminalId` from a previous run names nothing, and nine surfaces read
	 *  this map meaning "running". */
	bySession: Record<string, LiveTerminal>;
	/** Open sessions in tab order (F16). Separate from `bySession` because
	 *  object key order is an implementation detail, and this one is dragged by
	 *  hand.
	 *
	 *  **Persisted**, so the strip comes back on launch. A tab outlives its
	 *  process — it survives an exit and a quit — so this is always a superset
	 *  of `bySession`'s keys, and only closing removes an entry. This used to be
	 *  `order: string[]`, in memory, on the reasoning that quitting kills every
	 *  PTY (ADR-0005) so there would be nothing to restore. ADR-0005 is
	 *  unchanged; what changed is that a tab is no longer a PTY. */
	tabs: OpenTab[];
	/** sessionId → a counter the session route uses as its `<Terminal>` key.
	 *
	 *  Restarting is "throw the pooled xterm away and mount a fresh one", and
	 *  until F16 only the session header could ask for it, with local state. The
	 *  tab strip now asks too — clicking a stopped tab restarts it, including the
	 *  one you are already looking at, where a `navigate` to the route you are on
	 *  does nothing at all. A counter here is what both surfaces can reach.
	 *
	 *  Not persisted: it exists to invalidate a pooled terminal that only lives
	 *  as long as the renderer does. */
	restartEpoch: Record<string, number>;
	attach: (sessionId: string, terminalId: TerminalId, projectId: string) => void;
	/** Adopt the PTYs Rust already holds, from `terminal_list` at boot.
	 *
	 *  A renderer reload keeps every PTY alive — they live in Rust state, not
	 *  here — but throws `bySession` away, so without this the tabs are all grey
	 *  while the processes behind them are still running.
	 *
	 *  **Merges, never replaces.** The call is async and a `Terminal` can mount
	 *  and spawn while it is in flight, so replacing the map would drop a PTY
	 *  younger than the request. Adopting each entry is also idempotent, which
	 *  is what makes it safe under StrictMode's double-invoke. */
	adoptLive: (live: TerminalStatusDto[]) => void;
	/** Move a tab, by session id, to the index of another. */
	reorder: (sessionId: string, toIndex: number) => void;
	/** Update status for the terminal with this id (`terminal:status`). */
	setStatus: (terminalId: TerminalId, status: TerminalStatus) => void;
	/** Drop the *terminal* with this id (`terminal:exit`) — and **keep the
	 *  tab**, which is now stopped. You did not ask for it to close. */
	removeByTerminal: (terminalId: TerminalId) => void;
	/** Close a session: drop the terminal **and** the tab. The only way a tab
	 *  ever leaves the strip. */
	detach: (sessionId: string) => void;
	/** Drop every tab belonging to a project, for when the project itself goes
	 *  (`useRemoveProject`). Killing its PTYs is the caller's job — this only
	 *  stops the strip pointing at a project that is no longer there. */
	closeProject: (projectId: string) => void;
	/** Ask the mounted `<Terminal>` for this session to tear down and spawn
	 *  again. Callers dispose the pooled xterm first — see `restartSession` in
	 *  `components/terminal/Terminal`, which is the pair of them and the only
	 *  thing either surface calls. */
	requestRestart: (sessionId: string) => void;
}

function findSessionByTerminal(
	bySession: Record<string, LiveTerminal>,
	terminalId: TerminalId,
): string | undefined {
	for (const [sessionId, t] of Object.entries(bySession)) {
		if (t.terminalId === terminalId) return sessionId;
	}
	return undefined;
}

/** Append unless it is already there — re-attaching an existing session (a
 *  reload re-syncing from `terminal_list`, a restored tab being restarted) must
 *  not move its tab to the end. */
function withTab(tabs: OpenTab[], sessionId: string, projectId: string): OpenTab[] {
	return tabs.some((t) => t.sessionId === sessionId) ? tabs : [...tabs, { sessionId, projectId }];
}

export const useTerminalStore = create<TerminalState>()(
	persist(
		(set) => ({
			bySession: {},
			tabs: [],
			restartEpoch: {},
			attach: (sessionId, terminalId, projectId) =>
				set((s) => ({
					bySession: {
						...s.bySession,
						[sessionId]: { terminalId, projectId, status: 'working' },
					},
					tabs: withTab(s.tabs, sessionId, projectId),
				})),
			adoptLive: (live) =>
				set((s) => {
					const bySession = { ...s.bySession };
					let tabs = s.tabs;
					for (const t of live) {
						bySession[t.sessionId] = {
							terminalId: t.id,
							projectId: t.projectId,
							status: t.status,
						};
						tabs = withTab(tabs, t.sessionId, t.projectId);
					}
					return { bySession, tabs };
				}),
			reorder: (sessionId, toIndex) =>
				set((s) => {
					const from = s.tabs.findIndex((t) => t.sessionId === sessionId);
					if (from < 0) return s;
					const next = [...s.tabs];
					const [moved] = next.splice(from, 1);
					next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, moved);
					return { tabs: next };
				}),
			setStatus: (terminalId, status) =>
				set((s) => {
					const sessionId = findSessionByTerminal(s.bySession, terminalId);
					if (!sessionId) return s;
					return {
						bySession: {
							...s.bySession,
							[sessionId]: { ...s.bySession[sessionId], status },
						},
					};
				}),
			removeByTerminal: (terminalId) =>
				set((s) => {
					const sessionId = findSessionByTerminal(s.bySession, terminalId);
					if (!sessionId) return s;
					const next = { ...s.bySession };
					delete next[sessionId];
					// The tab stays. It goes grey and clicking it restarts the session
					// — the same thing the session header's Restart does, on the surface
					// your pointer is already on.
					return { bySession: next };
				}),
			detach: (sessionId) =>
				set((s) => {
					const next = { ...s.bySession };
					delete next[sessionId];
					return { bySession: next, tabs: s.tabs.filter((t) => t.sessionId !== sessionId) };
				}),
			closeProject: (projectId) =>
				set((s) => ({ tabs: s.tabs.filter((t) => t.projectId !== projectId) })),
			requestRestart: (sessionId) =>
				set((s) => ({
					restartEpoch: { ...s.restartEpoch, [sessionId]: (s.restartEpoch[sessionId] ?? 0) + 1 },
				})),
		}),
		{
			name: 'factorai.terminals',
			version: 1,
			// `tabs` alone. `bySession` describes processes that died at quit, so
			// persisting it would be a claim about something that is gone — and it
			// is what makes a restored tab `stopped` by construction rather than by
			// a rule somebody has to remember to apply.
			partialize: (s) => ({ tabs: s.tabs }),
		},
	),
);
