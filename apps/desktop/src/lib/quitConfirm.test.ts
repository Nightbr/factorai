import { describe, expect, it } from 'vitest';
import { needsQuitConfirm, quitConfirmSentence } from './quitConfirm';

describe('needsQuitConfirm', () => {
	it('does not ask when nothing is working', () => {
		// The bug this rule exists for: four sessions open, all of them parked at
		// their prompt, and quitting stopped to warn about work that finished
		// hours ago.
		expect(needsQuitConfirm({ live: 4, working: 0 })).toBe(false);
	});

	it('does not ask when nothing is live either', () => {
		expect(needsQuitConfirm({ live: 0, working: 0 })).toBe(false);
	});

	it('asks as soon as one agent is working', () => {
		expect(needsQuitConfirm({ live: 4, working: 1 })).toBe(true);
	});
});

describe('quitConfirmSentence', () => {
	it('counts what dies, not what is working', () => {
		// The load-bearing assertion. Quitting here ends four processes; a
		// sentence built from `working` would say one and be believed.
		expect(quitConfirmSentence({ live: 4, working: 1 }, 'Quitting')).toBe(
			'Claude is working in 1 of 4 live sessions. Quitting terminates all 4 — work in progress is lost.',
		);
	});

	it('drops the "of N" clause when every live session is working', () => {
		expect(quitConfirmSentence({ live: 2, working: 2 }, 'Restarting')).toBe(
			'Claude is working in 2 sessions. Restarting terminates them — work in progress is lost.',
		);
	});

	it('says "it" for a single session', () => {
		expect(quitConfirmSentence({ live: 1, working: 1 }, 'Quitting')).toBe(
			'Claude is working in 1 session. Quitting terminates it — work in progress is lost.',
		);
	});
});
