# ADR-0004 — `~/.claude/` is read-only ground truth

**Status.** Accepted (M0, 2026-05-28). Generalised to every agent store by
[ADR-0011](./0011-a-project-is-a-folder-in-the-workspace.md) — the stance below
is about *an agent's* transcript store, and Claude's is simply the only one we
read today.

## Context

Claude Code persists session state to `~/.claude/projects/<encoded>/<id>.jsonl`.
We need to read these files, but it's tempting to also write to them
(e.g. to set session titles, to edit message history, to "compress"
long sessions).

## Decision

`~/.claude/` is **read-only ground truth** from factorai's perspective.
We do not:

- Mutate session JSONLs.
- Move or delete session files.
- Inject new events into existing sessions.

The **one exception** is fork: forking writes a new `.jsonl` file with
a fresh session UUID under the same project directory, containing a
prefix of the source session up to and including the fork point. We
never modify the source file.

Editing CLAUDE.md and writing new files into `.claude/plans/` is
governed by the same rule — we treat each file as belonging to Claude
Code and follow whatever conventions Claude Code expects.

## Consequences

**Positive.**

- Claude Code's own behaviour is never confused by our writes. If
  factorai is buggy, the worst case is a stale cache, not a corrupt
  session.
- The user can uninstall factorai and lose nothing — their session
  history is intact in `~/.claude/`.
- We don't need to coordinate with Claude Code's own writes to JSONL
  files (would be a race condition nightmare).

**Negative.**

- We can't offer session "cleanup" features (compaction, deletion). If
  needed later, do it explicitly behind a confirm dialog and write to
  new file paths (move-then-rename, not in-place edit).

## Related

- `specs/02-data-model.md` § "Source of truth"
- `specs/05-features.md` F6 (fork)
