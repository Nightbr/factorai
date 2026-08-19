import { describe, expect, it } from 'vitest';
import { localImageSrc, resolveRelative } from './MarkdownView';

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

	it('takes a leading slash as absolute rather than appending it', () => {
		expect(resolveRelative(from, '/etc/hosts')).toBe('/etc/hosts');
	});
});

describe('localImageSrc', () => {
	const from = '/home/alice/repo/docs/guide.md';

	it('resolves a relative image against the document', () => {
		expect(localImageSrc(from, 'img/diagram.png')).toBe('/home/alice/repo/docs/img/diagram.png');
		expect(localImageSrc(from, '../logo.png')).toBe('/home/alice/repo/logo.png');
	});

	it('treats a leading slash as a filesystem path, not a site root', () => {
		expect(localImageSrc(from, '/home/bob/shot.png')).toBe('/home/bob/shot.png');
	});

	it('leaves a remote image to the webview', () => {
		expect(localImageSrc(from, 'https://img.shields.io/badge.svg')).toBeNull();
		expect(localImageSrc(from, 'HTTP://example.com/a.png')).toBeNull();
	});

	it('has nothing to open for a src react-markdown sanitised away', () => {
		expect(localImageSrc(from, '')).toBeNull();
		expect(localImageSrc(from, '   ')).toBeNull();
	});

	it('drops the query and fragment a URL may carry', () => {
		expect(localImageSrc(from, 'logo.png?v=2')).toBe('/home/alice/repo/docs/logo.png');
		expect(localImageSrc(from, 'logo.svg#icon')).toBe('/home/alice/repo/docs/logo.svg');
		expect(localImageSrc(from, '#anchor')).toBeNull();
	});

	it('decodes percent-escapes, since the target is a path and not a URL', () => {
		expect(localImageSrc(from, 'my%20logo.png')).toBe('/home/alice/repo/docs/my logo.png');
	});

	it('keeps a stray percent that is not an escape', () => {
		expect(localImageSrc(from, '100%off.png')).toBe('/home/alice/repo/docs/100%off.png');
	});
});
