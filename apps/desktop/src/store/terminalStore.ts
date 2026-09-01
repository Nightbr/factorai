import type { TerminalId, TerminalStatus, TerminalStatusDto } from '@factorai/types';
import { usePrefsStore } from '@store/prefsStore';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** A PTY that is (or was) live for a session. Present in the store iff the
 *  process has not exited. */
export interface LiveTerminal {
	terminalId: TerminalId;
	projectId: string;
	status: TerminalStatus;
}

/** The checkout a session's agent signalled, and that checkout's branch (F21).
 *
 *  The branch is carried rather than looked up so the header badge can render it
 *  from one event, instead of the badge and the panel resolving it separately and
 *  briefly disagreeing. */
interface LiveWorktree {
	path: string;
	branch: string | null;
	/** True when a **human** chose this checkout in the header's picker (F21).
	 *
	 *  It is what stops the next `openFile` inference dragging the panel back
	 *  out of the checkout you just asked to see: an agent that never learned to
	 *  signal is exactly the agent whose every file read is a signal, so without
	 *  this a pick lasts until the agent touches a file — a control that works
	 *  for a second reads as a control that does not work.
	 *
	 *  Deliberately **not persisted, and not a column**. The pick writes
	 *  `session_worktrees` like any other record of the same fact, so a reload
	 *  resolves to the same checkout; what a reload drops is only the pick's
	 *  immunity, and an agent that moves after a reload is one the panel should
	 *  follow again. */
	pinned?: boolean;
}

/** A session you have open, whether or not it is running (F16). Carries its
 *  project because that is what the tab needs to render an avatar and what the
 *  spawn needs for a cwd — and looking it up from the index at boot would mean
 *  an async round trip before the strip could paint.
 *
 *  Not exported: `lib/` takes it structurally so it stays free of store
 *  imports, and an export nothing imports is what knip is for. */
interface OpenTab {
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
	/** sessionId → why its IDE bridge is unusable (F20).
	 *
	 *  **Only failures are kept.** A working bridge is the normal case and puts
	 *  nothing on screen; the header's only job here is to say when the agent
	 *  *cannot* open a file, since that otherwise looks exactly like an agent
	 *  that chose not to.
	 *
	 *  Not persisted: it describes a process that will not outlive the app. */
	ideIssues: Record<string, string>;
	/** The checkout each session's agent last signalled (F21), by session id.
	 *
	 *  **Not persisted**, exactly as `bySession` isn't, and for a stronger reason
	 *  than "it would go stale": the durable copy is `session_worktrees` in
	 *  SQLite, arriving on `SessionSummary.worktree`. This is only the in-flight
	 *  value, so a reload falls back to the row rather than to nothing. */
	worktreeBySession: Record<string, LiveWorktree>;
	/** Record a live PTY for a session, and open a tab for it.
	 *
	 *  `openTab: false` is a **routine's** session (F22): it runs with a hidden
	 *  pooled xterm and no tab until a human opens it, which is the one case
	 *  where a live session is not an open one. */
	attach: (
		sessionId: string,
		terminalId: TerminalId,
		projectId: string,
		options?: { openTab?: boolean },
	) => void;
	/** Which routine started a session, for the origin icon (F22).
	 *
	 *  Not persisted, like `bySession`: the durable copy is `session_routines`
	 *  in SQLite, arriving on `SessionSummary.routineId`. This is only what the
	 *  lists need *before* the indexer has seen the transcript — which for a
	 *  routine's session is most of the time it matters. */
	routineBySession: Record<string, { routineId: string; routineName: string; startedAt: number }>;
	setRoutineOrigin: (
		sessionId: string,
		routineId: string,
		routineName: string,
		startedAt: number,
	) => void;
	/** Put a session on the strip because a human opened it (F16, F22).
	 *
	 *  Idempotent, and it never moves an existing tab. It exists because a
	 *  routine's session is live *without* a tab, so `attach` — which is where a
	 *  tab used to come from — has already run by the time you click the row. */
	openTab: (sessionId: string, projectId: string) => void;
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
	/** Record where a session's bridge stands. Returns the same state when
	 *  nothing changed, so a repeated report — and `resync` re-announcing every
	 *  bridge — costs no render. */
	setIdeStatus: (sessionId: string, error: string | null) => void;
	/** Record a `session:worktree` signal. Rust wrote the row before emitting, so
	 *  this never gets ahead of what a reload would show.
	 *
	 *  **Ignored while the session's checkout is pinned** — see `LiveWorktree`. */
	setWorktree: (sessionId: string, path: string, branch: string | null) => void;
	/** Record the human's own pick from the header's checkout menu (F21).
	 *
	 *  Outranks a signal rather than racing it, and the durable half is
	 *  `set_session_worktree`, which the caller writes first for the same reason
	 *  the bridge does: a panel showing a checkout the next reload disagrees with
	 *  is worse than one that moves a beat late. */
	pinWorktree: (sessionId: string, path: string, branch: string | null) => void;
	/** Drop the signal for a session — the header badge's revert. The persisted
	 *  row goes with it, through `clearSessionWorktree`; this is only the
	 *  in-flight half. */
	clearWorktree: (sessionId: string) => void;
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
			routineBySession: {},
			restartEpoch: {},
			ideIssues: {},
			worktreeBySession: {},

			setWorktree: (sessionId, path, branch) =>
				set((s) => {
					const current = s.worktreeBySession[sessionId];
					// The human is looking at a checkout they asked for. The signal is
					// still true — the agent really did open a file elsewhere — but it
					// is not a reason to move the panel out from under them.
					if (current?.pinned) return s;
					// A signal is sent on every `openFile` in a checkout, so the same
					// path arrives over and over. Bail before writing, or every one of
					// them is a new object reference and a re-render.
					if (current?.path === path && current.branch === branch) return s;
					return {
						worktreeBySession: { ...s.worktreeBySession, [sessionId]: { path, branch } },
					};
				}),

			pinWorktree: (sessionId, path, branch) =>
				set((s) => {
					const current = s.worktreeBySession[sessionId];
					if (current?.path === path && current.branch === branch && current.pinned) return s;
					return {
						worktreeBySession: {
							...s.worktreeBySession,
							[sessionId]: { path, branch, pinned: true },
						},
					};
				}),

			setIdeStatus: (sessionId, error) =>
				set((s) => {
					if ((s.ideIssues[sessionId] ?? null) === error) return s;
					const next = { ...s.ideIssues };
					if (error) next[sessionId] = error;
					else delete next[sessionId];
					return { ideIssues: next };
				}),

			clearWorktree: (sessionId) =>
				set((s) => {
					if (!s.worktreeBySession[sessionId]) return s;
					const next = { ...s.worktreeBySession };
					delete next[sessionId];
					return { worktreeBySession: next };
				}),

			attach: (sessionId, terminalId, projectId, options) =>
				set((s) => ({
					bySession: {
						...s.bySession,
						[sessionId]: { terminalId, projectId, status: 'working' },
					},
					tabs: options?.openTab === false ? s.tabs : withTab(s.tabs, sessionId, projectId),
				})),

			setRoutineOrigin: (sessionId, routineId, routineName, startedAt) =>
				set((s) => {
					const current = s.routineBySession[sessionId];
					if (current?.routineId === routineId) return s;
					return {
						routineBySession: {
							...s.routineBySession,
							[sessionId]: { routineId, routineName, startedAt },
						},
					};
				}),

			openTab: (sessionId, projectId) =>
				set((s) => {
					const tabs = withTab(s.tabs, sessionId, projectId);
					return tabs === s.tabs ? s : { tabs };
				}),
			adoptLive: (live) =>
				set((s) => {
					const bySession = { ...s.bySession };
					for (const t of live) {
						// **Shells are skipped, and this map is why** (F23). A
						// footer shell carries the session id of the footer it is
						// drawn in, and this map is keyed by session id meaning
						// "the agent" — so adopting one would file a shell's PTY
						// over its agent's, and every surface reading `bySession`
						// would then write into, kill, and report the status of
						// the wrong process.
						if (t.kind !== 'agent') continue;
						bySession[t.sessionId] = {
							terminalId: t.id,
							projectId: t.projectId,
							status: t.status,
						};
					}
					// **Adopting opens no tabs — changed by F22.** It used to
					// `withTab` every live PTY, on the reasoning that a live session
					// was by definition an open one. A routine's session is live and
					// deliberately has no tab (ADR-0026), and this runs on every
					// reload, so keeping that line would hand one a tab the human
					// never asked for. Nothing is lost: `tabs` is the persisted half
					// and comes back on its own, which is what makes a restored strip
					// mean anything.
					return { bySession };
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
			/**
			 * **The restore switch is honoured here, at hydration** (F11, F16).
			 *
			 * Off means the strip starts empty — dropping the tabs on the way in
			 * rather than not writing them on the way out, so the switch describes
			 * *launch* and nothing has to be remembered at quit. `prefsStore` is on
			 * localStorage and hydrates when its module loads, which importing it
			 * here is what guarantees happens before this runs.
			 *
			 * The dropped list does not come back if you turn the switch on again:
			 * the tabs were not open this session, so the next launch restores what
			 * you had *then*. Persisting a shadow copy of a list nobody is looking at
			 * would be a second source of truth for one boolean's sake.
			 */
			merge: (persisted, current) => {
				const state = { ...current, ...(persisted as Partial<TerminalState>) };
				if (usePrefsStore.getState().restoreTabs) return state;
				return { ...state, tabs: [] };
			},
		},
	),
);
