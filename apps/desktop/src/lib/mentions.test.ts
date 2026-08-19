import { describe, expect, it } from 'vitest';
import { mentionFor, mentionLabel, mentionRange } from './mentions';

describe('mentionRange', () => {
	it('is null without a selection', () => {
		expect(mentionRange(null)).toBeNull();
	});

	it('keeps a range that ends mid-line', () => {
		expect(mentionRange({ startLine: 12, endLine: 18, endColumn: 7 })).toEqual({
			start: 12,
			end: 18,
		});
	});

	it('drops a trailing line the selection only touched at column 1', () => {
		// Dragging from 12 to the start of 19 highlights nothing on 19, so
		// calling it #L12-19 claims a line the reader never selected. Every
		// editor trims this, and the CLI's own footer does the same subtraction.
		expect(mentionRange({ startLine: 12, endLine: 19, endColumn: 1 })).toEqual({
			start: 12,
			end: 18,
		});
	});

	it('does not trim a single line down to nothing', () => {
		expect(mentionRange({ startLine: 12, endLine: 12, endColumn: 1 })).toEqual({
			start: 12,
			end: 12,
		});
	});

	it('reports one line as a one-line range', () => {
		expect(mentionRange({ startLine: 5, endLine: 5, endColumn: 30 })).toEqual({
			start: 5,
			end: 5,
		});
	});
});

describe('mentionLabel', () => {
	it('names the range, so you know what you are about to send', () => {
		expect(mentionLabel(null)).toBe('Add file to Claude');
		expect(mentionLabel({ start: 5, end: 5 })).toBe('Add line 5 to Claude');
		expect(mentionLabel({ start: 12, end: 18 })).toBe('Add lines 12–18 to Claude');
	});
});

describe('mentionFor', () => {
	it('sends the whole file when there is no range', () => {
		expect(mentionFor('/p/a.ts', null)).toEqual({ path: '/p/a.ts' });
	});

	it('carries 1-based bounds, which is what the CLI prints verbatim', () => {
		expect(mentionFor('/p/a.ts', { start: 12, end: 18 })).toEqual({
			path: '/p/a.ts',
			lineStart: 12,
			lineEnd: 18,
		});
	});
});
