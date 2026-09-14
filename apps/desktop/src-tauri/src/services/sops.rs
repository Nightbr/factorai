//! SOPS-encrypted files: recognising one, and finding the `sops` that can open
//! it (specs/05-features.md F27).
//!
//! Two questions live here, and they are deliberately in one module rather than
//! spread across `files.rs` and a command:
//!
//! - **Is this file encrypted?** Answered from its own bytes, with no `sops`
//!   process and no key material, because it is asked on every read the viewer
//!   performs. This is the half `FileContents` carries.
//! - **Can we run `sops` at all?** Answered once, from the resolved child
//!   `PATH`, so the control in the footer can say *why* it is disabled instead
//!   of failing at click time.
//!
//! Nothing here reads a key, caches one, or prompts for a passphrase. Key
//! material is the user's: `SOPS_AGE_KEY_FILE`, the GPG agent and the cloud
//! credentials are whatever the child process inherits, and factorai never
//! looks at any of it.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use crate::error::{AppError, AppResult};
use crate::models::{FileContents, SopsStatus};
use crate::services::shell_path;

/// The oldest `sops` this feature can drive.
///
/// 3.9.0 is where `sops encrypt` and `sops decrypt` became subcommands. Every
/// call we make is written against them rather than against the older `-e` /
/// `-d` flags, which are deprecated and whose stdin handling differs — one
/// spelling, checked once, beats two code paths chosen from a version string.
pub const MIN_VERSION: (u32, u32, u32) = (3, 9, 0);

/// Resolved once per run. The probe spawns a process and reads a `PATH` that
/// itself cost a login shell, and the answer only changes when the user
/// installs something — which is a restart either way.
static STATUS: OnceLock<SopsStatus> = OnceLock::new();

/// Whether `sops` is usable, and what to say when it is not.
pub fn status() -> &'static SopsStatus {
	STATUS.get_or_init(probe)
}

fn probe() -> SopsStatus {
	let Some(binary) = find_binary() else {
		return SopsStatus { usable: false, binary_path: None, version: None, too_old: false };
	};
	let binary_path = Some(binary.to_string_lossy().into_owned());
	let version = version_of(&binary);
	let too_old = version.as_deref().and_then(parse_version).is_some_and(|v| v < MIN_VERSION);
	SopsStatus { usable: version.is_some() && !too_old, binary_path, version, too_old }
}

/// The `sops` on the **child** `PATH`, not on ours.
///
/// A GUI process has launchd's or the session manager's environment, and a
/// `sops` installed by Homebrew, mise or `go install` is on none of it — this
/// is precisely what [`shell_path`] exists for. Walking the entries ourselves
/// rather than shelling out to `which` keeps this free enough to call from a
/// command: the `PATH` was already resolved for the first terminal.
pub fn find_binary() -> Option<PathBuf> {
	std::env::split_paths(shell_path::child_path())
		.map(|dir| dir.join("sops"))
		.find(|candidate| is_executable(candidate))
}

#[cfg(unix)]
fn is_executable(path: &std::path::Path) -> bool {
	use std::os::unix::fs::PermissionsExt;
	std::fs::metadata(path).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

/// `sops --version`, with the release check off.
///
/// `--disable-version-check` is not a nicety: without it `sops --version`
/// reaches GitHub to see whether a newer release exists, which would make
/// opening a file in the viewer a network call the user did not ask for and
/// cannot see (PRODUCT.md — no telemetry, and nothing phones home).
fn version_of(binary: &std::path::Path) -> Option<String> {
	let mut cmd = Command::new(binary);
	cmd.args(["--version", "--disable-version-check"])
		.stdin(Stdio::null())
		.stdout(Stdio::piped())
		.stderr(Stdio::null());
	// The same environment every other child gets: under an AppImage ours
	// carries a `LD_LIBRARY_PATH` into a squashfs mount, and a Go binary that
	// picks up our libraries is a failure that looks like a missing install.
	crate::services::child_env::changes_for_current_env().apply_to_command(&mut cmd);

	let out = cmd.output().ok()?;
	if !out.status.success() {
		return None;
	}
	parse_version_line(&String::from_utf8_lossy(&out.stdout))
}

/// `sops 3.13.1` → `3.13.1`. The line can carry a build suffix
/// (`3.9.0 (latest)`), so the version is the second whitespace-separated word
/// and nothing else.
fn parse_version_line(stdout: &str) -> Option<String> {
	let first = stdout.lines().find(|l| !l.trim().is_empty())?;
	let word = first.split_whitespace().nth(1)?;
	parse_version(word)?;
	Some(word.to_string())
}

/// `3.13.1` → `(3, 13, 1)`. `None` for anything that is not three numbers, so a
/// version we cannot read is reported as unknown rather than as too old.
fn parse_version(version: &str) -> Option<(u32, u32, u32)> {
	let mut parts = version.split('.');
	let major = parts.next()?.parse().ok()?;
	let minor = parts.next()?.parse().ok()?;
	// A patch with a suffix (`1-rc1`) still has a leading number worth reading.
	let patch_word = parts.next().unwrap_or("0");
	let digits: String = patch_word.chars().take_while(char::is_ascii_digit).collect();
	let patch = digits.parse().unwrap_or(0);
	Some((major, minor, patch))
}

/// Decrypt `path` and hand back the plaintext (F27).
///
/// **To memory, never to disk.** `sops decrypt` writes the plaintext to stdout
/// and we keep it in this `String` all the way to the renderer's buffer; no
/// temp file exists at any point for something to leak it. The only file this
/// feature ever writes is the ciphertext.
///
/// The child inherits the user's environment — `SOPS_AGE_KEY_FILE`, the GPG
/// agent socket, cloud credentials — because that is where every key lives.
/// Nothing here reads, copies or caches one.
pub fn decrypt(path: &str) -> AppResult<String> {
	let binary = usable_binary()?;

	let mut cmd = Command::new(&binary);
	// `decrypt` as a subcommand rather than `-d`: it is the spelling 3.9
	// introduced and the one `MIN_VERSION` guarantees, and it leaves no room
	// for a path that starts with a dash to be read as a flag.
	cmd.arg("decrypt").arg(path).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
	crate::services::child_env::changes_for_current_env().apply_to_command(&mut cmd);

	let out = cmd
		.output()
		.map_err(|e| AppError::Process(format!("could not run {}: {e}", binary.display())))?;

	if !out.status.success() {
		return Err(failure(out.status.code(), &String::from_utf8_lossy(&out.stderr), path));
	}

	// **`from_utf8`, not `from_utf8_lossy`.** A `binary`-format file can hold
	// anything, and the lossy version would put U+FFFD where a byte was and
	// hand the editor a buffer that re-encrypts to a different file. Refusing
	// is the only answer that cannot corrupt a secret.
	String::from_utf8(out.stdout).map_err(|_| {
		AppError::InvalidInput(
			"this file decrypts to bytes that are not text, so it cannot be edited here".into(),
		)
	})
}

/// Encrypt `plaintext` and write it over `path`, answering with the file as
/// written (F27 § "Encrypting on save", ADR-0045).
///
/// **The recipients come from the file being replaced, never from
/// `.sops.yaml`.** That is the whole of ADR-0045: the configuration says who
/// *new* files are encrypted for, and re-deriving an existing file's key set
/// from it drops anybody who was added to the file and not to the config —
/// silently, and in the direction that locks a colleague out of a secret.
///
/// **Plaintext goes in on stdin and the ciphertext comes back on stdout.** No
/// temp file holds a secret at any point; the only write is
/// [`super::files::write_file`], which is atomic, follows a symlink to its
/// target and keeps the original's permission bits — the last of those matters
/// more here than anywhere else in the app, since this file is the one that is
/// probably `0600`.
pub fn encrypt(path: &str, plaintext: &str) -> AppResult<FileContents> {
	let binary = usable_binary()?;

	// What is on disk now, which is what decides how the replacement is made.
	let current = std::fs::read_to_string(path)
		.map_err(|e| AppError::Io(format!("could not read {path}: {e}")))?;
	if !is_encrypted(&current) {
		return Err(AppError::InvalidInput(
			"this file is no longer a SOPS-encrypted file, so there is nothing to re-encrypt it for"
				.into(),
		));
	}
	let recipe = Recipe::read(&current)?;

	let mut cmd = Command::new(&binary);
	cmd.arg("encrypt");
	for (flag, value) in recipe.flags() {
		cmd.arg(flag).arg(value);
	}
	// **`--filename-override`, so the output format is the input's.** `sops`
	// decides YAML / JSON / dotenv / INI from the filename, and the thing on the
	// command line is `/dev/stdin`, which tells it nothing. The original path
	// tells it exactly what the file it is replacing was.
	cmd.arg("--filename-override").arg(path).arg("/dev/stdin");
	cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
	crate::services::child_env::changes_for_current_env().apply_to_command(&mut cmd);

	let mut child = cmd
		.spawn()
		.map_err(|e| AppError::Process(format!("could not run {}: {e}", binary.display())))?;
	{
		let stdin =
			child.stdin.as_mut().ok_or_else(|| AppError::Process("sops took no stdin".into()))?;
		stdin
			.write_all(plaintext.as_bytes())
			.map_err(|e| AppError::Process(format!("could not send the plaintext to sops: {e}")))?;
	}
	let out = child
		.wait_with_output()
		.map_err(|e| AppError::Process(format!("sops did not finish: {e}")))?;

	if !out.status.success() {
		return Err(failure(out.status.code(), &String::from_utf8_lossy(&out.stderr), path));
	}
	let ciphertext = String::from_utf8(out.stdout)
		.map_err(|_| AppError::Process("sops produced output that is not text".into()))?;

	// **Checked before it is written, not asserted in a comment.** The flags
	// above are this module's reconstruction of the file's key set, and a
	// backend whose metadata we read wrongly would produce a file somebody can
	// no longer open — the one failure in this feature that is discovered by
	// the person who lost access, days later. Comparing what came back against
	// what went in costs one scan and makes the reconstruction verifiable
	// rather than trusted.
	let before = key_identifiers(&current);
	let after = key_identifiers(&ciphertext);
	// **Both halves, because they miss different things.** The identifiers catch
	// a recipient dropped from a backend we understand; the backend names catch a
	// whole backend we failed to rebuild a flag for — an Azure entry whose three
	// metadata fields did not parse contributes no identifier to *either* side,
	// so it would vanish with the sets still equal.
	if before != after || backends(&current) != backends(&ciphertext) {
		return Err(AppError::InvalidInput(format!(
			"refusing to save: re-encrypting this file would change who can open it ({} keys before, \
			 {} after). Re-encrypt it with sops itself.",
			before.len(),
			after.len()
		)));
	}

	super::files::write_file(path, &ciphertext)
}

/// How to re-make one file: who it is for, and which keys of it are encrypted.
///
/// Read from the file's own `sops` block rather than from `.sops.yaml`
/// (ADR-0045). Every field here is something `sops encrypt` takes as a flag,
/// which is what makes "re-encrypt this file as it was" expressible without a
/// temp file.
#[derive(Debug, Default, PartialEq, Eq)]
struct Recipe {
	/// One entry per backend, in `sops encrypt`'s own flag spelling.
	keys: Vec<(&'static str, String)>,
	/// Which keys of the document are encrypted — the metadata carries exactly
	/// one of these, or none, and passing two is an error in `sops`.
	shape: Option<(&'static str, String)>,
}

impl Recipe {
	fn read(text: &str) -> AppResult<Self> {
		// **Key groups are refused, not approximated.** A file split across
		// groups with a Shamir threshold cannot be expressed in `sops encrypt`'s
		// flags at all — they describe one flat set — so re-encrypting it here
		// would quietly produce a file with a different, weaker key policy.
		if has_key_groups(text) {
			return Err(AppError::InvalidInput(
				"this file uses sops key groups, which cannot be reproduced from the command line \
				 — edit it with `sops` itself"
					.into(),
			));
		}

		let mut keys: Vec<(&'static str, String)> = Vec::new();
		for (flag, values) in [
			("--age", collect(text, &["recipient"])),
			("--pgp", collect(text, &["fp"])),
			("--kms", collect(text, &["arn"])),
			("--gcp-kms", collect(text, &["resource_id"])),
			("--azure-kv", azure_urls(text)),
			("--hc-vault-transit", vault_uris(text)),
		] {
			if !values.is_empty() {
				keys.push((flag, values.join(",")));
			}
		}
		if keys.is_empty() {
			return Err(AppError::InvalidInput(
				"this file's metadata names no key this build knows how to encrypt for".into(),
			));
		}

		// Whichever one the file carries. `sops` writes the one in effect and no
		// others, and rejects two at once — so this is one option, not a set.
		let shape = [
			("--encrypted-regex", "encrypted_regex"),
			("--unencrypted-regex", "unencrypted_regex"),
			("--encrypted-suffix", "encrypted_suffix"),
			("--unencrypted-suffix", "unencrypted_suffix"),
		]
		.iter()
		.find_map(|(flag, key)| value_of(text, key).map(|v| (*flag, v)));

		Ok(Recipe { keys, shape })
	}

	fn flags(&self) -> Vec<(&'static str, String)> {
		let mut flags = self.keys.clone();
		if let Some(shape) = &self.shape {
			flags.push(shape.clone());
		}
		flags
	}
}

/// A file whose keys are split into groups with a Shamir threshold. Detected by
/// name in any of the four formats, since it is a refusal either way.
fn has_key_groups(text: &str) -> bool {
	scan(text).any(|(key, value)| {
		key == "key_groups" || (key == "shamir_threshold" && value != "0" && !value.is_empty())
	})
}

/// Every value in the metadata under any of `wanted`, in the order they appear
/// and without duplicates.
fn collect(text: &str, wanted: &[&str]) -> Vec<String> {
	let mut found: Vec<String> = Vec::new();
	for (key, value) in scan(text) {
		if wanted.iter().any(|w| matches_key(&key, w))
			&& !value.is_empty()
			&& !found.contains(&value)
		{
			found.push(value);
		}
	}
	found
}

/// The single value of `key`, for the metadata's one-of-four shape setting.
fn value_of(text: &str, key: &str) -> Option<String> {
	scan(text).find(|(k, _)| matches_key(k, key)).map(|(_, v)| v)
}

/// Azure's flag takes the key's full URL; the metadata stores it in three
/// pieces. Reconstructed in the order the list gives them, which is the order
/// the three keys appear in each entry.
///
/// **Read from that backend's own block**, not from the whole metadata: two of
/// the three fields are called `name` and `version`, which are also the names of
/// `hc_vault`'s `key_name` and of the `version` SOPS stamps on every file. The
/// first version of this took the file's `version: 3.13.1` for the key's.
fn azure_urls(text: &str) -> Vec<String> {
	let block = backend_block(text, "azure_kv");
	triples(&block, "vault_url", "name", "version")
		.into_iter()
		.map(|(vault, name, version)| {
			format!("{}/keys/{name}/{version}", vault.trim_end_matches('/'))
		})
		.collect()
}

/// Vault's flag takes the transit key's URI, stored as three pieces too. Scoped
/// to its own block for the reason [`azure_urls`] is.
fn vault_uris(text: &str) -> Vec<String> {
	let block = backend_block(text, "hc_vault");
	triples(&block, "vault_address", "engine_path", "key_name")
		.into_iter()
		.map(|(address, engine, key)| {
			format!("{}/v1/{engine}/keys/{key}", address.trim_end_matches('/'))
		})
		.collect()
}

/// Just the metadata lines belonging to one backend.
///
/// Two shapes, because the four formats are two shapes: nested under a
/// `backend:` key, where the block is the lines indented under it; or flattened
/// into `…backend__list_0__map_field` keys, where the block is the lines whose
/// key carries that prefix.
fn backend_block(text: &str, backend: &str) -> String {
	let flattened: Vec<&str> =
		text.lines().filter(|line| line.contains(&format!("{backend}__"))).collect();
	if !flattened.is_empty() {
		return flattened.join("\n");
	}

	let mut lines = text.lines();
	let Some(header) = lines.find(|line| {
		line.trim_start().trim_start_matches('"').starts_with(&format!("{backend}\""))
			|| line.trim() == format!("{backend}:")
	}) else {
		return String::new();
	};
	let depth = header.len() - header.trim_start().len();
	lines
		.take_while(|line| line.trim().is_empty() || line.len() - line.trim_start().len() > depth)
		.collect::<Vec<_>>()
		.join("\n")
}

/// The entries of a list whose items carry three named fields, in order.
///
/// A new entry starts whenever the first field is seen again, which is how the
/// list's shape survives the line scan: SOPS writes each entry's fields
/// together, and the first of them is what separates one from the next.
fn triples(text: &str, first: &str, second: &str, third: &str) -> Vec<(String, String, String)> {
	let mut entries: Vec<(String, String, String)> = Vec::new();
	for (key, value) in scan(text) {
		if matches_key(&key, first) {
			entries.push((value, String::new(), String::new()));
		} else if let Some(last) = entries.last_mut() {
			if matches_key(&key, second) {
				last.1 = value;
			} else if matches_key(&key, third) {
				last.2 = value;
			}
		}
	}
	entries.retain(|(a, b, c)| !a.is_empty() && !b.is_empty() && !c.is_empty());
	entries
}

/// Who a file is encrypted for, as one sorted set, for comparing the file
/// written against the file replaced.
///
/// Sorted and deduplicated on purpose: `sops` is free to order a rewritten
/// file's key list however it likes, and a comparison that called that a change
/// would refuse every save on a file with two recipients.
fn key_identifiers(text: &str) -> std::collections::BTreeSet<String> {
	let mut ids: std::collections::BTreeSet<String> =
		collect(text, IDENTIFIER_KEYS).into_iter().collect();
	ids.extend(azure_urls(text));
	ids.extend(vault_uris(text));
	ids
}

/// The one field per backend that names *which* key, rather than describing it.
const IDENTIFIER_KEYS: &[&str] = &["recipient", "fp", "arn", "resource_id"];

/// Which backends a file's metadata names at all — `age`, `pgp`, `kms`, … .
///
/// Coarser than [`key_identifiers`] and not a substitute for it: this says
/// *that* a backend is there, which is the half a failed reconstruction would
/// lose without changing any identifier.
fn backends(text: &str) -> std::collections::BTreeSet<&'static str> {
	let keys: Vec<String> = scan(text).map(|(key, _)| key).collect();
	KEY_SOURCES
		.iter()
		.copied()
		.filter(|src| {
			keys.iter().any(|key| {
				key == src
					|| key.starts_with(&format!("{src}__"))
					|| key.starts_with(&format!("sops_{src}__"))
			})
		})
		.collect()
}

/// Whether a metadata line's key is `want`, in any of the four spellings.
///
/// YAML and JSON write the bare name; dotenv and INI flatten the block and
/// suffix it (`sops_age__list_0__map_recipient`, `age__list_0__map_recipient`),
/// so the tail is what identifies the field.
fn matches_key(key: &str, want: &str) -> bool {
	key == want || key.ends_with(&format!("_{want}"))
}

/// Every `key: value` / `key=value` line of the text, normalised.
///
/// The same line scan `is_encrypted` uses, and for the same reason: four
/// formats spell this block four ways and all four put a plain identifier after
/// a separator. Quotes, list dashes and trailing commas are stripped so JSON
/// and YAML produce the same pair.
fn scan(text: &str) -> impl Iterator<Item = (String, String)> + '_ {
	text.lines().filter_map(|line| {
		let (key, value) = line.split_once(&[':', '='][..])?;
		let key = key.trim().trim_start_matches("- ").trim().trim_matches('"').to_string();
		let value =
			value.trim().trim_end_matches(',').trim().trim_matches(['"', '\'']).trim().to_string();
		Some((key, value))
	})
}

/// The `sops` to run, or the one message that says why there is not one.
///
/// The control in the footer is disabled in exactly these cases, so reaching
/// this error means something raced — an uninstall, or a call that did not go
/// through the UI. Still worth a sentence rather than a panic.
fn usable_binary() -> AppResult<PathBuf> {
	let status = status();
	if let Some(version) = status.version.as_deref() {
		if status.too_old {
			let (major, minor, patch) = MIN_VERSION;
			return Err(AppError::Process(format!(
				"sops {version} is too old — {major}.{minor}.{patch} or newer is needed"
			)));
		}
	}
	match (&status.binary_path, status.usable) {
		(Some(path), true) => Ok(PathBuf::from(path)),
		(Some(path), false) => {
			Err(AppError::Process(format!("{path} did not answer `sops --version`")))
		}
		(None, _) => Err(AppError::NotFound(
			"sops is not installed, or is not on the PATH your shell uses".into(),
		)),
	}
}

/// What `sops` failing means, in a sentence (F27 § "Errors, forwarded and
/// readable").
///
/// **The exit code classifies, the text informs.** `sops` has documented codes
/// for exactly the cases that have a human meaning, and they do not move
/// between releases the way its prose does; matching the prose alone would
/// break on the next release that rewords a message. Where the code is not
/// specific enough — every key backend fails with the same 128 — the stderr
/// separates "you hold no keys at all" from "you hold keys, none of them
/// opens this file", which are different problems with different fixes.
///
/// Anything unclassified is forwarded **verbatim**. A KMS refusal carries the
/// provider's own wording and a request id, and paraphrasing it would throw
/// away the half that is actionable.
fn failure(code: Option<i32>, stderr: &str, path: &str) -> AppError {
	match code {
		// The MAC no longer matches the contents: hand-edited, badly merged, or
		// truncated by something. Refuse, and say so — this is the one failure
		// where offering to write anything back would make it worse.
		Some(51) => AppError::InvalidInput(format!(
			"this file's MAC does not match its contents — it was edited or merged outside sops, 			 and decrypting it would not give back what was encrypted. {}",
			verbatim(stderr)
		)),
		Some(52) => AppError::InvalidInput(
			"this file has no MAC, so sops cannot tell whether it is intact".into(),
		),
		Some(24 | 25) => AppError::InvalidInput(format!(
			"sops could not decrypt this file's contents — the ciphertext does not match its 			 metadata. {}",
			verbatim(stderr)
		)),
		// Every key backend reports the same code, so the text decides which of
		// the two problems it is.
		Some(128 | 111) => key_failure(stderr, path),
		// `sops metadata not found`: the file is not encrypted after all. The
		// viewer only offers Decrypt on a file detection flagged, so this means
		// the file changed under us.
		Some(1) if stderr.contains("metadata not found") => {
			AppError::InvalidInput("this file is no longer a SOPS-encrypted file".into())
		}
		Some(2 | 100) => AppError::NotFound(format!("sops could not read {path}")),
		_ => AppError::Process(verbatim(stderr)),
	}
}

/// "None of your keys open this" and "you have no keys" are different
/// sentences, because they have different fixes: the first is a person to ask,
/// the second is a key to configure.
///
/// The recipients are named in the first case for exactly that reason — "ask
/// whoever holds one of these" is the actual next step, and the file itself
/// says who they are.
fn key_failure(stderr: &str, path: &str) -> AppError {
	// A cloud backend's refusal — an expired session, the wrong profile, no
	// network — is forwarded whole. We cannot improve on AWS's wording and
	// paraphrasing it loses the request id.
	if CLOUD_MARKERS.iter().any(|m| stderr.contains(m)) {
		return AppError::Process(format!(
			"sops could not reach a key service. {}",
			verbatim(stderr)
		));
	}

	if NO_KEY_MARKERS.iter().any(|m| stderr.contains(m)) {
		return AppError::Process(format!(
			"no key material was found on this machine — set SOPS_AGE_KEY_FILE, unlock your GPG \
			 agent, or sign in to the provider this file was encrypted for. {}",
			verbatim(stderr)
		));
	}

	let holders = std::fs::read_to_string(path).map(|text| recipients(&text)).unwrap_or_default();
	let named = if holders.is_empty() {
		String::new()
	} else {
		format!(" It is encrypted for {}.", holders.join(", "))
	};
	AppError::Process(format!(
		"none of your keys can decrypt this file.{named} Ask someone who holds one of them. {}",
		verbatim(stderr)
	))
}

/// Stderr from a backend that could not be *reached*, as opposed to one that
/// answered no. Matched on the provider's own words, since the exit code is
/// the same 128 for all of them.
const CLOUD_MARKERS: &[&str] = &[
	"AccessDenied",
	"ExpiredToken",
	"ExpiredTokenException",
	"InvalidClientTokenId",
	"UnrecognizedClientException",
	"could not decrypt data key with AWS KMS",
	"Cannot create GCP KMS service",
	"failed to encrypt or decrypt via Azure",
	"no such host",
	"context deadline exceeded",
];

/// Stderr that means there is no key **at all**, rather than none that fits.
/// `sops` says so by listing where it looked and finding nothing.
const NO_KEY_MARKERS: &[&str] = &[
	"failed to load age identities",
	"no identity found",
	"could not find key",
	"no keys found",
	"gpg-agent",
];

/// Who a file is encrypted for, as the metadata names them — age recipients,
/// PGP fingerprints, KMS ARNs (F27).
///
/// Read from the file rather than from `sops`, which has already failed by the
/// time this is wanted. Truncated to a handful: a file encrypted for a whole
/// team should not turn a one-line failure into a paragraph, and the count says
/// what was left out.
pub fn recipients(text: &str) -> Vec<String> {
	const SHOWN: usize = 4;
	let mut found = key_identifiers(text).into_iter().collect::<Vec<_>>();
	if found.len() > SHOWN {
		let rest = found.len() - SHOWN;
		found.truncate(SHOWN);
		found.push(format!("and {rest} more"));
	}
	found
}

/// `sops`'s own words, collapsed onto one line so they fit a banner.
///
/// Kept rather than swallowed: the classified sentence above says what kind of
/// failure this is, and this says what the tool actually reported. Trimmed to
/// a length a banner can hold — the full text is in the log if it is ever
/// needed, and a message nobody can read is not better than a short one.
fn verbatim(stderr: &str) -> String {
	const MAX: usize = 400;
	let collapsed = stderr.split_whitespace().collect::<Vec<_>>().join(" ");
	let collapsed = collapsed.trim_start_matches("| ").trim().to_string();
	if collapsed.chars().count() <= MAX {
		return collapsed;
	}
	let cut: String = collapsed.chars().take(MAX).collect();
	format!("{cut}…")
}

/// Whether this text is a SOPS-encrypted file (F27 § "Detection").
///
/// **A parse of the file's own structure, never of its name.** `.enc.yaml`,
/// `secrets.yaml` and `.env.production` are conventions; none of them is
/// load-bearing, and a rule built on them would both miss an encrypted
/// `config.yaml` and claim an unencrypted `secrets.yaml`.
///
/// The test is the metadata block SOPS writes beside the ciphertext: a `sops`
/// section carrying **`mac`**, **`version`** and **at least one key source**.
/// All three, because the point is to be wrong in neither direction — a plain
/// YAML file with a top-level `sops:` key of its own is ordinary, and calling
/// it encrypted would make it read-only for no reason.
///
/// Four spellings of the same block, because SOPS writes one per output format:
/// nested under `sops:` in YAML, under `"sops"` in JSON (which is also what the
/// `binary` format produces), flattened to `sops_*` keys in dotenv, and as a
/// `[sops]` section in INI. There is no fifth — a format SOPS cannot write is a
/// file it cannot have encrypted.
pub fn is_encrypted(text: &str) -> bool {
	// JSON first: it is the one format with a real parser to hand, and the
	// `binary` output format is JSON too, so this arm covers both.
	if let Ok(serde_json::Value::Object(root)) = serde_json::from_str::<serde_json::Value>(text) {
		return root.get("sops").and_then(|v| v.as_object()).is_some_and(|block| {
			block.contains_key("mac")
				&& block.contains_key("version")
				&& KEY_SOURCES.iter().any(|k| block.contains_key(*k))
		});
	}
	yaml_block(text) || dotenv_block(text) || ini_block(text)
}

/// The key-source keys SOPS writes, one per backend it can wrap a data key
/// with. A block with none of them is metadata for a file nothing could
/// decrypt, which is to say it is not one of ours.
const KEY_SOURCES: &[&str] = &["age", "pgp", "kms", "gcp_kms", "azure_kv", "hc_vault"];

/// YAML: a `sops:` mapping at column 0, and the indented block under it.
///
/// Scanned rather than parsed — no YAML parser is in the tree, and pulling one
/// in to read four key *names* would be a dependency for a question this
/// answers exactly. The block ends at the first line that is neither blank nor
/// indented, which is what "the children of this key" means in YAML with no
/// tabs — and SOPS emits spaces.
fn yaml_block(text: &str) -> bool {
	let mut lines = text.lines().skip_while(|l| l.trim_end() != "sops:");
	if lines.next().is_none() {
		return false;
	}
	let block = lines.take_while(|l| l.trim().is_empty() || l.starts_with(' '));
	has_all_three(block.filter_map(|l| yaml_key(l)))
}

/// The key a YAML line declares, ignoring its indentation and its value.
/// `    mac: ENC[…]` → `mac`. A list item (`- enc: …`) has no key of its own at
/// this level and is skipped.
fn yaml_key(line: &str) -> Option<&str> {
	let trimmed = line.trim_start();
	if trimmed.starts_with('-') {
		return None;
	}
	trimmed.split_once(':').map(|(key, _)| key.trim())
}

/// dotenv: the block flattened into `sops_`-prefixed keys at the top level.
/// `sops_age__list_0__map_recipient` is the age arm of it, so the source match
/// is on the prefix rather than on the whole key.
fn dotenv_block(text: &str) -> bool {
	let keys = text
		.lines()
		.filter_map(|l| l.split_once('=').map(|(key, _)| key.trim()))
		.filter_map(|key| key.strip_prefix("sops_"));
	has_all_three(keys)
}

/// INI: a `[sops]` section, whose keys are the block's own — `mac`, `version`,
/// `age__list_0__map_recipient`. The section ends at the next `[header]`.
fn ini_block(text: &str) -> bool {
	let mut lines = text.lines().skip_while(|l| l.trim() != "[sops]");
	if lines.next().is_none() {
		return false;
	}
	let section = lines.take_while(|l| !l.trim_start().starts_with('['));
	has_all_three(section.filter_map(|l| l.split_once('=').map(|(key, _)| key.trim())))
}

/// `mac`, `version` and one key source, from whatever spelling of the block the
/// caller unpacked. The key-source test is a prefix match because the flattened
/// formats suffix it (`age__list_0__map_enc`), and because a nested `age:` in
/// YAML arrives as the bare word.
fn has_all_three<'a>(keys: impl Iterator<Item = &'a str>) -> bool {
	let (mut mac, mut version, mut source) = (false, false, false);
	for key in keys {
		mac |= key == "mac";
		version |= key == "version";
		source |= KEY_SOURCES.iter().any(|s| key == *s || key.starts_with(&format!("{s}__")));
	}
	mac && version && source
}

#[cfg(test)]
mod tests {
	use super::*;

	/// The metadata block as SOPS writes it, per format. Trimmed to the keys
	/// detection reads: the ciphertext values are megabytes of base64 in a real
	/// file and none of them is what is being tested.
	const YAML: &str = "api_key: ENC[AES256_GCM,data:C5Lp,iv:xEum,tag:kJrp,type:str]\nsops:\n    age:\n        - recipient: age183pme\n          enc: |\n            -----BEGIN AGE ENCRYPTED FILE-----\n    lastmodified: \"2026-09-14T15:29:16Z\"\n    mac: ENC[AES256_GCM,data:k5c7,iv:Vue/,tag:pk07,type:str]\n    unencrypted_suffix: _unencrypted\n    version: 3.13.1\n";

	const JSON: &str = r#"{
	"api_key": "ENC[AES256_GCM,data:llTG,iv:P9xS,tag:KJp8,type:str]",
	"sops": {
		"age": [{ "recipient": "age183pme", "enc": "-----BEGIN AGE ENCRYPTED FILE-----" }],
		"lastmodified": "2026-09-14T15:29:25Z",
		"mac": "ENC[AES256_GCM,data:tZWT,iv:dOW2,tag:lD9y,type:str]",
		"version": "3.13.1"
	}
}"#;

	/// The `binary` output format: JSON with the whole file under `data`.
	const BINARY: &str = r#"{
	"data": "ENC[AES256_GCM,data:yQPK,iv:GJg4,tag:sEym,type:str]",
	"sops": {
		"age": [{ "recipient": "age183pme", "enc": "-----BEGIN AGE ENCRYPTED FILE-----" }],
		"mac": "ENC[AES256_GCM,data:tZWT,iv:dOW2,tag:lD9y,type:str]",
		"version": "3.13.1"
	}
}"#;

	const DOTENV: &str = "API_KEY=ENC[AES256_GCM,data:Jdtl,iv:byuZ,tag:YI+V,type:str]\nsops_age__list_0__map_recipient=age183pme\nsops_lastmodified=2026-09-14T15:29:25Z\nsops_mac=ENC[AES256_GCM,data:tZWT,iv:dOW2,tag:lD9y,type:str]\nsops_unencrypted_suffix=_unencrypted\nsops_version=3.13.1\n";

	const INI: &str = "[default]\napi_key = ENC[AES256_GCM,data:yjlV,iv:qmhi,tag:WA91,type:str]\n\n[sops]\nage__list_0__map_recipient = age183pme\nlastmodified               = 2026-09-14T15:29:25Z\nmac                        = ENC[AES256_GCM,data:Xo3C,iv:bd8j,tag:p6EE,type:str]\nversion                    = 3.13.1\n";

	#[test]
	fn recognises_every_format_sops_writes() {
		assert!(is_encrypted(YAML), "yaml");
		assert!(is_encrypted(JSON), "json");
		assert!(is_encrypted(BINARY), "binary");
		assert!(is_encrypted(DOTENV), "dotenv");
		assert!(is_encrypted(INI), "ini");
	}

	/// The false positive the three-key rule exists to prevent: an ordinary
	/// file that happens to talk *about* sops.
	#[test]
	fn a_plain_file_with_a_sops_key_is_not_encrypted() {
		let yaml = "sops:\n  enabled: true\n  version: 3.13.1\n";
		assert!(!is_encrypted(yaml), "no mac, no key source");

		let json = r#"{ "sops": { "version": "3.13.1", "mac": "whatever" } }"#;
		assert!(!is_encrypted(json), "no key source");

		let dotenv = "SOPS_AGE_KEY_FILE=/home/me/key.txt\nsops_version=3.13.1\n";
		assert!(!is_encrypted(dotenv), "a variable named after sops is not a block");
	}

	#[test]
	fn plain_text_is_not_encrypted() {
		assert!(!is_encrypted(""));
		assert!(!is_encrypted("api_key: sk-live-abc123\n"));
		assert!(!is_encrypted("{\"api_key\": \"sk-live-abc123\"}"));
	}

	/// A read cut at the cap loses the block, which SOPS writes at the *end* of
	/// every format. Detection says no, which is the safe answer: a truncated
	/// file is already read-only for its own reason, so nothing offers to write
	/// ciphertext back.
	#[test]
	fn a_truncated_read_is_not_claimed_to_be_encrypted() {
		let cut = &YAML[..40];
		assert!(!is_encrypted(cut));
	}

	/// The block is at the end of the file in every format SOPS writes, but a
	/// hand-reordered YAML file is still the same file.
	#[test]
	fn the_yaml_block_is_found_wherever_it_sits() {
		let reordered = "sops:\n    age:\n        - recipient: age183pme\n    mac: ENC[AES256_GCM,data:k5c7]\n    version: 3.13.1\napi_key: ENC[AES256_GCM,data:C5Lp]\n";
		assert!(is_encrypted(reordered));
	}

	/// A nested `sops:` belongs to whatever contains it. Only a mapping at
	/// column 0 is the file's own metadata block.
	#[test]
	fn an_indented_sops_key_is_somebody_elses() {
		let nested = "tools:\n  sops:\n    mac: yes\n    version: 3\n    age: yes\n";
		assert!(!is_encrypted(nested));
	}

	/// The metadata of a file encrypted for two age recipients, with a shape
	/// setting — the shape [`Recipe`] has to reproduce exactly.
	const TWO_RECIPIENTS: &str = "api_key: ENC[AES256_GCM,data:C5Lp,type:str]\nsops:\n    age:\n        - recipient: age1aaa\n          enc: |\n            -----BEGIN AGE ENCRYPTED FILE-----\n        - recipient: age1bbb\n          enc: |\n            -----BEGIN AGE ENCRYPTED FILE-----\n    encrypted_regex: ^(api_key)$\n    mac: ENC[AES256_GCM,data:k5c7,type:str]\n    version: 3.13.1\n";

	#[test]
	fn a_recipe_is_read_from_the_file_rather_than_from_config() {
		let recipe = Recipe::read(TWO_RECIPIENTS).unwrap();
		assert_eq!(recipe.keys, vec![("--age", "age1aaa,age1bbb".to_string())]);
		// The one shape setting the file carries, not a default and not two.
		assert_eq!(recipe.shape, Some(("--encrypted-regex", "^(api_key)$".to_string())));
	}

	#[test]
	fn every_backend_becomes_its_own_flag() {
		let mixed = "sops:\n    kms:\n        - arn: arn:aws:kms:eu-west-1:1234:key/abcd\n    gcp_kms:\n        - resource_id: projects/p/locations/l/keyRings/r/cryptoKeys/k\n    azure_kv:\n        - vault_url: https://vault.vault.azure.net\n          name: thekey\n          version: fa4f\n    hc_vault:\n        - vault_address: https://vault.example.org:8200\n          engine_path: transit\n          key_name: dev\n    pgp:\n        - fp: 85D77543B3D624B63CEA9E6DBC17301B491B3F21\n    mac: ENC[x]\n    version: 3.13.1\n";
		let recipe = Recipe::read(mixed).unwrap();
		assert_eq!(
			recipe.keys,
			vec![
				("--pgp", "85D77543B3D624B63CEA9E6DBC17301B491B3F21".to_string()),
				("--kms", "arn:aws:kms:eu-west-1:1234:key/abcd".to_string()),
				("--gcp-kms", "projects/p/locations/l/keyRings/r/cryptoKeys/k".to_string()),
				// Azure and Vault name a key in three metadata fields and one flag,
				// so the flag is rebuilt from the pieces.
				("--azure-kv", "https://vault.vault.azure.net/keys/thekey/fa4f".to_string()),
				(
					"--hc-vault-transit",
					"https://vault.example.org:8200/v1/transit/keys/dev".to_string()
				),
			]
		);
	}

	#[test]
	fn key_groups_are_refused_rather_than_flattened() {
		let grouped = "sops:\n    key_groups:\n        - age:\n            - recipient: age1aaa\n        - age:\n            - recipient: age1bbb\n    shamir_threshold: 2\n    mac: ENC[x]\n    version: 3.13.1\n";
		let err = Recipe::read(grouped).unwrap_err();
		assert!(format!("{err}").contains("key groups"), "got {err}");
	}

	#[test]
	fn the_key_set_is_compared_as_a_set_so_reordering_is_not_a_change() {
		let reordered = TWO_RECIPIENTS.replace("age1aaa", "age1zzz").replace("age1bbb", "age1aaa");
		let reordered = reordered.replace("age1zzz", "age1bbb");
		assert_eq!(key_identifiers(TWO_RECIPIENTS), key_identifiers(&reordered));
		// …and a recipient actually going missing is one.
		let dropped = TWO_RECIPIENTS.replace("        - recipient: age1bbb\n", "");
		assert_ne!(key_identifiers(TWO_RECIPIENTS), key_identifiers(&dropped));
	}

	#[test]
	fn a_backend_that_vanishes_is_noticed_even_with_no_identifier_to_compare() {
		// The gap the backend comparison closes: an Azure entry we failed to
		// rebuild contributes no identifier to either side.
		let with_azure = "sops:\n    azure_kv:\n        - vault_url: https://v.vault.azure.net\n    mac: ENC[x]\n    version: 3.13.1\n";
		let without = "sops:\n    mac: ENC[x]\n    version: 3.13.1\n";
		assert_eq!(key_identifiers(with_azure), key_identifiers(without));
		assert_ne!(backends(with_azure), backends(without));
	}

	#[test]
	fn version_lines_parse() {
		assert_eq!(parse_version_line("sops 3.13.1\n").as_deref(), Some("3.13.1"));
		assert_eq!(parse_version_line("sops 3.9.0 (latest)\n").as_deref(), Some("3.9.0"));
		// The release check writes its own line; the version is still the first.
		assert_eq!(
			parse_version_line("sops 3.9.0\n[info] a new version is available\n").as_deref(),
			Some("3.9.0")
		);
		assert_eq!(parse_version_line("").as_deref(), None);
		assert_eq!(parse_version_line("not a version line\n").as_deref(), None);
	}

	#[test]
	fn versions_compare_against_the_floor() {
		assert!(parse_version("3.8.1").unwrap() < MIN_VERSION);
		assert!(parse_version("3.9.0").unwrap() >= MIN_VERSION);
		assert!(parse_version("3.13.1").unwrap() >= MIN_VERSION);
		assert!(parse_version("4.0.0").unwrap() >= MIN_VERSION);
		// A patch with a suffix still reads; a word that is not a version does
		// not, and unknown is reported as unknown rather than as too old.
		assert_eq!(parse_version("3.10.0-rc1"), Some((3, 10, 0)));
		assert_eq!(parse_version("nightly"), None);
	}
}
