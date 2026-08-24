import { describe, expect, it } from 'vitest';
import { isExternalUrl, parseFrontmatter, splitFrontmatter } from './frontmatter';

describe('splitFrontmatter', () => {
	it('takes a fenced block off the front and leaves the body', () => {
		const { frontmatter, body } = splitFrontmatter('---\ntitle: Spec\n---\n\n# Heading\n');
		expect(frontmatter?.fields).toEqual([{ key: 'title', value: { kind: 'text', text: 'Spec' } }]);
		expect(body).toBe('\n# Heading\n');
	});

	it('accepts a `...` closing fence', () => {
		const { frontmatter, body } = splitFrontmatter('---\ntitle: Spec\n...\nprose\n');
		expect(frontmatter?.fields).toHaveLength(1);
		expect(body).toBe('prose\n');
	});

	it('leaves a document that never closes its fence alone', () => {
		const source = '---\nnot frontmatter, a thematic break\n';
		expect(splitFrontmatter(source)).toEqual({ frontmatter: null, body: source });
	});

	it('leaves a fence that is not the first line alone', () => {
		const source = '# Heading\n\n---\ntitle: Spec\n---\n';
		expect(splitFrontmatter(source)).toEqual({ frontmatter: null, body: source });
	});

	it('shows no panel for an empty block, and still drops it', () => {
		const { frontmatter, body } = splitFrontmatter('---\n---\n# Heading\n');
		expect(frontmatter).toBeNull();
		expect(body).toBe('# Heading\n');
	});

	it('handles CRLF line endings', () => {
		const { frontmatter, body } = splitFrontmatter('---\r\ntitle: Spec\r\n---\r\n# Heading\r\n');
		expect(frontmatter?.fields).toHaveLength(1);
		expect(body).toBe('# Heading\n');
	});

	it('skips a leading BOM', () => {
		const { frontmatter } = splitFrontmatter('﻿---\ntitle: Spec\n---\n');
		expect(frontmatter?.fields).toHaveLength(1);
	});

	it('does not treat a horizontal rule further down as a closing fence body', () => {
		const { body } = splitFrontmatter('---\ntitle: Spec\n---\na\n\n---\n\nb\n');
		expect(body).toBe('a\n\n---\n\nb\n');
	});
});

describe('parseFrontmatter', () => {
	it('keeps fields in the order they were written', () => {
		const { fields } = parseFrontmatter('b: 1\na: 2\n10: 3\n');
		expect(fields?.map((f) => f.key)).toEqual(['b', 'a', '10']);
	});

	it('reads the shapes a document actually uses', () => {
		const { fields, error } = parseFrontmatter(
			[
				'title: "Facet-driven action scoring"',
				'date: 2026-08-24',
				'draft: false',
				'weight: 3',
				'reviewers: ["Noé Pion", "Laurent Anadon"]',
				'notion_source: null # not exported',
				'links:',
				'  issue: ENG-3150',
			].join('\n'),
		);
		expect(error).toBeNull();
		expect(fields).toEqual([
			{ key: 'title', value: { kind: 'text', text: 'Facet-driven action scoring' } },
			// The core schema leaves a bare date a string, which is what was typed.
			{ key: 'date', value: { kind: 'text', text: '2026-08-24' } },
			{ key: 'draft', value: { kind: 'text', text: 'false' } },
			{ key: 'weight', value: { kind: 'text', text: '3' } },
			{
				key: 'reviewers',
				value: {
					kind: 'list',
					items: [
						{ kind: 'text', text: 'Noé Pion' },
						{ kind: 'text', text: 'Laurent Anadon' },
					],
				},
			},
			{ key: 'notion_source', value: { kind: 'empty' } },
			{
				key: 'links',
				value: {
					kind: 'map',
					fields: [{ key: 'issue', value: { kind: 'text', text: 'ENG-3150' } }],
				},
			},
		]);
	});

	it('treats an empty string, an empty list and an empty map as no value', () => {
		const { fields } = parseFrontmatter('a: ""\nb: []\nc: {}\n');
		expect(fields?.map((f) => f.value.kind)).toEqual(['empty', 'empty', 'empty']);
	});

	it('keeps the line breaks of a block scalar', () => {
		const { fields } = parseFrontmatter('note: |\n  one\n  two\n');
		expect(fields?.[0]?.value).toEqual({ kind: 'text', text: 'one\ntwo\n' });
	});

	it('keeps the source and the reason when the YAML will not parse', () => {
		const raw = 'title: "unterminated\n';
		const parsed = parseFrontmatter(raw);
		expect(parsed.fields).toBeNull();
		expect(parsed.raw).toBe(raw);
		expect(parsed.error).toBeTruthy();
		expect(parsed.error).not.toContain('\n');
	});

	it('refuses a block that parses to something other than fields', () => {
		expect(parseFrontmatter('- one\n- two\n').fields).toBeNull();
		expect(parseFrontmatter('just a string\n').fields).toBeNull();
	});
});

describe('isExternalUrl', () => {
	it('accepts the two schemes a markdown link hands to the OS', () => {
		expect(isExternalUrl('https://linear.app/hey-pearl/issue/ENG-3150')).toBe(true);
		expect(isExternalUrl('http://example.com')).toBe(true);
		expect(isExternalUrl('mailto:titouan@heypearl.ai')).toBe(true);
	});

	it('rejects everything else, including a path and a bare domain', () => {
		expect(isExternalUrl('Draft')).toBe(false);
		expect(isExternalUrl('example.com')).toBe(false);
		expect(isExternalUrl('/home/me/spec.md')).toBe(false);
		expect(isExternalUrl('file:///etc/hosts')).toBe(false);
		expect(isExternalUrl('https://example.com two words')).toBe(false);
	});
});
