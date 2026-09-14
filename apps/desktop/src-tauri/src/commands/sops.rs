use crate::error::AppResult;
use crate::models::{FileContents, SopsStatus};
use crate::services::sops;

/// Whether `sops` can be driven at all, for the viewer's Decrypt control (F27).
///
/// Asked **before** the control is pressed, not after: a button that fails on
/// click teaches nothing, while a disabled one carrying "sops 3.8.1 is too old
/// — 3.9 or newer" names the fix. There is no key material in the answer and
/// none is read to produce it.
///
/// Resolved once per run and cached in the service — the probe spawns a process
/// and reads a `PATH` that cost a login shell, and installing `sops` while the
/// app is open is a restart either way.
#[tauri::command]
pub fn sops_status() -> SopsStatus {
	sops::status().clone()
}

/// Decrypt one SOPS file and hand the plaintext to the renderer (F27).
///
/// **The plaintext crosses the bridge and stops there**: it lands in the
/// viewer's buffer, is never written to disk by us, and is excluded from the
/// draft store. `sops` writes it to stdout, so no temp file holds it either.
///
/// Errors arrive classified — "none of your keys open this", "no key material
/// on this machine", "the MAC does not match" — with `sops`'s own words kept
/// on the end rather than swallowed. See `services::sops::failure`.
#[tauri::command]
pub fn sops_decrypt(path: String) -> AppResult<String> {
	sops::decrypt(&path)
}

/// Encrypt the viewer's plaintext buffer and write it over the file (F27).
///
/// **The recipients come from the file being replaced, not from `.sops.yaml`**
/// (ADR-0045), and the result is checked against them before anything is
/// written — a save that would change who can open the file is refused rather
/// than performed.
///
/// Answers with the encrypted file as written, the way `write_file` does and
/// for the same reason: the renderer's cached read is stale the instant this
/// returns, and re-reading would cost a second pass over bytes we just held.
#[tauri::command]
pub fn sops_encrypt(path: String, plaintext: String) -> AppResult<FileContents> {
	sops::encrypt(&path, &plaintext)
}
