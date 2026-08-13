import { describe, expect, it } from 'vitest';
import { resolveRelative } from './MarkdownView';

describe('resolveRelative', () => {
	const from = '/home/alice/repo/docs/guide.md';

	it('resolves a sibling file', () => {
		expect(resolveRelative(from, 'other.md')).toBe('/home/alice/repo/docs/other.md');
	});

	it('resolves into a subdirectory', () => {
		expect(resolveRelative(from, 'api/routes.md')).toBe('/home/alice/repo/docs/api/routes.md');
	});

	it('walks up with ..', () => {
		expect(resolveRelative(from, '../README.md')).toBe('/home/alice/repo/README.md');
		expect(resolveRelative(from, '../../README.md')).toBe('/home/alice/README.md');
	});

	it('ignores a leading ./', () => {
		expect(resolveRelative(from, './other.md')).toBe('/home/alice/repo/docs/other.md');
	});

	it('collapses redundant separators', () => {
		expect(resolveRelative(from, 'api//routes.md')).toBe('/home/alice/repo/docs/api/routes.md');
	});

	it('cannot climb above the filesystem root', () => {
		expect(resolveRelative('/a/b.md', '../../../../x.md')).toBe('/x.md');
	});

	it('handles a file at the root', () => {
		expect(resolveRelative('/README.md', 'docs/x.md')).toBe('/docs/x.md');
	});
});
