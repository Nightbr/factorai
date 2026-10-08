import { describe, expect, it } from 'vitest';
import { fnv1a } from './hash';

describe('fnv1a', () => {
	it('matches the published 32-bit FNV-1a vectors', () => {
		expect(fnv1a('')).toBe(0x811c9dc5);
		expect(fnv1a('a')).toBe(0xe40c292c);
		expect(fnv1a('foobar')).toBe(0xbf9cf968);
	});

	it('stays an unsigned 32-bit integer however long the input', () => {
		const h = fnv1a('x'.repeat(10_000));
		expect(Number.isInteger(h)).toBe(true);
		expect(h).toBeGreaterThanOrEqual(0);
		expect(h).toBeLessThan(2 ** 32);
	});
});
