import type {
	ClaudeCliStatus,
	DirListing,
	FileContents,
	GitRev,
	GitStatus,
	ImageContents,
	ImportCandidate,
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
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { type UnlistenFn, listen as tauriListen } from '@tauri-apps/api/event';

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
	/** The workspace: folders you added. Never anything Claude merely touched. */
	listProjects: () => invoke<Project[]>('list_projects'),
	resolveProjectPath: (id: string) => invoke<string | null>('resolve_project_path', { id }),
	/** Add a folder to the workspace, whether or not Claude has ever run in it.
	 *  Idempotent by canonical path, so neither the picker nor the import dialog
	 *  can produce duplicates. Also indexes the folder, since nothing outside
	 *  the workspace is parsed. */
	addProject: (path: string) => invoke<Project>('add_project', { path }),
	/** Remove a folder from the workspace. Touches nothing on disk; drops this
	 *  project's rows from the index, which re-adding rebuilds. */
	removeProject: (id: string) => invoke<void>('remove_project', { id }),
	/** Folders Claude has worked in, for the import dialog. Read from the store
	 *  rather than the index — the point is to show what *isn't* indexed. */
	listImportCandidates: () => invoke<ImportCandidate[]>('list_import_candidates'),
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
	/** Read an image for the viewer (F7). Rejects a file whose magic bytes
	 *  aren't a displayable format, which is the caller's cue to fall back to
	 *  the binary card. */
	readImage: (path: string, maxBytes?: number | null) =>
		invoke<ImageContents>('read_image', { path, maxBytes }),

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
 * Put an image on the system clipboard (F7).
 *
 * **Not `navigator.clipboard.write`.** WebKitGTK implements `writeText` — the
 * viewer's copy-path button proves it — but not `ClipboardItem`, so the web
 * API rejects and nothing reaches the clipboard. Verified on this machine:
 * after a web-API copy, `xclip -t TARGETS` still offered text only.
 *
 * Raw RGBA rather than the PNG bytes we already hold, because `Image.new` is
 * the one constructor that needs no decoding: `fromBytes`/`fromPath` would
 * make Tauri decode, which needs its `image-png` feature and still wouldn't
 * cover jpeg or webp. The caller has a decoded canvas anyway.
 *
 * Throws on failure, so the button can say so instead of showing a tick for
 * something that didn't happen.
 */
export async function copyImageToClipboard(
	rgba: Uint8Array,
	width: number,
	height: number,
): Promise<void> {
	if (!isTauri()) {
		// Browser-only dev and Playwright: the web API is all there is, and in a
		// Chromium test lane it works.
		const canvas = new OffscreenCanvas(width, height);
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('no 2d context');
		ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
		const blob = await canvas.convertToBlob({ type: 'image/png' });
		await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
		return;
	}
	const [{ writeImage }, { Image }] = await Promise.all([
		import('@tauri-apps/plugin-clipboard-manager'),
		import('@tauri-apps/api/image'),
	]);
	await writeImage(await Image.new(rgba, width, height));
}

/**
 * Ask the OS for a folder, for "Add project" (F1). Resolves null when the
 * picker is cancelled — which is a normal outcome, not an error.
 *
 * Lazily imported for the same reason as `openExternally`: browser-only dev and
 * Playwright have no plugin host, so a top-level import would reject rather
 * than no-op. There the fixture's `folderPick` stands in, since a native dialog
 * is otherwise unreachable from a test.
 */
export async function pickFolder(): Promise<string | null> {
	if (!isTauri()) {
		recordMockCall('dialog.open');
		return testFixture()?.folderPick ?? null;
	}
	// plugin-dialog 2.7.x; the capability grant is `dialog:default`.
	const { open } = await import('@tauri-apps/plugin-dialog');
	const picked = await open({ directory: true, multiple: false, title: 'Add project folder' });
	// `multiple: false` narrows it to one path, but the union still admits an
	// array — cancelling gives null either way.
	return typeof picked === 'string' ? picked : null;
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
// specs/annex-A-tolaria-patterns.md § A.7.
//
// Tests inject richer data via `window.__FACTORAI_TEST__` (set in
// tests/smoke/fixtures.ts before the page navigates). Hand-rolling
// fixtures avoids dragging msw/server mocks into the renderer.

/**
 * A stable, uuid-shaped id for a mocked project.
 *
 * Derived from the path rather than random so a fixture can predict it and a
 * re-run of the same test produces the same URLs. The real command mints a
 * genuine v4 — nothing in the renderer may depend on the id's *content*, only
 * on its stability, which is exactly what this preserves.
 */
function mockUuid(seed: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < seed.length; i++) {
		h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
	}
	const hex = h.toString(16).padStart(8, '0');
	return `${hex}-0000-4000-8000-${hex}00000000`.slice(0, 36);
}

interface TestFixture {
	projects?: Project[];
	/** Rows the import dialog offers (F1). Also what `add_project` reads a
	 *  session count off, so importing a candidate looks like importing. */
	importCandidates?: ImportCandidate[];
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
	/** Images keyed by absolute path, for the F7 viewer. An image-looking path
	 *  that isn't listed here rejects, which is the binary-card fallback. */
	images?: Record<string, ImageContents>;
	/** Repository state keyed by project path, for the F13 Changes tab. */
	gitStatuses?: Record<string, GitStatus>;
	/** Blobs keyed by `<rev>:<absolute path>`, for diff fixtures. */
	gitBlobs?: Record<string, FileContents>;
	/** Version to report as downloaded and staged, for the F14 update badge.
	 *  The real updater is a Tauri plugin and inert in the browser, so this is
	 *  the only way to reach the `ready` state from a test. */
	updateReady?: string;
	/** Path the folder picker returns for "Add project" (F1). Absent means the
	 *  picker was cancelled — a native dialog can't be driven from a test. */
	folderPick?: string;
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
		case 'add_project': {
			const path = String(args?.path ?? '');
			// Idempotent **by path**, not by id — that is the real command's rule
			// now that ids are uuids, and a test that re-adds a folder is asserting
			// exactly this.
			const existing = fx?.projects ?? [];
			const already = existing.find((p) => p.realPath === path);
			if (already) return already as unknown as T;
			const candidate = fx?.importCandidates?.find((c) => c.realPath === path);
			const project: Project = {
				id: mockUuid(path),
				realPath: path,
				displayName: path.split('/').filter(Boolean).pop() ?? path,
				lastSessionAt: candidate?.lastActivityAt ?? null,
				sessionCount: candidate?.sessionCount ?? 0,
				pinned: false,
				missing: candidate?.missing ?? false,
			};
			// Write it back into the fixture so the next `list_projects` returns it,
			// as the real command's row would.
			if (fx) {
				fx.projects = [...existing, project];
				// And it stops being importable, the way the real candidate list
				// reports `alreadyOpen` against the workspace.
				for (const c of fx.importCandidates ?? []) {
					if (c.realPath === path) c.alreadyOpen = true;
				}
			}
			return project as unknown as T;
		}
		case 'remove_project': {
			const id = String(args?.id ?? '');
			if (fx) {
				const gone = fx.projects?.find((p) => p.id === id);
				fx.projects = (fx.projects ?? []).filter((p) => p.id !== id);
				// The index goes with the membership, so its sessions and its search
				// hits go too — the mock models that, or a test would "prove" the
				// removed project is still searchable.
				if (gone) {
					delete fx.sessionsByProject?.[id];
					fx.searchHits = (fx.searchHits ?? []).filter((h) => h.projectId !== id);
					for (const c of fx.importCandidates ?? []) {
						if (c.realPath === gone.realPath) c.alreadyOpen = false;
					}
				}
			}
			return undefined as unknown as T;
		}
		case 'list_import_candidates':
			return (fx?.importCandidates ?? []) as unknown as T;
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
		case 'read_image': {
			const path = String(args?.path ?? '');
			const image = fx?.images?.[path];
			// Undeclared means "not a displayable image", which is how a fixture
			// reaches the fall-back-to-binary-card path without inventing bytes.
			if (!image) throw { kind: 'InvalidInput', message: `not a displayable image: ${path}` };
			return image as unknown as T;
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
		case 'pin_project': {
			// Mutates the fixture so the renderer's next `list_projects` reflects
			// it — a no-op mock would make the pinned group untestable.
			const id = String(args?.id ?? '');
			const pinned = args?.pinned === true;
			const project = fx?.projects?.find((p) => p.id === id);
			if (project) project.pinned = pinned;
			return undefined as unknown as T;
		}
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
