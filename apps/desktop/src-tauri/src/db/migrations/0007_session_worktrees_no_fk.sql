-- Drop `session_worktrees`' foreign key to `sessions` (F21).
--
-- **Found by using it, 2026-08-21.** A brand-new session has no `sessions` row:
-- that table is derived from transcripts, and the indexer only writes a row once
-- Claude has written one. So an agent that runs `git worktree add` early — the
-- exact case this feature exists for — signalled a checkout for a session id the
-- FK had never heard of, and the insert failed with `FOREIGN KEY constraint
-- failed`. The panel moved, because the event fires either way, and nothing
-- persisted: precisely the "renderer shows what a reload disagrees with" split
-- that the write-then-emit ordering was supposed to prevent.
--
-- The constraint was the design error, not the ordering. `session_worktrees` is
-- a **record of what the agent said**, keyed by an id factorai itself minted
-- (ADR-0008); `sessions` is derived state the scan owns. Making the record's
-- lifetime depend on the scan noticing a transcript is the same mistake
-- ADR-0011 was written to correct, one level down — and it is why 0006's own
-- comment argues for a separate table in the first place.
--
-- **Cleanup moves to `reap_deleted`**, which is where sessions are actually
-- deleted and which already exempts live ones — the same guard this needs. That
-- is what `ON DELETE CASCADE` was buying, minus the insert-time constraint that
-- could not be satisfied.
--
-- SQLite cannot drop a constraint, so the table is rebuilt. Rows are carried
-- over; on any machine that has run 0006 there are none, because every insert it
-- could have accepted is one this migration would have accepted too.
CREATE TABLE session_worktrees_new (
	session_id TEXT PRIMARY KEY,
	path       TEXT NOT NULL,
	updated_at INTEGER NOT NULL
);

INSERT INTO session_worktrees_new(session_id, path, updated_at)
	SELECT session_id, path, updated_at FROM session_worktrees;

DROP TABLE session_worktrees;

ALTER TABLE session_worktrees_new RENAME TO session_worktrees;
