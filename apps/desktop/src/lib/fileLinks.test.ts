import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	candidatePaths,
	classify,
	clearKindCache,
	findCandidates,
	looksLikePath,
	normalizePosix,
	resolveLinks,
} from './fileLinks';

vi.mock('@lib/tauri', () => ({
	cmd: { pathKinds: vi.fn() },
}));

const { cmd } = await import('@lib/tauri');
const pathKinds = cmd.pathKinds as unknown as ReturnType<typeof vi.fn>;

/** Answer `file` for anything in `present`, `missing` otherwise. */
function diskWith(present: string[]) {
	pathKinds.mockImplementation((paths: string[]) =>
		Promise.resolve(paths.map((p) => (present.includes(p) ? 'file' : 'missing'))),
	);
}

beforeEach(() => {
	clearKindCache();
	pathKinds.mockReset();
});

describe('looksLikePath', () => {
	it('accepts anything with a separator', () => {
		expect(looksLikePath('src/foo.ts')).toBe(true);
		expect(looksLikePath('./scripts/qa/kill.sh')).toBe(true);
		expect(looksLikePath('src/components/')).toBe(true);
		expect(looksLikePath('specs/roadmap')).toBe(true);
	});

	it('accepts a dotted filename and a dotfile', () => {
		expect(looksLikePath('README.md')).toBe(true);
		expect(looksLikePath('Cargo.toml')).toBe(true);
		expect(looksLikePath('foo.test.ts')).toBe(true);
		expect(looksLikePath('.gitignore')).toBe(true);
		expect(looksLikePath('.env.local')).toBe(true);
	});

	it('rejects a version string, which is the common false positive', () => {
		// The extension has to start with a letter. This is the whole reason
		// that rule exists.
		expect(looksLikePath('1.2.3')).toBe(false);
		expect(looksLikePath('v2.1.235')).toBe(false);
		expect(looksLikePath('0.12.0')).toBe(false);
	});

	it('rejects a bare word, so prose does not become links', () => {
		expect(looksLikePath('test')).toBe(false);
		expect(looksLikePath('Makefile')).toBe(false);
		expect(looksLikePath('')).toBe(false);
		expect(looksLikePath('/')).toBe(false);
	});
});

describe('findCandidates', () => {
	it('finds a path and reports where it sits', () => {
		const [c] = findCandidates('edited src/lib/foo.ts today');
		expect(c.raw).toBe('src/lib/foo.ts');
		expect(c.start).toBe(7);
		expect(c.end).toBe(21);
		expect(c.line).toBeNull();
	});

	it('reads a :line and a :line:col suffix into the range', () => {
		const [a] = findCandidates('see src/foo.ts:42');
		expect([a.raw, a.line, a.col]).toEqual(['src/foo.ts', 42, null]);
		expect(a.end).toBe(17);

		const [b] = findCandidates('see src/foo.ts:42:7');
		expect([b.raw, b.line, b.col]).toEqual(['src/foo.ts', 42, 7]);
		expect(b.end).toBe(19);
	});

	it('drops a trailing full stop or comma but keeps the path', () => {
		expect(findCandidates('open README.md.')[0].raw).toBe('README.md');
		expect(findCandidates('a.ts, b.ts').map((c) => c.raw)).toEqual(['a.ts', 'b.ts']);
	});

	it('leaves URLs alone — those belong to WebLinksAddon (F5)', () => {
		// Two providers claiming the same cells is a fight the user watches.
		expect(findCandidates('see https://example.com/docs/guide.md')).toEqual([]);
		expect(findCandidates('at http://localhost:3000/app.js')).toEqual([]);
	});

	it('does not read a timestamp as a path with a line number', () => {
		expect(findCandidates('finished at 12:34:56')).toEqual([]);
	});

	it('splits on a colon that is not a position suffix', () => {
		expect(findCandidates('note:src/foo.ts').map((c) => c.raw)).toEqual(['src/foo.ts']);
	});

	it('finds several on one line', () => {
		expect(findCandidates('moved src/a.ts to src/b.ts').map((c) => c.raw)).toEqual([
			'src/a.ts',
			'src/b.ts',
		]);
	});

	it('ignores `..` on its own', () => {
		expect(findCandidates('cd ..')).toEqual([]);
	});
});

describe('normalizePosix', () => {
	it('collapses . and .. and duplicate separators', () => {
		expect(normalizePosix('/a/b/../c')).toBe('/a/c');
		expect(normalizePosix('/a//b/./c')).toBe('/a/b/c');
		expect(normalizePosix('a/b/../../c')).toBe('c');
	});

	it('cannot climb past the root', () => {
		expect(normalizePosix('/../..')).toBe('/');
		expect(normalizePosix('/a/../../b')).toBe('/b');
	});

	it('keeps leading .. on a relative path, which is still meaningful', () => {
		expect(normalizePosix('../sibling/x.ts')).toBe('../sibling/x.ts');
	});
});

describe('candidatePaths', () => {
	const ctx = { bases: ['/home/u/proj/sub', '/home/u/proj'], home: '/home/u' };

	it('takes an absolute path as it is', () => {
		expect(candidatePaths('/etc/hosts', ctx)).toEqual(['/etc/hosts']);
	});

	it('expands ~ against home', () => {
		expect(candidatePaths('~/.claude/settings.json', ctx)).toEqual([
			'/home/u/.claude/settings.json',
		]);
	});

	it('offers no ~ expansion when there is no home to expand against', () => {
		expect(candidatePaths('~/x.ts', { bases: ctx.bases, home: null })).toEqual([]);
	});

	it('tries every base in order, for a relative path', () => {
		expect(candidatePaths('src/foo.ts', ctx)).toEqual([
			'/home/u/proj/sub/src/foo.ts',
			'/home/u/proj/src/foo.ts',
		]);
	});

	it('dedupes bases that resolve to the same place', () => {
		expect(candidatePaths('a.ts', { bases: ['/p', '/p/'], home: null })).toEqual(['/p/a.ts']);
	});
});

describe('resolveLinks', () => {
	const ctx = { bases: ['/proj/sub', '/proj'], home: '/home/u' };

	it('keeps only what is really on disk', async () => {
		diskWith(['/proj/src/real.ts']);
		const links = await resolveLinks('touched src/real.ts and src/ghost.ts', ctx);
		expect(links.map((l) => l.path)).toEqual(['/proj/src/real.ts']);
	});

	it('prefers the first base that exists — cwd before project root', async () => {
		diskWith(['/proj/sub/a.ts', '/proj/a.ts']);
		const [link] = await resolveLinks('see a.ts', ctx);
		expect(link.path).toBe('/proj/sub/a.ts');
	});

	it('falls through to the project root when the cwd has nothing', async () => {
		diskWith(['/proj/a.ts']);
		const [link] = await resolveLinks('see a.ts', ctx);
		expect(link.path).toBe('/proj/a.ts');
	});

	it('carries the position through', async () => {
		diskWith(['/proj/src/x.ts']);
		const [link] = await resolveLinks('at src/x.ts:12:3', ctx);
		expect([link.line, link.col]).toEqual([12, 3]);
	});

	it('does not link a directory the tree cannot show', async () => {
		// `~/.claude/projects/` is real and interesting, and clicking it would do
		// nothing — the tree only shows this project. Better not a link at all.
		pathKinds.mockResolvedValue(['directory']);
		expect(await resolveLinks('under /home/u/.claude/projects/', ctx)).toEqual([]);
	});

	it('still links a directory inside the project', async () => {
		pathKinds.mockResolvedValue(['directory']);
		const [link] = await resolveLinks('under /proj/sub/src/', ctx);
		expect([link.path, link.kind]).toEqual(['/proj/sub/src', 'directory']);
	});

	it('reports a directory as a directory', async () => {
		pathKinds.mockResolvedValue(['directory']);
		const [link] = await resolveLinks('under src/components/', {
			bases: ['/proj'],
			home: null,
		});
		expect(link.kind).toBe('directory');
	});

	it('asks the backend once for the whole line', async () => {
		diskWith([]);
		await resolveLinks('a.ts b.ts c.ts', { bases: ['/proj'], home: null });
		expect(pathKinds).toHaveBeenCalledTimes(1);
		expect(pathKinds).toHaveBeenCalledWith(['/proj/a.ts', '/proj/b.ts', '/proj/c.ts']);
	});

	it('does not ask twice about a path it already found', async () => {
		diskWith(['/proj/a.ts']);
		await resolveLinks('see a.ts', { bases: ['/proj'], home: null });
		await resolveLinks('see a.ts again', { bases: ['/proj'], home: null });
		expect(pathKinds).toHaveBeenCalledTimes(1);
	});
});

describe('the kind cache remembers what exists and forgets what does not', () => {
	it('re-asks about a missing path once its entry has expired', async () => {
		diskWith([]);
		const ctx = { bases: ['/proj'], home: null };

		await resolveLinks('see a.ts', ctx);
		expect(pathKinds).toHaveBeenCalledTimes(1);

		// Within the TTL, the negative is trusted.
		await classify(['/proj/a.ts'], 1_000);
		expect(pathKinds).toHaveBeenCalledTimes(1);
	});

	it('a file the agent just wrote becomes clickable once the negative lapses', async () => {
		const ctx = { bases: ['/proj'], home: null };
		diskWith([]);
		await classify(['/proj/new.ts'], 0);

		// The agent creates it, and 11 seconds later the reader hovers again.
		diskWith(['/proj/new.ts']);
		expect(await classify(['/proj/new.ts'], 11_000)).toEqual(new Map([['/proj/new.ts', 'file']]));
		expect(await resolveLinks('see new.ts', ctx)).toHaveLength(1);
	});
});
