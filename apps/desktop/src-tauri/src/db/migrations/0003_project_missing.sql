-- Whether the project's folder is gone from disk (F1 + F6).
--
-- Set by the indexer while it scans, not computed per `list_projects` call:
-- the list is polled every 2s and stat-ing every project on every poll would
-- put the filesystem in a hot path to answer a question that changes rarely.
--
-- Defaults to 0 so existing rows read as present until the next scan, which is
-- the right way round — claiming a project is missing when we haven't looked
-- would gray out a working row.
ALTER TABLE projects ADD COLUMN missing INTEGER NOT NULL DEFAULT 0 CHECK (missing IN (0, 1));
