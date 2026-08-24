import { describe, expect, it } from 'vitest';
import { localImageSrc, mermaidSource, resolveRelative } from './MarkdownView';

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

interface TestNode {
	type: string;
	tagName?: string;
	value?: string;
	properties?: { className?: unknown };
	children?: TestNode[];
}

describe('mermaidSource', () => {
	/** The hast a ```<info> fence lowers to. */
	const fence = (info: string | null, body: string): TestNode => ({
		type: 'element',
		tagName: 'pre',
		properties: {},
		children: [
			{
				type: 'element',
				tagName: 'code',
				properties: info ? { className: [`language-${info}`] } : {},
				children: [{ type: 'text', value: body }],
			},
		],
	});

	it('reads the source out of a mermaid fence', () => {
		expect(mermaidSource(fence('mermaid', 'graph TD\n  A --> B\n'))).toBe('graph TD\n  A --> B\n');
	});

	it('leaves every other fence alone', () => {
		expect(mermaidSource(fence('ts', 'const a = 1;'))).toBeNull();
		expect(mermaidSource(fence(null, 'plain'))).toBeNull();
		// Close, but not the language remark labelled it with.
		expect(mermaidSource(fence('mmd', 'graph TD'))).toBeNull();
		expect(mermaidSource(fence('mermaid-js', 'graph TD'))).toBeNull();
	});

	it('accepts a className that arrived as a string', () => {
		const node = fence('mermaid', 'graph TD');
		const code = node.children?.[0];
		if (code) code.properties = { className: 'language-mermaid' };
		expect(mermaidSource(node)).toBe('graph TD');
	});

	it('has nothing to draw for an empty fence', () => {
		expect(mermaidSource(fence('mermaid', ''))).toBeNull();
		expect(mermaidSource(fence('mermaid', '  \n '))).toBeNull();
	});

	it('is null for a pre that is not a fenced code block', () => {
		expect(mermaidSource(undefined)).toBeNull();
		expect(
			mermaidSource({ type: 'element', tagName: 'p', properties: {}, children: [] }),
		).toBeNull();
		expect(
			mermaidSource({
				type: 'element',
				tagName: 'pre',
				properties: {},
				children: [{ type: 'text', value: 'graph TD' }],
			}),
		).toBeNull();
	});

	it('joins the text nodes remark may have split the literal across', () => {
		const node = fence('mermaid', '');
		const code = node.children?.[0];
		if (code)
			code.children = [
				{ type: 'text', value: 'graph TD\n' },
				{ type: 'text', value: '  A --> B' },
			];
		expect(mermaidSource(node)).toBe('graph TD\n  A --> B');
	});
});
