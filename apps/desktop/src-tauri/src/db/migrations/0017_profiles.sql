-- Several Claude identities on one machine, isolated by config directory
-- (F25, ADR-0036).
--
-- A profile *is* a directory plus a name. `CLAUDE_CONFIG_DIR` is the CLI's own
-- isolation boundary — credentials, `settings.json`, `projects/`, `ide/`, hooks
-- and MCP config all live under it — so switching identity is an environment
-- variable on one child process rather than a login we hold. Nothing in this
-- table is a secret, which is what keeps specs/07-open-questions.md Q3 and
-- "no Claude OAuth helper" intact.

CREATE TABLE IF NOT EXISTS profiles (
	-- uuid v4, minted by us. Deliberately not derived from the directory: a
	-- profile can be renamed and its directory re-pointed without orphaning the
	-- projects assigned to it (F25 slice 3).
	id         TEXT PRIMARY KEY,
	-- Which agent this is an identity *for*. There is no Claude profile on a
	-- Codex agent, so the column is what "one default" and "one per project" are
	-- scoped by. Only `'claude'` is written today; a second agent is an INSERT,
	-- which is the same reason `discovered_projects.agent` was written that way
	-- in migration 0004.
	agent      TEXT NOT NULL DEFAULT 'claude',
	name       TEXT NOT NULL,
	-- Absolute path. **UNIQUE, and that is load-bearing rather than tidy:** the
	-- scan iterates profiles, and two profiles over one directory would discover
	-- the same transcripts twice while `sessions.id` (a primary key) can only
	-- belong to one row — the two profiles would fight over every session on
	-- every pass. One profile per directory is also what makes "delete this
	-- profile" and "is this directory missing" have one answer each.
	config_dir TEXT NOT NULL UNIQUE,
	is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
	created_at INTEGER NOT NULL
);

-- **Exactly one default per agent, enforced here rather than in the service
-- layer.** A project with no assignment resolves to its agent's default profile,
-- so two defaults is not a cosmetic inconsistency: it is a spawn with no
-- deterministic identity. A partial unique index says it once, and `sqlite3` by
-- hand cannot get around it either.
--
-- Zero defaults is not expressible as a constraint and is prevented from the
-- other side: `services::profiles` refuses to delete or demote the last default,
-- and `ensure_default` creates one at boot when the table is empty.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_default_per_agent
	ON profiles(agent) WHERE is_default = 1;

-- Two profiles called "Work" on the same agent is a label that identifies
-- nothing, and the only place a profile is ever named is a list you scan by eye.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_name_per_agent
	ON profiles(agent, name);

-- ── One default, seeded with its directory left blank ───────────────────────
--
-- **The row is written here and its path is filled in at boot**, which is a
-- split with a cause: migration 0018 attributes every existing discovery to the
-- default profile, and `profile_id` is NOT NULL — so on a fresh install the row
-- has to exist by the time 0018 runs, which is before any Rust has had a chance
-- to write one. A static migration cannot read `CLAUDE_HOME`, so it cannot
-- supply the directory.
--
-- `config_dir = ''` is therefore "not yet resolved", and
-- `services::profiles::ensure_default` fills it in with `CLAUDE_HOME` or
-- `$HOME/.claude` before the first scan. That is also what keeps the environment
-- variable a *seed*: it is consulted for a blank row and never again, so it
-- cannot outrank this table for the life of the install.
--
-- SQLite has no uuid(); this is the standard randomblob() construction for a v4,
-- as migration 0004 uses — version nibble 4, variant nibble from 8/9/a/b.
INSERT INTO profiles(id, agent, name, config_dir, is_default, created_at)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
		|| substr(lower(hex(randomblob(2))), 2) || '-'
		|| substr('89ab', abs(random()) % 4 + 1, 1)
		|| substr(lower(hex(randomblob(2))), 2) || '-'
		|| lower(hex(randomblob(6))),
	'claude',
	'Default',
	'',
	1,
	CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE agent = 'claude');
