-- Messages become a real table, and the FTS index becomes external content.
--
-- **Why.** `session_id` was an `UNINDEXED` FTS5 column, which means FTS5 keeps
-- it in the content table with no b-tree over it — so
-- `DELETE FROM messages_fts WHERE session_id = ?` scanned every row of every
-- session. That delete runs on every re-index of a changed transcript, on every
-- reap, on deleting a session and on removing a project, always inside a write
-- transaction holding the one database lock, which is the main thread's wait.
-- Measured on a 232-session index: 8.0ms; on the same data grown ten times,
-- 29.7ms; fifty times, 121.2ms — the cost of the table, not of the session.
-- Deleting a *one-row* session cost 2.5ms, which is the tell.
--
-- See ADR-0053 for the decision and the alternative that was rejected.
--
-- The rows are read back out of the FTS table rather than re-parsed from the
-- transcripts: an FTS5 table reads as an ordinary one, so nobody pays a full
-- reindex for a change of table shape. Migration 0004 already did this once,
-- when the `project_id` column went.

CREATE TABLE messages (
	id         INTEGER PRIMARY KEY,
	session_id TEXT NOT NULL,
	role       TEXT NOT NULL,
	body       TEXT NOT NULL
);

INSERT INTO messages(session_id, role, body)
SELECT session_id, role, body FROM messages_fts;

-- The whole point of the migration: the delete is a lookup now.
CREATE INDEX idx_messages_session ON messages(session_id);

DROP TABLE messages_fts;

-- External content: the index stores no copy of the text, it reads through to
-- `messages` by rowid. `role` is column 0 and `body` is column 1, which moves
-- `snippet()`'s column argument from 2 to 1 (services/search.rs).
CREATE VIRTUAL TABLE messages_fts USING fts5(
	role,
	body,
	content = 'messages',
	content_rowid = 'id',
	tokenize = 'porter unicode61'
);

INSERT INTO messages_fts(messages_fts) VALUES('rebuild');

-- The standard external-content triggers. Every write to `messages` goes
-- through them, so no caller ever writes to `messages_fts` directly again.
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
	INSERT INTO messages_fts(rowid, role, body) VALUES (new.id, new.role, new.body);
END;

CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
	INSERT INTO messages_fts(messages_fts, rowid, role, body)
	VALUES ('delete', old.id, old.role, old.body);
END;

CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
	INSERT INTO messages_fts(messages_fts, rowid, role, body)
	VALUES ('delete', old.id, old.role, old.body);
	INSERT INTO messages_fts(rowid, role, body) VALUES (new.id, new.role, new.body);
END;

-- No foreign key to `sessions`, deliberately, and for the reason migration 0007
-- gave when it took one off `session_worktrees`: the delete sites here are
-- explicit and already ordered (the reap deletes messages, the checkout record,
-- the routine record and then the row), and a cascade would move that ordering
-- somewhere it cannot be read.
