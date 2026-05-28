import type { TerminalId } from '@factorai/types';
import { create } from 'zustand';

interface TerminalState {
	/** Maps sessionId → terminalId for resumed sessions. */
	bySession: Record<string, TerminalId>;
	/** Pure-spawn terminals not bound to a known session (rare in MVP). */
	loose: TerminalId[];
	attach: (sessionId: string, terminalId: TerminalId) => void;
	detach: (sessionId: string) => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
	bySession: {},
	loose: [],
	attach: (sessionId, terminalId) =>
		set((s) => ({ bySession: { ...s.bySession, [sessionId]: terminalId } })),
	detach: (sessionId) =>
		set((s) => {
			const next = { ...s.bySession };
			delete next[sessionId];
			return { bySession: next };
		}),
}));
