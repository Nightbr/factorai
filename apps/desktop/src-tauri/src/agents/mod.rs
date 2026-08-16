//! Agent stores — the places a coding agent keeps its transcripts.
//!
//! A project is a folder in the workspace (`projects`); an agent store is a
//! **discovery source** we read to find out which folders an agent has worked
//! in. Only Claude Code is implemented, and it goes through this seam rather
//! than around it — that is the whole point of the module existing before a
//! second agent does. There is deliberately no `trait AgentStore`: a trait with
//! one implementor is a guess about the second agent's shape, made before we
//! have seen one.
//!
//! Every agent's store is **read-only** to us. ADR-0004 says that of
//! `~/.claude/`; it generalises here.

use std::path::Path;

pub mod claude;

/// The `discovered_projects.agent` value for Claude Code. One constant so the
/// string is spelled once, and so `grep 'claude'` finds every place a second
/// agent will need a branch.
pub const CLAUDE: &str = "claude";

/// One directory an agent's store holds transcripts in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Discovered {
	/// Which agent's store this came from — [`CLAUDE`] today.
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
}
