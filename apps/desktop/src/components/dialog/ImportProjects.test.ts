import { filterCandidates, selectAllState } from '@components/dialog/ImportProjects';
import type { ImportCandidate } from '@factorai/types';
import { describe, expect, it } from 'vitest';

function candidate(realPath: string, alreadyOpen = false): ImportCandidate {
	return {
		agent: 'claude',
		key: `-${realPath.replace(/^\/+/, '').replace(/\//g, '-')}`,
		realPath,
		displayName: realPath.split('/').filter(Boolean).pop() ?? realPath,
		sessionCount: 3,
		lastActivityAt: 1_000,
		missing: false,
		alreadyOpen,
	};
}

describe('filterCandidates', () => {
	const rows = [
		candidate('/home/alice/work/desktop'),
		candidate('/home/alice/side/desktop'),
		candidate('/home/alice/work/api'),
	];

	it('matches on the whole path, not just the name', () => {
		// The reason the filter exists: two folders called `desktop` are
		// indistinguishable by name, and telling them apart is the whole job.
		expect(filterCandidates(rows, 'side').map((r) => r.realPath)).toEqual([
			'/home/alice/side/desktop',
		]);
	});

	it('ignores case and surrounding whitespace', () => {
		expect(filterCandidates(rows, '  WORK/API ')).toHaveLength(1);
	});

	it('returns everything for an empty needle', () => {
		expect(filterCandidates(rows, '')).toHaveLength(3);
		expect(filterCandidates(rows, '   ')).toHaveLength(3);
	});
});

describe('selectAllState', () => {
	const a = candidate('/a');
	const b = candidate('/b');

	it('is unchecked when nothing is selected', () => {
		expect(selectAllState([a, b], new Set())).toBe(false);
	});

	it('is indeterminate on a partial selection', () => {
		// An empty box here would say something false about what clicking does.
		expect(selectAllState([a, b], new Set([a.key]))).toBe('indeterminate');
	});

	it('is checked when every selectable row is selected', () => {
		expect(selectAllState([a, b], new Set([a.key, b.key]))).toBe(true);
	});

	it('is unchecked, not indeterminate, when there is nothing to select', () => {
		// Every row already in the workspace: the box is disabled, and a dash on a
		// disabled control reads as "partially done" rather than "nothing to do".
		expect(selectAllState([], new Set())).toBe(false);
	});

	it('ignores rows that are already in the workspace', () => {
		// `selectable` excludes them, so a list of one importable row plus three
		// already-open ones reads as fully selected once that one is ticked —
		// rather than as perpetually partial.
		const open = candidate('/c', true);
		expect(selectAllState([a], new Set([a.key, open.key]))).toBe(true);
	});
});
