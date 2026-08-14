import type { GitChange } from '@factorai/types';
import { describe, expect, it } from 'vitest';
import { buildDecorations } from '@hooks/useGitDecorations';

function change(path: string, over: Partial<GitChange> = {}): GitChange {
	return {
		path,
		relPath: path,
		group: 'unstaged',
		kind: 'modified',
		oldRelPath: null,
		additions: 1,
		deletions: 0,
		isBinary: false,
		...over,
	};
}

function decorations(changes: GitChange[], repoRoot = '/repo') {
	return buildDecorations(changes, repoRoot);
}

describe('buildDecorations', () => {
	it('decorates the changed file itself', () => {
		const d = decorations([change('/repo/app/src/a.ts')]);

		expect(d.get('/repo/app/src/a.ts')).toBe('modified');
		expect(d.get('/repo/app/src/b.ts')).toBeUndefined();
	});

	it('bubbles up to every ancestor directory, so a collapsed folder shows a dot', () => {
		const d = decorations([change('/repo/app/src/deep/a.ts')]);

		expect(d.get('/repo/app/src/deep')).toBe('modified');
		expect(d.get('/repo/app/src')).toBe('modified');
		expect(d.get('/repo/app')).toBe('modified');
		expect(d.get('/repo')).toBe('modified');
	});

	it('stops at the repository root rather than walking to /', () => {
		const d = decorations([change('/repo/app/src/a.ts')]);

		expect(d.get('/')).toBeUndefined();
		expect(d.get('')).toBeUndefined();
	});

	it('gives a directory the most severe status among its descendants', () => {
		// Conflicted outranks untracked outranks modified — during a rebase the
		// folder holding the conflict has to be the one that stands out.
		const d = decorations([
			change('/repo/app/src/a.ts', { kind: 'modified' }),
			change('/repo/app/src/b.ts', { kind: 'untracked' }),
			change('/repo/app/src/c.ts', { kind: 'conflicted', group: 'conflicted' }),
		]);

		expect(d.get('/repo/app/src')).toBe('conflicted');
		expect(d.get('/repo/app/src/a.ts')).toBe('modified');
		expect(d.get('/repo/app/src/b.ts')).toBe('untracked');
	});

	it('treats a staged addition as untracked-green, like git does', () => {
		const d = decorations([change('/repo/app/new.ts', { kind: 'added', group: 'staged' })]);

		expect(d.get('/repo/app/new.ts')).toBe('untracked');
	});

	it('decorates nothing when there are no changes', () => {
		const d = decorations([]);

		expect(d.get('/repo/app/src/a.ts')).toBeUndefined();
		expect(d.size).toBe(0);
	});
});
