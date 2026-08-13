import { describe, expect, it } from 'vitest';
import { formatBytes, formatRelative } from './format';

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

describe('formatBytes', () => {
	it('uses plain bytes below 1 KB', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatBytes(1)).toBe('1 B');
		expect(formatBytes(1023)).toBe('1023 B');
	});

	it('steps up through binary units', () => {
		expect(formatBytes(1024)).toBe('1 KB');
		expect(formatBytes(1536)).toBe('1.5 KB');
		expect(formatBytes(1024 * 1024)).toBe('1 MB');
		expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
		expect(formatBytes(1024 ** 3)).toBe('1 GB');
	});

	it('drops the decimal once the number is large enough to not need it', () => {
		expect(formatBytes(128.4 * 1024)).toBe('128 KB');
		expect(formatBytes(9.75 * 1024)).toBe('9.8 KB');
	});

	it('stops at the largest unit it knows', () => {
		expect(formatBytes(1024 ** 5)).toBe('1024 TB');
	});

	it('returns a dash for nonsense rather than NaN', () => {
		expect(formatBytes(Number.NaN)).toBe('—');
		expect(formatBytes(-1)).toBe('—');
	});
});
