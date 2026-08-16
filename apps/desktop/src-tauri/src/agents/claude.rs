//! Claude Code's transcript store: `~/.claude/projects/<encoded-path>/*.jsonl`.
//!
//! The path encoding used to *be* a project's identity in factorai. It isn't
//! any more — a project is a folder you added, keyed by a uuid — and the
//! encoding is what it always actually was: how one agent names its own
//! directories. Everything that needs to turn a folder into a transcript
//! directory comes through here.

use std::path::{Path, PathBuf};

use crate::agents::{Discovered, CLAUDE};
use crate::services::jsonl::EventIter;

/// Encode an absolute filesystem path into the directory name Claude Code uses
/// under `~/.claude/projects/`.
///
/// Rule: drop the leading `/`, then replace each `/` with `-`. Trailing slashes
/// are dropped. Example: `/Users/alice/code/foo` becomes
/// `-Users-alice-code-foo`.
pub fn encode_path(p: &Path) -> String {
	let mut s = p.to_string_lossy().to_string();
	while s.ends_with('/') {
		s.pop();
	}
	s.replace('/', "-")
}

/// Best-effort decode. Ambiguous when the original path contained a literal `-`
/// (`/foo-bar` and `/foo/bar` encode alike), which is why it is a last resort:
/// the authoritative answer is the `cwd` field Claude itself records in the
/// transcript, read by [`real_path_of`].
pub fn decode_candidates(encoded: &str) -> Vec<String> {
	let trimmed = encoded.trim_start_matches('-');
	let parts: Vec<&str> = trimmed.split('-').collect();
	// For most real paths (no embedded '-') the all-slashes form is correct. We
	// don't enumerate the full 2^n space — it's never that ambiguous in
	// practice, and `real_path_of` is the real fix.
	vec![format!("/{}", parts.join("/"))]
}

/// Where Claude writes transcripts for work done in `real_path`.
///
/// This is the function ADR-0008's `--resume` / `--session-id` probe needs for
/// a folder Claude has never run in: there is no directory to look up, so the
/// path has to be derived from the folder itself.
pub fn transcript_dir(claude_dir: &Path, real_path: &Path) -> PathBuf {
	claude_dir.join("projects").join(encode_path(real_path))
}

/// The transcript file for one session in one folder.
pub fn transcript_path(claude_dir: &Path, real_path: &Path, session_id: &str) -> PathBuf {
	transcript_dir(claude_dir, real_path).join(format!("{session_id}.jsonl"))
}

/// The transcript file for one session, addressed by the store's own directory
/// name rather than by a folder. Used when reading a session we already have
/// indexed, where the key is recorded and exact.
pub fn transcript_path_by_key(claude_dir: &Path, key: &str, session_id: &str) -> PathBuf {
	claude_dir
		.join("projects")
		.join(key)
		.join(format!("{session_id}.jsonl"))
}

/// Every directory in Claude's store, with the folder each one describes.
///
/// Cheap by design: one `read_dir`, plus one partial file read per directory to
/// recover `cwd`. Nothing is parsed in full here — that only happens for
/// folders in the workspace.
pub fn discover(claude_dir: &Path) -> Vec<Discovered> {
	let projects_dir = claude_dir.join("projects");
	let Ok(rd) = std::fs::read_dir(&projects_dir) else {
		return Vec::new();
	};
	rd.filter_map(Result::ok)
		.filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
		.filter_map(|e| {
			let key = e.file_name().to_str()?.to_string();
			let real_path = real_path_of(&e.path());
			Some(Discovered { agent: CLAUDE, key, real_path })
		})
		.collect()
}

/// Resolve which folder a store directory describes, authoritatively.
///
/// Reads the `cwd` Claude recorded in the transcripts (Q4). Falls back to
/// decoding the directory name only when that fails and the decoded candidate
/// actually exists — a guess we can't confirm is worse than admitting we don't
/// know, because it would file sessions under a folder nobody worked in.
pub fn real_path_of(dir: &Path) -> Option<String> {
	let mut session_files: Vec<PathBuf> = std::fs::read_dir(dir)
		.ok()?
		.filter_map(Result::ok)
		.map(|e| e.path())
		.filter(|p| p.extension().is_some_and(|e| e == "jsonl"))
		.collect();
	// Newest first: the most recent transcript is the one most likely to open
	// cleanly and to name a folder that still exists.
	session_files.sort_by_cached_key(|p| {
		std::cmp::Reverse(
			std::fs::metadata(p)
				.and_then(|m| m.modified())
				.ok()
				.and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
				.map(|d| d.as_millis())
				.unwrap_or(0),
		)
	});
	if let Some(cwd) = session_files
		.iter()
		.find_map(|p| EventIter::open(p).ok()?.find_map(|ev| ev.cwd))
	{
		return Some(cwd);
	}
	let name = dir.file_name()?.to_str()?;
	decode_candidates(name)
		.into_iter()
		.find(|c| Path::new(c).is_dir())
}

/// Transcript count and last-modified time for a store directory, without
/// parsing anything. What the import list shows to answer "is this the one I
/// mean" — stat only, so the dialog opens instantly however large the store is.
pub fn dir_stats(dir: &Path) -> (i64, Option<i64>) {
	let Ok(rd) = std::fs::read_dir(dir) else {
		return (0, None);
	};
	let mut count = 0i64;
	let mut newest: Option<i64> = None;
	for entry in rd.filter_map(Result::ok) {
		let path = entry.path();
		if path.extension().is_none_or(|e| e != "jsonl") {
			continue;
		}
		count += 1;
		let mtime = entry
			.metadata()
			.and_then(|m| m.modified())
			.ok()
			.and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
			.map(|d| d.as_millis() as i64);
		if let Some(ms) = mtime {
			newest = Some(newest.map_or(ms, |n: i64| n.max(ms)));
		}
	}
	(count, newest)
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
		assert_eq!(decode_candidates("-Users-alice-code-foo")[0], "/Users/alice/code/foo");
	}

	#[test]
	fn transcript_path_is_derived_from_the_folder() {
		let dir = PathBuf::from("/home/me/.claude");
		assert_eq!(
			transcript_path(&dir, &PathBuf::from("/home/me/code/foo"), "s1"),
			PathBuf::from("/home/me/.claude/projects/-home-me-code-foo/s1.jsonl")
		);
	}

	#[test]
	fn discover_reads_cwd_rather_than_the_directory_name() {
		let tmp = tempfile::tempdir().unwrap();
		let claude_dir = tmp.path();
		// A directory name that decodes wrong on purpose: the real folder has a
		// literal dash in it, so only the recorded `cwd` gets this right.
		let dir = claude_dir.join("projects").join("-home-me-my-repo");
		std::fs::create_dir_all(&dir).unwrap();
		std::fs::write(
			dir.join("s1.jsonl"),
			"{\"type\":\"user\",\"cwd\":\"/home/me/my-repo\"}\n",
		)
		.unwrap();

		let found = discover(claude_dir);
		assert_eq!(found.len(), 1);
		assert_eq!(found[0].agent, CLAUDE);
		assert_eq!(found[0].key, "-home-me-my-repo");
		assert_eq!(found[0].real_path.as_deref(), Some("/home/me/my-repo"));
	}

	#[test]
	fn discover_admits_it_does_not_know() {
		let tmp = tempfile::tempdir().unwrap();
		let dir = tmp.path().join("projects").join("-nowhere-at-all");
		std::fs::create_dir_all(&dir).unwrap();

		let found = discover(tmp.path());
		assert_eq!(found.len(), 1);
		assert_eq!(
			found[0].real_path, None,
			"an unconfirmable guess is worse than no answer"
		);
	}

	#[test]
	fn dir_stats_counts_transcripts_without_parsing() {
		let tmp = tempfile::tempdir().unwrap();
		let dir = tmp.path();
		std::fs::write(dir.join("a.jsonl"), "not even json\n").unwrap();
		std::fs::write(dir.join("b.jsonl"), "").unwrap();
		std::fs::write(dir.join("notes.txt"), "ignored").unwrap();

		let (count, newest) = dir_stats(dir);
		assert_eq!(count, 2);
		assert!(newest.is_some());
	}
}
