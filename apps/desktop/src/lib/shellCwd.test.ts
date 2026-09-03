import { describe, expect, it } from 'vitest';
import { shellCwdLabel } from '@lib/shellCwd';

describe('shellCwdLabel', () => {
	it('writes the project root as a dot', () => {
		expect(shellCwdLabel('/home/me/repo', '/home/me/repo')).toBe('.');
	});

	it('writes a subdirectory relative to the root', () => {
		expect(shellCwdLabel('/home/me/repo/crates/core', '/home/me/repo')).toBe('crates/core');
	});

	it('keeps a linked checkout as its own path, not a run of dot-dots', () => {
		// **The case the tooltip exists for** (F23, ADR-0032). A worktree is not
		// under the project root at all, and `../../repo-wt-demo` is less readable
		// than the path itself — while being exactly the chip a reader is trying
		// to tell apart from the one in the root.
		expect(shellCwdLabel('/home/me/repo-wt-demo', '/home/me/repo')).toBe('/home/me/repo-wt-demo');
	});

	it('is not fooled by a shared prefix that is not a parent', () => {
		// `/home/me/repo-two` starts with `/home/me/repo` as a string and is a
		// different directory. Only a `/` boundary makes it a child.
		expect(shellCwdLabel('/home/me/repo-two/src', '/home/me/repo')).toBe('/home/me/repo-two/src');
	});

	it('ignores a trailing slash on either side', () => {
		expect(shellCwdLabel('/home/me/repo/', '/home/me/repo')).toBe('.');
		expect(shellCwdLabel('/home/me/repo', '/home/me/repo/')).toBe('.');
	});

	it('falls back to the absolute path when the project has no root on disk', () => {
		expect(shellCwdLabel('/home/me/repo/src', null)).toBe('/home/me/repo/src');
	});
});
