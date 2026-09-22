-- Where a session's transcript is, for an agent whose path is not derivable
-- from the id and the folder (F30 § "Storage", ADR-0060).
--
-- Claude's is `<store>/projects/<encoded cwd>/<id>.jsonl` and stays NULL here.
-- Codex writes `<store>/sessions/YYYY/MM/DD/rollout-<local ts>-<uuid>.jsonl`:
-- the timestamp is Codex's clock at creation and appears nowhere else, so the
-- indexer records the path it found the file at and `Transcripts::locate`
-- reads this column first and derives second.
ALTER TABLE sessions ADD COLUMN transcript_path TEXT;
