import { describe, expect, it } from 'vitest';
import {
	findMatches,
	matchLabel,
	type SearchOptions,
	searchPattern,
	stepIndex,
} from '@components/viewer/textSearch';

const PLAIN: SearchOptions = { matchCase: false, wholeWord: false, isRegex: false };

function texts(source: string, query: string, over: Partial<SearchOptions> = {}): string[] {
	return findMatches(source, query, { ...PLAIN, ...over }).map((m) => source.slice(m.start, m.end));
}

describe('findMatches', () => {
	it('is case-insensitive until told otherwise', () => {
		expect(texts('Find find FIND', 'find')).toEqual(['Find', 'find', 'FIND']);
		expect(texts('Find find FIND', 'find', { matchCase: true })).toEqual(['find']);
	});

	it('treats the query as a literal, so regex punctuation is not a pattern', () => {
		expect(texts('a.c abc', 'a.c')).toEqual(['a.c']);
		expect(texts('a+b', 'a+b')).toEqual(['a+b']);
	});

	it('reads the query as a pattern under the regex toggle', () => {
		expect(texts('a1 b22 c333', '\\d+', { isRegex: true })).toEqual(['1', '22', '333']);
	});

	it('bounds a whole-word search on both sides', () => {
		expect(texts('find finder refind', 'find', { wholeWord: true })).toEqual(['find']);
	});

	it("bounds on word characters rather than on `\\b`, which is Monaco's rule", () => {
		// `\b\(b\)\b` finds nothing: there is no word boundary beside a bracket.
		// What whole-word means is "no word character either side", and this is
		// the case that tells the two apart.
		expect(texts('a (b) c', '(b)', { wholeWord: true })).toEqual(['(b)']);
		expect(texts('x(b)y', '(b)', { wholeWord: true })).toEqual([]);
	});

	it('finds every occurrence, including overlapping starts', () => {
		expect(findMatches('aaaa', 'aa', PLAIN)).toEqual([
			{ start: 0, end: 2 },
			{ start: 2, end: 4 },
		]);
	});

	it('does not hang on a pattern that can match nothing', () => {
		expect(texts('banana', 'a*', { isRegex: true })).toEqual(['a', 'a', 'a']);
		expect(texts('one two', '^', { isRegex: true })).toEqual([]);
	});

	it('finds nothing for an empty query rather than everything', () => {
		expect(findMatches('anything', '', PLAIN)).toEqual([]);
	});
});

describe('searchPattern', () => {
	it('is null for a pattern still being typed, which is not an error', () => {
		expect(searchPattern('(\\w+', { ...PLAIN, isRegex: true })).toBeNull();
		expect(findMatches('a word', '(\\w+', { ...PLAIN, isRegex: true })).toEqual([]);
	});
});

describe('stepIndex', () => {
	it('wraps at both ends, the way Monaco loops', () => {
		expect(stepIndex(2, 3, 1)).toBe(0);
		expect(stepIndex(0, 3, -1)).toBe(2);
	});

	it('stays at zero with nothing to step through', () => {
		expect(stepIndex(0, 0, 1)).toBe(0);
	});
});

describe('matchLabel', () => {
	it('counts from one, because a reader does', () => {
		expect(matchLabel(0, 9)).toBe('1 of 9');
	});

	it('says what Monaco says when there is nothing', () => {
		expect(matchLabel(0, 0)).toBe('No results');
	});
});
