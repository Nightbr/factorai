import type { TerminalId, TerminalStatus } from '@factorai/types';
import { create } from 'zustand';

/** A PTY that is (or was) live for a session. Present in the store iff the
 *  process has not exited. */
export interface LiveTerminal {
	terminalId: TerminalId;
	projectId: string;
	status: TerminalStatus;
}

interface TerminalState {
	/** sessionId → live terminal. The single source of truth for "is this
	 *  session running" across the whole app. Kept current by a global
	 *  `terminal:status` / `terminal:exit` listener (see routes/__root). */
	bySession: Record<string, LiveTerminal>;
	/** Session ids in tab order (F16). Separate from `bySession` because object
	 *  key order is an implementation detail, and this one is dragged by hand.
	 *  In memory only: quitting kills every PTY (ADR-0005), so there is nothing
	 *  to restore, and a renderer reload rebuilds from `terminal_list()`. */
	order: string[];
	attach: (sessionId: string, terminalId: TerminalId, projectId: string) => void;
	/** Move a tab, by session id, to the index of another. */
	reorder: (sessionId: string, toIndex: number) => void;
	/** Update status for the terminal with this id (`terminal:status`). */
	setStatus: (terminalId: TerminalId, status: TerminalStatus) => void;
	/** Drop the terminal with this id (`terminal:exit`). */
	removeByTerminal: (terminalId: TerminalId) => void;
	/** Drop by session id (explicit). */
	detach: (sessionId: string) => void;
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

export const useTerminalStore = create<TerminalState>((set) => ({
	bySession: {},
	order: [],
	attach: (sessionId, terminalId, projectId) =>
		set((s) => ({
			bySession: {
				...s.bySession,
				[sessionId]: { terminalId, projectId, status: 'working' },
			},
			// Append. Re-attaching an existing session (a reload re-syncing from
			// terminal_list) must not move its tab.
			order: s.order.includes(sessionId) ? s.order : [...s.order, sessionId],
		})),
	reorder: (sessionId, toIndex) =>
		set((s) => {
			const from = s.order.indexOf(sessionId);
			if (from < 0) return s;
			const next = [...s.order];
			next.splice(from, 1);
			next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, sessionId);
			return { order: next };
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
			return { bySession: next, order: s.order.filter((id) => id !== sessionId) };
		}),
	detach: (sessionId) =>
		set((s) => {
			if (!s.bySession[sessionId]) return s;
			const next = { ...s.bySession };
			delete next[sessionId];
			return { bySession: next, order: s.order.filter((id) => id !== sessionId) };
		}),
}));
