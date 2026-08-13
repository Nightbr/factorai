/**
 * Helpers for installing a settable mock Tauri bridge into the renderer
 * before the page loads.
 *
 * Tolaria-style: install via `page.addInitScript` so the global lands on
 * `window` before any module runs. The renderer's `lib/tauri.ts`
 * mockInvoke() reads from `window.__FACTORAI_TEST__`.
 */

import type { Page } from '@playwright/test';
import type {
	DirEntry,
	DirListing,
	FileContents,
	Project,
	SearchHit,
	SessionPage,
	SessionSummary,
	TerminalId,
} from '@factorai/types';

export interface TestFixture {
	projects?: Project[];
	sessionsByProject?: Record<string, SessionSummary[]>;
	sessionPages?: Record<string, SessionPage>;
	terminalSpawnId?: TerminalId;
	searchHits?: SearchHit[];
	/** Directory listings keyed by absolute path (F12 file tree). Paths the
	 *  test never expands can be omitted — the mock treats them as empty. */
	dirListings?: Record<string, DirListing>;
	/** File contents keyed by absolute path (F7 viewer). An unlisted path makes
	 *  read_file reject with NotFound, same as a deleted file. */
	files?: Record<string, FileContents>;
}

declare global {
	interface Window {
		__FACTORAI_TEST__?: TestFixture;
		/** Mocked command calls in order — see `mockInvoke` in lib/tauri.ts. Lets
		 *  a test assert on the arguments the renderer sent. */
		__FACTORAI_TEST_CALLS__?: Array<{ name: string; args?: Record<string, unknown> }>;
	}
}

/**
 * Install `window.__FACTORAI_TEST__` before the renderer boots. Call
 * before `page.goto(...)`.
 */
export async function installMockBridge(page: Page, fixture: TestFixture): Promise<void> {
	await page.addInitScript((fx) => {
		(window as unknown as { __FACTORAI_TEST__: typeof fx }).__FACTORAI_TEST__ = fx;
	}, fixture);
}

/** Small fixture factory for the common "one project, one session" shape. */
export function fixtureOneProjectOneSession(): TestFixture {
	const project: Project = {
		id: '-home-alice-code-foo',
		realPath: '/home/alice/code/foo',
		displayName: 'foo',
		lastSessionAt: Date.now() - 60_000,
		sessionCount: 1,
		pinned: false,
	};
	const session: SessionSummary = {
		id: 'session-uuid-001',
		projectId: project.id,
		title: 'Refactor the auth middleware',
		createdAt: Date.now() - 3_600_000,
		updatedAt: Date.now() - 60_000,
		turnCount: 42,
		cwd: project.realPath,
	};
	return {
		projects: [project],
		sessionsByProject: { [project.id]: [session] },
		sessionPages: {
			[session.id]: {
				id: session.id,
				events: [],
				offset: 0,
				limit: 100,
				total: 42,
			},
		},
	};
}

function entry(path: string, name: string, over: Partial<DirEntry> = {}): DirEntry {
	return {
		name,
		path: `${path}/${name}`,
		isDir: false,
		isSymlink: false,
		symlinkOutsideRoot: false,
		size: 128,
		modifiedAt: null,
		...over,
	};
}

function listing(entries: DirEntry[], over: Partial<DirListing> = {}): DirListing {
	return { entries, total: entries.length, truncated: false, ...over };
}

function contents(path: string, text: string, over: Partial<FileContents> = {}): FileContents {
	return {
		path,
		contents: text,
		size: text.length,
		isBinary: false,
		truncated: false,
		// Mirrors Rust's `lines().count()`: a trailing newline ends the last line
		// rather than starting an empty one.
		lineCount: text ? text.replace(/\n$/, '').split('\n').length : 0,
		...over,
	};
}

/**
 * Base shape plus a two-level file tree under the project root, including the
 * awkward cases: a symlink out of the project (not expandable) and a truncated
 * directory (the "N more entries" row).
 *
 * Also carries `files` for the F7 viewer: a readable source file, a binary, an
 * oversized one, and `main.py`, which is deliberately **absent** from `files`
 * so read_file rejects it the way a deleted file would.
 */
export function fixtureWithFileTree(): TestFixture {
	const base = fixtureOneProjectOneSession();
	const root = base.projects?.[0]?.realPath ?? '';
	const apps = `${root}/apps`;

	return {
		...base,
		dirListings: {
			[root]: listing([
				entry(root, 'apps', { isDir: true }),
				entry(root, 'vendor', { isDir: true, isSymlink: true, symlinkOutsideRoot: true }),
				entry(root, 'Cargo.toml'),
				entry(root, 'README.md'),
				entry(root, 'logo.png'),
				entry(root, 'huge.log'),
				entry(root, 'main.py'),
			]),
			// 2 of 12 — exercises the truncation row.
			[apps]: listing([entry(apps, 'desktop', { isDir: true }), entry(apps, 'index.ts')], {
				total: 12,
				truncated: true,
			}),
		},
		files: {
			[`${root}/Cargo.toml`]: contents(
				`${root}/Cargo.toml`,
				'[package]\nname = "foo"\nversion = "0.1.0"\n',
			),
			[`${root}/README.md`]: contents(`${root}/README.md`, '# foo\n\nA test project.\n'),
			[`${root}/logo.png`]: contents(`${root}/logo.png`, '', {
				isBinary: true,
				size: 20_480,
				lineCount: 0,
			}),
			// Came back cut at the backend's cap; the footer should offer "Show
			// anyway", and the uncapped re-read resolves it (see mockInvoke).
			[`${root}/huge.log`]: contents(`${root}/huge.log`, 'x'.repeat(64), {
				size: 12_582_912,
				truncated: true,
			}),
		},
	};
}

/** Same base shape plus a couple of search hits for the /search route. */
export function fixtureWithSearchHits(): TestFixture {
	const base = fixtureOneProjectOneSession();
	const projectId = base.projects?.[0]?.id ?? '';
	const sessionId = base.sessionsByProject?.[projectId]?.[0]?.id ?? '';
	const searchHits: SearchHit[] = [
		{
			sessionId,
			projectId,
			title: 'Refactor the auth middleware',
			role: 'user',
			snippet: 'please refactor the auth middleware to use jwt …',
		},
	];
	return { ...base, searchHits };
}
