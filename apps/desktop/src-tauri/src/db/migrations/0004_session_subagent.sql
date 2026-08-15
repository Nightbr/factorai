-- Sub-agent transcripts. Claude Code writes each agent a session spawns to
-- <session-id>/subagents/agent-*.jsonl inside the project directory. They are
-- indexed as session rows with `subagent_of` set to the parent session id —
-- real sessions of a kind (searchable, readable), but never resumable and
-- never counted as the project's own.
--
-- Deliberately NOT a foreign key: the scan may index a sub-agent before its
-- parent (read_dir order is arbitrary), and an enforced reference would turn
-- that ordering into an error. Orphaned rows (parent transcript deleted) sort
-- as top-level but keep their marking.
ALTER TABLE sessions ADD COLUMN subagent_of TEXT;

-- The watcher used to treat a changed sub-agent transcript's direct parent
-- (…/<session>/subagents) as a project directory, which manufactured a project
-- literally named "subagents" and filed the agent transcripts under it as
-- ordinary sessions. Opening one then probed for a top-level transcript that
-- doesn't exist and spawned a fresh `claude` under the agent's id. Delete
-- those rows; the next scan re-indexes them under their real project with
-- `subagent_of` set.
DELETE FROM sessions WHERE project_id = 'subagents';
DELETE FROM projects WHERE id = 'subagents';
