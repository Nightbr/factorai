import { describe, expect, it } from 'vitest';
import { classify, describeError, isCancellation } from './globalErrors';

/** Exactly what Monaco constructs: `new CancellationError()` sets both `name`
 *  and `message` to `Canceled`. Rebuilt here rather than imported, because
 *  importing Monaco into a unit test would pull the whole editor bundle. */
function cancellationError(): Error {
	const e = new Error('Canceled');
	e.name = 'Canceled';
	return e;
}

describe('isCancellation', () => {
	it('recognises the error Monaco rejects a disposed worker request with', () => {
		expect(isCancellation(cancellationError())).toBe(true);
	});

	it('needs all three of Error, name and message — not just the name', () => {
		// A real error that merely mentions cancelling must not be swallowed:
		// this is the difference between ignoring noise and hiding a bug.
		const named = new Error('Request failed');
		named.name = 'Canceled';
		expect(isCancellation(named)).toBe(false);

		const messaged = new Error('Canceled');
		expect(isCancellation(messaged)).toBe(false); // name is still 'Error'

		expect(isCancellation({ name: 'Canceled', message: 'Canceled' })).toBe(false);
		expect(isCancellation('Canceled')).toBe(false);
		expect(isCancellation(null)).toBe(false);
	});
});

describe('classify', () => {
	it('ignores a cancellation whether or not the app is mounted', () => {
		for (const mounted of [true, false]) {
			expect(classify(cancellationError(), mounted).kind).toBe('ignore');
		}
	});

	it('never destroys a mounted app — the bug this exists to fix', () => {
		const d = classify(new TypeError('boom'), true);
		expect(d.kind).toBe('runtime');
		expect(d.kind === 'runtime' && d.text).toContain('TypeError: boom');
	});

	it('treats a failure with nothing rendered as a boot failure', () => {
		expect(classify(new TypeError('boom'), false).kind).toBe('boot-failure');
	});
});

describe('describeError', () => {
	it('keeps name, message and stack for a real error', () => {
		const e = new RangeError('out of range');
		const text = describeError(e);
		expect(text).toContain('RangeError: out of range');
		// The stack records where the error was *constructed*, which is this file —
		// that frame is the whole reason the stack is worth carrying.
		expect(text).toContain('globalErrors.test');
	});

	it('handles the non-Error things a rejection can carry', () => {
		// Our own AppError tagged union arrives as a plain object.
		expect(describeError({ kind: 'Io', message: 'no such file' })).toContain('no such file');
		expect(describeError('plain string')).toBe('plain string');
		expect(describeError(undefined)).toBe('undefined');
	});

	it('survives an object JSON cannot serialise', () => {
		const circular: Record<string, unknown> = { a: 1 };
		circular.self = circular;
		expect(() => describeError(circular)).not.toThrow();
		expect(describeError(circular)).toBe('[object Object]');
	});
});
