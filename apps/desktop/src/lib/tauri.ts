import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
	ClaudeCliStatus,
	DirListing,
	FileContents,
	GitRev,
	GitStatus,
	IndexerProgressEvent,
	Project,
	QuitRequestedEvent,
	SearchHit,
	SessionPage,
	SessionSummary,
	SessionsChangedEvent,
	SpawnOpts,
	TerminalDataEvent,
	TerminalExitEvent,
	TerminalId,
	TerminalStatusDto,
	TerminalStatusEvent,
} from '@factorai/types';

/// True when running inside a Tauri webview (window.__TAURI_INTERNALS__ is
/// injected). False under plain `vite dev` — the mocks below kick in.
///
/// Exported so features that talk to a plugin rather than to our own commands
/// (the updater, F14) can no-op in browser-only mode instead of importing a
/// plugin that has nothing to talk to.
export function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function invoke<T>(name: string, args?: Record<string, unknown>): Promise<T> {
	if (isTauri()) return tauriInvoke<T>(name, args);
	return mockInvoke<T>(name, args);
}

async function listen<T>(name: string, handler: (payload: T) => void): Promise<UnlistenFn> {
	if (isTauri()) return tauriListen<T>(name, (e) => handler(e.payload));
	return mockListen<T>(name, handler);
}

export const cmd = {
	listProjects: () => invoke<Project[]>('list_projects'),
	resolveProjectPath: (id: string) => invoke<string | null>('resolve_project_path', { id }),
	pinProject: (id: string, pinned: boolean) => invoke<void>('pin_project', { id, pinned }),
	listSessions: (projectId: string) => invoke<SessionSummary[]>('list_sessions', { projectId }),
	getSession: (sessionId: string, offset?: number, limit?: number) =>
		invoke<SessionPage>('get_session', { sessionId, offset, limit }),
	getSessionTail: (sessionId: string, limit?: number) =>
		invoke<SessionPage>('get_session_tail', { sessionId, limit }),
	searchSessions: (query: string, projectId?: string, limit?: number) =>
		invoke<SearchHit[]>('search_sessions', { query, projectId, limit }),

	/** List one directory. `root` is the project root — only used to flag
	 *  symlinks that point out of the project. */
	listDir: (path: string, root?: string) => invoke<DirListing>('list_dir', { path, root }),
	/** Read a file for the viewer. `maxBytes` omitted uses the backend's 5MB
	 *  default; pass null to lift the cap after warning the user. */
	readFile: (path: string, maxBytes?: number | null) =>
		invoke<FileContents>('read_file', { path, maxBytes }),

	/** Repository state for the Changes tab and the tree's decorations (F13).
	 *  A project outside a repository resolves with `repoRoot: null` rather
	 *  than rejecting. */
	gitStatus: (projectPath: string) => invoke<GitStatus>('git_status', { projectPath }),
	/** One file at HEAD or in the index, for the left side of a diff. Resolves
	 *  null when the path doesn't exist at that revision — an added file has no
	 *  HEAD side, and that is a row in the list, not an error. */
	gitBlob: (path: string, rev: GitRev, maxBytes?: number | null) =>
		invoke<FileContents | null>('git_blob', { path, rev, maxBytes }),

	checkClaudeCli: () => invoke<ClaudeCliStatus>('check_claude_cli'),
	/** The session id to open for a "new session" in this project — a fresh
	 *  uuid, or a live one that has never been messaged. See ADR-0008. */
	startSession: (projectId: string) => invoke<string>('start_session', { projectId }),
	terminalSpawn: (opts: SpawnOpts) => invoke<TerminalId>('terminal_spawn', { opts }),
	terminalWrite: (id: TerminalId, data: string) => invoke<void>('terminal_write', { id, data }),
	terminalResize: (id: TerminalId, cols: number, rows: number) =>
		invoke<void>('terminal_resize', { id, cols, rows }),
	terminalKill: (id: TerminalId) => invoke<void>('terminal_kill', { id }),
	terminalList: () => invoke<TerminalStatusDto[]>('terminal_list'),
	appQuitConfirmed: () => invoke<void>('app_quit_confirmed'),
};

/**
 * Open a path with the OS default application. The plugin is imported lazily so
 * browser-only dev (and Playwright) never load it — there it's a no-op rather
 * than a rejected invoke.
 */
export async function openExternally(path: string): Promise<void> {
	if (!isTauri()) return;
	// plugin-shell 2.3.x calls this `open`; the capability grant is
	// `shell:allow-open` in capabilities/default.json.
	const { open } = await import('@tauri-apps/plugin-shell');
	await open(path);
}

/**
 * Browser-only stand-in for the updater's `ready` state (F14).
 *
 * Returns the fixture's staged version, or null when there's nothing to
 * announce. Inside Tauri this is never consulted — the plugin is.
 */
export function mockStagedUpdate(): string | null {
	return testFixture()?.updateReady ?? null;
}

/** Record a call the mock bridge can't perform, so tests can assert it was
 *  attempted. `relaunch()` is the only one so far. */
export function recordMockCall(name: string): void {
	if (typeof window === 'undefined' || !testFixture()) return;
	window.__FACTORAI_TEST_CALLS__ ??= [];
	window.__FACTORAI_TEST_CALLS__.push({ name });
}

export const events = {
	onIndexerProgress: (cb: (p: IndexerProgressEvent) => void) =>
		listen<IndexerProgressEvent>('indexer:progress', cb),
	onSessionsChanged: (cb: (p: SessionsChangedEvent) => void) =>
		listen<SessionsChangedEvent>('sessions:changed', cb),
	onTerminalData: (cb: (p: TerminalDataEvent) => void) =>
		listen<TerminalDataEvent>('terminal:data', cb),
	onTerminalStatus: (cb: (p: TerminalStatusEvent) => void) =>
		listen<TerminalStatusEvent>('terminal:status', cb),
	onTerminalExit: (cb: (p: TerminalExitEvent) => void) =>
		listen<TerminalExitEvent>('terminal:exit', cb),
	onQuitRequested: (cb: (p: QuitRequestedEvent) => void) =>
		listen<QuitRequestedEvent>('app:quit-requested', cb),
};

// ── Mocks for browser-only dev (pnpm vite:dev without tauri) ───────────────
// Lightweight stand-ins so the renderer can boot without Rust. See
// specs/annex-A-cli-agent-patterns.md § A.7.
//
// Tests inject richer data via `window.__FACTORAI_TEST__` (set in
// tests/smoke/fixtures.ts before the page navigates). Hand-rolling
// fixtures avoids dragging msw/server mocks into the renderer.

interface TestFixture {
	projects?: Project[];
	sessionsByProject?: Record<string, SessionSummary[]>;
	sessionPages?: Record<string, SessionPage>;
	terminalSpawnId?: TerminalId;
	/** Session id `start_session` hands back for a new-session click. */
	newSessionId?: string;
	searchHits?: SearchHit[];
	/** Directory listings keyed by absolute path, for the F12 file tree. */
	dirListings?: Record<string, DirListing>;
	/** File contents keyed by absolute path, for the F7 viewer. */
	files?: Record<string, FileContents>;
	/** Repository state keyed by project path, for the F13 Changes tab. */
	gitStatuses?: Record<string, GitStatus>;
	/** Blobs keyed by `<rev>:<absolute path>`, for diff fixtures. */
	gitBlobs?: Record<string, FileContents>;
	/** Version to report as downloaded and staged, for the F14 update badge.
	 *  The real updater is a Tauri plugin and inert in the browser, so this is
	 *  the only way to reach the `ready` state from a test. */
	updateReady?: string;
}

/** One mocked command call, recorded in order while a fixture is installed. */
interface MockCall {
	name: string;
	args?: Record<string, unknown>;
}

declare global {
	interface Window {
		__FACTORAI_TEST__?: TestFixture;
		/** Log of mocked command calls — lets smoke tests assert on the arguments
		 *  the renderer sent, not just on what it rendered. Only populated when a
		 *  fixture is installed. */
		__FACTORAI_TEST_CALLS__?: MockCall[];
	}
}

function testFixture(): TestFixture | undefined {
	return typeof window !== 'undefined' ? window.__FACTORAI_TEST__ : undefined;
}

async function mockInvoke<T>(name: string, args?: Record<string, unknown>): Promise<T> {
	const fx = testFixture();
	if (fx) {
		window.__FACTORAI_TEST_CALLS__ ??= [];
		window.__FACTORAI_TEST_CALLS__.push({ name, args });
	}
	switch (name) {
		case 'list_projects':
			return (fx?.projects ?? []) as unknown as T;
		case 'list_sessions': {
			const projectId = String(args?.projectId ?? '');
			return (fx?.sessionsByProject?.[projectId] ?? []) as unknown as T;
		}
		case 'get_session':
		case 'get_session_tail': {
			const sessionId = String(args?.sessionId ?? '');
			return (fx?.sessionPages?.[sessionId] ?? {
				id: sessionId,
				events: [],
				offset: 0,
				limit: 0,
				total: 0,
			}) as unknown as T;
		}
		case 'search_sessions': {
			const query = String(args?.query ?? '').trim();
			const projectId = args?.projectId ? String(args.projectId) : null;
			if (!query) return [] as unknown as T;
			const hits = (fx?.searchHits ?? []).filter((h) => !projectId || h.projectId === projectId);
			return hits as unknown as T;
		}
		case 'list_dir': {
			const path = String(args?.path ?? '');
			const listing = fx?.dirListings?.[path];
			// An unlisted path is an empty directory, not an error — fixtures only
			// declare the paths a test actually expands.
			return (listing ?? { entries: [], total: 0, truncated: false }) as unknown as T;
		}
		case 'read_file': {
			const path = String(args?.path ?? '');
			const file = fx?.files?.[path];
			// An unlisted path rejects like a deleted file, so the viewer's
			// not-found path is reachable from a fixture.
			if (!file) throw { kind: 'NotFound', message: `path ${path}` };
			// An uncapped read is never truncated — same as the backend. Lets a
			// fixture declare `truncated: true` and have "Show anyway" resolve it.
			if (args?.maxBytes === null) return { ...file, truncated: false } as unknown as T;
			return file as unknown as T;
		}
		case 'git_status': {
			const projectPath = String(args?.projectPath ?? '');
			// An undeclared project is one without a repository — the panel's
			// "Not a git repository" state, reachable without a fixture.
			return (fx?.gitStatuses?.[projectPath] ?? {
				repoRoot: null,
				branch: null,
				changes: [],
				total: 0,
				truncated: false,
			}) as unknown as T;
		}
		case 'git_blob': {
			const key = `${String(args?.rev ?? '')}:${String(args?.path ?? '')}`;
			// Absent means "the file doesn't exist at that revision", which is an
			// added or deleted file — null, never a rejection.
			return (fx?.gitBlobs?.[key] ?? null) as unknown as T;
		}
		case 'resolve_project_path':
			return null as unknown as T;
		case 'pin_project':
			return undefined as unknown as T;
		case 'check_claude_cli':
			return { installed: false, binaryPath: null, version: null } as unknown as T;
		case 'start_session':
			// The real command may hand back a live never-messaged session instead
			// of a fresh id (it probes the transcript on disk). The mock always
			// returns the same id — simulating the reuse rule here would only
			// assert the mock, and the renderer's path is identical either way.
			return (fx?.newSessionId ?? '00000000-0000-4000-8000-000000000000') as unknown as T;
		case 'terminal_spawn':
			return (fx?.terminalSpawnId ?? 'mock-terminal-id') as unknown as T;
		case 'terminal_write':
		case 'terminal_resize':
		case 'terminal_kill':
		case 'app_quit_confirmed':
			return undefined as unknown as T;
		case 'terminal_list':
			return [] as unknown as T;
		default:
			throw new Error(`mockInvoke: unknown command "${name}"`);
	}
}

async function mockListen<T>(_name: string, _handler: (payload: T) => void): Promise<UnlistenFn> {
	return async () => {};
}
