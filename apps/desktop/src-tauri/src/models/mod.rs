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
