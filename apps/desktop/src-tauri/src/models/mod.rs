use serde::{Deserialize, Serialize};

/// A folder in the workspace. Mirrors `@factorai/types` `Project`.
///
/// `real_path` is not optional: a project *is* a folder, so it always has one.
/// That was not true of the old model, where a project was a directory in
/// Claude's store whose folder we might never have identified.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
	/// uuid v4. Not derived from the path — see migration 0004.
	pub id: String,
	pub real_path: String,
	pub display_name: String,
	/// Aggregated over the sessions of every agent directory linked to this
	/// folder. Computed per query rather than stored: the numbers change
	/// whenever the indexer runs, and a stale count is worse than a join.
	pub last_session_at: Option<i64>,
	pub session_count: i64,
	pub pinned: bool,
	/// The folder is gone from disk. Set by the scan, not computed per
	/// `list_projects` — that query is polled every 2s (F1).
	pub missing: bool,
}

/// One folder an agent has worked in that isn't in the workspace yet — a row in
/// the "Import from Claude Code" list (F1).
///
/// Built from `read_dir` and `stat` alone, so the dialog opens instantly no
/// matter how much history the store holds. Nothing here is indexed until you
/// import it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCandidate {
	/// Which agent's store this came from. `'claude'` today.
	pub agent: String,
	/// The agent's own directory name — the stable key for the row.
	pub key: String,
	pub real_path: String,
	pub display_name: String,
	pub session_count: i64,
	pub last_activity_at: Option<i64>,
	/// The folder is gone from disk. Still importable — every transcript is
	/// still there and only *starting* a session is impossible (F1).
	pub missing: bool,
	/// Already in the workspace. The row renders checked and disabled rather
	/// than being hidden, so the list answers "is this one already in?".
	pub already_open: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
	pub id: String,
	pub project_id: String,
	pub title: String,
	pub created_at: i64,
	pub updated_at: i64,
	pub turn_count: i64,
	pub cwd: Option<String>,
	/// Set when this is a sub-agent transcript (`<session>/subagents/agent-*`):
	/// the id of the session that spawned it. Such sessions are readable
	/// read-only and can never be resumed — `claude --resume` looks for a
	/// top-level transcript, which an agent id has none of.
	pub subagent_of: Option<String>,
}

/// One full-text search result. Mirrors `@factorai/types` `SearchHit`.
/// Identifies a *session* (no per-event position — the FTS index stores none).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
	pub session_id: String,
	pub project_id: String,
	pub title: String,
	pub role: String,
	pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPage {
	pub id: String,
	pub events: Vec<SessionEvent>,
	pub offset: usize,
	pub limit: usize,
	pub total: usize,
}

/// Tolerant JSONL event shape. See specs/02-data-model.md § "Session JSONL
/// format". `extra` captures any fields we don't model so the renderer can
/// still display them.
///
/// Only `event_type` is required. Real Claude session files include meta
/// events (`mode`, `permission-mode`, `ai-title`, `file-history-snapshot`,
/// …) that have none of the conversational fields below — we tolerate
/// them rather than treat them as malformed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionEvent {
	#[serde(rename = "type")]
	pub event_type: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub uuid: Option<String>,
	#[serde(rename = "parentUuid", default, skip_serializing_if = "Option::is_none")]
	pub parent_uuid: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub timestamp: Option<String>,
	#[serde(rename = "sessionId", default, skip_serializing_if = "Option::is_none")]
	pub session_id: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub cwd: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub version: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub message: Option<SessionMessage>,
	#[serde(flatten)]
	pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMessage {
	pub role: String,
	pub content: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexerProgress {
	pub processed: u32,
	pub total: u32,
	pub phase: IndexerPhase,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IndexerPhase {
	Scanning,
	Parsing,
	Idle,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsChanged {
	pub project_id: String,
	pub session_ids: Vec<String>,
}

/// One entry in a project directory listing. Mirrors `@factorai/types`
/// `DirEntry`. See specs/05-features.md F12.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
	pub name: String,
	/// Absolute path on disk — the renderer passes it straight back to
	/// `list_dir` when expanding, so it never has to join paths itself.
	pub path: String,
	/// True for directories and for symlinks that resolve to one.
	pub is_dir: bool,
	pub is_symlink: bool,
	/// A symlink whose target resolves outside the project root (or can't be
	/// resolved at all). The tree shows it but refuses to expand it.
	pub symlink_outside_root: bool,
	/// Bytes for files, 0 for directories.
	pub size: u64,
	/// Epoch milliseconds, `None` if the platform or filesystem won't say.
	pub modified_at: Option<i64>,
	/// Git would ignore this path. The tree dims it. Always false outside a
	/// repository, or when the repository can't be opened — an undecorated
	/// listing is still a correct listing (F12).
	pub ignored: bool,
}

/// One directory's worth of entries. `total` counts what we found before the
/// entry cap, so the UI can report how many rows it isn't showing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
	pub entries: Vec<DirEntry>,
	pub total: usize,
	pub truncated: bool,
}

/// A file's contents for the viewer. Mirrors `@factorai/types` `FileContents`.
/// See specs/05-features.md F7.
///
/// No `mime` field: the viewer resolves a language from the extension using
/// Monaco's own language registry (ADR-0007), so a mime guess would be a
/// second, worse source of the same answer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContents {
	pub path: String,
	/// Empty when `is_binary`, or cut at the cap when `truncated`.
	pub contents: String,
	/// True size on disk, whatever we actually returned.
	pub size: u64,
	/// A null byte turned up in the first 8KB.
	pub is_binary: bool,
	/// The file is longer than the requested cap.
	pub truncated: bool,
	/// Lines in `contents` (0 for empty or binary).
	pub line_count: usize,
}

/// One image, ready for an `<img src>` (F7).
///
/// Separate from [`FileContents`] rather than a field on it. `FileContents` is
/// shared with `git_blob`, and its `contents` is text the viewer puts into
/// Monaco; base64 image bytes are neither. Keeping them apart also keeps the
/// cost apart — nothing pays for an image encode unless it asked for an image.
///
/// This one *does* carry a `mime`, unlike `FileContents`, and for the opposite
/// reason: there is no language registry to defer to, `<img>` needs the type in
/// the data URI, and we know it exactly because we read the magic bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageContents {
	pub path: String,
	/// Sniffed from the file's own bytes, never from its extension.
	pub mime: String,
	/// Standard base64 of the whole file, for a `data:` URL.
	pub base64: String,
	/// True size on disk, in bytes.
	pub size: u64,
}

/// Which side of git a blob is read from (F13). The worktree isn't here: that
/// side is `read_file`, which already handles caps, binaries and lossy UTF-8.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GitRev {
	/// The commit HEAD points at.
	Head,
	/// The staging area.
	Index,
}

/// Which comparison a change row belongs to. A partly-staged file legitimately
/// produces one row in `Staged` and another in `Unstaged`, each with its own
/// line counts — that is the only version where the numbers add up (Q19).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GitGroup {
	/// HEAD ↔ index.
	Staged,
	/// Index ↔ worktree.
	Unstaged,
	/// Unmerged path. Diffs HEAD ↔ worktree, markers and all.
	Conflicted,
}

/// What happened to a path, in the group it appears in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GitChangeKind {
	Modified,
	Added,
	Deleted,
	Renamed,
	Typechange,
	Untracked,
	Conflicted,
}

/// One row in the Changes tab (F13).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
	/// Absolute path on disk. What the viewer and `git_blob` take.
	pub path: String,
	/// Path relative to the *project* root, so a change above the project reads
	/// `../packages/types/index.ts` and is visibly not yours.
	pub rel_path: String,
	pub group: GitGroup,
	pub kind: GitChangeKind,
	/// Previous path for a rename, relative to the project like `rel_path`.
	pub old_rel_path: Option<String>,
	/// `None` for binary deltas and for files over the stat cap — the row still
	/// exists, it just carries no counts.
	pub additions: Option<usize>,
	pub deletions: Option<usize>,
	pub is_binary: bool,
}

/// The repository's state for one project, or the absence of a repository.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
	/// Absolute path of the repository's working directory, `None` when the
	/// project isn't in a repository at all. That is a success, not an error:
	/// "not versioned" is something the UI renders (F13).
	pub repo_root: Option<String>,
	/// Current branch, or `None` on a detached HEAD / an empty repository.
	pub branch: Option<String>,
	/// Full SHA that HEAD resolves to, `None` on an unborn branch.
	///
	/// Added by F18, and not because the graph needs it — the graph walks HEAD
	/// itself. `branch: None` conflated two states the session header's badge has
	/// to tell apart: a detached HEAD, where there *is* a commit to name, and an
	/// unborn branch, where there isn't. With this the badge shows a short SHA in
	/// the first case and stays quiet in the second.
	pub head: Option<String>,
	pub changes: Vec<GitChange>,
	/// Rows found before the cap, so the UI can say how many it isn't showing.
	pub total: usize,
	pub truncated: bool,
}

// ── The graph (F18) ────────────────────────────────────────────────────────

/// What kind of ref points at a commit, which is what decides its chip.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GitRefKind {
	/// `refs/heads/*`.
	LocalBranch,
	/// `refs/remotes/*`, minus each remote's own `HEAD` — that is a symbolic ref
	/// duplicating one we already return, so it is dropped in the service rather
	/// than left for every consumer to know to ignore.
	RemoteBranch,
	/// `refs/tags/*`, peeled through annotated tag objects to a commit.
	Tag,
	/// A detached HEAD. A HEAD that is on a branch sets `is_head` on that branch
	/// instead, so the renderer can fold it into one `HEAD→main` chip.
	Head,
}

/// One ref pointing at a commit in the graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRef {
	/// Short name: `main`, `origin/main`, `v0.3.0`.
	pub name: String,
	pub kind: GitRefKind,
	/// HEAD points here. Lets the renderer draw `HEAD→main` as one chip.
	pub is_head: bool,
	/// For a local branch whose upstream is on this same commit, that upstream's
	/// short name — so the renderer can collapse the pair into `main ≡origin`
	/// instead of spending two slots saying the same thing. `None` when there is
	/// no upstream or it has diverged, in which case the two refs are on
	/// different rows anyway and there is nothing to collapse.
	pub upstream_in_sync: Option<String>,
}

/// How one lane line is drawn through a row.
///
/// Split by geometry rather than by git meaning, because geometry is what the
/// renderer needs: a `Through` line spans the row, an `Incoming` one stops at the
/// node, an `Outgoing` one starts there. Naming them for merges and branches
/// instead would invert in a newest-first walk — a lane *converging* on a commit
/// from below is where a branch forked off, not where it merged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GitGraphEdgeKind {
	/// Neither starts nor ends here: top edge to bottom edge.
	Through,
	/// Converges on this row's commit: top edge to the node.
	Incoming,
	/// Leaves this row's commit: the node to the bottom edge.
	Outgoing,
}

/// One line segment in a row's slice of the rail.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphEdge {
	pub from_lane: usize,
	pub to_lane: usize,
	/// Whose colour this segment takes. A converging branch keeps its own lane's
	/// colour all the way into the node, which is what makes it traceable.
	pub lane: usize,
	pub kind: GitGraphEdgeKind,
}

/// One commit in the graph, laid out.
///
/// No message body: at 300 commits a page that would be the bulk of the payload
/// for something only the detail pane reads, and `git_commit` serves that.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphCommit {
	/// Full 40-character SHA. Full rather than short because a later
	/// session↔commit join needs it and truncating now would mean re-walking.
	pub sha: String,
	pub short_sha: String,
	/// First line of the message, already trimmed.
	pub subject: String,
	pub author_name: String,
	/// Lower-cased and trimmed, because it is an identity key rather than a
	/// display string: the renderer derives a per-author avatar from it, and
	/// `Ada@Example.com` and `ada@example.com` are the same person.
	pub author_email: String,
	/// Epoch **milliseconds**, per the convention `modified_at` sets — git counts
	/// in seconds, so this is converted at the boundary.
	pub author_time: i64,
	pub commit_time: i64,
	/// Full SHAs, first parent first. More than one means a merge.
	pub parents: Vec<String>,
	pub refs: Vec<GitRef>,
	pub lane: usize,
	pub edges: Vec<GitGraphEdge>,
}

/// One page of the graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGraph {
	/// Absolute path of the repository's working directory, `None` when the
	/// project isn't in one — the same shape `GitStatus` uses, for the same
	/// reason: the panel renders "not versioned", it does not toast it.
	pub repo_root: Option<String>,
	pub commits: Vec<GitGraphCommit>,
	/// Lanes live anywhere in the prefix walked so far, so the renderer can pick
	/// one pitch for the whole list. Computed over the prefix rather than the
	/// returned page so it only ever grows as you load more — a pitch that
	/// shrank and grew per page would reflow the rows above.
	pub lane_count: usize,
	/// A digest of the refs this page was walked against. If it changes between
	/// pages the renderer refetches from the first page rather than splicing a
	/// page walked against different refs onto one that wasn't.
	pub refs_digest: String,
	/// False when the walk ended before `limit` was reached — there is no further
	/// page. Deliberately not a total: counting a 200 000-commit repository to
	/// render "300 of N" costs a full walk on every poll, which is the one thing
	/// paging exists to avoid.
	pub has_more: bool,
	/// Which forge `origin` points at, so a remote-branch chip can wear the right
	/// icon. Read from the remote's configured URL — a config read, not a network
	/// one; ADR-0009 still holds and transport is not linked in.
	pub remote_host: RemoteHost,
}

/// The forge a remote URL names. Only what changes an icon — this is not an
/// integration, and nothing here talks to any of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RemoteHost {
	GitHub,
	GitLab,
	/// A remote exists but is somewhere else, or there is no remote at all. Both
	/// draw the generic mark, so they do not need telling apart.
	Other,
}

/// One file touched by a commit.
///
/// `GitChange` minus `group`: a commit's diff is not staged, unstaged or
/// conflicted, and giving it one of those labels to reuse the type would be a
/// lie in the payload to save a struct. The *row component* is shared instead.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFile {
	/// Absolute path on disk.
	pub path: String,
	/// Relative to the *project* root, like `GitChange::rel_path`.
	pub rel_path: String,
	pub kind: GitChangeKind,
	pub old_rel_path: Option<String>,
	pub additions: Option<usize>,
	pub deletions: Option<usize>,
	pub is_binary: bool,
}

/// Everything the detail pane shows for one commit.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDetail {
	pub sha: String,
	pub short_sha: String,
	pub subject: String,
	/// Everything after the subject, trimmed. Empty when there is no body.
	pub body: String,
	pub author_name: String,
	pub author_email: String,
	/// Epoch milliseconds, like `GitGraphCommit`.
	pub author_time: i64,
	pub committer_name: String,
	pub commit_time: i64,
	pub parents: Vec<String>,
	/// The parent `files` is diffed against — the first parent, named here so the
	/// UI can label it rather than re-deriving a convention. `None` for a root
	/// commit, whose files are all additions against the empty tree.
	pub diff_parent: Option<String>,
	pub files: Vec<GitCommitFile>,
	/// Files found before the cap, and whether it bit — same contract as
	/// `GitStatus`, because a merge can legitimately touch thousands.
	pub total: usize,
	pub truncated: bool,
}
