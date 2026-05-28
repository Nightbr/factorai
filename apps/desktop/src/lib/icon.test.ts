import { describe, expect, it } from 'vitest';
import { hashHue, pickInitials } from './icon';

describe('hashHue', () => {
	it('is deterministic', () => {
		expect(hashHue('/Users/alice/code/foo')).toBe(hashHue('/Users/alice/code/foo'));
	});

	it('is always in [0, 360)', () => {
		const samples = [
			'/Users/a/b',
			'/home/nightbringer/Dev/factorai',
			'',
			'-',
			'something-with-many-dashes-in-it',
			'a',
		];
		for (const s of samples) {
			const h = hashHue(s);
			expect(h).toBeGreaterThanOrEqual(0);
			expect(h).toBeLessThan(360);
		}
	});

	it('different inputs usually produce different hues', () => {
		// Not a hard guarantee, but a useful smoke check: at least 8 unique
		// hues out of 10 sample strings.
		const inputs = Array.from({ length: 10 }, (_, i) => `/Users/u${i}/proj`);
		const hues = new Set(inputs.map(hashHue));
		expect(hues.size).toBeGreaterThanOrEqual(8);
	});
});

describe('pickInitials', () => {
	it('takes one letter from each of the first two words', () => {
		expect(pickInitials('factor ai')).toBe('FA');
	});

	it('handles hyphen-separated names', () => {
		expect(pickInitials('hey-pearl')).toBe('HP');
	});

	it('handles underscore-separated names', () => {
		expect(pickInitials('snake_case_thing')).toBe('SC');
	});

	it('uses first two chars when single word', () => {
		expect(pickInitials('factorai')).toBe('FA');
	});

	it('strips leading -/_/. (encoded dir names)', () => {
		expect(pickInitials('-Users-alice-code-foo')).toBe('UA');
	});

	it('returns "?" for empty', () => {
		expect(pickInitials('')).toBe('?');
		expect(pickInitials('---')).toBe('?');
	});

	it('uppercases', () => {
		expect(pickInitials('lowercase')).toBe('LO');
	});
});
