-- What an incremental re-index needs to resume, and to keep the title right.
--
-- **Why** (PERF-03, `specs/10-performance.md`). A changed transcript was read,
-- parsed and re-tokenised in full, every time, although transcripts are
-- append-only: a live session with a 30MB transcript paid a 30MB parse per
-- second of output. Indexing only the appended tail needs two facts the row did
-- not carry.
--
-- `indexed_bytes` — the offset just past everything the indexer finished with:
-- every line whose event it took, and every whole line it permanently skipped.
-- Not `file_size`: the watcher fires while Claude is mid-write, so a read can
-- land inside a line, and a truncated line is skipped as malformed. Resuming
-- from the file's size would skip the rest of it forever — one event lost, on
-- exactly the sessions someone is watching. 0 means "never indexed
-- incrementally", which is the correct starting point for every existing row.
--
-- `title_kind` — which of the three sources the stored title came from:
-- 'custom' (a `/rename`), 'ai' (Claude's own), or 'derived' (the first user
-- message, or the id). The full parse decided precedence by looking at the
-- whole file; a tail parse cannot, so it has to know what it is beating. NULL
-- means the row predates this and cannot be resumed — such a row takes one full
-- parse the next time its file changes, and is incremental from then on. A
-- session that never changes again never pays it.

ALTER TABLE sessions ADD COLUMN indexed_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN title_kind TEXT;
