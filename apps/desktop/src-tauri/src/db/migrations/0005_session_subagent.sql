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
--
-- Rewritten for the schema 0004 leaves behind: the manufactured project is a
-- *discovery* now (`agent='claude'`, `key='subagents'` — the directory name
-- the watcher wrongly took for a store directory), and sessions hang off that
-- rather than off `projects.id`.
--
-- The workspace row it may be linked to is deliberately left alone. 0004
-- imported discoveries by resolved `real_path`, and this one resolves through
-- the transcripts' `cwd` to the *real* repository — on the database this was
-- written against it collapsed into the existing project for that folder. So
-- what `project_id` points at here is a folder you actually opened, not the
-- phantom; deleting it would take a real project with it.
--
-- FTS rows go first and by hand: `messages_fts` is a plain fts5 table with no
-- triggers and no cascade, so deleting sessions alone would leave every
-- sub-agent turn searchable and pointing at a session id that no longer
-- exists.
DELETE FROM messages_fts
WHERE session_id IN (
	SELECT s.id FROM sessions s
	JOIN discovered_projects d ON d.id = s.discovered_id
	WHERE d.agent = 'claude' AND d.key = 'subagents'
);

DELETE FROM sessions
WHERE discovered_id IN (
	SELECT id FROM discovered_projects WHERE agent = 'claude' AND key = 'subagents'
);

DELETE FROM discovered_projects WHERE agent = 'claude' AND key = 'subagents';
