import { describe, expect, it } from 'vitest';
import { chipTooltip, shellCwdLabel } from '@lib/shellCwd';

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

describe('chipTooltip', () => {
	const root = '/home/me/repo';

	it('is just the shell name for one pane in the project root', () => {
		// The common case, and the reason the root is omitted: `zsh · .` on every
		// chip of a single-checkout project says nothing.
		expect(chipTooltip({ label: 'zsh', cwds: [root], projectRoot: root, dead: false })).toBe('zsh');
	});

	it('names the directories that are not the root, deduplicated, on one line', () => {
		// **One line** — WebKitGTK shows only a title's first line. And one entry
		// per place: three panes in one subdirectory are one place.
		expect(
			chipTooltip({
				label: 'zsh',
				cwds: [root, `${root}/crates/core`, `${root}/crates/core`, '/home/me/repo-wt-demo'],
				projectRoot: root,
				dead: false,
			}),
		).toBe('zsh · 4 panes · crates/core, /home/me/repo-wt-demo');
	});

	it('counts panes without naming a place when they are all in the root', () => {
		expect(
			chipTooltip({ label: 'fish', cwds: [root, root, root], projectRoot: root, dead: false }),
		).toBe('fish · 3 panes');
	});

	it('says what a click on a dead chip does, in the plural it earns', () => {
		expect(chipTooltip({ label: 'zsh', cwds: [root], projectRoot: root, dead: true })).toBe(
			'zsh · click to open a new shell here',
		);
		expect(chipTooltip({ label: 'zsh', cwds: [root, root], projectRoot: root, dead: true })).toBe(
			'zsh · 2 panes · click to open new shells here',
		);
	});
});
