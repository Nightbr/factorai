//! The half of F27 that only a real `sops` can answer: does a file this
//! machine's `sops` produced come back as the plaintext it was made from, and
//! do its failures classify into sentences a reader can act on.
//!
//! **Skipped, loudly, where there is no `sops`.** CI has none — see
//! `.github/workflows/quality.yml`, which runs `cargo test` on a runner with no
//! secrets tooling — so these print why they did nothing rather than failing on
//! a machine that was never going to pass them. The unit tests in
//! `services::sops` cover everything that does not need the binary.
//!
//! **The environment is shared, so the tests that set it take a lock.** Each
//! case points `SOPS_AGE_KEY_FILE` and `HOME` at a temporary directory, the
//! child inherits them through `child_env`, and cargo runs test functions on
//! parallel threads — without [`ENV`] two of these would overwrite each other's
//! variables and fail intermittently. Within one test the cases are sequenced
//! for the same reason, which is why the first is one function and not five.

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;

use factorai_lib::services::sops;

/// A throwaway age identity, generated for this file and used nowhere else.
///
/// **Committed on purpose.** The alternative is generating one at test time,
/// which needs either `age-keygen` on the machine (a second tool to skip on) or
/// an X25519 implementation as a dependency, to protect a key whose only
/// property is that it decrypts files this test wrote seconds earlier into a
/// temporary directory. Nothing real is ever encrypted to it.
const TEST_AGE_KEY: &str =
	"AGE-SECRET-KEY-18R9MVVHK0D8NGU74WKKXQGRZ032JF99LRJFVQNYCYT7DET5JE34QNANSKF";
const TEST_AGE_RECIPIENT: &str = "age183pmep5vqgx4ld244frt0eaulz8kct2stjj9hau42njhwc44makqlsumed";

/// A second identity, to play the colleague whose key this file was *not*
/// encrypted for. Same reasoning as above.
const OTHER_AGE_KEY: &str =
	"AGE-SECRET-KEY-1ZZ8NJUPA3U0K7V28KJYVLYJ3PRQ2X6CAG5L9J2SE4TE7NECEHPGQJEDRGK";
const OTHER_AGE_RECIPIENT: &str = "age1gznxw8m4q0muj8a4tjrqt0vgm0xnmgrj00ulacm89phfpk22ealq2p40wh";

/// Held for the whole of any test that sets the process environment. See the
/// module note: the variables are process-wide and the threads are not.
static ENV: Mutex<()> = Mutex::new(());

const PLAINTEXT: &str = "api_key: sk-live-abc123\nnested:\n    token: hunter2\n";

#[test]
fn sops_decrypts_what_sops_encrypted_and_says_why_when_it_cannot() {
	let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
	let Some(binary) = sops::find_binary() else {
		eprintln!("skipping: no `sops` on the child PATH — the unit tests cover the rest");
		return;
	};

	let tmp = tempfile::TempDir::new().unwrap();
	let key_file = tmp.path().join("key.txt");
	std::fs::write(&key_file, format!("{TEST_AGE_KEY}\n")).unwrap();
	let other_key_file = tmp.path().join("other.txt");
	std::fs::write(&other_key_file, format!("{OTHER_AGE_KEY}\n")).unwrap();

	// A `HOME` with nothing in it, so the "no key material" case cannot find
	// the developer's own `~/.config/sops/age/keys.txt` and pass by accident.
	let empty_home = tmp.path().join("home");
	std::fs::create_dir(&empty_home).unwrap();

	let encrypted = tmp.path().join("secrets.yaml");
	encrypt_fixture(&binary, &encrypted);

	// The detector and the tool agree about the same file: this is the seam
	// where a false negative would leave Decrypt off a file that needs it.
	let on_disk = std::fs::read_to_string(&encrypted).unwrap();
	assert!(sops::is_encrypted(&on_disk), "the detector should recognise what sops just wrote");
	assert!(on_disk.contains("ENC[AES256_GCM"), "sanity: the fixture is really encrypted");
	assert_eq!(sops::recipients(&on_disk), vec![TEST_AGE_RECIPIENT]);

	// ---- the key that opens it ------------------------------------------------
	set_env(&empty_home, Some(&key_file));
	let plaintext = sops::decrypt(encrypted.to_str().unwrap()).expect("decrypt with the right key");
	assert_eq!(plaintext, PLAINTEXT);

	// ---- a key that does not ---------------------------------------------------
	set_env(&empty_home, Some(&other_key_file));
	let err = sops::decrypt(encrypted.to_str().unwrap()).unwrap_err();
	let message = format!("{err}");
	assert!(
		message.contains("none of your keys can decrypt this file"),
		"expected the not-authorised sentence, got: {message}"
	);
	// The whole point of naming them: "ask whoever holds one of these" is the
	// next step, and only the file knows who they are.
	assert!(message.contains(TEST_AGE_RECIPIENT), "the recipient should be named: {message}");

	// ---- no key material at all ------------------------------------------------
	set_env(&empty_home, None);
	let err = sops::decrypt(encrypted.to_str().unwrap()).unwrap_err();
	let message = format!("{err}");
	assert!(
		message.contains("no key material was found"),
		"expected the no-keys sentence, which has a different fix: {message}"
	);

	// ---- a file somebody hand-edited -------------------------------------------
	// Dropping a line leaves every value decryptable and the MAC wrong, which is
	// exactly what a bad merge does.
	let mangled = tmp.path().join("mangled.yaml");
	let kept: String =
		on_disk.lines().filter(|l| !l.contains("token: ENC[")).collect::<Vec<_>>().join("\n");
	std::fs::write(&mangled, format!("{kept}\n")).unwrap();
	set_env(&empty_home, Some(&key_file));
	let err = sops::decrypt(mangled.to_str().unwrap()).unwrap_err();
	let message = format!("{err}");
	assert!(
		message.contains("MAC does not match"),
		"a mangled file must be refused as such, never silently half-decrypted: {message}"
	);

	// ---- a file that is not encrypted at all -----------------------------------
	let plain = tmp.path().join("plain.yaml");
	std::fs::write(&plain, PLAINTEXT).unwrap();
	let err = sops::decrypt(plain.to_str().unwrap()).unwrap_err();
	assert!(format!("{err}").contains("no longer a SOPS-encrypted file"), "got: {err}");

	// ---- a file that has gone ---------------------------------------------------
	let gone = tmp.path().join("gone.yaml");
	let err = sops::decrypt(gone.to_str().unwrap()).unwrap_err();
	assert!(format!("{err}").contains("could not read"), "got: {err}");
}

/// Write `PLAINTEXT` encrypted to [`TEST_AGE_RECIPIENT`] at `path`.
///
/// Through the real binary rather than from a committed blob: a fixture frozen
/// at one release stops testing the `sops` the developer actually has, which is
/// the only reason this file shells out at all.
fn encrypt_fixture(binary: &Path, path: &Path) {
	let plain = path.with_extension("plain.yaml");
	std::fs::write(&plain, PLAINTEXT).unwrap();
	let out = Command::new(binary)
		.args(["encrypt", "--age", TEST_AGE_RECIPIENT])
		.arg(&plain)
		.stdin(Stdio::null())
		.output()
		.expect("run sops encrypt");
	assert!(out.status.success(), "sops encrypt failed: {}", String::from_utf8_lossy(&out.stderr));
	std::fs::write(path, out.stdout).unwrap();
	std::fs::remove_file(&plain).unwrap();
}

/// Point `sops` at one identity file, or at none.
///
/// The child inherits this process's environment through `child_env`, so
/// setting it here is how a test chooses which keys exist. `SOPS_AGE_KEY` is
/// cleared alongside the file: a developer running this with one exported would
/// otherwise decrypt the "no key material" case successfully.
fn set_env(home: &Path, key_file: Option<&Path>) {
	std::env::set_var("HOME", home);
	std::env::remove_var("SOPS_AGE_KEY");
	std::env::remove_var("SOPS_AGE_KEY_CMD");
	match key_file {
		Some(path) => std::env::set_var("SOPS_AGE_KEY_FILE", path),
		None => std::env::remove_var("SOPS_AGE_KEY_FILE"),
	}
}

/// The property ADR-0045 exists for: a file encrypted for **two** recipients,
/// re-encrypted through the viewer, is still encrypted for both — even though
/// the `.sops.yaml` beside it names only one.
///
/// This is the whole difference between the two ways of re-encrypting an
/// existing file. Deriving the key set from the configuration produces a file
/// the second holder can no longer open, and nothing in the save says so.
#[test]
fn saving_keeps_the_recipients_the_file_had_not_the_ones_config_would_pick() {
	let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
	let Some(binary) = sops::find_binary() else {
		eprintln!("skipping: no `sops` on the child PATH");
		return;
	};

	let tmp = tempfile::TempDir::new().unwrap();
	let key_file = tmp.path().join("key.txt");
	std::fs::write(&key_file, format!("{TEST_AGE_KEY}\n")).unwrap();
	let home = tmp.path().join("home");
	std::fs::create_dir(&home).unwrap();
	set_env(&home, Some(&key_file));

	// A config that knows about one of the two holders, which is the ordinary
	// state of a repository where somebody was added to a file directly.
	std::fs::write(
		tmp.path().join(".sops.yaml"),
		format!("creation_rules:\n  - path_regex: .*\n    age: {TEST_AGE_RECIPIENT}\n"),
	)
	.unwrap();

	let path = tmp.path().join("secrets.yaml");
	let plain = tmp.path().join("plain.yaml");
	std::fs::write(&plain, PLAINTEXT).unwrap();
	let out = Command::new(&binary)
		.args(["encrypt", "--age", &format!("{TEST_AGE_RECIPIENT},{OTHER_AGE_RECIPIENT}")])
		.arg(&plain)
		.stdin(Stdio::null())
		.output()
		.expect("run sops encrypt");
	assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
	std::fs::write(&path, out.stdout).unwrap();
	std::fs::remove_file(&plain).unwrap();
	// `0600`, which is what a secrets file is, and what the write has to keep.
	std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();

	let edited = "api_key: sk-live-rotated\nnested:\n    token: hunter3\n";
	let written = sops::encrypt(path.to_str().unwrap(), edited).expect("encrypt and save");

	// What is on disk is the ciphertext, and the viewer is told so.
	assert!(written.sops_encrypted);
	let on_disk = std::fs::read_to_string(&path).unwrap();
	assert!(on_disk.contains("ENC[AES256_GCM"));
	assert!(!on_disk.contains("sk-live-rotated"), "the plaintext must not be on disk");

	// Both holders, still. This is the assertion the whole ADR is about.
	let mut after = sops::recipients(&on_disk);
	after.sort();
	let mut expected = vec![TEST_AGE_RECIPIENT.to_string(), OTHER_AGE_RECIPIENT.to_string()];
	expected.sort();
	assert_eq!(after, expected, "re-encrypting must not drop a recipient the file had");

	// The mode survived — `write_file`'s promise, and it matters most here.
	assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);

	// And the round trip is exact: what decrypts is what was typed.
	assert_eq!(sops::decrypt(path.to_str().unwrap()).unwrap(), edited);
}

/// A file whose keys are split into groups cannot be re-made from flags, so the
/// save is refused rather than silently rewriting the key policy.
#[test]
fn a_file_with_key_groups_is_refused_rather_than_flattened() {
	if sops::find_binary().is_none() {
		eprintln!("skipping: no `sops` on the child PATH");
		return;
	}
	let tmp = tempfile::TempDir::new().unwrap();
	let path = tmp.path().join("grouped.yaml");
	// The metadata shape `sops` writes for `--shamir-secret-sharing-threshold`,
	// trimmed to what detection and the refusal read.
	std::fs::write(
		&path,
		format!(
			"api_key: ENC[AES256_GCM,data:xx,type:str]\nsops:\n    key_groups:\n        - age:\n            - recipient: {TEST_AGE_RECIPIENT}\n    shamir_threshold: 2\n    age:\n        - recipient: {TEST_AGE_RECIPIENT}\n    mac: ENC[AES256_GCM,data:yy,type:str]\n    version: 3.13.1\n"
		),
	)
	.unwrap();

	let err = sops::encrypt(path.to_str().unwrap(), "api_key: whatever\n").unwrap_err();
	assert!(format!("{err}").contains("key groups"), "got: {err}");
	// Nothing was written over it.
	assert!(std::fs::read_to_string(&path).unwrap().contains("shamir_threshold"));
}
