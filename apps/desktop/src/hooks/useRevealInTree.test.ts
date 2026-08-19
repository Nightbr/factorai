import { describe, expect, it } from 'vitest';
import { ancestorsWithin } from './useRevealInTree';

describe('ancestorsWithin', () => {
	it('lists the root and every directory down to the target', () => {
		expect(ancestorsWithin('/p/src/lib', '/p')).toEqual(['/p', '/p/src', '/p/src/lib']);
	});

	it('is just the root when the target is the root', () => {
		expect(ancestorsWithin('/p', '/p')).toEqual(['/p']);
	});

	it('tolerates a trailing slash on either side', () => {
		expect(ancestorsWithin('/p/src/', '/p/')).toEqual(['/p', '/p/src']);
	});

	it('yields nothing for a path outside the root', () => {
		// A symlink target somewhere else has no ancestors in this tree, and
		// half-expanding towards it would be worse than doing nothing.
		expect(ancestorsWithin('/other/x', '/p')).toEqual([]);
		// Not fooled by a sibling that shares a prefix.
		expect(ancestorsWithin('/project2/x', '/project')).toEqual([]);
	});

	it('yields nothing without a root', () => {
		expect(ancestorsWithin('/p/src', '')).toEqual([]);
	});
});
