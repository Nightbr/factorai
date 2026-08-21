//! Reading project files: the tree's directory listings (F12) and the file
//! viewer's contents (F7).
//!
//! `list_dir` is deliberately shallow — one call lists exactly one directory.
//! The tree in the renderer expands lazily, so we never walk `node_modules` /
//! `.venv` / a symlink cycle; there is no recursion here to run away with.

use std::fs;
use std::io::Read;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;

use crate::error::{AppError, AppResult};
use crate::models::{DirEntry, DirListing, FileContents, ImageContents, PathKind, PdfContents};
use crate::services::git::IgnoreChecker;

/// Upper bound on entries returned for a single directory. Generated
/// directories (build output, caches) can hold tens of thousands of files and
/// the renderer would spend the whole frame budget reconciling rows nobody
/// reads. The listing reports `total` so the UI can say how many it hid.
pub const MAX_ENTRIES: usize = 2000;

/// List one directory. `root` is the project root: when given, symlinks whose
/// target resolves outside it are flagged so the tree can refuse to expand them
/// (browsing out of the project via a stray link is never what you meant).
pub fn list_dir(path: &str, root: Option<&str>) -> AppResult<DirListing> {
	list_dir_capped(path, root, MAX_ENTRIES)
}

/// `list_dir` with an injectable cap — lets tests exercise truncation without
/// creating 2000 files.
fn list_dir_capped(path: &str, root: Option<&str>, cap: usize) -> AppResult<DirListing> {
	let dir = Path::new(path);
	let meta = fs::metadata(dir).map_err(|e| match e.kind() {
		std::io::ErrorKind::NotFound => AppError::NotFound(format!("path {path}")),
		std::io::ErrorKind::PermissionDenied => AppError::Io(format!("permission denied: {path}")),
		_ => AppError::Io(format!("{path}: {e}")),
	})?;
	if !meta.is_dir() {
		return Err(AppError::InvalidInput(format!("not a directory: {path}")));
	}

	let root_canon = root.and_then(|r| fs::canonicalize(r).ok());
	// Opened once for the whole listing rather than per entry: discovering the
	// repository and parsing its ignore rules is the expensive half, and every
	// entry here shares both (F12).
	let ignores = IgnoreChecker::open(path);

	let reader = fs::read_dir(dir).map_err(|e| match e.kind() {
		std::io::ErrorKind::PermissionDenied => AppError::Io(format!("permission denied: {path}")),
		_ => AppError::Io(format!("{path}: {e}")),
	})?;

	let mut entries: Vec<DirEntry> = Vec::new();
	for entry in reader {
		// A single unreadable entry (racing deletion, for instance) shouldn't
		// fail the whole listing.
		let Ok(entry) = entry else { continue };
		let name = entry.file_name().to_string_lossy().into_owned();
		// `.git` only. Dotfiles and caches stay visible — `.claude/` is one of
		// the more interesting directories in this app.
		if name == ".git" {
			continue;
		}
		entries.push(describe(&entry, &name, root_canon.as_deref(), ignores.as_ref()));
	}

	// Sort before truncating so the cap keeps a deterministic prefix rather
	// than whatever order the filesystem handed us.
	entries.sort_by(|a, b| {
		b.is_dir
			.cmp(&a.is_dir)
			.then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
			.then_with(|| a.name.cmp(&b.name))
	});

	let total = entries.len();
	let truncated = total > cap;
	if truncated {
		entries.truncate(cap);
	}

	Ok(DirListing { entries, total, truncated })
}

fn describe(
	entry: &fs::DirEntry,
	name: &str,
	root_canon: Option<&Path>,
	ignores: Option<&IgnoreChecker>,
) -> DirEntry {
	let path = entry.path();
	// `file_type()` describes the link itself; `metadata()` follows it. We want
	// both: the symlink flag from the former, dir-ness from the latter (a link
	// to a directory should still get a chevron).
	let link_type = entry.file_type().ok();
	let is_symlink = link_type.map(|t| t.is_symlink()).unwrap_or(false);
	let target = fs::metadata(&path).ok();
	let is_dir = target
		.as_ref()
		.map(|m| m.is_dir())
		.or_else(|| link_type.map(|t| t.is_dir()))
		.unwrap_or(false);

	DirEntry {
		name: name.to_string(),
		path: path.to_string_lossy().into_owned(),
		is_dir,
		is_symlink,
		symlink_outside_root: is_symlink && escapes_root(&path, root_canon),
		size: if is_dir { 0 } else { target.as_ref().map(|m| m.len()).unwrap_or(0) },
		modified_at: target.as_ref().and_then(|m| m.modified().ok()).and_then(to_millis),
		ignored: ignores.is_some_and(|g| g.is_ignored(&path)),
	}
}

/// True when `path` resolves outside `root`. A link we can't resolve at all
/// (broken, or a permission wall) counts as escaping: better to refuse to
/// expand it than to follow it blind.
fn escapes_root(path: &Path, root_canon: Option<&Path>) -> bool {
	let Some(root) = root_canon else { return false };
	match fs::canonicalize(path) {
		Ok(target) => !target.starts_with(root),
		Err(_) => true,
	}
}

fn to_millis(t: SystemTime) -> Option<i64> {
	t.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as i64)
}

/// Default ceiling on how much of a file we hand the viewer. Monaco copes with
/// a few MB of source; it does not cope with a 200MB log, and neither does the
/// IPC hop. Callers can pass `None` to lift it after the UI has warned.
pub const DEFAULT_MAX_BYTES: usize = 5 * 1024 * 1024;

/// Bytes sniffed for a null to decide "binary". Enough to catch real binaries
/// without reading a whole file we're about to refuse.
const SNIFF_BYTES: usize = 8 * 1024;

/// Read a file for the viewer (specs/05-features.md F7).
///
/// Binary files come back with empty `contents` and `is_binary` set — the UI
/// shows a card rather than a screen of replacement characters. Text longer
/// than `max_bytes` comes back cut at that many bytes with `truncated` set;
/// `size` is always the true size on disk so the UI can say what it's hiding.
pub fn read_file(path: &str, max_bytes: Option<usize>) -> AppResult<FileContents> {
	let cap = max_bytes.unwrap_or(DEFAULT_MAX_BYTES);
	let p = Path::new(path);

	let meta = fs::metadata(p).map_err(|e| match e.kind() {
		std::io::ErrorKind::NotFound => AppError::NotFound(format!("path {path}")),
		std::io::ErrorKind::PermissionDenied => AppError::Io(format!("permission denied: {path}")),
		_ => AppError::Io(format!("{path}: {e}")),
	})?;
	if meta.is_dir() {
		return Err(AppError::InvalidInput(format!("is a directory: {path}")));
	}
	let size = meta.len();

	let mut file = fs::File::open(p).map_err(|e| match e.kind() {
		std::io::ErrorKind::PermissionDenied => AppError::Io(format!("permission denied: {path}")),
		_ => AppError::Io(format!("{path}: {e}")),
	})?;

	// Read at most one byte past the cap: that extra byte is how we know the
	// file was longer than the cap without stat'ing against a file that may
	// have changed underneath us.
	let mut buf = Vec::new();
	file.by_ref()
		.take(cap as u64 + 1)
		.read_to_end(&mut buf)
		.map_err(|e| AppError::Io(format!("{path}: {e}")))?;

	Ok(contents_from_bytes(path, &buf, size, cap))
}

/// Images we will hand to an `<img>`, keyed by their magic bytes.
///
/// **Sniffed, never taken from the extension.** The viewer routes here *by*
/// extension — that is how it avoids reading a 200MB video to discover it isn't
/// a picture — but a `.png` that is really a PDF must not come back claiming to
/// be one, or the renderer draws a broken-image icon and blames itself. The
/// extension picks the door; the bytes decide what is behind it.
const IMAGE_MAGIC: &[(&[u8], &str)] = &[
	(b"\x89PNG\r\n\x1a\n", "image/png"),
	(b"\xff\xd8\xff", "image/jpeg"),
	(b"GIF87a", "image/gif"),
	(b"GIF89a", "image/gif"),
	(b"BM", "image/bmp"),
	(b"\x00\x00\x01\x00", "image/x-icon"),
];

/// Cap for images, distinct from `DEFAULT_MAX_BYTES`.
///
/// Bigger than the text cap because a photo is legitimately larger than a
/// source file, and still a cap because the bytes cross the IPC bridge as
/// base64 — a third larger again — and land in a string the renderer holds
/// whole. 16MB in is ~21MB of JSON, which is already more than a preview is
/// worth.
pub const DEFAULT_MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;

/// Read one image as base64, for `<img src="data:…">` (F7).
///
/// Refuses anything whose magic bytes aren't a format we can display, so the
/// caller can fall back to the binary card rather than rendering a broken
/// image. Refuses oversized files outright instead of truncating: half a PNG is
/// not a smaller PNG, it is a decode error, and the "show anyway" affordance
/// that makes sense for text makes none here.
pub fn read_image(path: &str, max_bytes: Option<usize>) -> AppResult<ImageContents> {
	let cap = max_bytes.unwrap_or(DEFAULT_MAX_IMAGE_BYTES);
	let (bytes, size) = read_whole_capped(path, cap, "image")?;

	let mime = sniff_image_mime(&bytes)
		.ok_or_else(|| AppError::InvalidInput(format!("not a displayable image: {path}")))?;

	Ok(ImageContents {
		path: path.to_string(),
		mime: mime.to_string(),
		base64: B64.encode(&bytes),
		size,
	})
}

/// A whole file, refused rather than truncated when it is over `cap`.
///
/// The half of `read_file` that binary previews need and the rest of it that
/// they don't: no null sniffing, no lossy UTF-8, and no cut-at-the-cap, because
/// half a PNG is not a smaller PNG and half a PDF is not a shorter document —
/// both are decode errors. `kind` names the thing in the refusal so the message
/// reads as a sentence about what the user opened.
fn read_whole_capped(path: &str, cap: usize, kind: &str) -> AppResult<(Vec<u8>, u64)> {
	let p = Path::new(path);

	let meta = fs::metadata(p).map_err(|e| match e.kind() {
		std::io::ErrorKind::NotFound => AppError::NotFound(format!("path {path}")),
		std::io::ErrorKind::PermissionDenied => AppError::Io(format!("permission denied: {path}")),
		_ => AppError::Io(format!("{path}: {e}")),
	})?;
	if meta.is_dir() {
		return Err(AppError::InvalidInput(format!("is a directory: {path}")));
	}
	let size = meta.len();
	if size as usize > cap {
		return Err(AppError::InvalidInput(format!(
			"{kind} is {size} bytes, larger than the {cap}-byte limit"
		)));
	}

	let bytes = fs::read(p).map_err(|e| match e.kind() {
		std::io::ErrorKind::PermissionDenied => AppError::Io(format!("permission denied: {path}")),
		_ => AppError::Io(format!("{path}: {e}")),
	})?;

	Ok((bytes, size))
}

/// A PDF's first bytes. Every conforming file starts with this, and the version
/// digits that follow it are pdf.js's problem rather than ours.
const PDF_MAGIC: &[u8] = b"%PDF-";

/// Cap for PDFs, distinct again from the image cap.
///
/// Larger than an image's 16MB because a scanned document legitimately is —
/// every page is a photograph — and still a cap for the same base64 reason.
pub const DEFAULT_MAX_PDF_BYTES: usize = 32 * 1024 * 1024;

/// Read one PDF as base64, for pdf.js to parse in the renderer (F7).
///
/// The same bargain `read_image` strikes: the viewer routes here *by* extension
/// so it never reads a 200MB video to find out it isn't a document, and the
/// verdict is taken from the bytes — a `.pdf` that is really a zip is refused
/// here rather than reaching pdf.js, which would fail with an error about
/// structure that says nothing to the person who clicked the file.
pub fn read_pdf(path: &str, max_bytes: Option<usize>) -> AppResult<PdfContents> {
	let cap = max_bytes.unwrap_or(DEFAULT_MAX_PDF_BYTES);
	let (bytes, size) = read_whole_capped(path, cap, "PDF")?;

	if !bytes.starts_with(PDF_MAGIC) {
		return Err(AppError::InvalidInput(format!("not a PDF: {path}")));
	}

	Ok(PdfContents { path: path.to_string(), base64: B64.encode(&bytes), size })
}

/// The MIME for these bytes, or `None` if they aren't an image we display.
///
/// WebP earns its own arm because RIFF is a container: the first four bytes say
/// `RIFF` for `.wav` and `.avi` too, and only bytes 8..12 say which.
pub(crate) fn sniff_image_mime(bytes: &[u8]) -> Option<&'static str> {
	if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
		return Some("image/webp");
	}
	IMAGE_MAGIC.iter().find(|(magic, _)| bytes.starts_with(magic)).map(|(_, mime)| *mime)
}

/// Turn bytes into what the viewer renders.
///
/// Shared with `git_blob` (F13) so a file read from the object database and the
/// same file read from disk agree on what "binary" and "truncated" mean — two
/// definitions of binary in one viewer is how you get a file that previews from
/// the tree and refuses to diff.
///
/// `true_size` is the size of the whole thing, which may exceed `bytes.len()`
/// when the caller already stopped reading at the cap.
pub(crate) fn contents_from_bytes(
	path: &str,
	bytes: &[u8],
	true_size: u64,
	cap: usize,
) -> FileContents {
	if bytes.iter().take(SNIFF_BYTES).any(|b| *b == 0) {
		return FileContents {
			path: path.to_string(),
			contents: String::new(),
			size: true_size,
			is_binary: true,
			truncated: false,
			line_count: 0,
		};
	}

	let truncated = bytes.len() > cap;
	let kept = if truncated { &bytes[..cap] } else { bytes };

	// Lossy on purpose: a latin-1 source file or a stray invalid sequence is
	// still worth reading, and we've already ruled out real binaries.
	let contents = String::from_utf8_lossy(kept).into_owned();
	let line_count = if contents.is_empty() { 0 } else { contents.lines().count() };

	FileContents {
		path: path.to_string(),
		contents,
		size: true_size,
		is_binary: false,
		truncated,
		line_count,
	}
}

/// Classify a batch of paths for the terminal's link provider (F19).
///
/// Batched because the caller is: xterm hands `provideLinks` one hovered line,
/// which may hold several candidates, and one round trip per line beats one per
/// token. Order is the caller's, so it can zip the answers straight back onto
/// the ranges it found.
///
/// **Nothing here fails.** Every way of not being an openable path — absent,
/// unreadable, a socket — collapses to [`PathKind::Missing`], because a link
/// that isn't one is the whole of what the renderer does with the answer.
///
/// Symlinks are followed: a link to a file is a file, which is what a reader
/// means by clicking one. `list_dir`'s escape-flagging exists to stop the tree
/// *browsing* out of a project, and opening one file the agent just named is
/// not that.
pub fn path_kinds(paths: &[String]) -> Vec<PathKind> {
	paths.iter().map(|p| path_kind(p)).collect()
}

fn path_kind(path: &str) -> PathKind {
	// `metadata` rather than `symlink_metadata`: see the note above about
	// following links.
	match fs::metadata(path) {
		Ok(m) if m.is_dir() => PathKind::Directory,
		Ok(m) if m.is_file() => PathKind::File,
		_ => PathKind::Missing,
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::fs::File;
	use tempfile::tempdir;

	fn names(listing: &DirListing) -> Vec<&str> {
		listing.entries.iter().map(|e| e.name.as_str()).collect()
	}

	/// A one-pixel PNG, header and all — enough for the sniffer and short
	/// enough to keep inline.
	const TINY_PNG: &[u8] = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01";

	fn write_bytes(dir: &Path, name: &str, bytes: &[u8]) -> String {
		let p = dir.join(name);
		fs::write(&p, bytes).unwrap();
		p.to_string_lossy().to_string()
	}

	#[test]
	fn reads_an_image_as_base64_with_a_sniffed_mime() {
		let dir = tempdir().unwrap();
		let path = write_bytes(dir.path(), "pixel.png", TINY_PNG);

		let img = read_image(&path, None).expect("read");

		assert_eq!(img.mime, "image/png");
		assert_eq!(img.size, TINY_PNG.len() as u64);
		assert_eq!(B64.decode(img.base64).unwrap(), TINY_PNG);
	}

	#[test]
	fn the_extension_does_not_decide_the_mime() {
		// The viewer routes here because the name ends in .png. If we echoed the
		// extension back, the renderer would get `image/png` for a PDF and draw
		// a broken image with no way to know why.
		let dir = tempdir().unwrap();
		let path = write_bytes(dir.path(), "liar.png", b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n");

		let err = read_image(&path, None).unwrap_err();
		assert!(
			format!("{err}").contains("not a displayable image"),
			"expected a refusal, got {err}"
		);
	}

	#[test]
	fn a_jpeg_named_png_reports_what_it_actually_is() {
		let dir = tempdir().unwrap();
		let path = write_bytes(dir.path(), "actually.png", b"\xff\xd8\xff\xe0\x00\x10JFIF");
		assert_eq!(read_image(&path, None).unwrap().mime, "image/jpeg");
	}

	#[test]
	fn riff_is_a_container_so_only_webp_counts() {
		// `RIFF` alone is also wav and avi. Only bytes 8..12 separate them, and
		// getting this wrong would hand an `<img>` a sound file.
		let mut wav = b"RIFF\x24\x08\x00\x00WAVEfmt ".to_vec();
		wav.resize(32, 0);
		assert_eq!(sniff_image_mime(&wav), None);

		let mut webp = b"RIFF\x24\x08\x00\x00WEBPVP8 ".to_vec();
		webp.resize(32, 0);
		assert_eq!(sniff_image_mime(&webp), Some("image/webp"));

		// Too short to reach byte 12 at all — must not panic on the slice.
		assert_eq!(sniff_image_mime(b"RIFF"), None);
	}

	#[test]
	fn an_oversized_image_is_refused_rather_than_truncated() {
		// Half a PNG is not a smaller PNG, it's a decode error — so unlike text
		// there is no "show anyway" path worth offering.
		let dir = tempdir().unwrap();
		let mut big = TINY_PNG.to_vec();
		big.resize(4096, 0);
		let path = write_bytes(dir.path(), "big.png", &big);

		let err = read_image(&path, Some(1024)).unwrap_err();
		assert!(format!("{err}").contains("larger than"), "got {err}");
	}

	#[test]
	fn a_missing_image_is_not_found_rather_than_io() {
		let dir = tempdir().unwrap();
		let path = dir.path().join("gone.png").to_string_lossy().to_string();
		assert!(matches!(read_image(&path, None), Err(AppError::NotFound(_))));
	}

	/// Enough of a PDF for `read_pdf`, which reads the magic bytes and nothing
	/// else — the document only has to parse in the renderer, and the fixture
	/// that does parse lives on that side (`tests/smoke/fixtures.ts`).
	const TINY_PDF: &[u8] = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\ntrailer<</Root 1 0 R>>\n%%EOF\n";

	#[test]
	fn reads_a_pdf_as_base64() {
		let dir = tempdir().unwrap();
		let path = write_bytes(dir.path(), "spec.pdf", TINY_PDF);

		let pdf = read_pdf(&path, None).expect("read");

		assert_eq!(pdf.size, TINY_PDF.len() as u64);
		assert_eq!(B64.decode(pdf.base64).unwrap(), TINY_PDF);
	}

	#[test]
	fn a_pdf_by_name_only_is_refused_here_rather_than_in_pdfjs() {
		// A zip named .pdf. pdf.js would reject it too, with a message about
		// document structure that means nothing to whoever clicked the file.
		let dir = tempdir().unwrap();
		let path = write_bytes(dir.path(), "liar.pdf", b"PK\x03\x04\x14\x00\x00\x00");

		let err = read_pdf(&path, None).unwrap_err();
		assert!(format!("{err}").contains("not a PDF"), "expected a refusal, got {err}");
	}

	#[test]
	fn an_oversized_pdf_is_refused_and_the_message_says_pdf() {
		// Same bargain as an image: refused whole, no "show anyway". The refusal
		// names the kind, because the reader sees this sentence.
		let dir = tempdir().unwrap();
		let mut big = TINY_PDF.to_vec();
		big.resize(4096, 0);
		let path = write_bytes(dir.path(), "big.pdf", &big);

		let err = read_pdf(&path, Some(1024)).unwrap_err();
		let message = format!("{err}");
		assert!(message.contains("larger than"), "got {message}");
		assert!(message.contains("PDF is"), "got {message}");
	}

	#[test]
	fn a_missing_pdf_is_not_found_rather_than_io() {
		let dir = tempdir().unwrap();
		let path = dir.path().join("gone.pdf").to_string_lossy().to_string();
		assert!(matches!(read_pdf(&path, None), Err(AppError::NotFound(_))));
	}

	#[test]
	fn a_directory_named_like_a_pdf_is_invalid_input() {
		// `foo.pdf/` is a legal directory name, and the tree will happily route a
		// click on it here if its icon key says pdf.
		let dir = tempdir().unwrap();
		fs::create_dir(dir.path().join("bundle.pdf")).unwrap();
		let path = dir.path().join("bundle.pdf").to_string_lossy().to_string();
		assert!(matches!(read_pdf(&path, None), Err(AppError::InvalidInput(_))));
	}

	#[test]
	fn lists_directories_first_then_files_case_insensitively() {
		let dir = tempdir().unwrap();
		let root = dir.path();
		fs::create_dir(root.join("src")).unwrap();
		fs::create_dir(root.join("Apps")).unwrap();
		File::create(root.join("README.md")).unwrap();
		File::create(root.join("apple.txt")).unwrap();
		File::create(root.join(".env")).unwrap();

		let listing = list_dir(root.to_str().unwrap(), None).unwrap();

		// Dirs first (Apps before src, case-insensitive), then files with the
		// dotfile sorting under `.` and staying visible.
		assert_eq!(names(&listing), vec!["Apps", "src", ".env", "apple.txt", "README.md"]);
		assert!(!listing.truncated);
		assert_eq!(listing.total, 5);
	}

	#[test]
	fn excludes_git_but_keeps_other_dotdirs() {
		let dir = tempdir().unwrap();
		let root = dir.path();
		fs::create_dir(root.join(".git")).unwrap();
		fs::create_dir(root.join(".claude")).unwrap();
		fs::create_dir(root.join("__pycache__")).unwrap();

		let listing = list_dir(root.to_str().unwrap(), None).unwrap();

		assert_eq!(names(&listing), vec![".claude", "__pycache__"]);
		assert_eq!(listing.total, 2);
	}

	#[test]
	fn reports_sizes_and_dir_flags() {
		let dir = tempdir().unwrap();
		let root = dir.path();
		fs::create_dir(root.join("pkg")).unwrap();
		fs::write(root.join("a.txt"), b"hello").unwrap();

		let listing = list_dir(root.to_str().unwrap(), None).unwrap();
		let pkg = &listing.entries[0];
		let file = &listing.entries[1];

		assert!(pkg.is_dir);
		assert_eq!(pkg.size, 0);
		assert!(!file.is_dir);
		assert_eq!(file.size, 5);
		assert!(file.modified_at.is_some());
		assert!(file.path.ends_with("a.txt"));
	}

	#[test]
	fn truncates_to_the_cap_but_reports_the_true_total() {
		let dir = tempdir().unwrap();
		let root = dir.path();
		for i in 0..10 {
			File::create(root.join(format!("f{i:02}.txt"))).unwrap();
		}

		let listing = list_dir_capped(root.to_str().unwrap(), None, 4).unwrap();

		assert!(listing.truncated);
		assert_eq!(listing.total, 10);
		assert_eq!(listing.entries.len(), 4);
		// Deterministic prefix: sorted, then cut.
		assert_eq!(names(&listing), vec!["f00.txt", "f01.txt", "f02.txt", "f03.txt"]);
	}

	#[cfg(unix)]
	#[test]
	fn flags_symlinks_and_whether_they_escape_the_root() {
		let dir = tempdir().unwrap();
		let root = dir.path();
		let outside = tempdir().unwrap();
		fs::create_dir(root.join("real")).unwrap();
		std::os::unix::fs::symlink(root.join("real"), root.join("inside-link")).unwrap();
		std::os::unix::fs::symlink(outside.path(), root.join("outside-link")).unwrap();

		let listing = list_dir(root.to_str().unwrap(), Some(root.to_str().unwrap())).unwrap();
		let by_name = |n: &str| listing.entries.iter().find(|e| e.name == n).unwrap();

		let inside = by_name("inside-link");
		assert!(inside.is_symlink);
		assert!(inside.is_dir, "a link to a directory is expandable");
		assert!(!inside.symlink_outside_root);

		let outside_link = by_name("outside-link");
		assert!(outside_link.is_symlink);
		assert!(outside_link.symlink_outside_root);

		assert!(!by_name("real").is_symlink);
	}

	#[cfg(unix)]
	#[test]
	fn a_broken_symlink_is_listed_and_treated_as_escaping() {
		let dir = tempdir().unwrap();
		let root = dir.path();
		std::os::unix::fs::symlink(root.join("nope"), root.join("dangling")).unwrap();

		let listing = list_dir(root.to_str().unwrap(), Some(root.to_str().unwrap())).unwrap();
		let entry = &listing.entries[0];

		assert_eq!(entry.name, "dangling");
		assert!(entry.is_symlink);
		assert!(!entry.is_dir);
		assert!(entry.symlink_outside_root);
	}

	#[test]
	fn reads_text_with_a_line_count() {
		let dir = tempdir().unwrap();
		let p = dir.path().join("a.rs");
		fs::write(&p, "fn main() {}\nlet x = 1;\n").unwrap();

		let f = read_file(p.to_str().unwrap(), None).unwrap();

		assert_eq!(f.contents, "fn main() {}\nlet x = 1;\n");
		assert_eq!(f.size, 24);
		assert_eq!(f.line_count, 2);
		assert!(!f.is_binary);
		assert!(!f.truncated);
	}

	#[test]
	fn an_empty_file_reads_as_empty_not_as_an_error() {
		let dir = tempdir().unwrap();
		let p = dir.path().join("empty.txt");
		File::create(&p).unwrap();

		let f = read_file(p.to_str().unwrap(), None).unwrap();

		assert_eq!(f.contents, "");
		assert_eq!(f.size, 0);
		assert_eq!(f.line_count, 0);
		assert!(!f.is_binary);
	}

	#[test]
	fn a_null_byte_marks_the_file_binary_and_withholds_contents() {
		let dir = tempdir().unwrap();
		let p = dir.path().join("blob.bin");
		fs::write(&p, b"PNG\x00\x01\x02rest of the file").unwrap();

		let f = read_file(p.to_str().unwrap(), None).unwrap();

		assert!(f.is_binary);
		assert!(f.contents.is_empty(), "no point shipping bytes we won't render");
		// Size is still reported — the UI says how big the thing it can't show is.
		assert_eq!(f.size, 22);
	}

	#[test]
	fn a_null_byte_past_the_sniff_window_is_not_treated_as_binary() {
		let dir = tempdir().unwrap();
		let p = dir.path().join("late-null.txt");
		let mut bytes = vec![b'a'; SNIFF_BYTES + 10];
		bytes.push(0);
		fs::write(&p, &bytes).unwrap();

		let f = read_file(p.to_str().unwrap(), None).unwrap();

		assert!(!f.is_binary);
	}

	#[test]
	fn truncates_at_the_cap_and_still_reports_the_real_size() {
		let dir = tempdir().unwrap();
		let p = dir.path().join("big.txt");
		fs::write(&p, "0123456789").unwrap();

		let f = read_file(p.to_str().unwrap(), Some(4)).unwrap();

		assert!(f.truncated);
		assert_eq!(f.contents, "0123");
		assert_eq!(f.size, 10);

		// Lifting the cap returns everything.
		let full = read_file(p.to_str().unwrap(), None).unwrap();
		assert!(!full.truncated);
		assert_eq!(full.contents, "0123456789");
	}

	#[test]
	fn a_file_exactly_at_the_cap_is_not_reported_truncated() {
		let dir = tempdir().unwrap();
		let p = dir.path().join("exact.txt");
		fs::write(&p, "0123").unwrap();

		let f = read_file(p.to_str().unwrap(), Some(4)).unwrap();

		assert!(!f.truncated);
		assert_eq!(f.contents, "0123");
	}

	#[test]
	fn invalid_utf8_without_nulls_is_read_lossily() {
		let dir = tempdir().unwrap();
		let p = dir.path().join("latin1.txt");
		// 0xE9 is `é` in latin-1 and invalid on its own in UTF-8.
		fs::write(&p, b"caf\xE9 au lait").unwrap();

		let f = read_file(p.to_str().unwrap(), None).unwrap();

		assert!(!f.is_binary);
		assert!(f.contents.contains("caf"));
		assert!(f.contents.contains("au lait"));
	}

	#[test]
	fn reading_a_missing_path_or_a_directory_fails_distinctly() {
		let dir = tempdir().unwrap();
		let missing = dir.path().join("nope.txt");

		assert!(matches!(read_file(missing.to_str().unwrap(), None), Err(AppError::NotFound(_))));
		assert!(matches!(
			read_file(dir.path().to_str().unwrap(), None),
			Err(AppError::InvalidInput(_))
		));
	}

	#[test]
	fn missing_path_is_not_found_and_a_file_is_invalid_input() {
		let dir = tempdir().unwrap();
		let missing = dir.path().join("nope");
		let file = dir.path().join("f.txt");
		File::create(&file).unwrap();

		assert!(matches!(list_dir(missing.to_str().unwrap(), None), Err(AppError::NotFound(_))));
		assert!(matches!(list_dir(file.to_str().unwrap(), None), Err(AppError::InvalidInput(_))));
	}

	#[test]
	fn path_kinds_answers_in_the_order_it_was_asked() {
		let dir = tempdir().unwrap();
		let file = dir.path().join("a.txt");
		File::create(&file).unwrap();
		let subdir = dir.path().join("sub");
		fs::create_dir(&subdir).unwrap();

		// Order is the contract: the caller zips this back onto the ranges it
		// found on one terminal line.
		let asked = vec![
			dir.path().join("nope.txt").to_string_lossy().into_owned(),
			file.to_string_lossy().into_owned(),
			subdir.to_string_lossy().into_owned(),
		];

		assert_eq!(
			path_kinds(&asked),
			vec![PathKind::Missing, PathKind::File, PathKind::Directory]
		);
	}

	#[cfg(unix)]
	#[test]
	fn path_kinds_follows_a_symlink_to_what_it_points_at() {
		let dir = tempdir().unwrap();
		let file = dir.path().join("real.txt");
		File::create(&file).unwrap();
		let link = dir.path().join("link.txt");
		std::os::unix::fs::symlink(&file, &link).unwrap();
		let dangling = dir.path().join("dangling.txt");
		std::os::unix::fs::symlink(dir.path().join("gone.txt"), &dangling).unwrap();

		// A link to a file is a file — that is what clicking one means. A link
		// to nothing is Missing rather than an error, like everything else here.
		assert_eq!(
			path_kinds(&[
				link.to_string_lossy().into_owned(),
				dangling.to_string_lossy().into_owned(),
			]),
			vec![PathKind::File, PathKind::Missing]
		);
	}

	#[test]
	fn path_kinds_of_nothing_is_nothing() {
		assert!(path_kinds(&[]).is_empty());
	}
}
