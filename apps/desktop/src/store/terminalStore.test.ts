import type { TerminalStatusDto } from '@factorai/types';
import { useTerminalStore } from '@store/terminalStore';
import { beforeEach, describe, expect, it } from 'vitest';

function dto(sessionId: string, over: Partial<TerminalStatusDto> = {}): TerminalStatusDto {
	return {
		id: `pty-${sessionId}`,
		sessionId,
		projectId: 'p1',
		status: 'waiting_input',
		lastActivity: 0,
		...over,
	};
}

const reset = () => useTerminalStore.setState({ bySession: {}, order: [] });

describe('adoptLive', () => {
	beforeEach(reset);

	it('rebuilds the strip from the PTYs Rust is already running', () => {
		useTerminalStore.getState().adoptLive([dto('a'), dto('b')]);

		const s = useTerminalStore.getState();
		expect(s.order).toEqual(['a', 'b']);
		expect(s.bySession.a).toEqual({
			terminalId: 'pty-a',
			projectId: 'p1',
			status: 'waiting_input',
		});
	});

	it('keeps the real status rather than assuming working, unlike attach', () => {
		// `attach` is a spawn we just made, so `working` is a fair guess. These
		// are processes of unknown age and the backend already knows what they
		// are doing (F10) — guessing here would flash a green dot on a session
		// that has been waiting for you since before the reload.
		useTerminalStore.getState().adoptLive([dto('a', { status: 'stopped' })]);
		expect(useTerminalStore.getState().bySession.a.status).toBe('stopped');
	});

	it('merges rather than replacing, so a spawn racing the call survives', () => {
		// `terminal_list` is async and a Terminal can mount while it is in flight.
		useTerminalStore.getState().attach('new', 'pty-new', 'p2');
		useTerminalStore.getState().adoptLive([dto('old')]);

		const s = useTerminalStore.getState();
		expect(Object.keys(s.bySession).sort()).toEqual(['new', 'old']);
		expect(s.order).toEqual(['new', 'old']);
	});

	it('is idempotent, because StrictMode invokes the effect twice', () => {
		useTerminalStore.getState().adoptLive([dto('a'), dto('b')]);
		useTerminalStore.getState().adoptLive([dto('a'), dto('b')]);
		expect(useTerminalStore.getState().order).toEqual(['a', 'b']);
	});

	it('does not reorder a tab that is already placed', () => {
		useTerminalStore.getState().adoptLive([dto('a'), dto('b')]);
		useTerminalStore.getState().reorder('b', 0);
		useTerminalStore.getState().adoptLive([dto('a'), dto('b')]);
		expect(useTerminalStore.getState().order).toEqual(['b', 'a']);
	});
});
