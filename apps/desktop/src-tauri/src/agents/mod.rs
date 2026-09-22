//! Agents — the CLIs factorai runs, and the places they keep their transcripts.
//!
//! A project is a folder in the workspace (`projects`); an agent store is a
//! **discovery source** we read to find out which folders an agent has worked
//! in. Two agents are known: Claude Code and Codex CLI. Each is an
//! [`AgentDescriptor`] plus four capabilities — spawn, discovery, transcripts,
//! status — of which only spawn is required (ADR-0060). A capability an agent
//! lacks is rendered as absent by the UI, never defaulted.
//!
//! Every agent's store is **read-only** to us. ADR-0004 says that of
//! `~/.claude/`; it generalises here.

use std::path::Path;

pub mod claude;
pub mod codex;

/// The `discovered_projects.agent` / `profiles.agent` value for Claude Code.
/// One constant so the string is spelled once.
pub const CLAUDE: &str = "claude";
/// The same for Codex CLI (F30).
pub const CODEX: &str = "codex";

/// What an agent *is* to factorai before any capability is asked of it
/// (ADR-0060). Everything the settings card, the binary probe and the spawn
/// environment need to know, and nothing about how the agent behaves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AgentDescriptor {
	/// The value every `agent` column holds. Stable; never renamed.
	pub id: &'static str,
	/// What the UI calls it.
	pub display_name: &'static str,
	/// What the three-tier probe looks for on `PATH` and in the candidate list.
	pub binary_name: &'static str,
	/// The variable the CLI reads its config directory from — a profile is a
	/// value for it, passed per spawn (ADR-0036).
	pub config_dir_env: &'static str,
	/// Whether the CLI refuses to start when that directory does not exist.
	/// Claude creates it on demand; Codex errors out
	/// (`codex-rs/utils/home-dir/src/lib.rs`), so `for_spawn` creates it first.
	pub config_dir_must_exist: bool,
	/// Who names a new session (ADR-0008 vs ADR-0062).
	pub id_source: IdSource,
}

/// Where a new session's id comes from (ADR-0062).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdSource {
	/// factorai mints it and hands it to the CLI (`claude --session-id`).
	Ours,
	/// The CLI mints it; factorai starts under a provisional id and adopts the
	/// agent's once it appears in the terminal title.
	Agent,
}

const REGISTRY: [AgentDescriptor; 2] = [
	AgentDescriptor {
		id: CLAUDE,
		display_name: "Claude Code",
		binary_name: "claude",
		config_dir_env: "CLAUDE_CONFIG_DIR",
		config_dir_must_exist: false,
		id_source: IdSource::Ours,
	},
	AgentDescriptor {
		id: CODEX,
		display_name: "Codex",
		binary_name: "codex",
		config_dir_env: "CODEX_HOME",
		config_dir_must_exist: true,
		id_source: IdSource::Agent,
	},
];

/// Every agent factorai knows, in the order the Settings cards show them.
pub fn registry() -> &'static [AgentDescriptor] {
	&REGISTRY
}

/// The descriptor for an `agent` column value, or `None` for a string no
/// release of factorai ever wrote — which a caller treats as an error rather
/// than as Claude.
pub fn descriptor(id: &str) -> Option<&'static AgentDescriptor> {
	REGISTRY.iter().find(|d| d.id == id)
}

/// The id that survives an unknown or absent value: what a fresh install runs,
/// and what `agent.default` means when no row says otherwise (F30).
pub fn default_id() -> &'static str {
	CLAUDE
}

/// The directory an agent reads when no profile is passed: its own variable if
/// exported in the environment factorai was launched from, else its home
/// directory. For Claude that is `CLAUDE_CONFIG_DIR`, then `CLAUDE_HOME`, then
/// `~/.claude` (Q3); for Codex `CODEX_HOME`, then `~/.codex`.
pub fn ambient_dir(agent: &AgentDescriptor) -> std::path::PathBuf {
	let vars: &[&str] = match agent.id {
		CLAUDE => &["CLAUDE_CONFIG_DIR", "CLAUDE_HOME"],
		_ => &[agent.config_dir_env],
	};
	for var in vars {
		if let Some(env) = std::env::var_os(var) {
			if !env.is_empty() {
				return std::path::PathBuf::from(env);
			}
		}
	}
	let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("/"));
	match agent.id {
		CODEX => home.join(".codex"),
		_ => home.join(".claude"),
	}
}

/// One directory an agent's store holds transcripts in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Discovered {
	/// Which agent's store this came from — [`CLAUDE`] or [`CODEX`].
	pub agent: &'static str,
	/// The agent's own name for the directory. Opaque to us: it is a foreign
	/// key into that agent's store, never an identity in ours.
	pub key: String,
	/// The working directory the transcripts belong to, when we could resolve
	/// it. `None` means we found a directory but never learned which folder it
	/// describes — unknown, which is not the same as gone.
	pub real_path: Option<String>,
}

/// What a folder is called in the UI: its last path component.
///
/// Falls back to the whole path for a root-level folder, which has no last
/// component but is still a thing you can point at.
pub fn display_name_for_path(real_path: &str) -> String {
	Path::new(real_path)
		.file_name()
		.map(|n| n.to_string_lossy().to_string())
		.unwrap_or_else(|| real_path.to_string())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn display_name_is_the_last_component() {
		assert_eq!(display_name_for_path("/home/alice/code/foo"), "foo");
	}

	#[test]
	fn display_name_falls_back_to_the_whole_path() {
		assert_eq!(display_name_for_path("/"), "/");
	}

	#[test]
	fn the_registry_names_both_agents_once() {
		let ids: Vec<&str> = registry().iter().map(|d| d.id).collect();
		assert_eq!(ids, vec![CLAUDE, CODEX]);
		assert_eq!(descriptor(CODEX).unwrap().binary_name, "codex");
		assert_eq!(descriptor("gemini"), None);
	}

	#[test]
	fn only_codex_needs_its_directory_to_exist_and_names_its_own_sessions() {
		let claude = descriptor(CLAUDE).unwrap();
		let codex = descriptor(CODEX).unwrap();
		assert!(!claude.config_dir_must_exist);
		assert!(codex.config_dir_must_exist);
		assert_eq!(claude.id_source, IdSource::Ours);
		assert_eq!(codex.id_source, IdSource::Agent);
	}
}
