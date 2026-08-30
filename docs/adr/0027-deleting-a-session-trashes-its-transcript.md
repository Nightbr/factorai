# ADR-0027 — Deleting a session moves its transcript to the OS trash

**Date:** 2026-08-30
**Status:** Accepted. **Amends
[ADR-0004 — `~/.claude/` is read-only ground truth](0004-claude-dir-is-read-only.md)**
in one clause: "move or delete session files". Everything else in ADR-0004
stands — we still do not mutate a JSONL in place, and we still do not inject
events into one.

## Context

The sidebar lists a project's ten most relevant sessions and the project page
lists the rest. Both fill up with sessions that are not work: a `claude` you
started in the wrong folder, a routine's run that errored on its first turn, a
one-question session you will never reopen. There has been no way to get rid of
one.

ADR-0004 forbade it, and named the cost in its own Consequences: *"We can't
offer session 'cleanup' features (compaction, deletion). If needed later, do it
explicitly behind a confirm dialog and write to new file paths (move-then-rename,
not in-place edit)."* This is that "later". The rule being amended was written to
stop factorai **corrupting** a transcript Claude Code is reading, and a delete
the human asked for by name is not that failure mode.

Three shapes were considered:

1. **`unlink`.** Simplest, no dependency, and unrecoverable. A transcript is
   often the only record of a day's reasoning; a misclick that destroys one with
   no way back is the wrong default for a menu row that sits three pixels from
   "Open".
2. **Hide it in the index.** Fully reversible and touches no file — but
   `claude --resume` still lists the session, so the thing the user asked to
   delete is still there, in the tool this one exists to sit beside. A delete
   that only deletes our view of something is a lie the user finds out about
   later.
3. **Move it to the OS trash.** What every file manager on both our platforms
   means by delete, recoverable in a place the user already knows how to look,
   and a *move* rather than an edit — which is the exact shape ADR-0004's own
   escape hatch describes.

## Decision

**`delete_session` moves the session's transcript to the operating system's
trash** — `~/.local/share/Trash` on Linux via the freedesktop spec, the Finder
Trash on macOS — using the `trash` crate (5.x, both platforms, no system
dependency beyond what we link already).

Concretely, one command, `delete_session(session_id)`:

- Trashes `<store dir>/<session-id>.jsonl`.
- Trashes `<store dir>/<session-id>/` **whole**, the directory holding the
  session's sub-agent transcripts, when it exists. A sub-agent belongs to the
  session that spawned it; leaving them behind produces exactly the orphan rows
  the indexer's reap already treats as debris.
- Drops the session's rows — `sessions`, `messages_fts`, `session_worktrees`,
  `session_routines` — in one transaction, the same set and the same order
  `Indexer::reap_deleted` uses. Doing it here rather than waiting for the next
  scan is what makes the row leave the list on the click rather than a poll
  later.
- Emits `sessions:changed` for the project, so every list that is not the one
  you clicked in updates too.
- **Refuses while the session has a live PTY.** The kill is the renderer's, in
  front of the confirm dialog, for the reason `useRemoveProject` kills there:
  the failure mode of a kill that does not take is an invisible agent
  (ADR-0005), and the tab is where you can still see and stop it. A backend that
  killed silently would hide that.

**A delete is per-session and never per-project.** Removing a project from the
workspace stays what ADR-0011 made it — membership only, nothing on disk — and
the two rows sit in different menus with different words.

## Consequences

**Positive.**

- The lists can be kept. That is the whole feature.
- Recoverable by the ordinary means, so the confirm dialog can say where the
  file went instead of "this cannot be undone" — a true sentence that makes the
  action less frightening than it reads.
- Still no in-place write. If factorai is buggy the worst case is a file in the
  trash, not a corrupt session, which is the property ADR-0004 was protecting.

**Negative.**

- A new dependency on the delete path, and one that can fail for reasons the
  user did not cause: a store on a filesystem with no trash directory, or a
  `$HOME` on a different mount from `~/.claude`. The command surfaces that as
  an error rather than falling back to `unlink` — silently upgrading a
  recoverable delete to a permanent one is precisely the surprise this decision
  exists to avoid.
- `claude --resume` will not list the session afterwards, which is correct and
  is also the first thing that is not undoable from inside factorai. Restoring
  from the trash restores it: the next scan re-indexes the file and the row
  comes back.
- One more thing that can be true of a session id in the wild — a search hit or
  a restored tab pointing at a transcript that is gone. Both already handle it:
  ADR-0008's spawn path treats a missing transcript as a new session, and the
  reap drops the row.

## Related

- [ADR-0004 — `~/.claude/` is read-only ground truth](0004-claude-dir-is-read-only.md) (amended here)
- [ADR-0005 — kill on quit is non-optional](0005-kill-on-quit-non-optional.md)
- [ADR-0008 — factorai assigns new session ids](0008-factorai-assigns-new-session-ids.md)
- [ADR-0011 — a project is a folder in the workspace](0011-a-project-is-a-folder-in-the-workspace.md)
- `specs/05-features.md` F2 § "Deleting a session"
