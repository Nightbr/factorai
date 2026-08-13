import { describe, expect, it } from 'vitest';
import { formatError } from './errors';

describe('formatError', () => {
	it('names the kind and the message of a tagged AppError', () => {
		expect(
			formatError({ kind: 'NotFound', message: 'working directory /gone does not exist' }),
		).toBe('NotFound: working directory /gone does not exist');
	});

	it('does not render an AppError as [object Object]', () => {
		// The regression this exists for: a failed spawn used to print
		// "Failed to spawn claude: [object Object]" into the terminal pane.
		const out = formatError({ kind: 'Process', message: 'spawn: no such file' });
		expect(out).not.toContain('[object Object]');
	});

	it('unwraps an Error to its message', () => {
		expect(formatError(new Error('boom'))).toBe('boom');
	});

	it('passes a string through', () => {
		expect(formatError('plain failure')).toBe('plain failure');
	});

	it('falls back to String() for anything else', () => {
		expect(formatError(42)).toBe('42');
		expect(formatError(null)).toBe('null');
		// An object that isn't an AppError has no kind/message to show.
		expect(formatError({ nope: true })).toBe('[object Object]');
	});
});
