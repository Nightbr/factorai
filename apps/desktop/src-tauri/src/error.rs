use serde::Serialize;

/// Tagged error type that crosses the Tauri boundary as a discriminated union.
/// TS-side shape lives in `@factorai/types` as `AppError`.
#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
	#[error("io: {0}")]
	Io(String),
	#[error("db: {0}")]
	Db(String),
	#[error("not found: {0}")]
	NotFound(String),
	#[error("invalid input: {0}")]
	InvalidInput(String),
	#[error("process: {0}")]
	Process(String),
}

impl From<std::io::Error> for AppError {
	fn from(value: std::io::Error) -> Self {
		AppError::Io(value.to_string())
	}
}

impl From<rusqlite::Error> for AppError {
	fn from(value: rusqlite::Error) -> Self {
		AppError::Db(value.to_string())
	}
}

impl From<serde_json::Error> for AppError {
	fn from(value: serde_json::Error) -> Self {
		AppError::InvalidInput(value.to_string())
	}
}

impl From<anyhow::Error> for AppError {
	fn from(value: anyhow::Error) -> Self {
		AppError::Io(value.to_string())
	}
}

pub type AppResult<T> = std::result::Result<T, AppError>;
