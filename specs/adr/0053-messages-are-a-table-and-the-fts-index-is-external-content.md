# ADR-0053 — Messages are a table, and the FTS index is external content over it

**Status.** Accepted (2026-09-20). Arises from
[`specs/10-performance.md`](../10-performance.md) PERF-01. Refines
[ADR-0003](0003-sqlite-fts5-for-session-index.md), which chose FTS5 and is not
in question here; only the shape of the table changes.

## Context

`messages_fts` was declared with `session_id UNINDEXED`
(`db/migrations/0002_fts.sql`, carried forward by `0004_workspace_projects.sql`).
FTS5 keeps an `UNINDEXED` column in its content table and builds no b-tree over
it, so the only way to answer `WHERE session_id = ?` is to read every row of
every session.

Four call sites delete by session id, and each of them runs inside a write
transaction that holds the single database connection's mutex:

- `services/indexer.rs` — on **every** re-index of a changed transcript, before
  re-inserting the same session's rows.
- `services/indexer.rs` — the reap, per session whose transcript is gone.
- `services/sessions.rs` — deleting a session (F2, ADR-0027).
- `commands/projects.rs` — removing a project, as an `IN (…)` over its sessions.

So the cost of deleting one session's rows is the size of the whole index, paid
on the thread that paints, once per second of live output in the worst case.
Measured with the app's own data, on copies:

| Index | Delete a 363-row session | Delete a 1-row session |
| --- | --- | --- |
| 232 sessions, 6 014 rows | 8.0 ms | 2.5 ms |
| 2 320 sessions, 60 140 rows | 29.7 ms | — |
| 11 600 sessions, 300 700 rows | 121.2 ms | — |

The one-row number is the evidence that this is a property of the table and not
of the work: deleting a single row cost 2.5 ms because the scan is the cost.

## Decision

**`messages` becomes an ordinary table, and `messages_fts` becomes an
external-content FTS5 index over it.**

```sql
CREATE TABLE messages (
  id         INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  role       TEXT NOT NULL,
  body       TEXT NOT NULL
);
CREATE INDEX idx_messages_session ON messages(session_id);

CREATE VIRTUAL TABLE messages_fts USING fts5(
  role, body,
  content = 'messages', content_rowid = 'id',
  tokenize = 'porter unicode61'
);
```

with the three standard triggers keeping the index in step. Every caller writes
to `messages`; nothing writes to `messages_fts` again.

Two consequences follow from the column list and both are load-bearing:

- **`snippet()`'s column argument moves from 2 to 1.** `role` is column 0 and
  `body` is column 1, where the old table had `session_id` at 0.
- **The search query joins through `messages`**, `messages.id =
  messages_fts.rowid`, to recover `session_id` and `role`. The join is on an
  integer primary key.

`MATCH` behaviour does not change: `session_id` was unindexed and is now not a
column of the index at all, so a bare query searched `role` and `body` before
and searches `role` and `body` now. Verified against the live index: the same
112 hits in the same order with the same snippets.

## Alternatives

**Drop `UNINDEXED` and delete through `MATCH 'session_id:"<uuid>"'`.** Rejected.
It puts UUIDs through the porter tokenizer, which splits them on the hyphens,
and it makes `session_id` part of every unqualified `MATCH` — so a search for a
token that happens to look like a fragment of an id starts matching rows by
their identity rather than by their text. It also changes `bm25()`'s input.
Cheaper to write and wrong in a way that would surface as bad search results
much later.

**Leave it and delete less often.** PERF-03 does reduce how often the delete
runs, by indexing only the appended tail. It does not help the reap, the
session delete or the project removal, and it leaves a scan on a path that is
one `PARSE_VERSION` bump away from running for every session at once.

## Consequences

- The delete becomes `SEARCH messages USING COVERING INDEX idx_messages_session`.
  Measured after the change: 5.5 ms for the 363-row session at 232 sessions,
  5.6 ms at 2 320, 8.9 ms at 11 600 — flat in the size of the index, and what
  remains is the real work of removing that session's documents. A one-row
  session is 0.0 ms.
- **Storage grows by roughly the size of an index over `session_id`**, and the
  space the old content table used is not returned until a `VACUUM`, which this
  migration does not run (it cannot, inside a transaction, and a `VACUUM` of a
  large index at launch is a worse problem than the bytes). On the 20.6 MB
  index here the file went to 22.2 MB.
- The migration reads the rows out of the old FTS table rather than re-parsing
  transcripts, so no user pays a reindex for it. It takes 185 ms on a
  232-session index and about 10 s on a 11 600-session one, once.
- `messages.id` is a stable rowid per message, which is what
  [PERF-03](../10-performance.md) needs to append a transcript's tail without
  rewriting what is already indexed.
- Rebuilding the index from the transcripts is still possible and still not the
  source of truth — ADR-0003's property is unchanged.
