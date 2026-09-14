# ADR-0045 — A re-encrypted file keeps its own recipients

**Date.** 2026-09-14
**Status.** Accepted. Decides the open question in roadmap item 53 and is the
contract `specs/05-features.md` F27 § "Encrypting on save" states.

## Context

F27 lets the viewer decrypt a SOPS file, edit the plaintext in memory, and
**encrypt on save**. Encrypting a *new* file is unambiguous: `sops` reads the
creation rules in `.sops.yaml`, matches the path, and uses the keys they name.
Re-encrypting an **existing** file is not, because that file already has a key
set, and the two answers can differ.

They differ in the ordinary case, not a contrived one. A `.sops.yaml` lists the
team's keys; somebody is added to one file directly with
`sops --add-age <recipient> secrets.yaml` — which is how a contractor, a CI
identity, or a colleague on one project gets access without being added to
everything. The file now has two recipients and the configuration names one.

The hard constraint from F27 frames the choice: **plaintext never reaches disk,
an index, or a database.** That rules a candidate out on its own.

Three ways to produce the new ciphertext:

1. **`sops encrypt --filename-override <path>` with plaintext on stdin.** Simple;
   no temp file. The key set comes from the creation rules, so it is whatever
   `.sops.yaml` says today.
2. **Drive `sops edit` with `EDITOR` pointed at a helper** that writes our buffer
   into the file SOPS opens for the editor. SOPS itself re-uses the file's own
   key set, so recipients are preserved exactly.
3. **`sops encrypt` with the key flags built from the file's own metadata**
   (`--age`, `--pgp`, `--kms`, `--gcp-kms`, `--azure-kv`,
   `--hc-vault-transit`), plus `--filename-override <path>` so the output format
   is the input's, plaintext on stdin.

All three were built and run against a file encrypted for two age recipients,
with a `.sops.yaml` beside it naming one:

| | recipients after save | plaintext on disk |
|---|---|---|
| 1 — recipients from `.sops.yaml` | **1 of 2** | never |
| 2 — `sops edit` + `EDITOR` helper | 2 of 2 | **yes** — `/tmp/130949898/edited.yaml`, written by SOPS for the helper to read |
| 3 — recipients from the file | 2 of 2 | never |

Option 1 loses a holder, silently, in the direction that locks a colleague out
of a secret and reports success. Option 2 keeps the key set by putting the
plaintext in a file whose location SOPS chose — which is the constraint, and a
crash between the two writes leaves it there.

## Decision

**Option 3. An existing file's key set is read from that file, never re-derived
from configuration.** `.sops.yaml` decides who *new* files are for; the file
decides who *it* is for.

`services::sops::encrypt` reads the file it is about to replace, builds one flag
per backend the metadata names, reproduces the file's own shape setting
(whichever one of `encrypted_regex` / `unencrypted_regex` / `encrypted_suffix` /
`unencrypted_suffix` it carries — SOPS writes exactly one and rejects two),
passes `--filename-override <path>` so YAML stays YAML and dotenv stays dotenv,
and feeds the plaintext on stdin. The ciphertext comes back on stdout and is
written by `services::files::write_file` — atomic, symlink-resolving, and
permission-preserving, which matters more here than anywhere else in the app
since this file is usually `0600`.

**The result is verified against the original before anything is written.** The
key identifiers are extracted from both the old and the new ciphertext and
compared as sets; if they differ, nothing is written and the save fails with a
sentence. The flags above are this code's *reconstruction* of a key set, and a
backend whose metadata it reads wrongly would produce a file somebody can no
longer open — the one failure in this feature that is discovered days later, by
the person who lost access. A comparison costs one scan and makes the
reconstruction verifiable rather than trusted.

**Key groups are refused, not approximated.** A file whose keys are split into
groups with a Shamir threshold cannot be expressed in `sops encrypt`'s flags at
all — they describe one flat set — so the save fails with "edit it with `sops`
itself" rather than quietly rewriting the file's key policy into a weaker one.

## Consequences

- **A file encrypted for somebody outside `.sops.yaml` round-trips through the
  viewer with that access intact.** This is the property the decision exists for,
  and `tests/sops_integration.rs` asserts exactly it.
- **No plaintext file exists at any point**, so the hard constraint holds for the
  write path as it does for the read path.
- **Rotation is not this feature's job.** Saving through the viewer cannot add or
  remove a recipient, and a `.sops.yaml` that has since gained a key does not
  reach the file this way — `sops updatekeys` is the tool for that and remains
  the tool for it. A save preserves; it does not reconcile.
- **New key backends need a line each.** A backend SOPS gains that this code does
  not know how to spell as a flag will fail the verification above rather than
  drop a key — noisily, at save time, which is the failure mode to want.
- **`sops edit` stays unused**, and with it the `$EDITOR` dance the feature
  exists to replace.
