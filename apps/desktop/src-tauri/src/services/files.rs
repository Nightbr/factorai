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
use crate::models::{
	DirEntry, DirListing, FileContents, ImageContents, MediaKind, MediaProbe, PathKind, PdfContents,
};
use crate::services::git::IgnoreChecker;
use crate::services::sops;

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

/// Extensions the viewer hands to a media element, with the element to mount
/// and the type to assume when the bytes name none (F7, ADR-0057).
///
/// **`ts` is deliberately absent.** It is TypeScript here and in every project
/// this app is pointed at; MPEG-TS video spells itself `m2ts` or `mts` often
/// enough that claiming `.ts` would trade a rare video for every source file in
/// the tree. `svg` is absent for the reason `read_image` leaves it out — it is
/// better served as source.
///
/// Mirrored by `iconKeyFor` in the renderer, which decides *which door a file
/// knocks on*; this table decides what is behind it. The two can disagree
/// harmlessly in one direction only — an extension the renderer routes here and
/// this table does not know is refused below, which is the binary card.
const MEDIA_EXTENSIONS: &[(&str, MediaKind, &str)] = &[
	("mkv", MediaKind::Video, "video/x-matroska"),
	("mp4", MediaKind::Video, "video/mp4"),
	("m4v", MediaKind::Video, "video/x-m4v"),
	("mov", MediaKind::Video, "video/quicktime"),
	("webm", MediaKind::Video, "video/webm"),
	("avi", MediaKind::Video, "video/x-msvideo"),
	("ogv", MediaKind::Video, "video/ogg"),
	("mpg", MediaKind::Video, "video/mpeg"),
	("mpeg", MediaKind::Video, "video/mpeg"),
	("wmv", MediaKind::Video, "video/x-ms-wmv"),
	("flv", MediaKind::Video, "video/x-flv"),
	("m2ts", MediaKind::Video, "video/mp2t"),
	("mts", MediaKind::Video, "video/mp2t"),
	("mp3", MediaKind::Audio, "audio/mpeg"),
	("wav", MediaKind::Audio, "audio/wav"),
	("flac", MediaKind::Audio, "audio/flac"),
	("aac", MediaKind::Audio, "audio/aac"),
	("ogg", MediaKind::Audio, "audio/ogg"),
	("opus", MediaKind::Audio, "audio/ogg"),
	("m4a", MediaKind::Audio, "audio/mp4"),
	("wma", MediaKind::Audio, "audio/x-ms-wma"),
];

/// How much of the file the container sniff reads. MPEG-TS needs byte 188 to
/// confirm its second sync word, and nothing here looks further.
const MEDIA_SNIFF_BYTES: usize = 512;

/// The element and fallback type for this path's extension, or `None` when the
/// viewer should never have routed it here.
fn media_extension(path: &str) -> Option<(MediaKind, &'static str)> {
	let ext = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
	MEDIA_EXTENSIONS.iter().find(|(e, _, _)| *e == ext).map(|(_, kind, mime)| (*kind, *mime))
}

/// The container these bytes are, where we recognise one.
///
/// `ext_mime` breaks the ties the magic bytes cannot: Matroska and WebM share
/// an EBML header, Ogg carries audio and video under one `OggS`, and every MP4
/// family member starts `ftyp`. Where the brand *is* decisive — QuickTime's
/// `qt  `, the `M4A ` audio brand — it wins over the extension, because that is
/// the file telling us what it is.
pub(crate) fn sniff_media_mime(bytes: &[u8], ext_mime: &str) -> Option<&'static str> {
	let at = |i: usize, j: usize| bytes.get(i..j);

	if at(4, 8) == Some(b"ftyp") {
		return match at(8, 12) {
			Some(b"qt  ") => Some("video/quicktime"),
			Some(b"M4A ") => Some("audio/mp4"),
			// Every other brand is an ISO-BMFF box, and whether it holds a movie
			// or a song is what the extension already told us.
			_ if ext_mime.starts_with("audio/") => Some("audio/mp4"),
			_ => Some("video/mp4"),
		};
	}
	if bytes.starts_with(b"\x1a\x45\xdf\xa3") {
		// The DocType that separates `webm` from `matroska` lives inside the
		// first EBML element rather than at a fixed offset, and reading it means
		// a parser. The extension is right often enough, and both play or fail
		// together in any given webview anyway.
		return Some(if ext_mime == "video/webm" { "video/webm" } else { "video/x-matroska" });
	}
	if at(0, 4) == Some(b"RIFF") {
		return match at(8, 12) {
			Some(b"AVI ") => Some("video/x-msvideo"),
			Some(b"WAVE") => Some("audio/wav"),
			_ => None,
		};
	}
	if bytes.starts_with(b"OggS") {
		return Some(if ext_mime.starts_with("video/") { "video/ogg" } else { "audio/ogg" });
	}
	if bytes.starts_with(b"fLaC") {
		return Some("audio/flac");
	}
	if bytes.starts_with(b"FLV\x01") {
		return Some("video/x-flv");
	}
	// ASF, which is what `.wmv` and `.wma` both are.
	if bytes.starts_with(b"\x30\x26\xb2\x75\x8e\x66\xcf\x11") {
		return Some(if ext_mime.starts_with("audio/") {
			"audio/x-ms-wma"
		} else {
			"video/x-ms-asf"
		});
	}
	// MPEG program stream: a pack header.
	if bytes.starts_with(b"\x00\x00\x01\xba") {
		return Some("video/mpeg");
	}
	// MPEG transport stream: 0x47 every 188 bytes. Two syncs is enough to tell
	// it from a file that merely opens with a `G`.
	if bytes.first() == Some(&0x47) && bytes.get(188) == Some(&0x47) {
		return Some("video/mp2t");
	}
	if bytes.starts_with(b"ID3") {
		return Some("audio/mpeg");
	}
	// A bare MPEG audio frame: eleven sync bits set, and a version/layer pair
	// that is not one of the two reserved encodings.
	if let Some([b0, b1, ..]) = bytes.get(0..2) {
		if *b0 == 0xff && b1 & 0xe0 == 0xe0 && b1 & 0x18 != 0x08 && b1 & 0x06 != 0x00 {
			return Some("audio/mpeg");
		}
	}
	None
}

/// What these bytes are instead, when they are positively something else.
///
/// The half of the verdict that refuses. Kept separate from `sniff_media_mime`
/// because the two are not opposites: between them sits the file we do not
/// recognise and play anyway.
fn media_mismatch(bytes: &[u8]) -> Option<&'static str> {
	if let Some(mime) = sniff_image_mime(bytes) {
		return Some(mime);
	}
	if bytes.starts_with(PDF_MAGIC) {
		return Some("a PDF");
	}
	if bytes.starts_with(b"PK\x03\x04") {
		return Some("a zip archive");
	}
	if bytes.starts_with(b"\x7fELF") {
		return Some("an executable");
	}
	// Last, and only after every container above has declined: a file with no
	// NUL byte in its first block is text, by the same test `read_file` uses to
	// draw the binary card. Every container we play has NULs in its header, so
	// reaching here with none is a `.mp4` that is really a shell script.
	if !bytes.iter().take(MEDIA_SNIFF_BYTES).any(|b| *b == 0) {
		return Some("text");
	}
	None
}

/// Whether this file can be handed to a media element, and what to call it
/// (F7, [ADR-0057](../../../../specs/adr/0057-media-is-served-over-loopback-http-not-a-custom-protocol.md)).
///
/// **Reads the first 512 bytes and no more.** This is the one preview command
/// that never carries the file: a video is streamed from the media server in
/// the ranges the element asks for, so there is no cap here to refuse against
/// and no base64 to pay for. A 2GB recording costs one `stat` and one short
/// read.
///
/// **A looser bargain than `read_image`, deliberately.** That one refuses every
/// magic it does not know, because a wrong guess draws a broken-image icon.
/// Here a wrong guess costs nothing: the container we failed to name is handed
/// to a demuxer far better than this function, and if it also declines, the
/// element's own error says so in a sentence. So an unrecognised container
/// plays with the type its extension implies, and only bytes that positively
/// identify as something *else* — a picture, a PDF, an archive, an executable,
/// text — are refused to the binary card.
///
/// The path comes back canonicalized, so a file reached through a symlink has
/// one identity; the caller publishes *that* path. See [`MediaProbe`].
pub fn probe_media(path: &str) -> AppResult<MediaProbe> {
	let (kind, ext_mime) = media_extension(path)
		.ok_or_else(|| AppError::InvalidInput(format!("not a media file: {path}")))?;

	let p = Path::new(path);
	let meta = fs::metadata(p).map_err(|e| match e.kind() {
		std::io::ErrorKind::NotFound => AppError::NotFound(format!("path {path}")),
		std::io::ErrorKind::PermissionDenied => AppError::Io(format!("permission denied: {path}")),
		_ => AppError::Io(format!("{path}: {e}")),
	})?;
	if meta.is_dir() {
		return Err(AppError::InvalidInput(format!("is a directory: {path}")));
	}
	// An empty file has no magic to read and nothing to play; the element would
	// report a decode error against a file that is merely absent of content.
	if meta.len() == 0 {
		return Err(AppError::InvalidInput(format!("empty file: {path}")));
	}

	let mut file = fs::File::open(p).map_err(|e| match e.kind() {
		std::io::ErrorKind::PermissionDenied => AppError::Io(format!("permission denied: {path}")),
		_ => AppError::Io(format!("{path}: {e}")),
	})?;
	let mut head = Vec::new();
	file.by_ref()
		.take(MEDIA_SNIFF_BYTES as u64)
		.read_to_end(&mut head)
		.map_err(|e| AppError::Io(format!("{path}: {e}")))?;

	if let Some(what) = media_mismatch(&head) {
		return Err(AppError::InvalidInput(format!("not media, it is {what}: {path}")));
	}

	let canonical = fs::canonicalize(p)
		.map_err(|e| AppError::Io(format!("{path}: {e}")))?
		.to_string_lossy()
		.into_owned();

	Ok(MediaProbe {
		path: canonical,
		// Left blank here and filled by the command. Where the bytes are served
		// from is the media server's answer, and this function is the one that
		// decides there are bytes worth serving.
		url: String::new(),
		kind,
		mime: sniff_media_mime(&head, ext_mime).unwrap_or(ext_mime).to_string(),
		size: meta.len(),
	})
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
			lossy: false,
			// A binary read carries no `contents` to look at, and SOPS's own
			// `binary` output format is JSON — text — so it never lands here.
			sops_encrypted: false,
		};
	}

	let truncated = bytes.len() > cap;
	let kept = if truncated { &bytes[..cap] } else { bytes };

	// Lossy on purpose: a latin-1 source file or a stray invalid sequence is
	// still worth reading, and we've already ruled out real binaries.
	//
	// **But say so** (F26). Every byte that didn't decode is a U+FFFD in
	// `contents`, and saving that string back would write the replacement
	// character over the original byte, permanently. The viewer opens a lossy
	// read read-only, and this flag is the only way it can know.
	//
	// The cap is not the file's fault. Cutting at a byte offset can land inside
	// a multi-byte character, which `from_utf8` reports as an unexpected end of
	// input (`error_len() == None`) rather than as a bad byte. Dropping that
	// partial character keeps a large, perfectly valid UTF-8 file from being
	// called lossy because we stopped reading mid-`é`.
	let (contents, lossy) = match std::str::from_utf8(kept) {
		Ok(s) => (s.to_string(), false),
		Err(e) if truncated && e.error_len().is_none() => {
			// Everything up to `valid_up_to` decoded, so this is lossless.
			(String::from_utf8_lossy(&kept[..e.valid_up_to()]).into_owned(), false)
		}
		Err(_) => (String::from_utf8_lossy(kept).into_owned(), true),
	};
	let line_count = if contents.is_empty() { 0 } else { contents.lines().count() };

	// **Decided here rather than in the viewer** (F27). One answer for a file,
	// whether it was read from disk or out of the object database, and it costs
	// a scan of text we are already holding — no `sops` process, no key.
	let sops_encrypted = sops::is_encrypted(&contents);

	FileContents {
		path: path.to_string(),
		contents,
		size: true_size,
		is_binary: false,
		truncated,
		line_count,
		lossy,
		sops_encrypted,
	}
}

/// Write `contents` to `path`, atomically (F26).
///
/// The first thing factorai writes that a human typed, and the boundary it sits
/// on is ADR-0039: a project's own files, never an agent's store. Only the
/// renderer calls it, only from a Save the human pressed, and it is deliberately
/// not one of the tools the MCP server offers an agent (ADR-0029).
///
/// Four properties, each of which is a test below:
///
/// - **The path is canonicalised first**, so editing a symlinked `.env` — a very
///   common layout — writes its target rather than replacing the link with a
///   regular file.
/// - **Temp file in the same directory, then rename.** Same filesystem, so the
///   rename is atomic and a crash or a full disk leaves the previous contents
///   intact. A temp file in `/tmp` would make it a cross-device copy and lose
///   exactly that.
/// - **The original's permission bits are copied onto the temp file** before the
///   rename, or a `0600` secrets file comes back `0644` wearing the process
///   umask.
/// - **A file that has gone is recreated**, at the same path. Its parent is not:
///   a missing parent means the tree moved under the editor, and guessing is
///   worse than failing.
///
/// **It answers with the file it just wrote**, as a `read_file` would describe
/// it. The renderer's cached read is stale the instant this returns, and the
/// alternatives are both worse: re-reading costs a second pass over a file we
/// just held in memory, and recomputing the size and line count in TypeScript
/// puts a second definition of "how many lines is this" next to Rust's. No cap
/// is applied — this is the text the editor holds, and it decoded, so there is
/// nothing to truncate and nothing to lose.
pub fn write_file(path: &str, contents: &str) -> AppResult<FileContents> {
	let requested = Path::new(path);
	if !requested.is_absolute() {
		return Err(AppError::InvalidInput(format!("not an absolute path: {path}")));
	}

	// `canonicalize` resolves the symlink *and* fails on a file that is gone,
	// which is a case we support — so fall back to the path as given, with its
	// parent resolved. That still follows a symlinked directory on the way in,
	// and there is no link at the leaf to follow when the leaf does not exist.
	let target = match fs::canonicalize(requested) {
		Ok(p) => p,
		Err(e) if e.kind() == std::io::ErrorKind::NotFound => resolve_missing(requested)?,
		Err(e) => return Err(AppError::Io(format!("{path}: {e}"))),
	};

	if target.is_dir() {
		return Err(AppError::InvalidInput(format!("is a directory: {path}")));
	}
	let Some(dir) = target.parent() else {
		return Err(AppError::InvalidInput(format!("path has no parent: {path}")));
	};

	// The mode of what is being replaced, before anything replaces it. `None`
	// for a file that does not exist yet, which then takes the default.
	let existing_mode = fs::metadata(&target).ok().map(|m| mode_of(&m));

	let temp = tempfile::Builder::new()
		.prefix(".factorai-")
		.suffix(".tmp")
		.tempfile_in(dir)
		.map_err(|e| write_error(path, dir, e))?;

	{
		use std::io::Write as _;
		let file = temp.as_file();
		let mut writer = std::io::BufWriter::new(file);
		writer.write_all(contents.as_bytes()).map_err(|e| write_error(path, dir, e))?;
		writer.flush().map_err(|e| write_error(path, dir, e))?;
	}
	// Before the rename, not after: a rename that lands ahead of the data is
	// how an atomic write still produces an empty file after a power cut.
	temp.as_file().sync_all().map_err(|e| write_error(path, dir, e))?;

	if let Some(mode) = existing_mode {
		set_mode(temp.path(), mode).map_err(|e| write_error(path, dir, e))?;
	}

	// `persist` is the rename. It reports the temp file back on failure so it is
	// cleaned up rather than left beside the file it failed to become.
	temp.persist(&target).map_err(|e| write_error(path, dir, e.error))?;

	let bytes = contents.as_bytes();
	Ok(contents_from_bytes(path, bytes, bytes.len() as u64, usize::MAX))
}

/// The absolute path to write when the file itself does not exist: its parent
/// canonicalised — which must exist — plus the name it will have.
fn resolve_missing(requested: &Path) -> AppResult<std::path::PathBuf> {
	let (Some(parent), Some(name)) = (requested.parent(), requested.file_name()) else {
		return Err(AppError::InvalidInput(format!("path has no parent: {}", requested.display())));
	};
	let parent = fs::canonicalize(parent).map_err(|e| match e.kind() {
		std::io::ErrorKind::NotFound => {
			AppError::NotFound(format!("directory {}", parent.display()))
		}
		_ => AppError::Io(format!("{}: {e}", parent.display())),
	})?;
	Ok(parent.join(name))
}

/// One error shape for every step of the write, because the caller's question
/// is only ever "did the file change, and if not why not". `dir` is named on a
/// permission failure: the write can fail because the *directory* is read-only
/// while the file itself looks writable, and that is the confusing one.
fn write_error(path: &str, dir: &Path, e: std::io::Error) -> AppError {
	match e.kind() {
		std::io::ErrorKind::PermissionDenied => {
			AppError::Io(format!("permission denied writing {path} (in {})", dir.display()))
		}
		_ => AppError::Io(format!("{path}: {e}")),
	}
}

#[cfg(unix)]
fn mode_of(meta: &fs::Metadata) -> u32 {
	use std::os::unix::fs::PermissionsExt;
	meta.permissions().mode()
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) -> std::io::Result<()> {
	use std::os::unix::fs::PermissionsExt;
	fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

// macOS and Linux are the platforms (§ "What this project does not do"), so the
// arms above are the real ones. These keep the file compiling anywhere else
// without pretending the mode was preserved.
#[cfg(not(unix))]
fn mode_of(meta: &fs::Metadata) -> u32 {
	let _ = meta;
	0
}

#[cfg(not(unix))]
fn set_mode(path: &Path, mode: u32) -> std::io::Result<()> {
	let (_, _) = (path, mode);
	Ok(())
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

	/// A real file `sops` produced — the whole thing, MAC and all — read through
	/// `read_file` rather than through the detector directly, because the wiring
	/// is what this asserts: the flag the viewer reads comes off an ordinary
	/// read with no `sops` process and no key (F27).
	const SOPS_YAML: &str = r#"api_key: ENC[AES256_GCM,data:C5LpI9JZGR81BNW/J7g=,iv:xEumiTGqmmhXm2R+ckMWMtxyxICnIVKboRlkRLL4vko=,tag:kJrpIPlMaydO6ndFVIpb/g==,type:str]
nested:
    token: ENC[AES256_GCM,data:FgNuyFuCJg==,iv:quCuLXUzPu9e7J+cpmuHTCd92R84WVnU29DCjVeTkPU=,tag:dxUvcUkhCYdu9AU0zYYIYA==,type:str]
sops:
    age:
        - enc: |
            -----BEGIN AGE ENCRYPTED FILE-----
            YWdlLWVuY3J5cHRpb24ub3JnL3YxCi0+IFgyNTUxOSAxVkZTMDhjWllheEovOE5m
            TXhTZkcxYWN2OWJlM0JhSVF0WjVOWGorVGdRCkdMTTFUK0wxbzQwYTFYSlFDR3k0
            OUZXcDVSQWc4YktMSGlFUnM4Y2piMTAKLS0tIE1jc2VvTFFMeWVvUTYzTVZHSC9T
            RWFaSU9IR3FuWjU0TnZBQWRmSExvMDQKRbc4QRREaqOCDbBfpEblfz75lxu7LnBK
            3wuATJDJJbu26+beb9kdfNRziJ66dtCgtybLf/QRaUW86r7hDWJYvg==
            -----END AGE ENCRYPTED FILE-----
          recipient: age183pmep5vqgx4ld244frt0eaulz8kct2stjj9hau42njhwc44makqlsumed
    lastmodified: "2026-09-14T15:29:16Z"
    mac: ENC[AES256_GCM,data:k5c7moHOM14RA0bEEQwnOn+qrKx9aJybtQAGvW1/Oh+iTwFQEYLn2GOP23uCpPDf1rArCWpPp7EBXNiaSjGGA2z9mtZe8ZWfZIcLxeJo9XrFlxtfEkHnmVrZ+5ANUiIND4JuH2WCpzmbprFALJAYniXFJQZ8z41LJ30o4XpT0aI=,iv:Vue/bB8afK08gHzFOhlkoE9UjB32NBE4PMak+p95au8=,tag:pk07Gf7qB2qm/warmoQkKw==,type:str]
    unencrypted_suffix: _unencrypted
    version: 3.13.1
"#;

	#[test]
	fn an_encrypted_file_is_read_and_flagged() {
		let dir = tempdir().unwrap();
		let p = dir.path().join("secrets.yaml");
		fs::write(&p, SOPS_YAML).unwrap();

		let f = read_file(p.to_str().unwrap(), None).unwrap();

		// Ciphertext is text: it is readable, it is not binary, and the viewer
		// shows it. What the flag adds is that it must not be written back.
		assert!(f.sops_encrypted);
		assert!(!f.is_binary);
		assert!(f.contents.contains("ENC[AES256_GCM"));
	}

	#[test]
	fn an_ordinary_file_is_not_flagged_encrypted() {
		let dir = tempdir().unwrap();
		// The name a convention would call encrypted, holding a file that is not.
		let p = dir.path().join("secrets.yaml");
		fs::write(&p, "api_key: sk-live-abc123\n").unwrap();

		assert!(!read_file(p.to_str().unwrap(), None).unwrap().sops_encrypted);
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

	// ---- write_file (F26) ----------------------------------------------------

	fn path_of(p: &Path) -> String {
		p.to_string_lossy().into_owned()
	}

	#[test]
	fn write_file_replaces_contents() {
		let dir = tempdir().unwrap();
		let file = dir.path().join("notes.md");
		fs::write(&file, "before").unwrap();

		write_file(&path_of(&file), "after").unwrap();

		assert_eq!(fs::read_to_string(&file).unwrap(), "after");
	}

	#[test]
	fn write_file_answers_with_what_it_wrote() {
		let dir = tempdir().unwrap();
		let file = dir.path().join("notes.md");
		fs::write(&file, "old").unwrap();

		let after = write_file(&path_of(&file), "one\ntwo\n").unwrap();

		// The renderer swaps this straight into its cache, so it has to be what a
		// re-read would say — including the line count, which is Rust's answer and
		// must not be recomputed on the other side of the boundary.
		assert_eq!(after.contents, "one\ntwo\n");
		assert_eq!(after.line_count, 2);
		assert_eq!(after.size, 8);
		assert!(!after.truncated);
		assert!(!after.lossy);
	}

	#[test]
	fn write_file_creates_a_file_that_is_gone() {
		let dir = tempdir().unwrap();
		let file = dir.path().join("new.txt");

		write_file(&path_of(&file), "hello").unwrap();

		assert_eq!(fs::read_to_string(&file).unwrap(), "hello");
	}

	#[test]
	fn write_file_leaves_no_temp_files_behind() {
		let dir = tempdir().unwrap();
		let file = dir.path().join("a.txt");
		fs::write(&file, "x").unwrap();

		write_file(&path_of(&file), "y").unwrap();

		let left: Vec<String> = fs::read_dir(dir.path())
			.unwrap()
			.filter_map(|e| e.ok())
			.map(|e| e.file_name().to_string_lossy().into_owned())
			.collect();
		assert_eq!(left, vec!["a.txt".to_string()]);
	}

	#[test]
	fn write_file_refuses_a_directory() {
		let dir = tempdir().unwrap();
		let err = write_file(&path_of(dir.path()), "nope").unwrap_err();
		assert!(matches!(err, AppError::InvalidInput(_)), "got {err:?}");
	}

	#[test]
	fn write_file_refuses_a_relative_path() {
		let err = write_file("relative/file.txt", "nope").unwrap_err();
		assert!(matches!(err, AppError::InvalidInput(_)), "got {err:?}");
	}

	#[test]
	fn write_file_refuses_a_missing_parent() {
		let dir = tempdir().unwrap();
		let file = dir.path().join("gone").join("child.txt");
		let err = write_file(&path_of(&file), "nope").unwrap_err();
		// Not created: a missing parent means the tree moved under the editor.
		assert!(matches!(err, AppError::NotFound(_)), "got {err:?}");
		assert!(!file.exists());
	}

	#[cfg(unix)]
	#[test]
	fn write_file_follows_a_symlink_to_its_target() {
		let dir = tempdir().unwrap();
		let target = dir.path().join(".env.local");
		fs::write(&target, "KEY=old").unwrap();
		let link = dir.path().join(".env");
		std::os::unix::fs::symlink(&target, &link).unwrap();

		write_file(&path_of(&link), "KEY=new").unwrap();

		// The target changed, and the link is still a link — the failure this
		// guards is replacing somebody's `.env` symlink with a regular file.
		assert_eq!(fs::read_to_string(&target).unwrap(), "KEY=new");
		assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
	}

	#[cfg(unix)]
	#[test]
	fn write_file_keeps_the_mode_of_a_secrets_file() {
		use std::os::unix::fs::PermissionsExt;
		let dir = tempdir().unwrap();
		let file = dir.path().join(".env");
		fs::write(&file, "KEY=old").unwrap();
		fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();

		write_file(&path_of(&file), "KEY=new").unwrap();

		let mode = fs::metadata(&file).unwrap().permissions().mode() & 0o777;
		assert_eq!(mode, 0o600, "a 0600 file must not come back 0644");
	}

	#[cfg(unix)]
	#[test]
	fn write_file_reports_an_unwritable_directory() {
		use std::os::unix::fs::PermissionsExt;
		let dir = tempdir().unwrap();
		let sub = dir.path().join("locked");
		fs::create_dir(&sub).unwrap();
		let file = sub.join("a.txt");
		fs::write(&file, "before").unwrap();
		fs::set_permissions(&sub, fs::Permissions::from_mode(0o500)).unwrap();

		let err = write_file(&path_of(&file), "after").unwrap_err();

		// Restore before asserting, or the tempdir cannot be cleaned up.
		fs::set_permissions(&sub, fs::Permissions::from_mode(0o700)).unwrap();
		assert!(matches!(err, AppError::Io(_)), "got {err:?}");
		// The whole point of the temp-and-rename: a failed write changes nothing.
		assert_eq!(fs::read_to_string(&file).unwrap(), "before");
	}

	#[test]
	fn a_lossy_read_says_so() {
		// 0x80 is a continuation byte with nothing to continue — invalid UTF-8,
		// and not a null byte, so this is text as far as the sniff is concerned.
		let bytes = b"caf\x80 au lait";
		let read = contents_from_bytes("/tmp/x.txt", bytes, bytes.len() as u64, 1024);
		assert!(!read.is_binary);
		assert!(read.lossy, "invalid UTF-8 must be flagged, or Save would write U+FFFD back");
	}

	#[test]
	fn clean_utf8_is_not_lossy() {
		let bytes = "café au lait\n".as_bytes();
		let read = contents_from_bytes("/tmp/x.txt", bytes, bytes.len() as u64, 1024);
		assert!(!read.lossy);
		assert_eq!(read.contents, "café au lait\n");
	}

	#[test]
	fn a_cap_through_a_character_is_truncated_not_lossy() {
		// The cap lands between the two bytes of `é`. That is the reader's cut,
		// not the file's fault, and calling it lossy would make every large
		// UTF-8 file unreadable-as-editable for no reason.
		let bytes = "aéb".as_bytes();
		let read = contents_from_bytes("/tmp/x.txt", bytes, bytes.len() as u64, 2);
		assert!(read.truncated);
		assert!(!read.lossy);
		assert_eq!(read.contents, "a");
	}

	// ---- probe_media (F7, ADR-0057) ------------------------------------------

	/// An ISO-BMFF header: a `ftyp` box with the `isom` brand, padded past the
	/// point the sniffer reads. The NUL in the box length is what keeps it out
	/// of the `text` arm, exactly as a real file's would.
	fn mp4_header(brand: &[u8; 4]) -> Vec<u8> {
		let mut b = vec![0x00, 0x00, 0x00, 0x20];
		b.extend_from_slice(b"ftyp");
		b.extend_from_slice(brand);
		b.resize(256, 0);
		b
	}

	#[test]
	fn probes_a_video_without_reading_it() {
		let dir = tempdir().unwrap();
		let bytes = mp4_header(b"isom");
		let path = write_bytes(dir.path(), "clip.mp4", &bytes);

		let probe = probe_media(&path).expect("probe");

		assert_eq!(probe.kind, MediaKind::Video);
		assert_eq!(probe.mime, "video/mp4");
		assert_eq!(probe.size, bytes.len() as u64);
	}

	#[test]
	fn the_probed_path_is_canonical_so_one_file_has_one_identity() {
		let dir = tempdir().unwrap();
		let path = write_bytes(dir.path(), "clip.mp4", &mp4_header(b"isom"));
		let indirect = dir.path().join("sub").join("..").join("clip.mp4");
		fs::create_dir(dir.path().join("sub")).unwrap();

		let probe = probe_media(indirect.to_str().unwrap()).expect("probe");

		assert_eq!(probe.path, fs::canonicalize(&path).unwrap().to_string_lossy());
		assert!(!probe.path.contains(".."));
	}

	#[test]
	fn a_brand_that_names_itself_beats_the_extension() {
		// `.mp4` says video; the QuickTime brand says otherwise and wins,
		// because that is the file speaking rather than its name.
		assert_eq!(sniff_media_mime(&mp4_header(b"qt  "), "video/mp4"), Some("video/quicktime"));
		assert_eq!(sniff_media_mime(&mp4_header(b"M4A "), "video/mp4"), Some("audio/mp4"));
	}

	#[test]
	fn the_extension_breaks_the_ties_the_bytes_cannot() {
		// One EBML header, two answers; one `OggS`, two more.
		let ebml = b"\x1a\x45\xdf\xa3\x01\x00\x00\x00";
		assert_eq!(sniff_media_mime(ebml, "video/webm"), Some("video/webm"));
		assert_eq!(sniff_media_mime(ebml, "video/x-matroska"), Some("video/x-matroska"));
		assert_eq!(sniff_media_mime(b"OggS\x00\x02", "audio/ogg"), Some("audio/ogg"));
		assert_eq!(sniff_media_mime(b"OggS\x00\x02", "video/ogg"), Some("video/ogg"));
	}

	#[test]
	fn riff_is_a_container_so_the_form_decides() {
		assert_eq!(
			sniff_media_mime(b"RIFF\x00\x00\x00\x00AVI ", "video/x-msvideo"),
			Some("video/x-msvideo")
		);
		assert_eq!(sniff_media_mime(b"RIFF\x00\x00\x00\x00WAVE", "audio/wav"), Some("audio/wav"));
		// A WebP is a RIFF too, and it is not media — `media_mismatch` catches
		// it before this ever runs, but the sniffer must not claim it either.
		assert_eq!(sniff_media_mime(b"RIFF\x00\x00\x00\x00WEBP", "video/x-msvideo"), None);
	}

	#[test]
	fn an_unrecognised_container_still_plays() {
		// The whole point of the looser bargain: bytes we cannot name, with a
		// NUL so they are not text, get the extension's type and reach the
		// element rather than the binary card.
		let dir = tempdir().unwrap();
		let mut bytes = vec![0x00; 8];
		bytes.extend_from_slice(b"something we have never heard of");
		let path = write_bytes(dir.path(), "recording.wmv", &bytes);

		let probe = probe_media(&path).expect("probe");

		assert_eq!(probe.mime, "video/x-ms-wmv");
		assert_eq!(probe.kind, MediaKind::Video);
	}

	#[test]
	fn a_positive_mismatch_is_refused_to_the_binary_card() {
		let dir = tempdir().unwrap();
		for (name, bytes) in [
			("clip.mp4", TINY_PNG),
			("clip.mkv", b"%PDF-1.7\x00 not a movie".as_slice()),
			("clip.webm", b"PK\x03\x04\x00\x00 archive".as_slice()),
			("song.mp3", b"#!/bin/sh\necho not a song\n".as_slice()),
		] {
			let path = write_bytes(dir.path(), name, bytes);
			assert!(
				matches!(probe_media(&path), Err(AppError::InvalidInput(_))),
				"{name} should have been refused"
			);
		}
	}

	#[test]
	fn typescript_is_never_a_video() {
		// `.ts` is MPEG-TS to the rest of the world and TypeScript here, and
		// this table answers to the projects this app opens.
		let dir = tempdir().unwrap();
		let path = write_bytes(dir.path(), "store.ts", b"export const x = 1;\n");

		assert!(matches!(probe_media(&path), Err(AppError::InvalidInput(_))));
		assert!(media_extension("a/b/store.ts").is_none());
	}

	#[test]
	fn an_empty_file_is_refused_rather_than_handed_over_to_decode() {
		let dir = tempdir().unwrap();
		let path = write_bytes(dir.path(), "empty.mp4", b"");

		assert!(matches!(probe_media(&path), Err(AppError::InvalidInput(_))));
	}

	#[test]
	fn a_missing_video_is_not_found_rather_than_invalid() {
		let dir = tempdir().unwrap();
		let path = dir.path().join("gone.mp4");

		assert!(matches!(probe_media(path.to_str().unwrap()), Err(AppError::NotFound(_))));
	}
}
