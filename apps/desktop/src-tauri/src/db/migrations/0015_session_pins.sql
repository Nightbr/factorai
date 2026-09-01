-- A session you marked stays at the top of its project's list (F2).
--
-- **This is not migration 0011 arriving in reverse.** 0011 took the `pinned` bit
-- off `projects` and replaced it with an ordinal, because a pin there was "a
-- one-bit approximation of an ordering" over ten stable rows you can drag into
-- the order you actually want. A session list is the opposite shape: dozens of
-- rows, sorted by a recency that moves under you every turn, rows arriving from
-- the indexer and being reaped when a transcript goes. There is no hand order to
-- preserve, so one bit is the entire requirement — *exempt this row from
-- recency* — and an ordinal would be a position you had to re-earn on every
-- reindex.
--
-- A table rather than a column on `sessions`, for the reason every other
-- session-adjacent fact is one: `sessions` is a cache of what the transcripts
-- say, rewritten by `Indexer::index_one`, and a decision the *user* made does
-- not belong in the same row as parsed values. See specs/02-data-model.md.

CREATE TABLE IF NOT EXISTS session_pins (
	-- **With the foreign key, unlike `session_worktrees` (0007) and
	-- `session_routines` (0013).** Those two are written at spawn, before Claude
	-- has written a transcript and therefore before the `sessions` row exists —
	-- which is what made their foreign key impossible. A pin is the opposite: it
	-- can only be made from a row that is already in a list, so the constraint
	-- holds, and `ON DELETE CASCADE` is then the whole of its lifetime. Deleting
	-- a session takes its pin with it, and so does the indexer's reap when a
	-- transcript disappears from under us.
	--
	-- `PRAGMA foreign_keys` is ON for every connection (`db/mod.rs`), so the
	-- cascade is real and not decorative.
	session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
	-- When the pin was made. **Not what the list sorts on** — pinned rows order
	-- among themselves by recency, like every other row, so the list keeps one
	-- ordering rule and the pin only decides which side of the divider a row is
	-- on. Kept because "since when" is the question asked of a mark you may have
	-- left on a session weeks ago, and a column that exists costs nothing next to
	-- a migration that adds it later.
	pinned_at  INTEGER NOT NULL
);
