import { describe, expect, it } from 'vitest';
import { needsCloseConfirm } from './CloseSessionConfirm';

describe('needsCloseConfirm', () => {
	it('asks while Claude is working', () => {
		expect(needsCloseConfirm('working')).toBe(true);
	});

	it('does not ask once Claude has handed back', () => {
		// The whole point of F10: the dialog claims "any work in progress is
		// lost", and there is none.
		expect(needsCloseConfirm('waiting_input')).toBe(false);
	});

	it('does not ask about a process that is already gone', () => {
		expect(needsCloseConfirm('stopped')).toBe(false);
	});

	it('does not ask when there is no live PTY at all', () => {
		expect(needsCloseConfirm(undefined)).toBe(false);
	});
});
