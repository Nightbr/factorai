/**
 * Helpers for installing a settable mock Tauri bridge into the renderer
 * before the page loads.
 *
 * The reference app-style: install via `page.addInitScript` so the global lands on
 * `window` before any module runs. The renderer's `lib/tauri.ts`
 * mockInvoke() reads from `window.__FACTORAI_TEST__`.
 */

import type { Page } from '@playwright/test';
import type {
	DirEntry,
	DirListing,
	FileContents,
	GitChange,
	GitStatus,
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
	/** Repository state keyed by project path (F13 Changes tab). An unlisted
	 *  project has no repository — the "Not a git repository" state. */
	gitStatuses?: Record<string, GitStatus>;
	/** Blobs keyed by `<rev>:<absolute path>`. Absent means the file doesn't
	 *  exist at that revision, which is an added or deleted file. */
	gitBlobs?: Record<string, FileContents>;
	/** Version to report as downloaded and staged, for the F14 update badge. */
	updateReady?: string;
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
		ignored: false,
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
			[`${root}/README.md`]: contents(
				`${root}/README.md`,
				[
					'# foo',
					'',
					'A test project. See [the guide](docs/guide.md) or',
					'[the website](https://example.com).',
					'',
					'| Package | Purpose |',
					'| --- | --- |',
					'| `foo-core` | Shared helpers |',
					'',
				].join('\n'),
			),
			[`${root}/docs/guide.md`]: contents(`${root}/docs/guide.md`, '# Guide\n\nDeeper docs.\n'),
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

function change(relPath: string, root: string, over: Partial<GitChange> = {}): GitChange {
	return {
		path: `${root}/${relPath}`,
		relPath,
		group: 'unstaged',
		kind: 'modified',
		oldRelPath: null,
		additions: 3,
		deletions: 1,
		isBinary: false,
		...over,
	};
}

/**
 * Base shape plus a repository mid-edit (F13): one staged file, the same file
 * further modified in the worktree (the partly-staged case that is the reason
 * the index is modelled at all), an untracked addition, a conflicted path, a
 * binary, and a sibling change above the project root.
 */
export function fixtureWithChanges(): TestFixture {
	const base = fixtureWithFileTree();
	const root = base.projects?.[0]?.realPath ?? '';

	const changes: GitChange[] = [
		change('src/auth.ts', root, { group: 'conflicted', kind: 'conflicted', additions: null, deletions: null }),
		change('src/index.ts', root, { group: 'staged', additions: 4, deletions: 0 }),
		change('src/index.ts', root, { group: 'unstaged', additions: 2, deletions: 1 }),
		change('src/new-file.ts', root, { kind: 'untracked', additions: 12, deletions: 0 }),
		change('logo.png', root, { isBinary: true, additions: null, deletions: null }),
		change('../packages/types/index.ts', root, { kind: 'modified', additions: 1, deletions: 1 }),
	];

	return {
		...base,
		gitStatuses: {
			[root]: {
				repoRoot: root,
				branch: 'main',
				changes,
				total: changes.length,
				truncated: false,
			},
		},
		gitBlobs: {
			[`index:${root}/src/index.ts`]: contents(`${root}/src/index.ts`, 'export const a = 1;\n'),
			[`head:${root}/src/index.ts`]: contents(`${root}/src/index.ts`, 'export const a = 0;\n'),
		},
	};
}
