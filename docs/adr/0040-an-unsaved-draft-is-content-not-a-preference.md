# ADR-0040 — An unsaved draft is content, so it goes in SQLite

**Status.** Accepted (F26 — editing and saving a file, 2026-09-09).

## Context

F26 makes text files editable with an explicit Save. The viewer they are edited
in is a pane with its own strip of open files
([ADR-0037](./0037-the-viewer-is-a-column-with-a-measured-fallback.md)), and that
strip is **persisted and restored on launch** — close the app with four files
open and they come back.

Which decides this on its own: a buffer that died with the process would be the
one thing in the pane that does not come back. The file reopens next launch, in
the same tab, at the same scroll, with your edit gone. Every other piece of that
tab survives, so the text does too, or the restore is a lie.

F26 also makes the draft outlive its *tab*: closing a tab keeps the buffer, the
file's row in the tree grows a dirty dot, and the quit confirm lists it
(ADR-0020 — that dialog asks about work, not processes).

That makes the draft persistent state, and the app already has a decision about
where persistent renderer state goes.
[ADR-0013](./0013-preferences-storage-split.md) splits it three ways: layout
state and renderer-only preferences in localStorage (`factorai.panel`,
`factorai.sidebar`, `factorai.zoom`, `factorai.prefs`), and **anything Rust must
read** in the SQLite `settings` table. Rust never reads a draft — the renderer
holds the buffer and hands it to `write_file` — so by that rule a draft is a
localStorage value.

## Decision

**Drafts go in SQLite, in a `file_drafts` table (migration `0020`), as an
explicit exception to ADR-0013's rule.** The rule is refined rather than broken:
the split is by *who reads it*, and a draft is the first persistent thing that is
neither a preference nor a Rust-readable setting. It is **content**.

Three reasons, in the order they matter:

1. **Quota.** localStorage is ~5MB per origin, shared across every
   `factorai.*` key. A draft is sized like a file, not like a panel width. One
   moderately large edited file exhausts it, and an over-quota `setItem` **throws**
   — the failure mode is losing exactly the unsaved work the store exists to keep,
   at the moment it is largest.
2. **Bounding needs queries.** The caps (1MB per draft, 32MB total, oldest
   evicted first) are an `ORDER BY updated_at` and a `DELETE`. In localStorage they
   are a hand-rolled scan over a key prefix on every keystroke's debounce.
3. **The restore rule is a comparison, not a read.** A draft carries the hash of
   the contents it was typed against and is dropped when disk has moved since
   (F26). That is a row with columns, not a JSON blob under a key.

**Two things the table deliberately does not hold.**

- **Secrets.** A file matching F26's secrets list (`.env`, `*.pem`, `id_rsa`, …)
  keeps its buffer in memory for the session and never gets a row. Persisting
  drafts buys crash-resistance; it is not worth a plaintext copy of every
  half-edited credential sitting in the database until the user happens to save.
  The dirty dot and the quit confirm still show it, so the work is visible — it
  simply does not survive a quit.
- **A foreign key.** Drafts key on an absolute path, not a project id. The viewer
  opens paths the tree reached, which is not the same set as "files inside a
  workspace project", and there is nothing to cascade from.

## Consequences

**Positive.**

- Unsaved work survives a crash, a quit and an update, for every file except the
  ones where persisting it would be the bigger problem.
- The caps are enforceable, so the table cannot grow without bound.
- ADR-0013's split gets the missing third category named, rather than being
  quietly violated by the first feature that stores something file-sized.

**Negative.**

- A migration and two commands for something the renderer could have done alone,
  and a round trip on the debounced write of every keystroke burst.
- The database now contains user file content, which it did not before. Backups,
  the dev-database copy note in `02-data-model.md`, and anything that ships a
  database now carry that.
- The rule "renderer-only state is localStorage" is no longer absolute, so a
  future author has to read this record to know which side their new state is on.
  The test to apply: is it a *setting*, or is it *content*?

## Alternatives rejected

- **localStorage `factorai.drafts`** — what ADR-0013 prescribes, and no backend
  work at all. Silent loss above quota is disqualifying for the one store whose
  job is not losing things.
- **Files under the app data directory**, one per draft, like an editor's swap
  files. Recoverable by hand, and a third storage location the ADR does not
  describe, with orphan cleanup to own.
- **No persistence — keep drafts in memory only.** Simplest, and it contradicts
  the surface it lives in: a restored tab strip that restores everything about a
  file except what you typed into it.
- **Persist everything including secrets, expiring rows after 24h.** Uniform, and
  it trades a clear guarantee for a timer plus a sweep.

## Related

- `specs/05-features.md` F26 § "Drafts", § "Secrets"
- `specs/02-data-model.md` § `file_drafts`
- ADR-0013 (preferences storage split), ADR-0020 (the quit confirm asks about
  work), ADR-0037 (the viewer is a column with a restored tab strip), ADR-0039
  (the write boundary)
