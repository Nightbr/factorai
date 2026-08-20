import { describe, expect, it } from 'vitest';
import type { CloseConfirmPrefs } from './CloseSessionConfirm';
import { needsCloseConfirm } from './CloseSessionConfirm';

/** Both switches on, which is how they ship (F11). */
const ON: CloseConfirmPrefs = { confirmCloseSession: true, confirmCloseMiddleClick: true };

describe('needsCloseConfirm', () => {
	it('asks while Claude is working', () => {
		expect(needsCloseConfirm('working', 'button', ON)).toBe(true);
		expect(needsCloseConfirm('working', 'middle-click', ON)).toBe(true);
	});

	it('does not ask once Claude has handed back', () => {
		// The whole point of F10: the dialog claims "any work in progress is
		// lost", and there is none.
		expect(needsCloseConfirm('waiting_input', 'button', ON)).toBe(false);
	});

	it('does not ask about a process that is already gone', () => {
		expect(needsCloseConfirm('stopped', 'button', ON)).toBe(false);
	});

	it('does not ask when there is no live PTY at all', () => {
		expect(needsCloseConfirm(undefined, 'button', ON)).toBe(false);
	});

	it('stops asking about the × once that switch is off', () => {
		const prefs: CloseConfirmPrefs = { ...ON, confirmCloseSession: false };
		expect(needsCloseConfirm('working', 'button', prefs)).toBe(false);
		// And leaves the wheel-click alone: they are two switches precisely
		// because a stray middle-click is not an aimed one.
		expect(needsCloseConfirm('working', 'middle-click', prefs)).toBe(true);
	});

	it('stops asking about a middle-click once that switch is off', () => {
		const prefs: CloseConfirmPrefs = { ...ON, confirmCloseMiddleClick: false };
		expect(needsCloseConfirm('working', 'middle-click', prefs)).toBe(false);
		expect(needsCloseConfirm('working', 'button', prefs)).toBe(true);
	});

	it('never asks about a session that is not working, whatever the switches say', () => {
		const prefs: CloseConfirmPrefs = {
			confirmCloseSession: false,
			confirmCloseMiddleClick: false,
		};
		// The status gate comes first: turning the questions off cannot invent one.
		for (const gesture of ['button', 'middle-click'] as const) {
			expect(needsCloseConfirm('waiting_input', gesture, prefs)).toBe(false);
			expect(needsCloseConfirm('waiting_input', gesture, ON)).toBe(false);
		}
	});
});
