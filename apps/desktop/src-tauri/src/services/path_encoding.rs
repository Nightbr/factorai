use std::path::Path;

/// Encode an absolute filesystem path into the directory name Claude Code
/// uses under `~/.claude/projects/`.
///
/// Rule: drop the leading `/`, then replace each `/` with `-`. Trailing
/// slashes are dropped. Example: `/Users/alice/code/foo` becomes
/// `-Users-alice-code-foo`.
pub fn encode_path(p: &Path) -> String {
	let mut s = p.to_string_lossy().to_string();
	while s.ends_with('/') {
		s.pop();
	}
	s.replace('/', "-")
}

/// Best-effort decode. Ambiguous when the original path contained a literal
/// `-` (e.g. `/foo-bar` vs `/foo/bar` both encode under the same prefix).
/// Use `Path::exists` to disambiguate by probing candidates.
///
/// For an authoritative decode, prefer reading the first JSONL event's `cwd`
/// field — that's what Claude itself records.
pub fn decode_candidates(encoded: &str) -> Vec<String> {
	let trimmed = encoded.trim_start_matches('-');
	let parts: Vec<&str> = trimmed.split('-').collect();
	// Generate candidates by joining with '/' at varying boundaries.
	// For most real paths (no embedded '-'), the all-slashes form is correct.
	let mut out = Vec::new();
	out.push(format!("/{}", parts.join("/")));
	// Common second form: only the leading segments are slashes, last has '-'.
	// We don't enumerate the full 2^n space — it's never that ambiguous in
	// practice. The cwd-from-JSONL pathway is the real fix.
	out
}

/// Last path component of a real path (or of the decoded candidate). Falls
/// back to the encoded id if nothing better is available.
pub fn display_name_for(encoded_id: &str, real_path: Option<&str>) -> String {
	if let Some(p) = real_path {
		if let Some(name) = Path::new(p).file_name() {
			return name.to_string_lossy().to_string();
		}
	}
	encoded_id.trim_start_matches('-').to_string()
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::path::PathBuf;

	#[test]
	fn encode_simple_path() {
		assert_eq!(
			encode_path(&PathBuf::from("/Users/alice/code/foo")),
			"-Users-alice-code-foo"
		);
	}

	#[test]
	fn encode_drops_trailing_slash() {
		assert_eq!(encode_path(&PathBuf::from("/Users/alice/")), "-Users-alice");
	}

	#[test]
	fn decode_simple_roundtrip() {
		let cands = decode_candidates("-Users-alice-code-foo");
		assert_eq!(cands[0], "/Users/alice/code/foo");
	}

	#[test]
	fn display_name_prefers_real_path() {
		assert_eq!(
			display_name_for("-Users-alice-code-foo", Some("/Users/alice/code/foo")),
			"foo"
		);
	}

	#[test]
	fn display_name_fallback_to_encoded_id() {
		assert_eq!(display_name_for("-foo-bar", None), "foo-bar");
	}
}
