-- Which identity a project's sessions run as (F25 slice 3, ADR-0036).
--
-- **No row means that agent's default profile.** So an existing install keeps
-- working with zero rows written, and "unassigned" is a real state rather than a
-- value somebody has to have chosen — the same shape `routines.catchup_hours`
-- uses for "inherit the app-wide setting".

CREATE TABLE IF NOT EXISTS project_profiles (
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
	-- **Denormalized from `profiles`, and the unique index below is the whole
	-- reason.** A project may be on one Claude profile *and*, when a second agent
	-- lands, one Codex profile — which is "one row per (project, agent)", and
	-- SQLite cannot build a unique index across the join that would otherwise
	-- answer which agent a profile belongs to. A trigger keeps the copy honest,
	-- because a copy nothing enforces is a copy that drifts.
	agent      TEXT NOT NULL,
	assigned_at INTEGER NOT NULL,
	PRIMARY KEY (project_id, profile_id)
);

-- One profile per project per agent. Reassigning is therefore a *move*, which is
-- what the Settings picker's tick does and what the project's menu does.
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_profile_per_agent
	ON project_profiles(project_id, agent);

CREATE INDEX IF NOT EXISTS idx_project_profile_profile ON project_profiles(profile_id);

-- The guard on the denormalized column. `RAISE(ABORT)` rather than a silent
-- correction: a mismatch means the caller believed something false about which
-- agent it was assigning, and quietly writing the right value would hide that.
CREATE TRIGGER IF NOT EXISTS project_profiles_agent_matches_insert
BEFORE INSERT ON project_profiles
FOR EACH ROW
WHEN NEW.agent <> (SELECT agent FROM profiles WHERE id = NEW.profile_id)
BEGIN
	SELECT RAISE(ABORT, 'project_profiles.agent must match the profile''s agent');
END;

CREATE TRIGGER IF NOT EXISTS project_profiles_agent_matches_update
BEFORE UPDATE ON project_profiles
FOR EACH ROW
WHEN NEW.agent <> (SELECT agent FROM profiles WHERE id = NEW.profile_id)
BEGIN
	SELECT RAISE(ABORT, 'project_profiles.agent must match the profile''s agent');
END;
