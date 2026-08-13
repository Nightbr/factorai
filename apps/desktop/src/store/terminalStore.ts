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
	attach: (sessionId: string, terminalId: TerminalId, projectId: string) => void;
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
	attach: (sessionId, terminalId, projectId) =>
		set((s) => ({
			bySession: {
				...s.bySession,
				[sessionId]: { terminalId, projectId, status: 'running' },
			},
		})),
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
			return { bySession: next };
		}),
	detach: (sessionId) =>
		set((s) => {
			if (!s.bySession[sessionId]) return s;
			const next = { ...s.bySession };
			delete next[sessionId];
			return { bySession: next };
		}),
}));
