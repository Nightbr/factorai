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
use crate::models::{FileContents, SopsAwsContext, SopsStatus};
use crate::services::{aws_config, shell_path};

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
///
/// `aws_profile` is the viewer's choice for a file keyed by AWS KMS (F27 §
/// "Choosing the AWS profile"), set as `AWS_PROFILE` on this child and no
/// other. It is a name, not a credential, and it is never written into the file.
pub fn decrypt(path: &str, aws_profile: Option<&str>) -> AppResult<String> {
	let binary = usable_binary()?;

	let mut cmd = Command::new(&binary);
	// `decrypt` as a subcommand rather than `-d`: it is the spelling 3.9
	// introduced and the one `MIN_VERSION` guarantees, and it leaves no room
	// for a path that starts with a dash to be read as a flag.
	cmd.arg("decrypt").arg(path).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
	crate::services::child_env::changes_for_current_env().apply_to_command(&mut cmd);
	set_aws_profile(&mut cmd, aws_profile);

	let out = cmd
		.output()
		.map_err(|e| AppError::Process(format!("could not run {}: {e}", binary.display())))?;

	if !out.status.success() {
		return Err(failure(
			out.status.code(),
			&String::from_utf8_lossy(&out.stderr),
			path,
			aws_profile,
		));
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
///
/// `aws_profile` is the same choice [`decrypt`] takes: a KMS recipient has to
/// be reached to wrap the new data key, so encrypting needs it as much as
/// decrypting does.
pub fn encrypt(path: &str, plaintext: &str, aws_profile: Option<&str>) -> AppResult<FileContents> {
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
	set_aws_profile(&mut cmd, aws_profile);

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
		return Err(failure(
			out.status.code(),
			&String::from_utf8_lossy(&out.stderr),
			path,
			aws_profile,
		));
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
fn failure(code: Option<i32>, stderr: &str, path: &str, aws_profile: Option<&str>) -> AppError {
	// An AWS sign-in problem has a fix we can name, which the provider's own
	// words do not: checked before the codes, since `sops` reports it under
	// whichever code the failing operation happened to have.
	if let Some(err) = aws_failure(stderr, aws_profile) {
		return err;
	}
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

/// Set the viewer's AWS profile on one `sops` child, after the environment it
/// inherits — so the choice wins over an `AWS_PROFILE` the app was started with,
/// which is the point of having made one.
fn set_aws_profile(cmd: &mut Command, aws_profile: Option<&str>) {
	if let Some(profile) = aws_profile.map(str::trim).filter(|p| !p.is_empty()) {
		cmd.env("AWS_PROFILE", profile);
	}
}

/// What the viewer needs to offer an AWS profile for `path`, or `None` when the
/// file has no AWS KMS recipient — and then there is no picker (F27 § "Choosing
/// the AWS profile").
///
/// **Only `kms`.** The other cloud backends have their own metadata keys
/// (`gcp_kms`, `azure_kv`, `hc_vault`) and their own credentials, none of which
/// an AWS profile reaches; a file keyed by age alone has nothing to sign in to.
/// The test is the ARNs, which only `kms` entries carry.
pub fn aws_context(path: &str) -> AppResult<Option<SopsAwsContext>> {
	let text = std::fs::read_to_string(path)
		.map_err(|e| AppError::Io(format!("could not read {path}: {e}")))?;
	Ok(aws_context_for(&text, aws_config::profiles(), aws_config::env_profile()))
}

fn aws_context_for(
	text: &str,
	profiles: Vec<crate::models::AwsProfile>,
	env_profile: Option<String>,
) -> Option<SopsAwsContext> {
	// Both: the backend has to be there, and the ARNs read only from metadata
	// that has one — a plaintext key ending `_arn` is not a recipient.
	if !is_encrypted(text) || !backends(text).contains("kms") {
		return None;
	}
	let arns = collect(text, &["arn"]);
	if arns.is_empty() {
		return None;
	}
	let mut account_ids: Vec<String> = Vec::new();
	for account in arns.iter().filter_map(|arn| aws_config::arn_account(arn)) {
		if !account_ids.contains(&account) {
			account_ids.push(account);
		}
	}
	let matching: Vec<&str> = profiles
		.iter()
		.filter(|p| p.account_id.as_ref().is_some_and(|a| account_ids.contains(a)))
		.map(|p| p.name.as_str())
		.collect();
	// The environment's profile when it is one of the matches — somebody who
	// started the app with it meant it — and otherwise the first by name.
	let suggested = env_profile
		.as_deref()
		.filter(|env| matching.contains(env))
		.or_else(|| matching.first().copied())
		.map(str::to_string);
	let file_profile = collect(text, &["aws_profile"]).into_iter().next();
	Some(SopsAwsContext { profiles, account_ids, suggested, file_profile, env_profile })
}

/// An AWS sign-in failure, said in terms of the fix (F27 § "Choosing the AWS
/// profile").
///
/// Two cases have a next step the SDK's words bury: an IAM Identity Center
/// session that expired or was never started (`aws sso login`), and no
/// credentials at all, which the SDK reports as the last link of its chain —
/// the EC2 instance metadata service, on a laptop that is not an EC2 instance.
/// Everything else from AWS is left to [`key_failure`], which forwards it whole.
fn aws_failure(stderr: &str, aws_profile: Option<&str>) -> Option<AppError> {
	let profile = aws_profile.map(str::trim).filter(|p| !p.is_empty());
	// **Matched on the unwrapped text.** `sops` wraps a backend's error at a
	// fixed width behind `|` gutters, so `operation error ec2imds` arrives as
	// `operation error\n      | ec2imds` and a marker can straddle any break.
	let text = unwrapped(stderr);
	if SSO_MARKERS.iter().any(|m| text.contains(m)) {
		let fix = match profile {
			Some(p) => format!("run `aws sso login --profile {p}`"),
			None => "run `aws sso login` for the profile this file's key belongs to".to_string(),
		};
		return Some(AppError::Process(format!(
			"the AWS sign-in session has expired or was never started — {fix}, then decrypt \
			 again. {}",
			verbatim(stderr)
		)));
	}
	if NO_AWS_CREDENTIALS_MARKERS.iter().any(|m| text.contains(m)) {
		let what = match profile {
			Some(p) => format!("the AWS profile `{p}` has no credentials sops could use"),
			None => "no AWS credentials were found for this file's KMS key — choose the AWS \
			         profile it belongs to"
				.to_string(),
		};
		return Some(AppError::Process(format!("{what}. {}", verbatim(stderr))));
	}
	None
}

/// `sops`'s stderr as one line with its `|` gutters taken out.
fn unwrapped(stderr: &str) -> String {
	stderr.split_whitespace().filter(|word| *word != "|").collect::<Vec<_>>().join(" ")
}

/// Stderr from the AWS SDK when an IAM Identity Center token is missing,
/// expired or refused.
const SSO_MARKERS: &[&str] =
	&["SSO session", "SSO token", "sso/cache", "operation error SSO", "InvalidGrantException"];

/// Stderr from the AWS SDK when its credential chain found nothing and ended at
/// the instance metadata service.
const NO_AWS_CREDENTIALS_MARKERS: &[&str] = &["no EC2 IMDS role found", "operation error ec2imds"];

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

	fn profile(name: &str, account: Option<&str>) -> crate::models::AwsProfile {
		crate::models::AwsProfile {
			name: name.to_string(),
			account_id: account.map(str::to_string),
		}
	}

	const AWS_FILE: &str = "secret: ENC[AES256_GCM,data:x,iv:y,tag:z,type:str]\nsops:\n    kms:\n        - arn: arn:aws:kms:eu-west-3:111111111111:key/abcd\n          created_at: \"2026-01-01T00:00:00Z\"\n          enc: AQICAH\n          aws_profile: \"\"\n    mac: ENC[x]\n    version: 3.13.1\n";

	#[test]
	fn only_a_file_with_an_aws_kms_recipient_gets_a_profile_picker() {
		let age_only = "secret: ENC[x]\nsops:\n    age:\n        - recipient: age1abc\n    mac: ENC[x]\n    version: 3.13.1\n";
		let gcp_only = "secret: ENC[x]\nsops:\n    gcp_kms:\n        - resource_id: projects/p/locations/l/keyRings/r/cryptoKeys/k\n    mac: ENC[x]\n    version: 3.13.1\n";
		// A plaintext key that merely ends in `_arn` is not a recipient.
		let age_with_arn_key = "role_arn: arn:aws:iam::111111111111:role/x\nsops:\n    age:\n        - recipient: age1abc\n    mac: ENC[x]\n    version: 3.13.1\n    unencrypted_suffix: _arn\n";
		let plain = "kms: arn:aws:kms:eu-west-3:111111111111:key/abcd\n";
		for text in [age_only, gcp_only, age_with_arn_key, plain] {
			assert_eq!(aws_context_for(text, vec![], None), None, "{text}");
		}
		assert!(aws_context_for(AWS_FILE, vec![], None).is_some());
	}

	#[test]
	fn a_file_mixing_aws_kms_with_another_backend_still_gets_the_picker() {
		let mixed = "secret: ENC[x]\nsops:\n    kms:\n        - arn: arn:aws:kms:eu-west-1:222222222222:key/abcd\n    age:\n        - recipient: age1abc\n    mac: ENC[x]\n    version: 3.13.1\n";
		let ctx = aws_context_for(mixed, vec![], None).expect("picker");
		assert_eq!(ctx.account_ids, vec!["222222222222".to_string()]);
	}

	#[test]
	fn the_profile_signing_in_to_the_keys_account_is_suggested() {
		let profiles = vec![
			profile("default", None),
			profile("prod", Some("999999999999")),
			profile("staging-admin", Some("111111111111")),
			profile("staging-dev", Some("111111111111")),
		];
		let ctx = aws_context_for(AWS_FILE, profiles.clone(), None).expect("picker");
		assert_eq!(ctx.account_ids, vec!["111111111111".to_string()]);
		assert_eq!(ctx.suggested.as_deref(), Some("staging-admin"));
		assert_eq!(ctx.file_profile, None, "an empty aws_profile names nothing");

		// The environment's own profile wins among the matches, and only there.
		let env = aws_context_for(AWS_FILE, profiles.clone(), Some("staging-dev".into()));
		assert_eq!(env.and_then(|c| c.suggested).as_deref(), Some("staging-dev"));
		let other = aws_context_for(AWS_FILE, profiles, Some("prod".into()));
		assert_eq!(other.and_then(|c| c.suggested).as_deref(), Some("staging-admin"));
	}

	#[test]
	fn a_profile_named_in_the_file_is_reported() {
		let named = AWS_FILE.replace("aws_profile: \"\"", "aws_profile: ci");
		let ctx = aws_context_for(&named, vec![], None).expect("picker");
		assert_eq!(ctx.file_profile.as_deref(), Some("ci"));
	}

	#[test]
	fn an_expired_sso_session_names_the_login_command() {
		let stderr = "Failed to get the data key required to decrypt the SOPS file. Group 0: FAILED arn:aws:kms:eu-west-3:111111111111:key/abcd: FAILED - failed to decrypt sops data key with AWS KMS: operation error KMS: Decrypt, get identity: get credentials: failed to refresh cached credentials, refresh cached SSO token failed, unable to refresh SSO token, operation error SSO OIDC: CreateToken, InvalidGrantException";
		let with = failure(Some(128), stderr, "/nope", Some("staging")).to_string();
		assert!(with.contains("aws sso login --profile staging"), "{with}");
		let without = failure(Some(128), stderr, "/nope", None).to_string();
		assert!(without.contains("aws sso login"), "{without}");
	}

	#[test]
	fn no_credentials_at_all_asks_for_a_profile_instead_of_blaming_imds() {
		let stderr = "Failed to get the data key required to decrypt the SOPS file. Group 0: FAILED arn:aws:kms:eu-west-3:111111111111:key/abcd: FAILED - failed to decrypt sops data key with AWS KMS: operation error KMS: Decrypt, get identity: get credentials: failed to refresh cached credentials, no EC2 IMDS role found, operation error ec2imds: GetMetadata, request canceled";
		let none = failure(Some(128), stderr, "/nope", None).to_string();
		assert!(none.contains("choose the AWS profile"), "{none}");
		let named = failure(Some(128), stderr, "/nope", Some("prod")).to_string();
		assert!(named.contains("`prod` has no credentials"), "{named}");
	}

	/// Captured from sops 3.13 with no credentials anywhere: the wrap splits
	/// `operation error ec2imds` and could as well split any other marker.
	#[test]
	fn markers_are_found_across_the_wrap_sops_puts_in_its_stderr() {
		let imds = "Failed to get the data key required to decrypt the SOPS file.\n\nGroup 0: FAILED\n  arn:aws:kms:eu-west-3:111111111111:key/0000: FAILED\n    - | failed to decrypt sops data key with AWS KMS: operation\n      | error KMS: Decrypt, get identity: get credentials: failed to\n      | refresh cached credentials, no EC2 IMDS\n      | role found, operation error\n      | ec2imds: GetMetadata, request canceled\n";
		let msg = failure(Some(128), imds, "/nope", None).to_string();
		assert!(msg.contains("choose the AWS profile"), "{msg}");

		let sso = "Failed to get the data key required to decrypt the SOPS file.\n\nGroup 0: FAILED\n  arn:aws:kms:eu-west-3:111111111111:key/0000: FAILED\n    - | failed to decrypt sops data key with AWS KMS: operation\n      | error KMS: Decrypt, get identity: get credentials: failed to\n      | refresh cached credentials, failed to read cached SSO\n      | token file, open /home/u/.aws/sso/cache/ee0b.json: no such\n      | file or directory\n";
		let msg = failure(Some(128), sso, "/nope", Some("staging")).to_string();
		assert!(msg.contains("aws sso login --profile staging"), "{msg}");
	}

	#[test]
	fn other_aws_refusals_are_still_forwarded_whole() {
		let stderr = "failed to decrypt sops data key with AWS KMS: could not decrypt data key with AWS KMS: AccessDeniedException: User is not authorized, request id: 1234";
		let msg = failure(Some(128), stderr, "/nope", Some("prod")).to_string();
		assert!(msg.contains("sops could not reach a key service"), "{msg}");
		assert!(msg.contains("request id: 1234"), "{msg}");
	}
}
