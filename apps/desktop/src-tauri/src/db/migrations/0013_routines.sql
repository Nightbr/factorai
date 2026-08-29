-- Routines: a project's scheduled prompts (F22, ADR-0026).
--
-- A routine is a first-class object under a project — a sibling of a session,
-- not a setting on one. When it comes due, `RoutineRunner` mints a session id
-- and the renderer spawns an agent with `prompt` as its first message, with no
-- tab (ADR-0026 § 2).
--
-- `cron` is **the** representation of the schedule, whatever wrote it: the
-- preset picker, the `Custom…` field and the later MCP tool all write this
-- column, so nothing translates between two dialects and a routine created by
-- an agent is editable by a human.
--
-- Three "last" columns rather than one, because they answer three different
-- questions and folding them together loses one of the answers:
--   * `last_fire_at`   — the last occurrence the scheduler **consumed**, run or
--                        skipped. This is the marker due-ness is computed
--                        against, and the reason a skipped fire does not come
--                        back every tick for the rest of the day.
--   * `last_run_at`    — when a session actually started. Written at spawn, not
--                        at completion, so a run that kill-on-quit takes still
--                        counts as having happened (F22): re-running an agent
--                        that already committed and pushed is worse than
--                        skipping it, and nothing can tell those apart after.
--   * `last_skipped_at`— when a fire was dropped because the previous session
--                        was still live. What lets the list say "skipped 10:00,
--                        still running" instead of silently doing nothing.
--
-- `catchup_hours` NULL means "use the app-wide default" from `settings`
-- (`routines.catchup_hours`); 0 means this routine never runs late.
CREATE TABLE IF NOT EXISTS routines (
	id              TEXT PRIMARY KEY,
	project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	name            TEXT NOT NULL,
	cron            TEXT NOT NULL,
	prompt          TEXT NOT NULL,
	enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
	catchup_hours   INTEGER,
	last_fire_at    INTEGER,
	last_run_at     INTEGER,
	last_session_id TEXT,
	last_skipped_at INTEGER,
	last_error      TEXT,
	created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_routines_project ON routines(project_id, created_at);

-- Which routine started a session (F22).
--
-- **No foreign key on `session_id`, deliberately** — this is migration 0007's
-- lesson applied up front rather than discovered a second time. A brand-new
-- session has no `sessions` row: that table is derived from transcripts and the
-- indexer only writes a row once Claude has written one, while the runner
-- writes here at spawn, which is strictly earlier. A constraint would fail on
-- every insert this table exists for. `session_worktrees` shipped that FK and
-- removed it a day later; this table skips the day.
--
-- **`ON DELETE SET NULL` on the routine, not CASCADE.** Deleting a routine
-- leaves its sessions running and listed (F22), so the row survives with a null
-- routine and the origin icon degrades to "started by a routine that no longer
-- exists". Cascading would quietly rewrite history to say those sessions were
-- started by hand.
--
-- Cleanup of the session side joins `reap_deleted`, which is where sessions are
-- actually deleted and which already exempts live ones.
CREATE TABLE IF NOT EXISTS session_routines (
	session_id TEXT PRIMARY KEY,
	routine_id TEXT REFERENCES routines(id) ON DELETE SET NULL,
	created_at INTEGER NOT NULL
);
