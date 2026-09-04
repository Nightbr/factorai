-- A discovered directory belongs to a *profile*, not to an agent (F25 slice 2).
--
-- The same repository under two config directories produces the same encoded
-- `key` from two different stores, which `UNIQUE (agent, key)` rejects — so
-- until this migration a second profile's transcripts could not be recorded at
-- all. The key becomes `(profile_id, key)`, and `agent` goes: a profile carries
-- it, and keeping a copy here would be two columns that must agree forever with
-- nothing but discipline making them.
--
-- **This runs outside the shared migration transaction, with foreign keys off**
-- — see the `STANDALONE` list in `db/mod.rs`. It is a table rebuild, which
-- SQLite's own 12-step ALTER TABLE procedure requires, and migration 0011's
-- closing note is where the reason was written down: `sessions.discovered_id` is
-- `ON DELETE CASCADE`, so `DROP TABLE discovered_projects` inside a transaction
-- deletes every session row in the index, and `PRAGMA foreign_keys = OFF` is a
-- silent no-op there. `PRAGMA legacy_alter_table` does not save it either: a
-- rename rewrites `REFERENCES` clauses in other tables whenever foreign keys are
-- *enabled*, regardless of that flag, so the rename hands `sessions` a pointer
-- to the old table on the way past.

-- ── The rebuild ─────────────────────────────────────────────────────────────
--
-- `profile_id` is NOT NULL and always the concrete profile whose directory the
-- scan walked. **NULL-means-default belongs to the per-project assignment, and
-- only there** (F25 slice 3): SQLite treats NULLs as distinct, so a nullable
-- column here would make the scan's `ON CONFLICT(profile_id, key)` never fire
-- and insert a duplicate row for every project on every pass.
--
-- No `ON DELETE CASCADE` from `profiles` is spelled out as a second thought: it
-- is the whole lifetime of these rows. Deleting a profile takes its discoveries
-- with it — and, through `sessions.discovered_id`, that profile's sessions out of
-- the index. Re-adding a profile on the same directory rebuilds both on the next
-- scan, which is what makes the delete recoverable without us touching the disk.

CREATE TABLE discovered_projects_new (
	id         INTEGER PRIMARY KEY,
	profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
	-- The agent's own directory name. A foreign key into *their* store, never an
	-- identity in ours — unchanged from migration 0004.
	key        TEXT NOT NULL,
	real_path  TEXT,
	-- ON DELETE SET NULL is what makes "remove a project" cheap and reversible:
	-- the discovery stays, only the membership goes. Also unchanged.
	project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
	UNIQUE (profile_id, key)
);

-- Existing rows belong to the default profile, which `ensure_default` wrote at
-- boot before this migration could run — the app has been through 0017 and its
-- seeding at least once by the time anything gets here.
--
-- A row whose agent is not `'claude'` cannot exist: nothing has ever written one.
-- If somebody's database has one anyway, it is attributed to the Claude default
-- like everything else rather than dropped — a wrong profile is recoverable by
-- rescanning, a deleted discovery takes its sessions with it.
INSERT INTO discovered_projects_new(id, profile_id, key, real_path, project_id)
SELECT
	d.id,
	(SELECT p.id FROM profiles p WHERE p.agent = 'claude' AND p.is_default = 1),
	d.key,
	d.real_path,
	d.project_id
FROM discovered_projects d;

DROP TABLE discovered_projects;
ALTER TABLE discovered_projects_new RENAME TO discovered_projects;

-- Both indexes from 0004, which the rebuild does not inherit.
CREATE INDEX IF NOT EXISTS idx_discovered_project ON discovered_projects(project_id);
CREATE INDEX IF NOT EXISTS idx_discovered_real_path ON discovered_projects(real_path);
-- New, and the reason the scan can afford to be per-profile: every pass now
-- selects the directories of one profile at a time.
CREATE INDEX IF NOT EXISTS idx_discovered_profile ON discovered_projects(profile_id);
