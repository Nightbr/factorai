# ADR-0011 — A project is a folder in the workspace, not a directory Claude has

**Status.** Accepted (2026-08-16). Extends [ADR-0004](./0004-claude-dir-is-read-only.md).

## Context

Nothing in `docs/adr/` ever recorded what a project *is*. `specs/05-features.md`
F1 asserted it in prose — the row's id is "Claude Code's own directory encoding
of the path", and that was "the whole design" — and the schema agreed:
`projects.id` was the directory name under `~/.claude/projects/`, and
`indexer::full_scan()` upserted a row for every directory it found there.

So the workspace was a **mirror of a directory**, and three things followed
that we didn't want:

1. **Projects arrived uninvited.** Every folder Claude had ever been run in
   appeared in the sidebar, in the order Claude happened to touch them. The
   user's words: *"aujourd'hui ça ajoute toutes les sessions claude par projet
   sans contrôle — je pense que ça devrait juste être une étape d'import"*.

2. **Closing a project was impossible.** Not an oversight — a `DELETE FROM
   projects` was undone by the next `full_scan()` or the next watcher tick,
   because the table was derived state. Any close button built on that schema
   would lie within one second.

3. **A second agent had nowhere to go.** Identity was one agent's naming
   scheme, so a codex session — with a different store and a different
   directory convention — could not be a project at all without a parallel id
   space.

The prose in F1 was not wrong about the *mechanism*: sharing Claude's encoding
is exactly what made `add_project` and the indexer's upsert land on one row
instead of two, and two tests guarded it. What was wrong was making that
mechanism the **identity**.

## Decision

**A project is a folder you added.** An agent's transcript store is a
*discovery source*, not the workspace.

Two tables with two owners, and the ownership is the point:

```
projects                      -- what you added. Only user actions write here.
  id            TEXT PK       -- uuid v4
  real_path     TEXT UNIQUE   -- canonical; the identity you can see
  display_name, pinned, missing, opened_at

discovered_projects           -- what an agent's store holds. Only the scan writes here.
  id            INTEGER PK
  agent         TEXT          -- 'claude'
  key           TEXT          -- the agent's own directory name
  real_path     TEXT          -- the folder it describes, when resolvable
  project_id    TEXT NULL REFERENCES projects(id) ON DELETE SET NULL
  UNIQUE (agent, key)

sessions.discovered_id -> discovered_projects.id
```

Consequences of the shape, each one deliberate:

- **`projects.id` is a uuid, not a path.** Identity is a record of a decision,
  so it does not change when the folder does — which is what will later let a
  moved or renamed folder keep its project, its pin and its tabs by updating
  `real_path`. Duplicate prevention moves from "both sides compute the same
  encoding" to `real_path UNIQUE`, which is the same guarantee without
  borrowing another program's naming scheme.

- **The link lives on the discovered row, not on the session.** Adding or
  removing a project updates a handful of rows rather than every session in it,
  and `ON DELETE SET NULL` makes removal cheap: the discovery survives, only the
  membership goes.

- **Sessions attach by canonical path, exact match only.** A session recorded in
  `/repo/apps/web` belongs to `/repo/apps/web`, not to `/repo`, even when only
  the latter is in the workspace. Rolling up to the nearest added ancestor was
  considered and rejected: it turns every session lookup into a prefix scan and
  needs a tie-break the moment a folder and its parent are both added.

- **`encode_path` moves to `agents::claude`.** It stops being identity and
  becomes what it always was — how one agent names its own directories. The
  module is the seam; there is deliberately **no trait**, because a trait with
  one implementor is a guess about the second agent's shape made before we have
  seen one. ADR-0004 generalises with it: *every* agent's store is read-only,
  not just Claude's.

- **Indexing and search are both gated on the workspace.** Discovery stays
  global and cheap (one `read_dir`, plus one partial file read per directory to
  recover `cwd`), but only added folders are parsed and tokenized. Removing a
  project drops its rows from the index; adding it back re-parses from the
  transcripts, which never moved.

**Migration 0004 imports everything that already existed.** Someone with thirty
projects opens the new build and sees thirty projects. An empty sidebar with a
helpful modal is data loss as far as they are concerned, whatever the schema
says. Directories whose folder was never resolved are the one exception — a
workspace is keyed by folder and we do not know which one those describe, so
they stay discovered-but-unadded rather than being guessed at.

## Consequences

**What gets better.** Removing a project works and stays worked. The sidebar is
what you chose rather than what Claude accumulated. Cold start gets faster in
proportion to how much of the store you don't use. A folder Claude has never run
in is a first-class project rather than F1's embarrassed footnote about it
"[not being reachable] from the app at all".

**What gets worse, and was accepted knowingly.** Search no longer reaches
outside the workspace. Today F4 finds a conversation in any folder Claude ever
touched; after this it finds only what you added, and the recovery path is
"remember the folder, add it, search again" — which is precisely the moment you
can't remember. Gating the index is what makes this coherent rather than merely
restrictive: there is nothing to find because nothing was parsed, not because a
filter hid it. If this proves wrong in use, the fix is to un-gate indexing and
drop the `project_id IS NOT NULL` clause in `services/search.rs`, which is two
lines and a reindex — the schema does not need to change.

**Persisted UI state keyed by the old ids is dropped**, not remapped:
`sidebarStore.expanded` and `panelStore.expandedByProject` hold expand/collapse
state, worth one click, and a one-shot async remap in the renderer that has to
finish before first paint is real complexity for a collapsed tree.

**What this does not do.** No second agent is implemented. No projects-directory
override is reopened (`specs/07-open-questions.md` Q3 stands). Nothing under
`~/.claude/` is written, moved or deleted, by this or any other code path —
ADR-0004, now stated of agent stores generally.
