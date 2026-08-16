/**
 * Helpers for installing a settable mock Tauri bridge into the renderer
 * before the page loads.
 *
 * The reference app-style: install via `page.addInitScript` so the global lands on
 * `window` before any module runs. The renderer's `lib/tauri.ts`
 * mockInvoke() reads from `window.__FACTORAI_TEST__`.
 */

import type {
	DirEntry,
	DirListing,
	FileContents,
	GitChange,
	GitStatus,
	ImageContents,
	ImportCandidate,
	Project,
	SearchHit,
	SessionPage,
	SessionSummary,
	TerminalId,
} from '@factorai/types';
import type { Page } from '@playwright/test';

export interface TestFixture {
	projects?: Project[];
	/** Rows the import dialog offers (F1). Read from Claude's store rather than
	 *  the index, so this is deliberately independent of `projects`. */
	importCandidates?: ImportCandidate[];
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
	/** Images keyed by absolute path (F7 viewer). An image-looking path that
	 *  isn't listed rejects, which is how the binary-card fallback is reached. */
	images?: Record<string, ImageContents>;
	/** Repository state keyed by project path (F13 Changes tab). An unlisted
	 *  project has no repository — the "Not a git repository" state. */
	gitStatuses?: Record<string, GitStatus>;
	/** Blobs keyed by `<rev>:<absolute path>`. Absent means the file doesn't
	 *  exist at that revision, which is an added or deleted file. */
	gitBlobs?: Record<string, FileContents>;
	/** Version to report as downloaded and staged, for the F14 update badge. */
	updateReady?: string;
	/** Path the folder picker returns for "Add project" (F1). Omit to have the
	 *  picker behave as if it were cancelled — a native dialog can't be driven
	 *  from a test, so this is the only way through that flow. */
	folderPick?: string;
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

/**
 * Project ids the specs route by.
 *
 * Exported rather than spelled out at each call site: since ADR-0011 an id is a
 * uuid the backend mints, so a spec cannot derive one from a path any more —
 * and the ones that tried were the ones that broke when identity changed.
 * Uuid-shaped on purpose, so a fixture never teaches the old model.
 */
export const FOO_ID = 'p0000001-0000-4000-8000-000000000001';
export const ZULU_ID = 'p0000002-0000-4000-8000-000000000002';
export const ALPHA_ID = 'p0000003-0000-4000-8000-000000000003';

/** Small fixture factory for the common "one project, one session" shape. */
export function fixtureOneProjectOneSession(): TestFixture {
	const project: Project = {
		id: FOO_ID,
		realPath: '/home/alice/code/foo',
		displayName: 'foo',
		lastSessionAt: Date.now() - 60_000,
		sessionCount: 1,
		pinned: false,
		missing: false,
	};
	const session: SessionSummary = {
		id: 'session-uuid-001',
		projectId: project.id,
		title: 'Refactor the auth middleware',
		createdAt: Date.now() - 3_600_000,
		updatedAt: Date.now() - 60_000,
		turnCount: 42,
		cwd: project.realPath,
		subagentOf: null,
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

/** A parent session plus two nested sub-agents — the F2 nesting shape, with
 *  the project's count covering only the parent (sub-agents don't count). */
export function fixtureWithSubagents(): TestFixture {
	const base = fixtureOneProjectOneSession();
	const project = base.projects?.[0];
	if (!project) throw new Error('base fixture has no project');
	const parent = base.sessionsByProject?.[project.id]?.[0];
	if (!parent) throw new Error('base fixture has no session');

	const agent = (id: string, title: string, ageMs: number): SessionSummary => ({
		id,
		projectId: project.id,
		title,
		createdAt: Date.now() - ageMs,
		updatedAt: Date.now() - ageMs,
		turnCount: 12,
		cwd: project.realPath,
		subagentOf: parent.id,
	});

	const agents = [
		agent('agent-1111', 'Explore the sidebar component', 50_000),
		agent('agent-2222', 'Design the hide-project plan', 40_000),
	];

	return {
		...base,
		sessionsByProject: { [project.id]: [parent, ...agents] },
		sessionPages: {
			...base.sessionPages,
			// The tail page the read-only view fetches on open.
			'agent-1111': {
				id: 'agent-1111',
				events: [
					{
						type: 'user',
						uuid: 'u1',
						timestamp: '2026-08-15T19:02:00.000Z',
						sessionId: 'agent-1111',
						message: { role: 'user', content: 'Explore the repo, search breadth medium' },
					},
					{
						type: 'assistant',
						uuid: 'a1',
						timestamp: '2026-08-15T19:03:00.000Z',
						sessionId: 'agent-1111',
						message: {
							role: 'assistant',
							content: [
								{ type: 'text', text: 'Found the sidebar at components/layout/Sidebar.tsx' },
							],
						},
					},
				],
				offset: 0,
				limit: 100,
				total: 2,
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

/** A real 1×1 transparent PNG — actual bytes, so the `<img>` genuinely decodes
 *  and `naturalWidth` reports something rather than the load handler never
 *  firing. */
const ONE_PIXEL_PNG =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function image(path: string, over: Partial<ImageContents> = {}): ImageContents {
	return { path, mime: 'image/png', base64: ONE_PIXEL_PNG, size: 70, ...over };
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
 *
 * And `images`: `logo.png` is a real PNG, while `broken.png` looks like one by
 * name and is absent here — which is how the viewer's "the extension lied"
 * fallback is reached, since routing is by extension but the verdict is the
 * backend's.
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
				entry(root, 'mark.svg'),
				entry(root, 'broken.png'),
				entry(root, 'data.bin'),
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
			// Text, not bytes — so it reaches the viewer through read_file like any
			// source file, and gets markdown's rendered/source treatment. The
			// non-ASCII label is deliberate: it is what rules out `btoa`.
			[`${root}/mark.svg`]: contents(
				`${root}/mark.svg`,
				'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">\n<title>café</title>\n<circle cx="10" cy="10" r="9" fill="currentColor"/>\n</svg>\n',
			),
			// Not an image by name, so it goes through read_file and is the case
			// the binary card was built for.
			[`${root}/data.bin`]: contents(`${root}/data.bin`, '', {
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
		// `broken.png` is deliberately missing: the mock rejects an unlisted
		// image path exactly as the backend rejects wrong magic bytes.
		images: { [`${root}/logo.png`]: image(`${root}/logo.png`) },
	};
}

/**
 * A project whose folder has been deleted since it was indexed (F1 + F6).
 *
 * `realPath` is still set — a project is a folder, so it always has one. What
 * `missing` adds is that we know exactly where it was and it isn't there: the
 * row stays openable, since every transcript survives, and only *starting* a
 * session is impossible.
 */
export function fixtureMissingProject(): TestFixture {
	const base = fixtureOneProjectOneSession();
	const project = base.projects?.[0];
	if (!project) throw new Error('base fixture has no project');
	return { ...base, projects: [{ ...project, missing: true }] };
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
		change('src/auth.ts', root, {
			group: 'conflicted',
			kind: 'conflicted',
			additions: null,
			deletions: null,
		}),
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

/**
 * Two projects, the second holding more sessions than the sidebar shows, for
 * the F1 sort menu and the F2 expandable session list.
 *
 * `zulu` sorts after `alpha` by name but is listed first, which is what
 * `list_projects` does — recency order, not alphabetical.
 */
export function fixtureTwoProjectsManySessions(): TestFixture {
	const zulu: Project = {
		id: ZULU_ID,
		realPath: '/home/alice/code/zulu',
		displayName: 'zulu',
		lastSessionAt: Date.now() - 1_000,
		sessionCount: 12,
		pinned: false,
		missing: false,
	};
	const alpha: Project = {
		id: ALPHA_ID,
		realPath: '/home/alice/code/alpha',
		displayName: 'alpha',
		lastSessionAt: Date.now() - 90_000,
		sessionCount: 1,
		pinned: false,
		missing: false,
	};

	// 12 sessions, oldest first on purpose: the sidebar has to reorder them.
	const zuluSessions: SessionSummary[] = Array.from({ length: 12 }, (_, i) => ({
		id: `zulu-session-${String(i).padStart(2, '0')}`,
		projectId: zulu.id,
		title: `Zulu task ${i}`,
		createdAt: Date.now() - 500_000,
		updatedAt: Date.now() - (12 - i) * 60_000,
		turnCount: i + 1,
		cwd: zulu.realPath,
		subagentOf: null,
	}));

	return {
		projects: [zulu, alpha],
		sessionsByProject: {
			[zulu.id]: zuluSessions,
			[alpha.id]: [
				{
					id: 'alpha-session-1',
					projectId: alpha.id,
					title: 'Alpha only task',
					createdAt: Date.now() - 900_000,
					updatedAt: Date.now() - 90_000,
					turnCount: 3,
					cwd: alpha.realPath,
					subagentOf: null,
				},
			],
		},
	};
}

/**
 * An empty workspace with folders available to import (F1).
 *
 * The point of the shape: `importCandidates` is independent of `projects`,
 * because since ADR-0011 the two come from different places — one is a walk of
 * Claude's store, the other is what you added. One row is already in the
 * workspace and one folder has been deleted, since those are the two states the
 * dialog has to render differently.
 */
export function fixtureImportCandidates(): TestFixture {
	const known: Project = {
		id: 'p0000004-0000-4000-8000-000000000004',
		realPath: '/home/alice/code/known',
		displayName: 'known',
		lastSessionAt: Date.now() - 10_000,
		sessionCount: 4,
		pinned: false,
		missing: false,
	};
	const candidate = (
		realPath: string,
		sessionCount: number,
		extra: Partial<ImportCandidate> = {},
	): ImportCandidate => ({
		agent: 'claude',
		key: `-${realPath.replace(/^\/+/, '').replace(/\//g, '-')}`,
		realPath,
		displayName: realPath.split('/').filter(Boolean).pop() ?? realPath,
		sessionCount,
		lastActivityAt: Date.now() - 3_600_000,
		missing: false,
		alreadyOpen: false,
		...extra,
	});

	return {
		projects: [known],
		importCandidates: [
			candidate('/home/alice/code/known', 4, { alreadyOpen: true }),
			candidate('/home/alice/code/pelican', 17),
			candidate('/home/alice/code/heron', 2),
			// Deleted on disk. Still importable — every transcript survives, and
			// only starting a session in it is impossible.
			candidate('/home/alice/code/vanished', 9, { missing: true }),
		],
	};
}
