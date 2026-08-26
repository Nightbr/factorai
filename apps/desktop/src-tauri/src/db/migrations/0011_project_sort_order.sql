-- Where a project sits in the sidebar is a decision you made, not one we derive.
--
-- Pinning was a one-bit approximation of an ordering: it could say "this matters"
-- and nothing else, and it forced the list into two tiers that the sort control
-- then had to mean the same thing inside both of. An ordinal says the same thing
-- with more resolution and no tiers. See roadmap item 28 and the ADR it names.
--
-- The sort control survives and grows a `Manual` mode alongside `Name` and
-- `Recent`, so the derived orders are a *view* over this column rather than a
-- competitor to it.

-- ── The ordinal ─────────────────────────────────────────────────────────────
--
-- DEFAULT 0 rather than NOT NULL with no default, because `add_project` inserts
-- without naming the column and then reads `MIN(sort_order) - 1` for the top
-- slot. A row that briefly shares an ordinal with another is harmless:
-- `PROJECT_SELECT` tie-breaks on `display_name`, so the list order is
-- deterministic even while the values are not dense.

ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- ── Seed from what the sidebar shows today ──────────────────────────────────
--
-- `pinned DESC, display_name ASC`, and **not** the recency order that the
-- default sort actually displays. `last_session_at` is not a column — it is a
-- MAX(sessions.updated_at) subquery computed per `PROJECT_SELECT` — so seeding
-- from it means reproducing that join here, and the whole point would have been
-- an invisible upgrade.
--
-- It is visible instead: someone on the default `recent` sort watches their
-- sidebar go alphabetical once, and then it stays put forever, which is the
-- feature. That trade is only acceptable because `Name` survives on the sort
-- menu — the seeded order is one the user can ask for again by name, so the
-- one-time reshuffle lands somewhere they can reason about rather than somewhere
-- arbitrary. Pins are honoured on the way through, so the rows someone marked as
-- mattering keep their place at the top.
--
-- Correlated COUNT(*) rather than ROW_NUMBER(): both work on 3.45, and this one
-- reads as the definition of the rank it computes. Projects are counted in tens.

UPDATE projects
   SET sort_order = (
	SELECT COUNT(*) FROM projects q
	 WHERE q.pinned > projects.pinned
	    OR (q.pinned = projects.pinned AND q.display_name < projects.display_name)
   );

-- ── And the flag goes ───────────────────────────────────────────────────────
--
-- **This does not need a table rebuild**, which the roadmap entry for this work
-- got wrong twice before it was measured. SQLite's DROP COLUMN restriction is on
-- *table-level* CHECK constraints, not inline column ones: the drop is
-- implemented by rewriting the CREATE TABLE text and re-parsing it, so an inline
-- CHECK leaves with the column it is attached to. `pinned` is declared inline in
-- 0004, is not indexed, is not a key and is not named in a foreign key, so this
-- one statement is the whole job. `missing`'s own inline CHECK keeps being
-- enforced afterwards, and `discovered_projects.project_id` is untouched.
--
-- Worth knowing for the next migration that *does* need a rebuild: the obvious
-- recipe (create, copy, DROP TABLE, rename) cannot be made safe here from inside
-- a migration. `DROP TABLE projects` fires `discovered_projects.project_id`'s
-- ON DELETE SET NULL and unlinks every session from its project, and the usual
-- guard — `PRAGMA foreign_keys = OFF` — is a **silent no-op**, because
-- `Db::migrate` runs every migration inside one transaction and SQLite ignores
-- that pragma inside a transaction. Such a migration has to stash and restore
-- the links itself, or the runner has to learn to run it outside the shared
-- transaction.

ALTER TABLE projects DROP COLUMN pinned;
