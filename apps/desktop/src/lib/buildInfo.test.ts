import { describe, expect, it } from 'vitest';
import { type BuildInfo, buildLine, formatBuildDate, parseBuildInfo } from '@lib/buildInfo';

/**
 * The parser is where F29's "absence is a state" rule is actually enforced, and
 * it is the half of the About pane that never runs on a developer's machine —
 * every local build takes the `null` branch. So the release shape is tested
 * here rather than discovered by a user reading a pane with blanks in it.
 */

const RELEASE = {
	version: '0.3.0',
	builtAt: '2026-09-16T11:02:37Z',
	commit: 'a6ac769',
	contributors: [{ login: 'octocat', url: 'https://github.com/octocat' }],
};

describe('parseBuildInfo', () => {
	it('takes a file the script wrote', () => {
		expect(parseBuildInfo(RELEASE)).toEqual(RELEASE satisfies BuildInfo);
	});

	it('treats a missing commit as a build with no git to ask', () => {
		expect(parseBuildInfo({ ...RELEASE, commit: null })?.commit).toBeNull();
		expect(parseBuildInfo({ ...RELEASE, commit: undefined })?.commit).toBeNull();
	});

	it('defaults an absent contributor list to empty rather than rejecting', () => {
		const { contributors: _, ...withoutList } = RELEASE;
		expect(parseBuildInfo(withoutList)?.contributors).toEqual([]);
	});

	it.each([
		['not an object', 'a6ac769'],
		['no version', { ...RELEASE, version: '' }],
		['no build date', { ...RELEASE, builtAt: undefined }],
		['a build date nothing can parse', { ...RELEASE, builtAt: 'last Tuesday' }],
		['a commit that is not a string', { ...RELEASE, commit: 7 }],
		['a contributor list that is not a list', { ...RELEASE, contributors: {} }],
		['a contributor with no url', { ...RELEASE, contributors: [{ login: 'octocat' }] }],
	])('rejects %s whole', (_label, value) => {
		// Whole, not partially: the dev wording is a designed state, a pane with
		// three blanks in it is not (F29).
		expect(parseBuildInfo(value)).toBeNull();
	});
});

describe('buildLine', () => {
	it('names the build a bug report is about', () => {
		expect(buildLine(RELEASE)).toBe('factorai 0.3.0 (a6ac769), built 2026-09-16');
	});

	it('drops the parenthesis when there is no commit', () => {
		expect(buildLine({ ...RELEASE, commit: null })).toBe('factorai 0.3.0, built 2026-09-16');
	});

	it('says so rather than inventing a release for a local build', () => {
		expect(buildLine(null)).toContain('built locally');
	});
});

describe('formatBuildDate', () => {
	it('renders a date', () => {
		// The locale decides the order, so assert the parts rather than the
		// string: the app does not localize, but the machine still has a locale.
		const formatted = formatBuildDate(RELEASE.builtAt);
		expect(formatted).toContain('2026');
		expect(formatted).not.toBe('—');
	});

	it('shows an em dash for a date it cannot read', () => {
		expect(formatBuildDate('last Tuesday')).toBe('—');
	});
});
