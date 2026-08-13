// ── Core domain models ───────────────────────────────────────────────────────

export interface Project {
	id: string;
	realPath: string | null;
	displayName: string;
	lastSessionAt: number | null;
	sessionCount: number;
	pinned: boolean;
}

export interface SessionSummary {
	id: string;
	projectId: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	turnCount: number;
	cwd: string | null;
}

export interface SessionPage {
	id: string;
	events: SessionEvent[];
	offset: number;
	limit: number;
	total: number;
}

// The JSONL event shape we parse. See specs/02-data-model.md for the
// full schema documentation.
//
// Only `type` is guaranteed. Meta events (`mode`, `permission-mode`,
// `ai-title`, `file-history-snapshot`, …) have no `uuid` or `timestamp`.
export interface SessionEvent {
	type: string;
	uuid?: string;
	parentUuid?: string;
	timestamp?: string;
	sessionId?: string;
	cwd?: string;
	version?: string;
	message?: SessionMessage;
	// Anything else we don't model — preserved verbatim for rendering.
	[extra: string]: unknown;
}

export interface SessionMessage {
	role: 'user' | 'assistant' | string;
	content: string | ContentBlock[];
}

export type ContentBlock =
	| { type: 'text'; text: string }
	| { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
	| {
			type: 'tool_result';
			tool_use_id: string;
			content: string | ContentBlock[];
			is_error?: boolean;
	  }
	| { type: 'thinking'; thinking: string }
	| { type: string; [extra: string]: unknown };

// ── Search ──────────────────────────────────────────────────────────────────

export interface SearchHit {
	sessionId: string;
	projectId: string;
	/** Session title (may be empty if not yet derived). */
	title: string;
	role: string;
	snippet: string;
}

// ── Terminal ────────────────────────────────────────────────────────────────

export type TerminalId = string;

export type TerminalStatus = 'running' | 'idle' | 'waiting_input' | 'stopped';

export interface TerminalStatusDto {
	id: TerminalId;
	sessionId: string;
	projectId: string;
	status: TerminalStatus;
	lastActivity: number;
}

export interface SpawnOpts {
	/** The session this PTY runs. Always set: factorai names its own sessions
	 *  (ADR-0008), so a brand-new one has an id before any process exists. The
	 *  backend decides `--resume` vs `--session-id` by probing for the
	 *  transcript — callers never say which they want. */
	sessionId: string;
	/** Encoded project dir name under `~/.claude/projects/`, used to locate
	 *  that transcript. */
	projectId: string;
	cwd?: string;
	cols: number;
	rows: number;
}

export interface ClaudeCliStatus {
	installed: boolean;
	binaryPath: string | null;
	version: string | null;
}

export interface QuitRequestedEvent {
	liveCount: number;
}

// ── Files ───────────────────────────────────────────────────────────────────

/** One entry in a project directory listing (F12 file tree). */
export interface DirEntry {
	name: string;
	/** Absolute path on disk — pass it straight back to `listDir` to expand. */
	path: string;
	/** True for directories and for symlinks resolving to one. */
	isDir: boolean;
	isSymlink: boolean;
	/** Symlink resolving outside the project root (or unresolvable): shown,
	 *  never expanded. */
	symlinkOutsideRoot: boolean;
	/** Bytes for files, 0 for directories. */
	size: number;
	/** Epoch milliseconds, null when the filesystem won't say. */
	modifiedAt: number | null;
}

export interface DirListing {
	entries: DirEntry[];
	/** Entries found before the cap — `total > entries.length` when truncated. */
	total: number;
	truncated: boolean;
}

/**
 * A file's contents for the viewer (F7).
 *
 * No `mime`: the viewer resolves a language from the extension via Monaco's
 * own language registry (ADR-0007).
 */
export interface FileContents {
	path: string;
	/** Empty when `isBinary`, or cut at the cap when `truncated`. */
	contents: string;
	/** True size on disk, whatever was actually returned. */
	size: number;
	/** A null byte turned up in the first 8KB. */
	isBinary: boolean;
	/** Longer than the requested cap — refetch with no cap to see it all. */
	truncated: boolean;
	/** Lines in `contents` (0 for empty or binary). */
	lineCount: number;
}

// ── IPC events (Rust → JS) ──────────────────────────────────────────────────

export interface IndexerProgressEvent {
	processed: number;
	total: number;
	phase: 'scanning' | 'parsing' | 'idle';
}

export interface SessionsChangedEvent {
	projectId: string;
	sessionIds: string[];
}

export interface TerminalDataEvent {
	id: TerminalId;
	bytesB64: string;
}

export interface TerminalStatusEvent {
	id: TerminalId;
	status: TerminalStatus;
	lastActivity: number;
}

export interface TerminalExitEvent {
	id: TerminalId;
	code: number | null;
}

// ── Tauri command error shape ──────────────────────────────────────────────

export type AppError =
	| { kind: 'Io'; message: string }
	| { kind: 'Db'; message: string }
	| { kind: 'NotFound'; message: string }
	| { kind: 'InvalidInput'; message: string }
	| { kind: 'Process'; message: string };
