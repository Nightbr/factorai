// ── Core domain models ───────────────────────────────────────────────────────

/**
 * A folder in the workspace (F1, ADR-0011).
 *
 * `realPath` is not optional: a project *is* a folder, so it always has one.
 * That was not true of the old model, where a project was a directory in
 * Claude's store whose folder we might never have identified.
 */
export interface Project {
	/** uuid v4. Not derived from the path — moving a folder later can keep the
	 *  project rather than orphaning its place in the sidebar and its sessions. */
	id: string;
	realPath: string;
	displayName: string;
	lastSessionAt: number | null;
	sessionCount: number;
	/** The folder is gone from disk. Set by the indexer's scan, not computed per
	 *  `list_projects` call — that query is polled every 2s. */
	missing: boolean;
	/** Which Claude profile this project's **new** sessions run as (F25 slice 3).
	 *  Null means the agent's default — which is what no assignment means, so an
	 *  install that never assigned anything has null everywhere.
	 *
	 *  On the project rather than fetched separately because the right-click menu
	 *  that changes it is drawn from this list, which the sidebar already polls. */
	profileId: string | null;
	/** That profile's name, for the menu. Null alongside a null `profileId`. */
	profileName: string | null;
}

/**
 * One row of the sidebar's tree (F1, ADR-0025).
 *
 * **The order is the array's order**, and a group's contents are the array order
 * of `children` — neither carries its ordinal across the boundary.
 * `sidebar_rows.sort_order` is sparse by design (a new row gets
 * `MIN(sort_order) - 1` so it lands on top without renumbering), so an ordinal
 * the renderer could see would be a number it must not do arithmetic with. What
 * goes back is `SidebarOrder` — ids in order — and `reorder_sidebar` assigns the
 * numbers.
 *
 * A discriminated union on `kind`, matching Rust's
 * `#[serde(tag = "kind", rename_all = "camelCase")]`.
 */
export type SidebarRow =
	| {
			kind: 'project';
			/** The **row's** id, not the project's. Durable, and what
			 *  `reorderSidebar` addresses. A project has exactly one row. */
			rowId: string;
			project: Project;
	  }
	| {
			kind: 'group';
			rowId: string;
			name: string;
			/** Possibly empty — a group you made and have not filled yet is a
			 *  container you made on purpose (F1). */
			children: SidebarChild[];
	  };

/**
 * A project inside a group.
 *
 * Its own type rather than a reused `SidebarRow` because a group cannot contain a
 * group: the schema's `CHECK (kind = 'project' OR parent_id IS NULL)` says so,
 * and this makes the same statement in the type the renderer reads.
 */
export interface SidebarChild {
	rowId: string;
	project: Project;
}

/**
 * The order the renderer is asking for — what `reorderSidebar` sends back.
 *
 * Deliberately not `SidebarRow`: this carries ids and nothing else. Sending the
 * rendered shape would mean sending names and project payloads to a command
 * whose only job is ordering, and then deciding whether to trust them.
 */
export type SidebarOrder =
	| { kind: 'project'; rowId: string }
	| { kind: 'group'; rowId: string; children: string[] };

/**
 * A folder an agent has worked in that isn't in the workspace yet — one row in
 * the "Import from Claude Code" list (F1).
 *
 * Read from the agent's store directly rather than from the index, since
 * nothing outside the workspace is indexed.
 */
export interface ImportCandidate {
	/** Which agent's store this came from. `'claude'` today. */
	agent: string;
	/** The agent's own directory name — the stable key for the row. */
	key: string;
	realPath: string;
	displayName: string;
	sessionCount: number;
	lastActivityAt: number | null;
	/** The folder is gone from disk. Still importable: every transcript is still
	 *  there and only *starting* a session is impossible. */
	missing: boolean;
	/** Already in the workspace — the row renders checked and disabled rather
	 *  than being hidden. */
	alreadyOpen: boolean;
}

export interface SessionSummary {
	id: string;
	projectId: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	turnCount: number;
	cwd: string | null;
	/** Set when this is a sub-agent transcript (`<session>/subagents/agent-*`):
	 *  the id of the session that spawned it. Sub-agent sessions are readable
	 *  read-only — the session view shows their transcript with no terminal,
	 *  because `claude --resume` cannot open them. */
	subagentOf: string | null;
	/** The checkout of the project's repository this session is working in, as
	 *  last signalled through the IDE bridge (F21). Null for the ordinary case —
	 *  no signal, so the checkout is derived from `cwd` instead.
	 *
	 *  **A record, not a guarantee**: the path may have been removed since, so it
	 *  is validated against `gitWorktrees` before being used. */
	worktree: string | null;
	/** The **last** `cwd` the transcript records, where `cwd` is the first (F21).
	 *
	 *  How the panel notices an agent that moved into a worktree without saying
	 *  so. Only ever read through containment against the repository's checkouts,
	 *  which is what makes the churn between the two harmless: a `cd` into
	 *  `node_modules/…` is still inside the main checkout and resolves to it. */
	lastCwd: string | null;
	/** The recent **absolute** paths this session's tools named, oldest first
	 *  (F21).
	 *
	 *  The signal for an agent that drives another checkout by absolute path and
	 *  so never moves its own cwd — the shape neither `lastCwd` nor the bridge can
	 *  see. Read through the same containment, ahead of `lastCwd`, and believed
	 *  only where it lands in a *linked* checkout: the most recent entry that does
	 *  wins and the rest are ignored, which is what lets the harvest behind it be
	 *  loose enough to read shell commands. */
	touchedPaths: string[];
	/** The routine that started this session, when one did (F22).
	 *
	 *  Outlives the routine: deleting one nulls the link rather than cascading,
	 *  so a session it started keeps its origin icon and loses only the name. */
	routineId: string | null;
	/** That routine's name, for the origin icon's tooltip. Null when the routine
	 *  has been deleted since. */
	routineName: string | null;
	/** When the routine started this session (`session_routines.created_at`).
	 *  The durable half of its label: it survives the session gaining a title of
	 *  its own, and a reload. */
	routineStartedAt: number | null;
	/** Whether you pinned this session to the top of its project's list (F2).
	 *
	 *  The row's **own** pin. A sub-agent is never pinned itself and cannot be —
	 *  it is not a session you go back into — but it does travel above unpinned
	 *  rows when the session that spawned it is pinned, because the backend orders
	 *  the group and `groupSessions` only nests. */
	pinned: boolean;
	/** The profile this session **is running or ran under** (F25 slice 3) — the
	 *  one whose store holds its transcript, which is what a resume has to use
	 *  even when the project has since been reassigned.
	 *
	 *  Null for a session the scan has not seen yet: no transcript, so nothing to
	 *  have been written anywhere, and a spawn falls through to the project's
	 *  assignment. */
	profileName: string | null;
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
	/** Workspace project display name, JOINed for the result label. A hit that
	 *  only names its session answers "which conversation" but not "which
	 *  codebase", and the second question is the one you are usually asking. */
	projectName: string;
	/** The project's folder on disk. Carried so a hit can render the same
	 *  path-hashed `ProjectIcon` the sidebar and tab strip do — the hue comes
	 *  from the path, so a name alone would colour it differently. */
	projectPath: string;
	/** Session title (may be empty if not yet derived). */
	title: string;
	role: string;
	snippet: string;
}

// ── Terminal ────────────────────────────────────────────────────────────────

export type TerminalId = string;

/**
 * What a session is doing, derived from Claude's own terminal title (F10,
 * ADR-0015). Mirrors `services::terminal::TerminalStatus`.
 *
 * Three values because three is what the source honestly supports. There is no
 * `idle` — nothing distinguishes "alive with nothing pending" from "stopped and
 * waiting for you" — and `running` was renamed `working` because its meaning
 * narrowed: a live PTY sitting at the prompt is `waiting_input` now.
 */
export type TerminalStatus = 'working' | 'waiting_input' | 'stopped';

/**
 * What a PTY *is*, which is not what it is doing. Mirrors
 * `services::terminal::TerminalKind`.
 *
 * `shell` is the terminal in a project's footer (F23). It carries a project id
 * and **no session id at all** (ADR-0032): it outlives every session of that
 * project, and `bySession` — keyed by session id, meaning "the agent" — would
 * otherwise have filed one over the agent it happened to be drawn under.
 */
export type TerminalKind = 'agent' | 'shell';

export interface TerminalStatusDto {
	id: TerminalId;
	/** Null for a shell, which has no session (ADR-0032). */
	sessionId: string | null;
	projectId: string;
	status: TerminalStatus;
	lastActivity: number;
	kind: TerminalKind;
	/** The renderer's own pane key for a shell, handed straight back so a
	 *  reloaded renderer can re-bind this PTY to the pane it belongs to
	 *  (ADR-0032). Null for an agent, which is found by its session id. */
	clientKey: string | null;
	/** Where this terminal is running. A shell chip that outlives its process
	 *  respawns here (F23). */
	cwd: string;
}

/**
 * What the footer needs to open a shell (F23). Mirrors
 * `services::terminal::ShellSpawnOpts`.
 *
 * Deliberately not `SpawnOpts` with a flag on it: half of that struct is about
 * a Claude session — the transcript probe, a routine's first prompt — and none
 * of it means anything here.
 */
export interface ShellSpawnOpts {
	/** This renderer's key for the pane the shell fills — a `shell:<uuid>`.
	 *  Round-tripped through Rust and never read there; it is what a reloaded
	 *  renderer matches a live PTY against (ADR-0032). */
	clientKey: string;
	/** The project this shell belongs to, and the whole of its lifetime rule.
	 *  There is no session id: nothing about a session kills a shell
	 *  (ADR-0032). */
	projectId: string;
	/** Required, unlike an agent's: the caller knows which checkout the footer
	 *  is under (F21) and there is no transcript to fall back to. */
	cwd: string;
	cols: number;
	rows: number;
}

export interface SpawnOpts {
	/** The session this PTY runs. Always set: factorai names its own sessions
	 *  (ADR-0008), so a brand-new one has an id before any process exists. The
	 *  backend decides `--resume` vs `--session-id` by probing for the
	 *  transcript — callers never say which they want. */
	sessionId: string;
	/** The workspace project this session belongs to. Used for grouping — the
	 *  status dots, the new-session reuse rule — and nothing else. It says
	 *  nothing about where the transcript lives; `cwd` does. */
	projectId: string;
	/** The project's folder. Also what the transcript path is derived from,
	 *  since that is exactly what Claude encodes to name its own directory. */
	cwd?: string;
	cols: number;
	rows: number;
	/** A first message for the agent, appended to argv (F22, ADR-0026 § 4).
	 *
	 *  Only a routine fire sets it. Argv rather than a write into the PTY: a
	 *  write races the CLI's startup and lands in a trust dialog when it loses. */
	initialPrompt?: string;
}

export interface ClaudeCliStatus {
	/** The binary resolved — **not** that `claude --version` answered. A
	 *  resolved path with a null `version` is a real state (a wrapper script, a
	 *  half-finished install), and the settings page says so rather than calling
	 *  a binary that spawns sessions perfectly well "not installed". */
	installed: boolean;
	binaryPath: string | null;
	version: string | null;
}

/**
 * A setting **Rust** reads, written through `get_setting` / `set_setting`
 * (F11, ADR-0013). Mirrors the Rust enum of the same name.
 *
 * Preferences only the renderer reads are not here — they live in `prefsStore`
 * on localStorage, which is synchronous and so paints them on the first frame.
 * A union rather than a free string for the reason `GitRev` is one: a
 * misspelled key would otherwise read as "unset" with nothing to catch it.
 */
export type SettingKey = 'claudeBinaryPath' | 'routinesCatchupHours' | 'routinesMaxConcurrent';

/**
 * Emitted from `CloseRequested` when quitting needs a confirmation — which is
 * **only** when Claude is working somewhere (ADR-0020). A window close with
 * live-but-idle sessions never fires this; Rust kills them and lets the close
 * through.
 */
export interface QuitRequestedEvent {
	/** Every live PTY, i.e. what quitting terminates. */
	liveCount: number;
	/** How many of those Claude is working in — the reason the dialog exists.
	 *  Always at least 1 when this event fires. */
	workingCount: number;
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
	/** Git would ignore this path — the tree dims it. Always false outside a
	 *  repository, or when it can't be opened (F12). */
	ignored: boolean;
}

export interface DirListing {
	entries: DirEntry[];
	/** Entries found before the cap — `total > entries.length` when truncated. */
	total: number;
	truncated: boolean;
}

/**
 * What a path on disk turned out to be, for the terminal's link provider (F19).
 *
 * Three states and no error case: the only question is "can I usefully open
 * this", and a broken symlink, a permission error and a path that was never
 * there all answer it the same way. Mirrors Rust's `PathKind`.
 */
export type PathKind = 'file' | 'directory' | 'missing';

/**
 * What the renderer has on screen, reported to the backend so the IDE bridge
 * can answer honestly rather than guess (F20). Mirrors Rust's `UiSnapshot`.
 *
 * Two of the bridge's answers depend on it and Rust cannot see the UI:
 * `getOpenEditors` has to name real files, and an `openFile` for a session that
 * is not in front marks its tab instead of taking the window.
 */
export interface UiSnapshot {
	/** The session whose tab is in front, or null when the human is somewhere
	 *  that isn't a session. */
	activeSession: string | null;
	/** What the viewer is showing (`?file=`), if anything. */
	openFile: string | null;
}

/**
 * The agent asked us to show a file (F20).
 *
 * `frontmost` is decided in Rust, from whether this session is the one in front
 * *and* whether the agent asked to be intrusive. The renderer obeys rather than
 * re-deciding, so the rule lives in one place.
 */
/**
 * A file, or a run of lines in one, handed to the agent as context (F20).
 *
 * **`lineStart`/`lineEnd` are 1-based and inclusive here** — the numbers the
 * human selected and the viewer showed them. The wire is 0-based; Rust's
 * `protocol::at_mentioned` is the single place that converts, and its doc
 * comment carries the evidence for why.
 */
export interface Mention {
	path: string;
	lineStart?: number;
	lineEnd?: number;
}

/**
 * Where a session's IDE bridge stands (F20).
 *
 * The header draws nothing while this is healthy — a badge for a working bridge
 * is a label that is always on, and a label that is always on is one you stop
 * reading. `error` is the only field the UI acts on; `connected` is for the log.
 */
export interface IdeStatusEvent {
	sessionId: string;
	connected: boolean;
	/** Why the bridge is unusable, in words a human can act on. Null when there
	 *  is nothing wrong to report. */
	error: string | null;
}

/** The checkout a session is working in, after a bridge signal (F21).
 *
 *  Emitted **after** the row is written, so what the renderer shows and what a
 *  reload would show cannot disagree. */
export interface SessionWorktreeEvent {
	sessionId: string;
	path: string;
	/** The checkout's own branch, for the header badge. Null on a detached
	 *  HEAD. */
	branch: string | null;
}

export interface IdeOpenFileEvent {
	sessionId: string;
	path: string;
	/** 1-based, straight into the viewer's `&line=`. */
	line: number | null;
	frontmost: boolean;
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

/**
 * One image, ready for an `<img src>` (F7).
 *
 * Separate from `FileContents` rather than a field on it: that type is shared
 * with `git_blob` and its `contents` is text bound for Monaco. This one carries
 * a `mime` for the opposite reason `FileContents` doesn't — a data URL needs
 * the type, and it is read from the file's magic bytes rather than guessed
 * from its extension.
 */
export interface ImageContents {
	path: string;
	/** Sniffed from the bytes, e.g. `image/png`. Never the extension. */
	mime: string;
	/** Standard base64 of the whole file. */
	base64: string;
	/** Size on disk, in bytes. */
	size: number;
}

/**
 * One PDF's bytes, for pdf.js to parse in the renderer (F7).
 *
 * `ImageContents` without the `mime`: `read_pdf` refuses anything that isn't
 * `%PDF-`, so the type is a constant and sending it would be restating the
 * command's own precondition. No page count either — pdf.js reports `numPages`
 * from these same bytes, and a second answer could only disagree with it.
 */
export interface PdfContents {
	path: string;
	/** Standard base64 of the whole file. */
	base64: string;
	/** Size on disk, in bytes. */
	size: number;
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

/**
 * The file the viewer has open changed on disk (F7).
 *
 * The path only: the renderer re-reads through `readFile` / `readImage` /
 * `readPdf`, so the refresh cannot show something a reopen wouldn't, and the
 * bytes of a file nobody is looking at any more never cross the bridge.
 */
export interface FileChangedEvent {
	path: string;
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
	/** True when **factorai** killed this process — the quit, a session close, a
	 *  restart — rather than it ending on its own.
	 *
	 *  F23 answers the two differently: a shell you typed `exit` in loses its
	 *  chip, one the app killed comes back as a dead chip holding its cwd. The
	 *  exit code cannot tell them apart, and on the quit path this renderer may
	 *  not live long enough to reason about it. */
	killed: boolean;
}

// ── Git (F13) ──────────────────────────────────────────────────────────────

/** Which side of git a blob is read from. The worktree isn't here: that side is
 *  `readFile`, which already handles caps, binaries and lossy UTF-8. */
export type GitRev = 'head' | 'index';

/**
 * Which comparison a change row belongs to.
 *
 * A partly-staged file legitimately produces one row in `staged` and another in
 * `unstaged`, each with its own line counts — the only version where the numbers
 * add up (07-open-questions.md Q19).
 */
export type GitGroup = 'staged' | 'unstaged' | 'conflicted';

export type GitChangeKind =
	| 'modified'
	| 'added'
	| 'deleted'
	| 'renamed'
	| 'typechange'
	| 'untracked'
	| 'conflicted';

/** One row in the Changes tab. */
export interface GitChange {
	/** Absolute path on disk — what the viewer and `gitBlob` take. */
	path: string;
	/** Relative to the *project* root, so a change above the project reads
	 *  `../packages/types/index.ts` and is visibly not yours. */
	relPath: string;
	group: GitGroup;
	kind: GitChangeKind;
	/** Previous path for a rename, relative to the project like `relPath`. */
	oldRelPath: string | null;
	/** Null for binary deltas, for files over the stat cap, and for conflicted
	 *  rows — the row still exists, it just carries no counts. */
	additions: number | null;
	deletions: number | null;
	isBinary: boolean;
}

/** One checkout of a repository — the main working tree or a linked worktree
 *  (F21). Mirrors Rust `GitWorktree`.
 *
 *  **Every checkout git knows is a row, the broken ones included.** `locked`,
 *  `prunable` and `exists: false` are reported rather than filtered, because a
 *  session whose cwd is inside a checkout we hid resolves somewhere else with
 *  nothing on screen saying why. */
export interface GitWorktree {
	/** Absolute path of the checkout's working directory. */
	path: string;
	/** Git's own name for a linked worktree. Null for the main checkout, which
	 *  has no `.git/worktrees` entry. */
	name: string | null;
	/** Short branch name at this checkout's HEAD, null on a detached HEAD or an
	 *  unborn branch — exactly as `GitStatus.branch` is. */
	branch: string | null;
	/** Full SHA this checkout's HEAD resolves to, null on an unborn branch. */
	head: string | null;
	/** The repository's main working tree. A bare repository has none and so
	 *  contributes no row at all. */
	isMain: boolean;
	locked: boolean;
	prunable: boolean;
	/** The working directory is on disk. False is a checkout you can still see in
	 *  the list but cannot be shown. */
	exists: boolean;
}

export interface GitStatus {
	/** Working directory of the repository, null when the project isn't in one.
	 *  That is a success, not an error: "not versioned" is something the panel
	 *  renders. */
	repoRoot: string | null;
	/** Null on a detached HEAD or an unborn branch. */
	branch: string | null;
	/** Full SHA that HEAD resolves to, null on an unborn branch (F18).
	 *
	 *  `branch: null` conflated two states the header badge has to tell apart: a
	 *  detached HEAD, where there *is* a commit to name, and an unborn branch,
	 *  where there isn't. With this the badge shows a short SHA in the first case
	 *  and stays quiet in the second. */
	head: string | null;
	changes: GitChange[];
	/** Rows found before the cap, so the UI can say how many it isn't showing. */
	total: number;
	truncated: boolean;
}

// ── Git graph (F18) ────────────────────────────────────────────────────────

/** What kind of ref points at a commit, which is what decides its chip.
 *
 *  No `origin/HEAD`: it is a symbolic ref duplicating one we already return and
 *  the commonest cause of a row overflowing its chips, so it is dropped in the
 *  service rather than left for every consumer to know to ignore. */
export type GitRefKind = 'localBranch' | 'remoteBranch' | 'tag' | 'head';

export interface GitRef {
	/** Short name: `main`, `origin/main`, `v0.3.0`. */
	name: string;
	kind: GitRefKind;
	/** HEAD points here — lets the row draw `HEAD→main` as one chip. */
	isHead: boolean;
	/** For a local branch whose upstream is on this same commit, that upstream's
	 *  short name, so the pair collapses to `main ≡origin` instead of spending two
	 *  slots saying the same thing. Null when there is no upstream or it has
	 *  diverged — in which case the two refs are on different rows anyway and
	 *  there is nothing to crowd. */
	upstreamInSync: string | null;
}

/** How one lane line is drawn through a row.
 *
 *  Split by geometry rather than git meaning, because geometry is what the
 *  renderer needs. Naming them for merges and branches would invert in a
 *  newest-first walk: a lane converging on a commit from below is where a branch
 *  forked off, not where it merged. */
export type GitGraphEdgeKind =
	/** Neither starts nor ends here: top edge to bottom edge. */
	| 'through'
	/** Converges on this row's commit: top edge to the node. */
	| 'incoming'
	/** Leaves this row's commit: the node to the bottom edge. */
	| 'outgoing';

export interface GitGraphEdge {
	fromLane: number;
	toLane: number;
	/** Whose colour this segment takes. A converging branch keeps its own lane's
	 *  colour into the node, which is what makes it traceable back up the rail. */
	lane: number;
	kind: GitGraphEdgeKind;
}

/** One commit in the graph, laid out. No message body: at 300 commits a page
 *  that would be the bulk of the payload for something only the detail pane
 *  reads, and `gitCommit` serves that. */
export interface GitGraphCommit {
	/** Full 40-character SHA. */
	sha: string;
	shortSha: string;
	/** First line of the message. Empty for a commit with an empty message. */
	subject: string;
	authorName: string;
	/** Lower-cased and trimmed in Rust: an identity key rather than a display
	 *  string, since the row derives one avatar per distinct value. */
	authorEmail: string;
	/** Epoch milliseconds — git counts seconds, converted in Rust. */
	authorTime: number;
	commitTime: number;
	/** Full SHAs, first parent first. More than one means a merge. */
	parents: string[];
	refs: GitRef[];
	lane: number;
	edges: GitGraphEdge[];
}

/** One page of the graph. */
export interface GitGraph {
	/** Null when the project isn't in a repository — the same shape `GitStatus`
	 *  uses, for the same reason. */
	repoRoot: string | null;
	commits: GitGraphCommit[];
	/** Lanes live anywhere in the prefix walked so far, so one pitch can be
	 *  chosen for the whole list. Computed over the prefix rather than the page,
	 *  so it only ever grows as you load more and the rows above never reflow. */
	laneCount: number;
	/** Digest of the refs this page was walked against. If it changes between
	 *  pages, refetch from the first page rather than splicing a page walked
	 *  against different refs onto one that wasn't. */
	refsDigest: string;
	/** False when the walk ended before the limit — there is no further page.
	 *  Deliberately not a total: counting a 200 000-commit repository to render
	 *  "300 of N" costs a full walk on every poll. */
	hasMore: boolean;
	/** Which forge `origin` points at, so a remote-branch chip can wear the right
	 *  icon. Read from the remote's configured URL — a config read, not a network
	 *  one; nothing here contacts any forge. */
	remoteHost: RemoteHost;
}

/** The forge a remote URL names. Only ever picks an icon. */
export type RemoteHost = 'gitHub' | 'gitLab' | 'other';

/** One file touched by a commit.
 *
 *  `GitChange` minus `group`: a commit's diff is not staged, unstaged or
 *  conflicted, and labelling it one of those to reuse the type would be a lie in
 *  the payload to save an interface. The row *component* is shared instead. */
export interface GitCommitFile {
	path: string;
	relPath: string;
	kind: GitChangeKind;
	oldRelPath: string | null;
	additions: number | null;
	deletions: number | null;
	isBinary: boolean;
}

/** Everything the detail pane shows for one commit. */
export interface GitCommitDetail {
	sha: string;
	shortSha: string;
	subject: string;
	/** Everything after the subject, trimmed. Empty when there is no body. */
	body: string;
	authorName: string;
	authorEmail: string;
	authorTime: number;
	committerName: string;
	commitTime: number;
	parents: string[];
	/** The parent `files` is diffed against — the first parent, named here so the
	 *  UI can label it rather than re-deriving the convention. Null for a root
	 *  commit, whose files are all additions against the empty tree. */
	diffParent: string | null;
	files: GitCommitFile[];
	/** Files found before the cap, and whether it bit — a merge can legitimately
	 *  touch thousands. */
	total: number;
	truncated: boolean;
}

// ── Tauri command error shape ──────────────────────────────────────────────

export type AppError =
	| { kind: 'Io'; message: string }
	| { kind: 'Db'; message: string }
	| { kind: 'NotFound'; message: string }
	| { kind: 'InvalidInput'; message: string }
	| { kind: 'Process'; message: string };

/**
 * A project's scheduled prompt (F22, ADR-0026). Mirrors the Rust `Routine`.
 *
 * The three "last" fields answer three different questions and folding them
 * together loses one: `lastFireAt` is the occurrence the scheduler **consumed**
 * (run or skipped), `lastRunAt` is when a session actually started, and
 * `lastSkippedAt` is when a fire was dropped because the previous session was
 * still live.
 */
export interface Routine {
	id: string;
	projectId: string;
	name: string;
	/** The 5-field expression. The preset picker and the `Custom…` field both
	 *  write this, so a schedule has one representation. */
	cron: string;
	/** The session's first message. */
	prompt: string;
	enabled: boolean;
	/** Null inherits the app-wide `routinesCatchupHours`; 0 never runs late. */
	catchupHours: number | null;
	lastFireAt: number | null;
	/** Written when the session **starts**, so a run kill-on-quit took still
	 *  counts as having happened (F22). */
	lastRunAt: number | null;
	lastSessionId: string | null;
	lastSkippedAt: number | null;
	lastError: string | null;
	createdAt: number;
	/** The session that created this routine over the IDE bridge (F22 slice 3,
	 *  ADR-0028). **Null means a human wrote it** — meaningful rather than
	 *  missing, since every row that predates the column came from the editor. */
	createdBySessionId: string | null;
	/** The session that last changed it, on the same terms. An agent may amend a
	 *  routine a human wrote, and this is the only thing that says so. */
	lastModifiedBySessionId: string | null;
	/** Derived per query from `cron`, never stored — epoch ms. */
	nextRunAt: number | null;
}

/** What `createRoutine` and `updateRoutine` accept. Run state is the runner's
 *  to write, so it is not part of this. */
export interface RoutineInput {
	projectId: string;
	name: string;
	cron: string;
	prompt: string;
	enabled: boolean;
	catchupHours: number | null;
}

/** What `runRoutineNow` did, and — when it did nothing — why (F22).
 *
 *  A manual run obeys the scheduler's own rules (the overlap skip, the
 *  concurrency cap), so the two paths cannot drift. What it owes on top is an
 *  answer: somebody is watching the button. */
export interface RunNowResult {
	outcome: 'started' | 'skipped' | 'capped' | 'failed';
	/** Set only when a session actually started. */
	sessionId: string | null;
	/** Why nothing started, in the words the row shows. */
	message: string | null;
}

/** `routine:fire` — the runner telling the renderer to start a session (F22).
 *
 *  Every row is written before this is emitted, the same write-then-emit
 *  ordering `session:worktree` follows: an event ahead of its row is a fact the
 *  next reload disagrees with. */
export interface RoutineFireEvent {
	routineId: string;
	routineName: string;
	projectId: string;
	sessionId: string;
	prompt: string;
	/** The project's folder, resolved by the runner. */
	cwd: string;
}

/** `routines:changed` — a project's routine list is no longer what the renderer
 *  has (F22 slice 3, ADR-0028).
 *
 *  Every routine write emits it, whichever caller made it. For the editor's own
 *  mutations that is a belt on braces — they invalidate optimistically already.
 *  For a write that arrived over the IDE bridge it is the only thing that stops
 *  an open Routines tab showing a list that is no longer true.
 *
 *  It carries the project rather than the routine because every reader is a list
 *  keyed by project, and a client that has to refetch anyway gains nothing from
 *  knowing which row moved. */
export interface RoutinesChangedEvent {
	projectId: string;
}

/** One Claude identity, isolated by config directory (F25, ADR-0036). Mirrors
 *  the Rust `Profile`.
 *
 *  A profile is a name plus a directory. It holds no credential — the directory
 *  does, put there by the CLI when the user logged in, which is why creating a
 *  profile stops at making the directory empty. */
export interface Profile {
	id: string;
	/** Which agent this is an identity for. `'claude'` today; the column exists
	 *  so a second agent is a row rather than a migration. */
	agent: string;
	name: string;
	configDir: string;
	/** Every project with no assignment for this agent spawns under it. Exactly
	 *  one per agent, enforced by a partial unique index in migration 0017. */
	isDefault: boolean;
	/** The directory is not on disk — unmounted, renamed, deleted. Not an error
	 *  state: the scan skips such a profile rather than reaping its sessions, and
	 *  the next spawn recreates the directory, where the CLI asking for a login is
	 *  the correct and visible outcome. */
	missing: boolean;
	createdAt: number;
}

/** What `createProfile` accepts. `isDefault` is not part of it: promotion goes
 *  through `setDefaultProfile`, which has to clear the old default in the same
 *  transaction. */
export interface ProfileInput {
	name: string;
	configDir: string;
}

/** `profiles:changed` — the profile list is different, so re-read it (F25).
 *
 *  No payload: there are a handful of rows and every reader wants all of them.
 *  What the event buys is the half a renderer cannot do for itself — the indexer
 *  re-reads profiles off it, which is what makes a new profile's sessions appear
 *  at all. */
export type ProfilesChangedEvent = Record<string, never>;
