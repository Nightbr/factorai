-- Bookkeeping
CREATE TABLE IF NOT EXISTS _meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

-- Projects observed under ~/.claude/projects/
CREATE TABLE IF NOT EXISTS projects (
	id              TEXT PRIMARY KEY,         -- encoded directory name
	real_path       TEXT,                     -- resolved absolute path (NULL until first session seen)
	display_name    TEXT NOT NULL,            -- last path component or fallback
	last_session_at INTEGER,                  -- unix ms; max(sessions.updated_at)
	session_count   INTEGER NOT NULL DEFAULT 0,
	pinned          INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1))
);

-- One row per .jsonl file under a project directory
CREATE TABLE IF NOT EXISTS sessions (
	id          TEXT PRIMARY KEY,             -- filename minus .jsonl
	project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	title       TEXT,                         -- derived; NULL until first parse
	created_at  INTEGER NOT NULL,             -- first event timestamp
	updated_at  INTEGER NOT NULL,             -- last event timestamp
	turn_count  INTEGER NOT NULL DEFAULT 0,
	file_mtime  INTEGER NOT NULL,             -- ms since unix epoch
	file_size   INTEGER NOT NULL,             -- bytes at last index
	cwd         TEXT                          -- first non-null cwd seen in events
);

-- Generic key/value config. Keyed by a dotted namespace (`claude.binary`);
-- written only through get_setting/set_setting, which key it off the mirrored
-- `SettingKey` union (F11). A comment corrected in place when the first caller
-- landed: the value is the string itself, not JSON. See specs/02-data-model.md.
CREATE TABLE IF NOT EXISTS settings (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL                       -- no row means unset
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
