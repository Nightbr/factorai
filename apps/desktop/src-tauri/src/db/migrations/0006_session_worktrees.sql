-- Which checkout of its repository a session is working in (F21, ADR-0019 § 3).
--
-- Its own table rather than a column on `sessions`, and the reason is the one
-- ADR-0011 turns on: `sessions` is derived state that the indexer upserts from
-- transcripts, so a decision recorded there has to be defended from its own
-- owner on every write. That the upsert already carries
-- `cwd = COALESCE(excluded.cwd, sessions.cwd)` for one column it does not own
-- is an argument against adding a second, not for it. Two tables, two owners.
--
-- Written only by the IDE bridge's signal path — the agent calling
-- `setWorktree`, or an `openFile` landing in another checkout — after the path
-- has been validated against the repository's real worktree list.
--
-- `path` is a record, not a guarantee. The checkout it names can be
-- `git worktree remove`d while this row survives, so every read re-validates
-- against git and falls back to the checkout containing `sessions.cwd`. It is
-- also NOT where the PTY's cwd comes from: that is the transcript's own `cwd`,
-- and conflating the two turns a resume into a new conversation.
CREATE TABLE IF NOT EXISTS session_worktrees (
	session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
	path       TEXT NOT NULL,
	updated_at INTEGER NOT NULL
);
