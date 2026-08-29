/**
 * Helpers for installing a settable mock Tauri bridge into the renderer
 * before the page loads.
 *
 * Installed via `page.addInitScript` so the global lands on `window` before
 * any module runs. The renderer's `lib/tauri.ts`
 * mockInvoke() reads from `window.__FACTORAI_TEST__`.
 */

import type {
	ClaudeCliStatus,
	DirEntry,
	DirListing,
	FileContents,
	GitChange,
	GitCommitDetail,
	GitGraph,
	GitGraphCommit,
	GitRef,
	GitStatus,
	GitWorktree,
	ImageContents,
	ImportCandidate,
	PdfContents,
	Project,
	Routine,
	SearchHit,
	SessionPage,
	SessionSummary,
	SettingKey,
	TerminalId,
	SidebarRow,
} from '@factorai/types';
import type { Page } from '@playwright/test';

export interface TestFixture {
	projects?: Project[];
	/** The sidebar's tree (F1, ADR-0025). **Optional, and usually omitted**: a
	 *  fixture that declares only `projects` gets one top-level project row per
	 *  project, in that array's order, synthesised by the mock — which is how
	 *  every fixture written before groups existed keeps working unchanged.
	 *  Declare it only to set up a group. */
	sidebar?: SidebarRow[];
	/** Rows the import dialog offers (F1). Read from Claude's store rather than
	 *  the index, so this is deliberately independent of `projects`. */
	importCandidates?: ImportCandidate[];
	sessionsByProject?: Record<string, SessionSummary[]>;
	/** Routines per project id (F22). The create/update/delete mocks mutate it,
	 *  so a spec can add one and see the list it lands in. */
	routinesByProject?: Record<string, Routine[]>;
	sessionPages?: Record<string, SessionPage>;
	terminalSpawnId?: TerminalId;
	/** Session id `start_session` hands back for a new-session click (F6). The
	 *  mock falls back to a fixed uuid, so a spec only sets this when it wants
	 *  to talk about the id. */
	newSessionId?: string;
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
	/** Checkouts keyed by project path (F21). Absent means one checkout, the
	 *  project itself — the shape almost every project has, so a spec only
	 *  declares this when worktrees are what it is testing. */
	gitWorktrees?: Record<string, GitWorktree[]>;
	gitGraphs?: Record<string, GitGraph>;
	gitCommits?: Record<string, GitCommitDetail>;
	/** Version to report as downloaded and staged, for the F14 update badge. */
	updateReady?: string;
	/** Path the folder picker returns for "Add project" (F1). Omit to have the
	 *  picker behave as if it were cancelled — a native dialog can't be driven
	 *  from a test, so this is the only way through that flow. */
	folderPick?: string;
	/** The `settings` table (F11). `set_setting` writes back into it, so a spec
	 *  can Save and then assert on what the next read returns. */
	settings?: Partial<Record<SettingKey, string>>;
	/** What the three-tier probe finds when nothing is overridden. Omit for a
	 *  machine with no `claude` on it, which is the browser-only default. */
	claudeCli?: ClaudeCliStatus;
	/** Paths that are a working `claude`, mapped to the version they report.
	 *  Anything not listed validates as not installed — which is how a spec
	 *  reaches the override field's inline error. */
	claudeBinaries?: Record<string, string | null>;
}

declare global {
	interface Window {
		__FACTORAI_TEST__?: TestFixture;
		/** Fire a Rust→JS event at the renderer (see `mockListen` in lib/tauri.ts).
		 *  Present once a fixture is installed and something has subscribed. */
		__FACTORAI_EMIT__?: (event: string, payload: unknown) => void;
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

/** One routine in `FOO`, with the fields a spec cares about overridable (F22).
 *
 *  A factory rather than a literal in the spec, so the spec needs no direct
 *  dependency on `@factorai/types` — the root workspace does not carry one, and
 *  every other fixture reaches the shared types through this file. */
export function routineFixture(over: Partial<Routine> = {}): Routine {
	return {
		id: 'routine-0000-4000-8000-000000000001',
		projectId: FOO_ID,
		name: 'Nightly triage',
		cron: '0 2 * * *',
		prompt: 'Triage anything that failed overnight.',
		enabled: true,
		catchupHours: null,
		lastFireAt: null,
		lastRunAt: null,
		lastSessionId: null,
		lastSkippedAt: null,
		lastError: null,
		createdAt: Date.now() - 86_400_000,
		nextRunAt: null,
		...over,
	};
}

/** Small fixture factory for the common "one project, one session" shape. */
export function fixtureOneProjectOneSession(): TestFixture {
	const project: Project = {
		id: FOO_ID,
		realPath: '/home/alice/code/foo',
		displayName: 'foo',
		lastSessionAt: Date.now() - 60_000,
		sessionCount: 1,
		sortOrder: 0,
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
		worktree: null,
		lastCwd: null,
		touchedPaths: [],
		routineId: null,
		routineName: null,
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

/**
 * One project whose repository has a second checkout, and a session working in
 * it (F21).
 *
 * The worktree is a **sibling** of the project folder rather than nested inside
 * it, because that is where real ones live — and because a nested one would let a
 * containment bug pass.
 */
export function fixtureSessionInAWorktree(): TestFixture {
	const base = fixtureOneProjectOneSession();
	const project = base.projects?.[0];
	if (!project) throw new Error('base fixture has no project');
	const main = base.sessionsByProject?.[project.id]?.[0];
	if (!main) throw new Error('base fixture has no session');

	const worktreePath = '/home/alice/code/worktrees/feature-x';
	// A rolled-up session: Claude ran it in the worktree, so its cwd is not the
	// project folder, and `worktree` is what the agent signalled.
	const inWorktree: SessionSummary = {
		id: 'session-uuid-002',
		projectId: project.id,
		title: 'Add the worktree switcher',
		createdAt: Date.now() - 600_000,
		updatedAt: Date.now() - 30_000,
		turnCount: 7,
		cwd: worktreePath,
		subagentOf: null,
		worktree: worktreePath,
	};

	return {
		...base,
		sessionsByProject: { [project.id]: [inWorktree, main] },
		sessionPages: {
			...base.sessionPages,
			[inWorktree.id]: { id: inWorktree.id, events: [], offset: 0, limit: 100, total: 7 },
		},
		// The branch badge lives beside the worktree mark, so the spec that asserts
		// "two facts, not one" needs a repository for the project.
		gitStatuses: {
			[project.realPath]: {
				repoRoot: project.realPath,
				branch: 'main',
				head: 'a'.repeat(40),
				changes: [],
				total: 0,
				truncated: false,
			},
			[worktreePath]: {
				repoRoot: project.realPath,
				branch: 'feature-x',
				head: 'b'.repeat(40),
				changes: [],
				total: 0,
				truncated: false,
			},
		},
		gitWorktrees: {
			[project.realPath]: [
				{
					path: project.realPath,
					name: null,
					branch: 'main',
					head: 'a'.repeat(40),
					isMain: true,
					locked: false,
					prunable: false,
					exists: true,
				},
				{
					path: worktreePath,
					// git's own worktree name — the leaf directory. Deliberately the
					// same as the branch here so the "both marks agree" spec is not
					// accidentally satisfied by the branch: `checkoutLabel` reads
					// `name`, and the branch badge reads `branch`.
					name: 'feature-x',
					branch: 'feature-x',
					head: 'b'.repeat(40),
					isMain: false,
					locked: false,
					prunable: false,
					exists: true,
				},
			],
		},
		// The tree the panel must root on once it follows the session.
		dirListings: {
			...base.dirListings,
			[worktreePath]: {
				entries: [
					{
						name: 'switcher.ts',
						path: `${worktreePath}/switcher.ts`,
						isDir: false,
						isSymlink: false,
						symlinkOutsideRoot: false,
						size: 120,
						modifiedAt: Date.now(),
						ignored: false,
					},
				],
				total: 1,
				truncated: false,
			},
		},
	};
}

/**
 * The shape F21 actually failed in (found 2026-08-21, in a real session).
 *
 * The agent was asked to open a worktree. It created one, moved into it, and
 * **never signalled**: no `setWorktree`, no `openFile` in the worktree. So
 * `worktree` is null and the only trace is that the session's *last* cwd is the
 * worktree while its first is still the project.
 */
export function fixtureAgentMovedWithoutSaying(): TestFixture {
	const base = fixtureSessionInAWorktree();
	const project = base.projects?.[0];
	if (!project) throw new Error('base fixture has no project');
	const sessions = base.sessionsByProject?.[project.id];
	if (!sessions) throw new Error('base fixture has no sessions');

	return {
		...base,
		sessionsByProject: {
			[project.id]: sessions.map((session) =>
				session.id === 'session-uuid-002'
					? {
							...session,
							// Nothing was ever recorded, because nothing was ever said.
							worktree: null,
							// It *started* in the project — this is the field the fallback
							// used to read, and why the panel stayed on main.
							cwd: project.realPath,
							lastCwd: '/home/alice/code/worktrees/feature-x',
							touchedPaths: [],
							routineId: null,
							routineName: null,
						}
					: session,
			),
		},
	};
}

/**
 * The shape F21 failed in a second time, and the noise it failed in a third time
 * with (2026-08-24, twice, in the same user's sessions).
 *
 * The agent created a worktree and then drove it entirely through
 * `git -C ../worktree …` and absolute paths. Its own cwd never moved, so both
 * cwds still name the project — correctly — and there is nothing to follow but
 * the paths its tools named.
 *
 * **The list ends on noise on purpose.** The harvest behind it reads shell
 * command lines, so most of what it collects belongs to no checkout at all; the
 * resolution has to read back past that to the most recent path that does, and a
 * fixture whose last entry is the answer would not notice if it stopped.
 */
export function fixtureAgentWorkedByAbsolutePath(): TestFixture {
	const base = fixtureSessionInAWorktree();
	const project = base.projects?.[0];
	if (!project) throw new Error('base fixture has no project');
	const sessions = base.sessionsByProject?.[project.id];
	if (!sessions) throw new Error('base fixture has no sessions');

	return {
		...base,
		sessionsByProject: {
			[project.id]: sessions.map((session) =>
				session.id === 'session-uuid-002'
					? {
							...session,
							worktree: null,
							// Where it started *and* where it still is. Neither says
							// anything, and both are right.
							cwd: project.realPath,
							lastCwd: project.realPath,
							touchedPaths: ['/home/alice/code/worktrees/feature-x/src/switcher.ts', '/dev/null'],
							routineId: null,
							routineName: null,
						}
					: session,
			),
		},
	};
}

/**
 * A repository whose second checkout is on no branch at all (F21).
 *
 * The state the header used to say nothing about: a detached `HEAD` gave the
 * branch badge nothing to print, so beside a checkout mark that was present the
 * gap read as "this app has no idea", not as "there is no branch".
 */
export function fixtureDetachedCheckout(): TestFixture {
	const base = fixtureSessionInAWorktree();
	const project = base.projects?.[0];
	if (!project) throw new Error('base fixture has no project');
	const worktreePath = '/home/alice/code/worktrees/feature-x';
	const head = 'c'.repeat(40);

	return {
		...base,
		gitStatuses: {
			...base.gitStatuses,
			[worktreePath]: {
				repoRoot: project.realPath,
				branch: null,
				head,
				changes: [],
				total: 0,
				truncated: false,
			},
		},
		gitWorktrees: {
			[project.realPath]: (base.gitWorktrees?.[project.realPath] ?? []).map((w) =>
				w.path === worktreePath ? { ...w, branch: null, head } : w,
			),
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
		worktree: null,
		lastCwd: null,
		touchedPaths: [],
		routineId: null,
		routineName: null,
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

/**
 * A real two-page PDF — 850 bytes, with a correct xref table, two Helvetica
 * pages reading "Page one" and "Page two".
 *
 * Genuine bytes rather than a stub for the same reason `ONE_PIXEL_PNG` is:
 * pdf.js actually parses this in a worker, and a fixture it rejects would test
 * the error path while claiming to test rendering. Two pages, not one, so the
 * page counter has something to count.
 */
const TWO_PAGE_PDF =
	'JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIg' +
	'Pj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUiA0IDAgUl0g' +
	'L0NvdW50IDIgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAg' +
	'UiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvQ29udGVudHMgNSAwIFIgL1Jlc291cmNlcyA8' +
	'PCAvRm9udCA8PCAvRjEgNyAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUg' +
	'L1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvQ29udGVudHMg' +
	'NiAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNyAwIFIgPj4gPj4gPj4KZW5kb2Jq' +
	'CjUgMCBvYmoKPDwgL0xlbmd0aCAzOSA+PgpzdHJlYW0KQlQgL0YxIDI0IFRmIDMwIDEwMCBU' +
	'ZCAoUGFnZSBvbmUpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNiAwIG9iago8PCAvTGVuZ3Ro' +
	'IDM5ID4+CnN0cmVhbQpCVCAvRjEgMjQgVGYgMzAgMTAwIFRkIChQYWdlIHR3bykgVGogRVQK' +
	'ZW5kc3RyZWFtCmVuZG9iago3IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBl' +
	'MSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDgKMDAwMDAwMDAwMCA2' +
	'NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNjQgMDAwMDAgbiAKMDAwMDAw' +
	'MDEyNyAwMDAwMCBuIAowMDAwMDAwMjUzIDAwMDAwIG4gCjAwMDAwMDAzNzkgMDAwMDAgbiAK' +
	'MDAwMDAwMDQ2OCAwMDAwMCBuIAowMDAwMDAwNTU3IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1Np' +
	'emUgOCAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNjI3CiUlRU9GCg==';

/**
 * A real RC4-encrypted one-page PDF whose user password is `letmein`.
 *
 * Genuine encryption, not a flag: pdf.js decides this is locked by failing to
 * derive a key, so a fixture that merely claimed to be encrypted would never
 * reach the unlock path at all. One page, reading "Secret page" once open.
 */
const LOCKED_PDF =
	'JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIg' +
	'Pj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50' +
	'IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVk' +
	'aWFCb3ggWzAgMCAzMDAgMjAwXSAvQ29udGVudHMgNSAwIFIgL1Jlc291cmNlcyA8PCAvRm9u' +
	'dCA8PCAvRjEgNCAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQg' +
	'L1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2Jq' +
	'Cjw8IC9MZW5ndGggNDIgPj4Kc3RyZWFtClSvYyRzgd/ZKApEOzX0LNmbU/23GbCYhm/jGv0b' +
	'ERuz4rvEgqEsUWBZGQplbmRzdHJlYW0KZW5kb2JqCjYgMCBvYmoKPDwgL0ZpbHRlciAvU3Rh' +
	'bmRhcmQgL1YgMSAvUiAyIC9PIDw4MTcxOTZjOGM0MTM2MzlmNjM4YmQ1NDA5ZDI2ZWE4ODhj' +
	'NDkwNThmNmEzM2Q2NDBjNTlmMGI0YTQyZTUyNDlkPiAvVSA8YmU1MThlOTAxZTQ3ZjVkNDRh' +
	'ZGI2MzM2ZjIxZGJmZmZkNGU2ODg2ZTJkYmZhMmNhZmM4MGViNGM4NjQwMjY0NT4gL1AgLTEg' +
	'Pj4KZW5kb2JqCnhyZWYKMCA3CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAw' +
	'MCBuIAowMDAwMDAwMDY0IDAwMDAwIG4gCjAwMDAwMDAxMjEgMDAwMDAgbiAKMDAwMDAwMDI0' +
	'NyAwMDAwMCBuIAowMDAwMDAwMzE3IDAwMDAwIG4gCjAwMDAwMDA0MDkgMDAwMDAgbiAKdHJh' +
	'aWxlcgo8PCAvU2l6ZSA3IC9Sb290IDEgMCBSIC9FbmNyeXB0IDYgMCBSIC9JRCBbPDAwMDEw' +
	'MjAzMDQwNTA2MDcwODA5MGEwYjBjMGQwZTBmPiA8MDAwMTAyMDMwNDA1MDYwNzA4MDkwYTBi' +
	'MGMwZDBlMGY+XSA+PgpzdGFydHhyZWYKNjA0CiUlRU9GCg==';

function pdf(path: string, over: Partial<PdfContents> = {}): PdfContents {
	return { path, base64: TWO_PAGE_PDF, size: 850, ...over };
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
				// `.jsonc`, not `.json`, so it covers both halves at once: JSON is
				// the one language `basic-languages` omits, and the two dialect
				// extensions are ours rather than Monaco's.
				entry(root, 'knip.jsonc'),
				entry(root, 'logo.png'),
				entry(root, 'mark.svg'),
				entry(root, 'broken.png'),
				entry(root, 'spec.pdf'),
				entry(root, 'locked.pdf'),
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
					// Frontmatter, which is lifted out of the document and laid out as
					// fields (F7). One field per shape the panel distinguishes: a
					// scalar, a list, a null, a nested map and a URL.
					'---',
					'title: foo',
					'reviewers: ["Noé Pion", "Laurent Anadon"]',
					'notion_source: null',
					'links:',
					'  issue: https://example.com/ENG-3150',
					'---',
					'',
					'# foo',
					'',
					'A test project. See [the guide](docs/guide.md) or',
					'[the website](https://example.com).',
					'',
					// One image per branch of the resolver: a raster read through
					// read_image, an SVG read through read_file, and one whose file is
					// absent, where the alt text stands in for it.
					'![the logo](logo.png)',
					'',
					'![the mark](./mark.svg)',
					'',
					'![a gap](img/gone.png)',
					'',
					'| Package | Purpose |',
					'| --- | --- |',
					'| `foo-core` | Shared helpers |',
					'',
					// One fence per branch of the `pre` override: a diagram, a
					// diagram mermaid cannot parse, and a fence that is just code.
					'```mermaid',
					'graph TD',
					'  Session --> Terminal',
					'```',
					'',
					'```mermaid',
					'notadiagram TD',
					'  nothing mermaid knows how to draw',
					'```',
					'',
					'```ts',
					'const answer = 42;',
					'```',
					'',
				].join('\n'),
			),
			[`${root}/docs/guide.md`]: contents(`${root}/docs/guide.md`, '# Guide\n\nDeeper docs.\n'),
			[`${root}/knip.jsonc`]: contents(
				`${root}/knip.jsonc`,
				'{\n\t// a comment, which strict JSON would not allow\n\t"entry": ["src/main.tsx"]\n}\n',
			),
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
			// Long enough that `&line=` has somewhere off-screen to land (F19).
			// Deliberately **not** in `dirListings`: it is reached by URL, which is
			// also how a terminal link reaches a file — through `?file=`, not
			// through the tree.
			[`${root}/src/deep.ts`]: contents(
				`${root}/src/deep.ts`,
				`${Array.from({ length: 400 }, (_, i) => `const line${i + 1} = ${i + 1};`).join('\n')}\n`,
			),
		},
		// `broken.png` is deliberately missing: the mock rejects an unlisted
		// image path exactly as the backend rejects wrong magic bytes.
		images: { [`${root}/logo.png`]: image(`${root}/logo.png`) },
		// `notreally.pdf` is missing for the same reason on the PDF side: routed
		// here by extension, refused by the backend for its magic bytes.
		pdfs: {
			[`${root}/spec.pdf`]: pdf(`${root}/spec.pdf`),
			[`${root}/locked.pdf`]: pdf(`${root}/locked.pdf`, { base64: LOCKED_PDF, size: 898 }),
		},
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
	const project = base.projects?.[0];
	const projectId = project?.id ?? '';
	const sessionId = base.sessionsByProject?.[projectId]?.[0]?.id ?? '';
	const searchHits: SearchHit[] = [
		{
			sessionId,
			projectId,
			// A hit carries its own project label — the backend JOINs it, so the
			// fixture states it rather than having the view look it up.
			projectName: project?.displayName ?? '',
			projectPath: project?.realPath ?? '',
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
				head: SHA_TIP,
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
		// zulu first by hand, which is also what the old recency default showed.
		sortOrder: 0,
		missing: false,
	};
	const alpha: Project = {
		id: ALPHA_ID,
		realPath: '/home/alice/code/alpha',
		displayName: 'alpha',
		lastSessionAt: Date.now() - 90_000,
		sessionCount: 1,
		sortOrder: 1,
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
		worktree: null,
		lastCwd: null,
		touchedPaths: [],
		routineId: null,
		routineName: null,
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
					worktree: null,
					lastCwd: null,
					touchedPaths: [],
					routineId: null,
					routineName: null,
					worktree: null,
					lastCwd: null,
					touchedPaths: [],
					routineId: null,
					routineName: null,
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
		sortOrder: 0,
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

/** Forty hex characters, so a SHA passes the `?diff=<a>..<b>` URL validation
 *  that guards a hand-edited link. The last two digits identify the commit. */
function sha(n: number): string {
	return `${String(n).padStart(2, '0').repeat(2)}`.padEnd(40, 'abcdef0123456789');
}

export const SHA_TIP = sha(1);
export const SHA_MERGE = sha(2);
export const SHA_SIDE = sha(3);
export const SHA_MAIN = sha(4);
export const SHA_BASE = sha(5);

function ref(name: string, kind: GitRef['kind'], over: Partial<GitRef> = {}): GitRef {
	return { name, kind, isHead: false, upstreamInSync: null, ...over };
}

function commit(
	over: Partial<GitGraphCommit> & Pick<GitGraphCommit, 'sha' | 'subject'>,
): GitGraphCommit {
	return {
		shortSha: over.sha.slice(0, 7),
		authorName: 'Titouan',
		authorTime: 1_760_000_000_000,
		commitTime: 1_760_000_000_000,
		parents: [],
		refs: [],
		lane: 0,
		edges: [],
		...over,
	};
}

/**
 * A history with a merge in it, so the rail has two lanes and something to draw
 * (specs/05-features.md F18).
 *
 * Lanes and edges are spelled out rather than computed: the layout is Rust's job
 * and has its own tests in `services/git.rs`, so what these exercise is the
 * renderer's half — chip folding, the `+N` cut, selection and the detail pane.
 *
 * The tip carries the four-ref case F18 is designed around: HEAD on a branch
 * that is in sync with its upstream, plus a tag. It should fold to
 * `HEAD→main ≡origin` and `v0.3.0` rather than spending four slots.
 */
export function fixtureWithGraph(): TestFixture {
	const base = fixtureWithChanges();
	const root = base.projects?.[0]?.realPath ?? '';

	const commits: GitGraphCommit[] = [
		commit({
			sha: SHA_TIP,
			subject: 'fix: an untagged build says so in its crash report',
			parents: [SHA_MERGE],
			refs: [
				ref('main', 'localBranch', { isHead: true, upstreamInSync: 'origin/main' }),
				ref('origin/main', 'remoteBranch'),
				ref('v0.3.0', 'tag'),
			],
			edges: [{ fromLane: 0, toLane: 0, lane: 0, kind: 'outgoing' }],
		}),
		commit({
			sha: SHA_MERGE,
			subject: 'merge: the side branch',
			parents: [SHA_MAIN, SHA_SIDE],
			edges: [
				{ fromLane: 0, toLane: 0, lane: 0, kind: 'incoming' },
				{ fromLane: 0, toLane: 0, lane: 0, kind: 'outgoing' },
				{ fromLane: 0, toLane: 1, lane: 1, kind: 'outgoing' },
			],
		}),
		commit({
			sha: SHA_MAIN,
			subject: 'docs: log the four items that landed',
			parents: [SHA_BASE],
			edges: [
				{ fromLane: 0, toLane: 0, lane: 0, kind: 'incoming' },
				{ fromLane: 0, toLane: 0, lane: 0, kind: 'outgoing' },
				{ fromLane: 1, toLane: 1, lane: 1, kind: 'through' },
			],
		}),
		commit({
			sha: SHA_SIDE,
			subject: 'feat: work done on the side branch',
			parents: [SHA_BASE],
			lane: 1,
			refs: [ref('side', 'localBranch')],
			edges: [
				{ fromLane: 0, toLane: 0, lane: 0, kind: 'through' },
				{ fromLane: 1, toLane: 1, lane: 1, kind: 'incoming' },
				{ fromLane: 1, toLane: 1, lane: 1, kind: 'outgoing' },
			],
		}),
		commit({
			sha: SHA_BASE,
			subject: 'chore: where the two branches parted',
			edges: [
				{ fromLane: 0, toLane: 0, lane: 0, kind: 'incoming' },
				{ fromLane: 1, toLane: 0, lane: 1, kind: 'incoming' },
			],
		}),
	];

	return {
		...base,
		gitGraphs: {
			[root]: {
				repoRoot: root,
				commits,
				laneCount: 2,
				refsDigest: 'deadbeefdeadbeef',
				hasMore: false,
			},
		},
		gitCommits: {
			[SHA_MERGE]: {
				sha: SHA_MERGE,
				shortSha: SHA_MERGE.slice(0, 7),
				subject: 'merge: the side branch',
				body: 'A body paragraph, which the row had no room for.',
				authorName: 'Titouan',
				authorEmail: 'titouan@example.invalid',
				authorTime: 1_760_000_000_000,
				committerName: 'Titouan',
				commitTime: 1_760_000_000_000,
				// Two parents, so the pane has to say which one the diff is against.
				parents: [SHA_MAIN, SHA_SIDE],
				diffParent: SHA_MAIN,
				files: [
					{
						path: `${root}/src/index.ts`,
						relPath: 'src/index.ts',
						kind: 'modified',
						oldRelPath: null,
						additions: 7,
						deletions: 2,
						isBinary: false,
					},
				],
				total: 1,
				truncated: false,
			},
		},
	};
}

/**
 * Two projects, each with its own history, for the switching path (F18).
 *
 * The blind spot this covers: page count, selection and the lane pitch are all
 * keyed on the active project, and a graph that kept the previous project's
 * commits — or its selection — would be showing someone else's history under the
 * right name. `zulu` and `alpha` share no SHAs, so a leak is unambiguous.
 */
export function fixtureTwoProjectGraphs(): TestFixture {
	const base = fixtureTwoProjectsManySessions();
	const [zulu, alpha] = base.projects ?? [];

	const graph = (prefix: string, count: number, laneCount: number, root: string): GitGraph => ({
		repoRoot: root,
		commits: Array.from({ length: count }, (_unused, i) =>
			commit({
				sha: `${prefix}${String(i).padStart(2, '0')}`.padEnd(40, '0'),
				subject: `${prefix} commit ${i}`,
			}),
		),
		laneCount,
		refsDigest: `${prefix}-digest`,
		hasMore: false,
	});

	return {
		...base,
		gitStatuses: {
			// Only zulu is dirty, so the hollow HEAD marker has to move with the
			// project rather than staying wherever it was first drawn.
			[zulu.realPath]: {
				repoRoot: zulu.realPath,
				branch: 'main',
				head: `aa${'00'}`.padEnd(40, '0'),
				changes: [change('dirty.ts', zulu.realPath, {})],
				total: 1,
				truncated: false,
			},
			[alpha.realPath]: {
				repoRoot: alpha.realPath,
				branch: 'main',
				head: `bb${'00'}`.padEnd(40, '0'),
				changes: [],
				total: 0,
				truncated: false,
			},
		},
		gitGraphs: {
			[zulu.realPath]: graph('aa', 3, 2, zulu.realPath),
			[alpha.realPath]: graph('bb', 2, 1, alpha.realPath),
		},
		// One detail per project, worded so the pane's contents name which project
		// it came from — the assertion that a restored selection is *this* history's
		// and not the other one's.
		gitCommits: {
			[`aa00`.padEnd(40, '0')]: detail(`aa00`.padEnd(40, '0'), 'zulu', zulu.realPath),
			[`bb00`.padEnd(40, '0')]: detail(`bb00`.padEnd(40, '0'), 'alpha', alpha.realPath),
		},
	};
}

function detail(sha: string, project: string, root: string): GitCommitDetail {
	return {
		sha,
		shortSha: sha.slice(0, 7),
		subject: `${project} commit 0`,
		body: `Belongs to ${project}.`,
		authorName: 'Titouan',
		authorEmail: 'titouan@example.invalid',
		authorTime: 1_760_000_000_000,
		committerName: 'Titouan',
		commitTime: 1_760_000_000_000,
		parents: [],
		diffParent: null,
		files: [
			{
				path: `${root}/only-in-${project}.ts`,
				relPath: `only-in-${project}.ts`,
				kind: 'added',
				oldRelPath: null,
				additions: 1,
				deletions: 0,
				isBinary: false,
			},
		],
		total: 1,
		truncated: false,
	};
}

/**
 * More commits than one page holds, for the paging path (F18).
 *
 * Worth its cost: `GRAPH_PAGE` is 300 and this repo has fewer commits than that,
 * so **"Load more" had never run once** — not in a test and not in the app. The
 * mock pages by slicing and derives `hasMore`, so one fixture drives both pages.
 */
export function fixtureLongHistory(): TestFixture {
	const base = fixtureWithChanges();
	const root = base.projects?.[0]?.realPath ?? '';
	const TOTAL = 430;

	return {
		...base,
		gitGraphs: {
			[root]: {
				repoRoot: root,
				commits: Array.from({ length: TOTAL }, (_unused, i) =>
					commit({
						sha: `cc${String(i).padStart(4, '0')}`.padEnd(40, '0'),
						subject: `commit ${i}`,
					}),
				),
				laneCount: 1,
				refsDigest: 'long-digest',
				hasMore: true,
			},
		},
	};
}

/**
 * A repository whose only commit is its root, for the no-parent path (F18).
 *
 * `diffParent: null` is the one branch of the detail pane that a normal commit
 * never reaches: the heading changes, the parents line is absent entirely, and
 * the diff URL's left side is empty because the comparison is against the empty
 * tree.
 */
export function fixtureRootCommit(): TestFixture {
	const base = fixtureWithChanges();
	const root = base.projects?.[0]?.realPath ?? '';
	const first = 'ff'.padEnd(40, '0');

	return {
		...base,
		gitGraphs: {
			[root]: {
				repoRoot: root,
				commits: [
					commit({
						sha: first,
						subject: 'chore: the first commit',
						refs: [ref('main', 'localBranch', { isHead: true })],
					}),
				],
				laneCount: 1,
				refsDigest: 'root-digest',
				hasMore: false,
			},
		},
		gitCommits: {
			[first]: {
				sha: first,
				shortSha: first.slice(0, 7),
				subject: 'chore: the first commit',
				body: '',
				authorName: 'Titouan',
				authorEmail: 'titouan@example.invalid',
				authorTime: 1_760_000_000_000,
				committerName: 'Titouan',
				commitTime: 1_760_000_000_000,
				parents: [],
				diffParent: null,
				files: [
					{
						path: `${root}/README.md`,
						relPath: 'README.md',
						kind: 'added',
						oldRelPath: null,
						additions: 12,
						deletions: 0,
						isBinary: false,
					},
				],
				total: 1,
				truncated: false,
			},
		},
	};
}

/**
 * Two projects with one of them filed into a group, plus an empty group.
 *
 * Built on top of `fixtureTwoProjectsManySessions` so every session, status and
 * count in that fixture still applies — what this adds is only the *arrangement*
 * (F1, ADR-0025). Declaring `sidebar` is the opt-in: a fixture that omits it gets
 * one top-level project row per project, synthesised by the mock, which is how
 * every fixture written before groups existed keeps working.
 *
 * The shape deliberately covers all three cases in one tree: a group with
 * children, a loose project interleaved *after* it, and an empty group — which is
 * the one that needs its placeholder to be a drop target.
 */
export function fixtureGroupedProjects(): TestFixture {
	const base = fixtureTwoProjectsManySessions();
	const [zulu, alpha] = base.projects ?? [];

	return {
		...base,
		sidebar: [
			{
				kind: 'group',
				rowId: PRO_GROUP_ID,
				name: 'Pro',
				children: [{ rowId: `row-${alpha.id}`, project: alpha }],
			},
			{ kind: 'project', rowId: `row-${zulu.id}`, project: zulu },
			{ kind: 'group', rowId: PERSO_GROUP_ID, name: 'Perso', children: [] },
		],
	};
}

/** Stable row ids for the group fixtures, so a test can address a group without
 *  reading it out of the DOM first. */
export const PRO_GROUP_ID = 'g0000001-0000-4000-8000-000000000001';
export const PERSO_GROUP_ID = 'g0000002-0000-4000-8000-000000000002';
