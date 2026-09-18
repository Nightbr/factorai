# ADR-0003 — SQLite + FTS5 for session index

**Status.** Accepted (M0, 2026-05-28).

## Context

We need to:

1. List ~100 projects × ~5 sessions each = ~500 sessions, sorted by
   recency. Should be instant.
2. Full-text search across all sessions by message body. Doing this in
   JS over loaded JSON is fine for small corpora, but it breaks down at
   10k+ sessions or large session files.

Options considered:

| Option              | Notes                                                  |
| ------------------- | ------------------------------------------------------ |
| Re-parse JSONL each query | Simplest. Doesn't scale.                       |
| JSON file cache     | Faster than re-parsing but FTS is still JS-side.       |
| SQLite + FTS5       | Native, fast, well-understood. Chosen.                 |
| Tantivy / Lucene    | Overkill. Would need a separate index process.         |

## Decision

Use **SQLite** (via `rusqlite` with `bundled` feature) with **FTS5**
for the session index. Tables: `projects`, `sessions`,
`messages_fts` (virtual), `settings`. Schema is in
`specs/02-data-model.md`.

Source of truth remains `~/.claude/projects/**/*.jsonl` — SQLite is a
rebuildable cache. If the DB is missing or corrupt, full re-scan on
boot rebuilds it.

## Consequences

**Positive.**

- Sub-100ms FTS hits on a 500-session corpus, easily.
- Schema migrations are simple text files (`db/migrations/000N_*.sql`).
- `rusqlite` bundles SQLite — no system dependency on the user's
  machine.

**Negative.**

- One more layer to keep coherent with disk. We pay this cost with the
  indexer/watcher that observes `~/.claude/projects/**` and re-indexes
  on change (debounced, suffix-read for live JSONLs).
- FTS5 tokeniser choice matters; we use `porter unicode61` to start. May
  need to revisit if we hit weird search behaviour with code samples in
  messages.

## Related

- `specs/02-data-model.md` § "SQLite schema"
- `specs/03-backend-rust.md` § "IndexerService"
