import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
	ClaudeCliStatus,
	DirListing,
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
function isTauri(): boolean {
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

	checkClaudeCli: () => invoke<ClaudeCliStatus>('check_claude_cli'),
	terminalSpawn: (opts: SpawnOpts) => invoke<TerminalId>('terminal_spawn', { opts }),
	terminalWrite: (id: TerminalId, data: string) => invoke<void>('terminal_write', { id, data }),
	terminalResize: (id: TerminalId, cols: number, rows: number) =>
		invoke<void>('terminal_resize', { id, cols, rows }),
	terminalKill: (id: TerminalId) => invoke<void>('terminal_kill', { id }),
	terminalList: () => invoke<TerminalStatusDto[]>('terminal_list'),
	appQuitConfirmed: () => invoke<void>('app_quit_confirmed'),
};

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
// specs/annex-A-tolaria-patterns.md § A.7.
//
// Tests inject richer data via `window.__FACTORAI_TEST__` (set in
// tests/smoke/fixtures.ts before the page navigates). Hand-rolling
// fixtures avoids dragging msw/server mocks into the renderer.

interface TestFixture {
	projects?: Project[];
	sessionsByProject?: Record<string, SessionSummary[]>;
	sessionPages?: Record<string, SessionPage>;
	terminalSpawnId?: TerminalId;
	searchHits?: SearchHit[];
	/** Directory listings keyed by absolute path, for the F11 file tree. */
	dirListings?: Record<string, DirListing>;
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
			const hits = (fx?.searchHits ?? []).filter(
				(h) => !projectId || h.projectId === projectId,
			);
			return hits as unknown as T;
		}
		case 'list_dir': {
			const path = String(args?.path ?? '');
			const listing = fx?.dirListings?.[path];
			// An unlisted path is an empty directory, not an error — fixtures only
			// declare the paths a test actually expands.
			return (listing ?? { entries: [], total: 0, truncated: false }) as unknown as T;
		}
		case 'resolve_project_path':
			return null as unknown as T;
		case 'pin_project':
			return undefined as unknown as T;
		case 'check_claude_cli':
			return { installed: false, binaryPath: null, version: null } as unknown as T;
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
