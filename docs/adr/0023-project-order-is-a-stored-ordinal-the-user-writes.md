# ADR-0023 — Project order is a stored ordinal the user writes

**Date:** 2026-08-26
**Status:** Accepted

Related, and **neither superseded**:
[ADR-0011 — a project is a folder in the workspace](0011-a-project-is-a-folder-in-the-workspace.md) ·
[ADR-0016 — dnd-kit for pointer-based reordering](0016-dnd-kit-for-pointer-based-reordering.md)

## Context

The sidebar's project list has had two ordering mechanisms since M1, and they
were never really one design.

The first was **`projects.pinned`**, a boolean written by `pin_project`. Pinned
projects floated into a block at the top of the list, above a headerless
divider. The second was a **sort control** offering `Recent` and `Name`, held in
`sidebarStore` — `Recent` meaning "keep whatever `list_projects` returned", since
that query ordered by `pinned DESC, last_session_at DESC, display_name ASC`.

The two had to be reconciled, and F1 reconciled them by declaring that the sort
applied *inside both groups*, "so the control means one thing wherever you look".
That sentence is the tell. It is a rule that exists only because the list has two
tiers, and the tiers exist only because a pin is the coarsest possible ordering:
one bit, saying "this matters" and nothing else. A user who wants three projects
in a particular order among themselves has no way to say so, and a user who wants
one project fourth from the top has no way to say that either.

Meanwhile the app already owned a hand-ordering gesture. `SessionTabs` reorders
by drag (ADR-0016), so the mechanism, the library, the activation constraint and
the keyboard-path precedent were all already paid for.

The question this ADR answers is what the sidebar's order *is* — where it lives,
who writes it, and what the derived orders are relative to it.

## Decision

**A project's place in the sidebar is a stored per-project ordinal that the user
writes by dragging. The derived orders are views over it. There is no pinned
flag.**

Concretely:

1. **`projects.sort_order INTEGER NOT NULL`** (migration 0011) is the order.
   Storage, not preference: Rust reads it to order `list_projects`, which per
   ADR-0013 is what decides it belongs in SQLite rather than in one of the
   localStorage stores.

2. **`pinned` is dropped**, and 0011 seeds the ordinals from
   `pinned DESC, display_name ASC` — so an existing pin is carried forward as a
   *position* rather than discarded. The pin was an approximation of this column;
   there is nothing left for it to approximate.

3. **One command writes the whole list.** `reorder_projects(ids)` rewrites every
   ordinal in one transaction and **rejects an id set that no longer matches the
   table**. A per-row "move up" was rejected: it leaves gaps, it races the
   sidebar's 2s poll, and it cannot notice that the list it is moving a row
   within is not the list the user was looking at.

4. **Three sort modes, one stored and two derived.** `Manual` reads
   `sort_order`; `Name` and `Recent` derive an order from fields the row already
   carries and write nothing. The drag is live in `Manual` only — a derived order
   has nowhere for a drop to land, and an ordinal written behind a rule that
   overrides it is a change the user cannot see.

5. **`Project` carries `sortOrder` across the IPC boundary.** The renderer holds
   a list whose display order may not be the manual order, so recovering the
   manual order from a field beats recovering it from the array the backend
   happened to return — and it lets the optimistic write keep the cached ordinals
   consistent rather than only the array positions.

6. **The gesture is dnd-kit, as ADR-0016 decided**, with that ADR's 4px
   activation constraint and a `Alt`+arrows keyboard path rather than
   `KeyboardSensor`.

## Why this is not a supersede

Roadmap item 28 originally called for this ADR to supersede both of the ADRs
above. It does not, and the reasoning is worth recording because the alternative
was one edit away.

**ADR-0011** decided that project identity is a uuid rather than a path, and part
of its argument was that this lets a folder be moved or renamed "without
orphaning its pins". Pins are gone; the argument is untouched. A hand-assigned
ordinal is *exactly the same kind of thing* a path-derived identity would throw
away — a record of a decision the user made about a folder, which has to survive
the folder moving. If anything this ADR strengthens 0011's case, because there is
now more of that kind of data on the row, and item 41's `group_id` will add more
still.

**ADR-0016** decided to reorder with dnd-kit rather than HTML5 drag-and-drop.
That decision is what this one builds on. What reads stale in it is one sentence
naming "roadmap item 28's pinned-project reordering" as the future surface that
would reuse the library — a description of a surface, not a decision about one.

A supersede link means *this decision was revised*. Spending it on two decisions
that both stand would make the chain less trustworthy rather than more: someone
reading `docs/adr/` later would see ADR-0011 marked superseded and reasonably
conclude that a project is no longer a folder in the workspace. So both are
linked, both are left standing, and this file is where the ordering model is
written down.

## Consequences

**What gets better.** The list stays where you put it — the ask this came from.
`Name` survives as a mode, so there is still a rule-based way to find a row in a
list you have not curated. And item 41 (project groups) lands on top of this
rather than beside it: a group is one more table and one more column under the
same decision, with the same `reorder_projects` growing a scope.

**What it costs.** `Manual` is the default, so a forty-project sidebar becomes a
list you maintain. That is the trade the ask makes, and item 41's groups and their
collapse are the mitigation — which is why the two roadmap items were filed
together and sequenced this way round.

**Ordinals go sparse, on purpose.** `add_project` writes
`COALESCE(MIN(sort_order), 0) - 1` so a new project lands on top without an
UPDATE over every row, and `remove_project` leaves a hole. `list_projects`
therefore tie-breaks on `display_name`, which is what keeps the order
deterministic while the values are not dense; the next drag renumbers from zero.
A future migration must not assume the column is a permutation of `0..n-1`.

**One migration lesson worth keeping.** Dropping `pinned` needed no table
rebuild: SQLite's `DROP COLUMN` restriction is on *table-level* CHECK
constraints, not inline column ones, and `pinned`'s CHECK was inline. The rebuild
recipe the roadmap had planned would also have been unsafe here — `DROP TABLE
projects` fires `discovered_projects.project_id`'s `ON DELETE SET NULL` and
unlinks every session, and `PRAGMA foreign_keys = OFF` is a silent no-op inside
the single transaction `Db::migrate` wraps every migration in. Any future
migration that does rebuild a referenced table has to stash and restore the links
itself, or the runner has to learn to run that one outside the shared
transaction. Both facts are recorded in 0011's own comments.
