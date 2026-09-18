# ADR-0009 — `git2` (libgit2) for reading repository state

Status: accepted · 2026-08-14

## Context

The right-hand panel grows a **Changes** tab beside **Files** (F13), and the
file tree paints git status onto rows it already renders (F12). Both need the
same thing: what has changed in this project's repository, right now, refreshed
every few seconds while an agent edits files.

Three ways to get it:

1. **Shell out to `git`** — `status --porcelain=v2`, `diff --numstat`,
   `show HEAD:path`.
2. **`git2`**, the Rust binding to libgit2.
3. **`gix`** (gitoxide), the pure-Rust reimplementation.

Shelling out is the obvious first instinct and the wrong one here, for a reason
this codebase has already paid for once: a GUI-launched app on macOS does not
inherit a shell PATH. `find_claude_binary()` exists — three tiers, a login-shell
probe, a candidate list, a cached override in settings (Q2, `services/terminal.rs`)
— solely because of that. Depending on `git` on PATH means owning a second copy
of that problem, for a binary we'd invoke every 3 seconds rather than once per
session. It also means parsing porcelain (a stable format, but one whose rename
and conflict cases are where the bugs live) and spawning two or more processes
per poll.

`gix` is the more interesting long-term answer but its status/diff surface is
still moving, and we need per-file line stats today.

**What VS Code does, and why we still diverge.** VS Code's git extension shells
out (`git status -z -uall`, parsed incrementally off the child's stdout) — the
strongest possible argument for option 1, so it deserves an answer rather than a
dismissal. It works for them because (a) they already own a `git.path` setting
plus discovery logic, i.e. they solved the PATH problem and made the user
configure it when discovery fails; (b) they deliberately match *the user's* git,
including its config, hooks and credential helpers, because they also **write** —
commit, stage, push; (c) they run in Electron with a mature child-process layer
and a filesystem-watcher service.

We write nothing, so "matches the user's git exactly" buys us little, and every
one of those tiers is a cost we'd take on for a read we perform every three
seconds. What we *do* take from their implementation is the operational shape —
cap the change set and say so, keep line-count computation off the status path,
index decorations rather than scanning per row — recorded in
`03-backend-rust.md` § `git` and F13.

## Decision

Use **`git2`**. All repository reads live in `services/git.rs`, exposed through
`commands/git.rs`, and the renderer never learns that libgit2 exists.

Specifically:

- `Repository::discover()` from the project root, so a project that is a
  subdirectory of a larger repo reports that repo's changes.
- `Repository::statuses()` with untracked included but **not** recursed into,
  so a new directory is one row rather than ten thousand.
- `Patch::line_stats()` per delta for the `+N -M` badges, skipped for binary
  deltas and for files over a size cap.
- `Repository::is_path_ignored()` inside `list_dir`, which opens the repo once
  per call and sets `ignored` on each entry — no second round trip from the
  tree.
- Blob reads at `head` (tree lookup) and `index` for the diff viewer's left
  side.

Everything is **read-only**. No staging, no discard, no commit — see F13.

## Consequences

**Good.**

- No PATH discovery, no subprocess, no porcelain parsing. The one dependency
  class this app has already been burned by is avoided outright.
- Tests build real repositories in a `tempdir` — init, commit, stage, conflict —
  with no `git` binary installed and no network. That is what makes the status
  matrix (staged + unstaged + untracked + renamed + deleted + binary) testable
  at all.
- Structured rename detection and conflict state, rather than inferred from
  text output.

**Bad.**

- libgit2 is a C library vendored through `libgit2-sys`; it adds build time and
  a compiled dependency to a project that had none beyond `rusqlite`'s bundled
  SQLite (which sets the precedent).
- git2's API is a faithful libgit2 binding, so lifetimes tie `Diff`, `Patch` and
  `Repository` together in ways that force the status walk into one function.
  Accepted: it's contained in `services/git.rs`.

**It supersedes a command that was never built.** `03-backend-rust.md` specced
`file_diff(path, original, modified) -> DiffPayload`, computing hunks in Rust
with the `similar` crate for a renderer that would draw them. ADR-0007 replaced
that renderer with Monaco, whose `createDiffEditor` diffs two strings itself —
so a Rust hunk list has no consumer. `file_diff` and the `similar` dependency
are dropped from the spec; the diff viewer is fed by `git_blob` plus the
existing `read_file`.

**What this does not decide.** Nothing here commits us to a git *watcher*.
Freshness is polling while the panel is open, consistent with F12's deliberate
no-watcher stance (Q17).
