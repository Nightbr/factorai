import { describe, expect, it } from 'vitest';
import type { FileContents } from '@factorai/types';
import { eolOf, isPlanPath, readOnlyReason } from './editable';

function file(over: Partial<FileContents> = {}): FileContents {
	return {
		path: '/repo/a.ts',
		contents: 'x',
		size: 1,
		isBinary: false,
		truncated: false,
		lineCount: 1,
		lossy: false,
		...over,
	};
}

describe('isPlanPath', () => {
	it('matches a plan in a project', () => {
		expect(isPlanPath('/repo/.claude/plans/refactor.md')).toBe(true);
	});

	it('does not match CLAUDE.md, which is the editable one', () => {
		expect(isPlanPath('/repo/CLAUDE.md')).toBe(false);
		expect(isPlanPath('/repo/.claude/settings.json')).toBe(false);
	});

	it('does not match a directory named like a plan, or a nested file', () => {
		expect(isPlanPath('/repo/.claude/plans')).toBe(false);
		expect(isPlanPath('/repo/.claude/plans/old/one.md')).toBe(false);
	});

	it('does not match a plans directory outside .claude', () => {
		expect(isPlanPath('/repo/docs/plans/roadmap.md')).toBe(false);
	});
});

describe('readOnlyReason', () => {
	it('lets an ordinary text file through', () => {
		expect(readOnlyReason(file(), '/repo/a.ts')).toBeNull();
	});

	it('refuses a truncated read, which is only a prefix', () => {
		expect(readOnlyReason(file({ truncated: true }), '/repo/a.ts')).toMatch(/truncated/);
	});

	it('refuses a lossy read, whose U+FFFD would be written back', () => {
		expect(readOnlyReason(file({ lossy: true }), '/repo/a.ts')).toMatch(/UTF-8/);
	});

	it('refuses a plan', () => {
		expect(readOnlyReason(file(), '/repo/.claude/plans/one.md')).toMatch(/plan/);
	});

	it('reports truncation first — it is the one that would delete content', () => {
		expect(readOnlyReason(file({ truncated: true, lossy: true }), '/repo/a.ts')).toMatch(
			/truncated/,
		);
	});
});

describe('eolOf', () => {
	it('reads CRLF from the first line ending', () => {
		expect(eolOf('one\r\ntwo\r\n')).toBe('crlf');
	});

	it('reads LF', () => {
		expect(eolOf('one\ntwo\n')).toBe('lf');
	});

	it('calls a file with no ending at all LF', () => {
		expect(eolOf('one line, no newline')).toBe('lf');
	});

	it('takes the first ending in a mixed file rather than rewriting the other half', () => {
		expect(eolOf('one\ntwo\r\n')).toBe('lf');
		expect(eolOf('one\r\ntwo\n')).toBe('crlf');
	});
});
