import { describe, expect, it } from 'vitest';
import { formatRelative } from './format';

const NOW = 1_700_000_000_000; // fixed reference

describe('formatRelative', () => {
	it('returns "just now" for <60s past', () => {
		expect(formatRelative(NOW - 30_000, NOW)).toBe('just now');
	});

	it('returns "just now" for future timestamps (clock skew)', () => {
		expect(formatRelative(NOW + 10_000, NOW)).toBe('just now');
	});

	it('formats minutes when <1h past', () => {
		expect(formatRelative(NOW - 5 * 60_000, NOW)).toBe('5m ago');
	});

	it('formats hours when <24h past', () => {
		expect(formatRelative(NOW - 3 * 60 * 60_000, NOW)).toBe('3h ago');
	});

	it('formats days when <30d past', () => {
		expect(formatRelative(NOW - 7 * 24 * 60 * 60_000, NOW)).toBe('7d ago');
	});

	it('falls back to absolute date when >=30d past', () => {
		const out = formatRelative(NOW - 31 * 24 * 60 * 60_000, NOW);
		expect(out).not.toMatch(/ago$/);
		// Just confirm it parses as a date; format is locale-dependent.
		expect(out.length).toBeGreaterThan(0);
	});
});
