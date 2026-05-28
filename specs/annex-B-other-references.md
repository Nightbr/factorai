# Annex B — Other reference projects considered

Short notes on other projects we evaluated for factorai. Each gets a
verdict: **lift now**, **revisit later**, or **not applicable**.

---

## B.1 — honker (russellromney/honker)

**What it is.** A SQLite loadable extension (Rust-implemented, with
language bindings everywhere) that adds Postgres-style `NOTIFY` /
`LISTEN` semantics, durable pub/sub queues, time-trigger scheduling
with a leader-elected scheduler, and durable streams — all backed by
rows in the same `.db` file as your business tables. Replaces
"add Redis + Celery" for projects that committed to SQLite as the
primary datastore.

**Verdict for factorai: not now, revisit if scheduler comes back.**

Why it doesn't fit MVP:

- factorai is **single-process**. The indexer, watcher, and terminal
  manager all live in one Tauri process, sharing one tokio runtime
  and one rusqlite connection pool. Honker's killer feature
  (cross-process notification on a single `.db`) buys us nothing here.
- We have **no durable queue requirement**. The indexer is event-driven
  from `notify` watcher events — it's not consuming a persistent job
  queue. PTYs are in-memory.
- We **dropped the scheduler from MVP scope** (deferred list #2,
  `06-milestones.md`). Honker's scheduler is exactly the right shape
  for a SQLite-native cron, but we don't need a scheduler at all
  right now.

Where it would shine in a future version:

- If we add the deferred scheduler ("run this prompt at this cron"),
  honker gives us atomic write + enqueue + leader election out of the
  box. That's much better than rolling our own cron in Rust.
- If we ever split factorai into a daemon + GUI (so the daemon keeps
  indexing while the GUI is closed), honker handles the cross-process
  signalling cleanly.

**Action.** No code change today. If/when the scheduler returns from
the deferred list, evaluate honker before writing custom cron logic.
Link this note from the eventual scheduler ADR.

**Reference.** [russellromney/honker](https://github.com/russellromney/honker)

---

## (others — append as we evaluate them)
