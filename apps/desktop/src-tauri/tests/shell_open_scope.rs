//! Guards the `shell > open` validation regex in `tauri.conf.json`.
//!
//! The shell plugin's default regex is URL-only, so "open in default app" on a
//! file path fails with "Scoped command argument at position 0 was found, but
//! failed regex validation". We override it to also allow absolute POSIX paths
//! (specs/03-backend-rust.md § Permissions).
//!
//! This is a config value with no compile-time checking and a runtime failure
//! that only shows up as an unhandled rejection in the webview, so it gets a
//! test rather than a comment.

use regex::Regex;

/// The plugin wraps the configured pattern in `^...$` before matching, so the
/// test has to as well.
///
/// That wrapping is why the whole pattern must be a single group: with
/// top-level alternation, `^A|B$` reads as "starts with A" OR "ends with B",
/// and a scope meant for absolute paths would accept anything *ending* in
/// one (`relative/path.md`). These tests exist because that mistake is
/// invisible at a glance.
fn scope_regex() -> Regex {
	let conf: serde_json::Value =
		serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json parses");
	let pattern = conf["plugins"]["shell"]["open"]
		.as_str()
		.expect("plugins.shell.open must be a validation regex, not a bool");
	Regex::new(&format!("^{pattern}$")).expect("pattern compiles")
}

#[test]
fn accepts_the_absolute_paths_the_file_viewer_opens() {
	let re = scope_regex();
	for path in [
		"/home/alice/code/foo/README.md",
		"/home/alice/code/foo/.gitignore",
		"/Users/alice/Projects/app/src/main.rs",
		"/home/alice/a file with spaces.txt",
		"/home/alice/repo/weird-but-fine/-not-leading.txt",
	] {
		assert!(re.is_match(path), "should allow project file path: {path}");
	}
}

#[test]
fn still_accepts_the_urls_the_default_regex_covered() {
	let re = scope_regex();
	for url in [
		"https://github.com/refactoringhq/tolaria",
		"http://localhost:1420/",
		"mailto:someone@example.com",
		"tel:+15551234567",
	] {
		assert!(re.is_match(url), "should allow url: {url}");
	}
}

/// The crash screen's `Report an issue` button builds a prefilled GitHub URL
/// (`lib/crashReport.ts`). Its query string carries a stack trace, so it is the
/// longest and most punctuation-heavy URL the app ever opens — and if
/// percent-encoding were ever dropped there, the failure is a button that
/// silently does nothing. The TS side has its own copy of this regex; this test
/// is the half that reads the real config.
#[test]
fn accepts_the_prefilled_issue_url_the_crash_screen_opens() {
	let re = scope_regex();
	let url = "https://github.com/Nightbr/factorai/issues/new\
		?title=Crash%3A%20TypeError%3A%20boom\
		&body=%2A%2AWhat%20happened%2A%2A%0A%0A%60%60%60%0ATypeError%3A%20boom%0A%60%60%60";
	assert!(re.is_match(url), "should allow the prefilled issue url: {url}");
}

#[test]
fn rejects_flag_like_arguments() {
	let re = scope_regex();
	// The plugin's own docs warn about these: a loose pattern turns "open a
	// path" into "pass arbitrary flags to the platform opener". `/R` is on the
	// plugin's list but is a legitimate POSIX path, and v1 is macOS + Linux
	// only, so it isn't here.
	for arg in ["--enable-debugging", "-i", "-", "--", "/", "  /etc/passwd"] {
		assert!(!re.is_match(arg), "should reject flag-like argument: {arg}");
	}
}

#[test]
fn rejects_things_that_are_not_absolute_paths_or_urls() {
	let re = scope_regex();
	for arg in [
		"relative/path.md",
		"./relative.md",
		"~/home-relative.md",
		"file:///etc/passwd",
		"javascript:alert(1)",
		"",
	] {
		assert!(!re.is_match(arg), "should reject: {arg}");
	}
}
