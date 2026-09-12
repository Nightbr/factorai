import { describe, expect, it } from 'vitest';
import { isWithin, relativeToRoot } from './paths';

describe('relativeToRoot', () => {
	it('strips the root and its separator, with no leading ./', () => {
		expect(relativeToRoot('/home/a/code/foo/src/main.ts', '/home/a/code/foo')).toBe('src/main.ts');
		expect(relativeToRoot('/home/a/code/foo/README.md', '/home/a/code/foo')).toBe('README.md');
	});

	it('calls the root itself .', () => {
		expect(relativeToRoot('/home/a/code/foo', '/home/a/code/foo')).toBe('.');
	});

	it('tolerates a trailing slash on the root', () => {
		expect(relativeToRoot('/home/a/code/foo/src', '/home/a/code/foo/')).toBe('src');
	});

	it('leaves a path outside the root absolute rather than piling up ../', () => {
		// A symlink target elsewhere on disk. Relative would only resolve from one
		// working directory; absolute is true from anywhere.
		expect(relativeToRoot('/etc/hosts', '/home/a/code/foo')).toBe('/etc/hosts');
	});

	it('does not treat a sibling with a shared prefix as inside', () => {
		expect(relativeToRoot('/home/a/code/foobar/x.ts', '/home/a/code/foo')).toBe(
			'/home/a/code/foobar/x.ts',
		);
	});

	it('returns the path unchanged with no root', () => {
		expect(relativeToRoot('/home/a/x.ts', '')).toBe('/home/a/x.ts');
	});
});

describe('isWithin', () => {
	it('holds for a file under the root', () => {
		expect(isWithin('/home/a/code/foo/src/main.ts', '/home/a/code/foo')).toBe(true);
	});

	it('holds for the root itself', () => {
		expect(isWithin('/home/a/code/foo', '/home/a/code/foo')).toBe(true);
	});

	it('rejects a sibling with a shared prefix', () => {
		expect(isWithin('/home/a/code/foobar/x.ts', '/home/a/code/foo')).toBe(false);
	});

	it('tolerates a trailing slash on the root', () => {
		expect(isWithin('/home/a/code/foo/src', '/home/a/code/foo/')).toBe(true);
	});
});
