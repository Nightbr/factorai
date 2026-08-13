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
