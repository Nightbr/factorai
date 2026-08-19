import { describe, expect, it } from 'vitest';
import { parsePosition } from './useFileViewer';

/**
 * `parsePosition` guards the two params a hand-edited URL can reach Monaco
 * through (F19). Everything it rejects is a position no file has.
 */
describe('parsePosition', () => {
	it('accepts a 1-based line, as a string or a number', () => {
		expect(parsePosition('42')).toBe(42);
		expect(parsePosition(42)).toBe(42);
		expect(parsePosition('1')).toBe(1);
	});

	it('rejects zero and negatives — lines start at 1', () => {
		expect(parsePosition('0')).toBeUndefined();
		expect(parsePosition('-3')).toBeUndefined();
	});

	it('rejects fractions', () => {
		expect(parsePosition('4.5')).toBeUndefined();
	});

	it('rejects anything that is not a number at all', () => {
		expect(parsePosition('abc')).toBeUndefined();
		expect(parsePosition('')).toBeUndefined();
		expect(parsePosition(undefined)).toBeUndefined();
		expect(parsePosition(null)).toBeUndefined();
		expect(parsePosition({})).toBeUndefined();
		// `Number(' ')` is 0 and `Number([])` is 0 — both would sneak past a
		// bare `Number.isInteger` check without the >= 1 floor.
		expect(parsePosition(' ')).toBeUndefined();
	});

	it('rejects Infinity and NaN', () => {
		expect(parsePosition('Infinity')).toBeUndefined();
		expect(parsePosition(Number.NaN)).toBeUndefined();
	});
});
