use serde::{Deserialize, Serialize};

/// One project directory under ~/.claude/projects/. Mirrors `@factorai/types`
/// `Project`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
	pub id: String,
	pub real_path: Option<String>,
	pub display_name: String,
	pub last_session_at: Option<i64>,
	pub session_count: i64,
	pub pinned: bool,
	/// `real_path` is known and isn't on disk any more. Distinct from
	/// `real_path: None`, which means we never learned where the project is —
	/// unknown is not the same as gone, and only one of them is worth saying.
	pub missing: bool,
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
	pub changes: Vec<GitChange>,
	/// Rows found before the cap, so the UI can say how many it isn't showing.
	pub total: usize,
	pub truncated: bool,
}
