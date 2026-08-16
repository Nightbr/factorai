-- A project is a folder you added, not a directory Claude happens to have.
--
-- Before this migration, `projects` was a *mirror* of ~/.claude/projects/: the
-- indexer upserted a row for every directory it found, which is why deleting a
-- project never stuck — the next scan put it back. Identity was Claude's own
-- path encoding, so a folder could only be a project if Claude had named it.
--
-- After it there are two tables with two owners:
--
--   projects            what you added. Only user actions write here.
--   discovered_projects what an agent's store contains. Only the scan writes
--                       here. `project_id` is the link, NULL when the folder
--                       isn't in your workspace.
--
-- Removing a project is now a DELETE the scan cannot undo, and indexing is
-- gated on membership: only folders in the workspace get parsed and searched.

-- ── The workspace ───────────────────────────────────────────────────────────

CREATE TABLE workspace_projects (
	-- uuid v4. Deliberately not derived from the path: identity is a record of
	-- your decision, which is what lets a folder later be moved or renamed
	-- without orphaning its pins, tabs and sessions.
	id           TEXT PRIMARY KEY,
	-- Canonical absolute path. UNIQUE is the no-duplicates guarantee that the
	-- shared path encoding used to provide.
	real_path    TEXT NOT NULL UNIQUE,
	display_name TEXT NOT NULL,
	pinned       INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
	-- The folder is gone from disk. Set by the scan, not computed per
	-- `list_projects` — that query is polled every 2s (F1).
	missing      INTEGER NOT NULL DEFAULT 0 CHECK (missing IN (0, 1)),
	opened_at    INTEGER NOT NULL
);

-- ── What the agents' stores hold ────────────────────────────────────────────

CREATE TABLE discovered_projects (
	id         INTEGER PRIMARY KEY,
	-- Which agent's store. Only 'claude' is written today; the column exists so
	-- a second agent is an INSERT rather than a schema change.
	agent      TEXT NOT NULL DEFAULT 'claude',
	-- The agent's own directory name. A foreign key into *their* store, never
	-- an identity in ours.
	key        TEXT NOT NULL,
	-- The folder these transcripts describe. NULL when we found a directory but
	-- could not confirm which folder it is (no `cwd` recorded, no decodable
	-- candidate on disk) — unknown, which is not the same as gone.
	real_path  TEXT,
	-- ON DELETE SET NULL is what makes "remove a project" cheap and reversible:
	-- the discovery stays, only the membership goes.
	project_id TEXT REFERENCES workspace_projects(id) ON DELETE SET NULL,
	UNIQUE (agent, key)
);

CREATE INDEX idx_discovered_project ON discovered_projects(project_id);
CREATE INDEX idx_discovered_real_path ON discovered_projects(real_path);

-- One discovered row per directory the old mirror had recorded.
INSERT INTO discovered_projects(agent, key, real_path)
SELECT 'claude', id, real_path FROM projects;

-- ── Import everything that already existed ──────────────────────────────────
--
-- Someone with thirty projects opens the new build and sees thirty projects.
-- An empty sidebar with a helpful modal is data loss as far as they're
-- concerned, whatever the database says.
--
-- SQLite has no uuid(); this is the standard randomblob() construction for a
-- v4 — version nibble 4, variant nibble from 8/9/a/b.
--
-- Rows whose `real_path` was never resolved are skipped: a workspace is keyed
-- by folder, and we do not know which folder those describe. They stay
-- discovered-but-unopened and are importable later if their path ever resolves.
--
-- OR IGNORE covers the case where two encoded directories resolved to the same
-- real folder; ordering pinned first means the surviving row is the pinned one.
INSERT OR IGNORE INTO workspace_projects(id, real_path, display_name, pinned, missing, opened_at)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
		|| substr(lower(hex(randomblob(2))), 2) || '-'
		|| substr('89ab', abs(random()) % 4 + 1, 1)
		|| substr(lower(hex(randomblob(2))), 2) || '-'
		|| lower(hex(randomblob(6))),
	real_path,
	display_name,
	pinned,
	missing,
	CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM projects
WHERE real_path IS NOT NULL
ORDER BY pinned DESC;

UPDATE discovered_projects
SET project_id = (
	SELECT w.id FROM workspace_projects w WHERE w.real_path = discovered_projects.real_path
)
WHERE real_path IS NOT NULL;

-- ── Sessions hang off the discovery, not the workspace ──────────────────────
--
-- A session belongs to a directory in an agent's store; whether that directory
-- is in your workspace is a separate, changeable fact. Putting the FK here
-- rather than on `sessions` means opening or removing a project updates a
-- handful of rows instead of every session in it.

CREATE TABLE sessions_new (
	id            TEXT PRIMARY KEY,
	discovered_id INTEGER NOT NULL REFERENCES discovered_projects(id) ON DELETE CASCADE,
	title         TEXT,
	created_at    INTEGER NOT NULL,
	updated_at    INTEGER NOT NULL,
	turn_count    INTEGER NOT NULL DEFAULT 0,
	file_mtime    INTEGER NOT NULL,
	file_size     INTEGER NOT NULL,
	cwd           TEXT
);

INSERT INTO sessions_new(id, discovered_id, title, created_at, updated_at, turn_count, file_mtime, file_size, cwd)
SELECT s.id, d.id, s.title, s.created_at, s.updated_at, s.turn_count, s.file_mtime, s.file_size, s.cwd
FROM sessions s
JOIN discovered_projects d ON d.agent = 'claude' AND d.key = s.project_id;

DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX idx_sessions_discovered ON sessions(discovered_id, updated_at DESC);
CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);

DROP TABLE projects;
ALTER TABLE workspace_projects RENAME TO projects;

-- ── The FTS index stops carrying a project id ───────────────────────────────
--
-- It used to store the encoded directory name, which was stable. A workspace id
-- is not: remove a project and re-add it and every row would be stale. Search
-- filters through `sessions` -> `discovered_projects` instead, which is one
-- indexed join and always current.
--
-- Rebuilt from the old table's own columns rather than by re-parsing every
-- transcript — an FTS5 table reads back as an ordinary one, so nobody pays a
-- full reindex for a column being dropped.

CREATE VIRTUAL TABLE messages_fts_new USING fts5(
	session_id UNINDEXED,
	role,
	body,
	tokenize = 'porter unicode61'
);

INSERT INTO messages_fts_new(session_id, role, body)
SELECT session_id, role, body FROM messages_fts;

DROP TABLE messages_fts;
ALTER TABLE messages_fts_new RENAME TO messages_fts;

-- Indexing is gated on the workspace now, so anything indexed for a folder
-- nobody opened is work no query will ever read. The only rows this can hit are
-- the unresolvable ones skipped above.
DELETE FROM messages_fts
WHERE session_id IN (
	SELECT s.id FROM sessions s
	JOIN discovered_projects d ON d.id = s.discovered_id
	WHERE d.project_id IS NULL
);

DELETE FROM sessions
WHERE discovered_id IN (SELECT id FROM discovered_projects WHERE project_id IS NULL);
