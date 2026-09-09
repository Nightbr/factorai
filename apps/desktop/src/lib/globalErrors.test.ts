import { describe, expect, it } from 'vitest';
import { classify, describeError, isCancellation, isDisposedDiff } from './globalErrors';

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

/** What Monaco's diff provider throws when the worker no longer holds one of
 *  the two models — a bare Error, no name, no code. */
function disposedDiffError(): Error {
	return new Error('no diff result available');
}

describe('isDisposedDiff', () => {
	it('recognises the diff race that is not dressed as a cancellation', () => {
		expect(isDisposedDiff(disposedDiffError())).toBe(true);
	});

	it('matches the message exactly, so another worker failure still reaches the screen', () => {
		expect(isDisposedDiff(new Error('no diff result available for foo.ts'))).toBe(false);
		expect(isDisposedDiff(new Error('worker failed to start'))).toBe(false);
		expect(isDisposedDiff({ message: 'no diff result available' })).toBe(false);
		expect(isDisposedDiff('no diff result available')).toBe(false);
		expect(isDisposedDiff(null)).toBe(false);
	});
});

describe('classify', () => {
	it('ignores a cancellation whether or not the app is mounted', () => {
		for (const mounted of [true, false]) {
			expect(classify(cancellationError(), mounted).kind).toBe('ignore');
		}
	});

	it('ignores the disposed-diff race the same way, and says which it was', () => {
		for (const mounted of [true, false]) {
			const d = classify(disposedDiffError(), mounted);
			expect(d.kind).toBe('ignore');
			if (d.kind === 'ignore') expect(d.why).toMatch(/disposed/);
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

	it('ignores an event carrying no error and no message', () => {
		// A failed resource load fires `error` on window as a plain Event, so
		// `e.error ?? e.message` is undefined. Reporting it renders a card reading
		// "undefined", which trains you to dismiss the ones that matter.
		for (const empty of [undefined, null, '']) {
			expect(classify(empty, true).kind).toBe('ignore');
			expect(classify(empty, false).kind).toBe('ignore');
		}
	});

	it('still reports a falsy-but-real value', () => {
		// `0` and `false` are rubbish to reject with, but they are *something* —
		// swallowing them would be the filter hiding a bug again.
		expect(classify(0, true).kind).toBe('runtime');
		expect(classify(false, true).kind).toBe('runtime');
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
