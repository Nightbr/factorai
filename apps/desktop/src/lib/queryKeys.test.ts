import { describe, expect, it } from 'vitest';
import { queryKeys } from './queryKeys';

describe('queryKeys', () => {
	it('projects() is a stable tuple', () => {
		expect(queryKeys.projects()).toEqual(['projects']);
	});

	it('sessions() includes the project id', () => {
		expect(queryKeys.sessions('-Users-alice-foo')).toEqual(['sessions', '-Users-alice-foo']);
	});

	it('session() includes id, offset, limit', () => {
		expect(queryKeys.session('abc-123', 0, 500)).toEqual(['session', 'abc-123', 0, 500]);
	});

	it('different offsets produce different keys', () => {
		const a = queryKeys.session('abc', 0, 500);
		const b = queryKeys.session('abc', 500, 500);
		expect(a).not.toEqual(b);
	});

	it('sessionTail() includes id and limit', () => {
		expect(queryKeys.sessionTail('abc', 100)).toEqual(['session-tail', 'abc', 100]);
	});

	it('sessionTail key is distinct from session key', () => {
		expect(queryKeys.sessionTail('abc', 100)).not.toEqual(queryKeys.session('abc', 0, 100));
	});

	it('dir() keys per absolute path', () => {
		expect(queryKeys.dir('/a/b')).toEqual(['dir', '/a/b']);
		expect(queryKeys.dir('/a/b')).not.toEqual(queryKeys.dir('/a/c'));
	});

	it('file() separates capped from uncapped reads', () => {
		expect(queryKeys.file('/a/b.ts', false)).toEqual(['file', '/a/b.ts', 'capped']);
		expect(queryKeys.file('/a/b.ts', true)).not.toEqual(queryKeys.file('/a/b.ts', false));
	});
});
