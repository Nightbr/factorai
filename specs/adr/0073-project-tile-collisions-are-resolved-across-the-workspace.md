# 73. Project tile collisions are resolved across the workspace

Date: 2026-10-08

Status: Accepted. **Amends [ADR-0072](0072-project-tiles-hash-the-name-to-a-curated-palette.md)**:
replaces its consequence 3, widens its palette and drops its dark-ink tone.

## Context

ADR-0072 made the project tile a hash of the display name into 22 swatches and
accepted that two projects could land on one — "stable-per-name was judged the
more valuable property". The first workspace it met had a sidebar group of two
projects, adjacent, in the same orange. With 22 slots the chance that a dozen
projects contain at least one pair is above 95%; it is not an edge case, it is
the expected case, and the whole reason the palette was rebuilt was that tiles
could not be told apart.

The alternative ADR-0072 weighed and declined was allocating colours globally,
the way the commit graph allocates lanes, because then a project's colour would
depend on which other projects exist. That framing missed a middle: keep the
hash as each project's *preferred* slot, and only move a project when its slot
is already held.

Two smaller things came back from the same workspace. 22 slots is a low
ceiling for an allocator — a user with twenty projects would be two collisions
from a full palette. And the bright tone's near-black initials, ADR-0072's way
of making the second tone read as a different tile, read as *less legible*
rather than more distinct; white on the same fill was preferred.

## Decision

- **The palette is 30 swatches**: fifteen hand-spaced oklch hues, still
  leaving the amber band empty, at two weights — `oklch(45% 0.12 h)` and
  `oklch(56% 0.17 h)` — **both with near-white initials**. Fifty was asked
  for and is not available: fifty tiles that carry white initials and still
  look different from one another at 16px do not exist in one hue circle, and
  a third, darker tone was tried and read as the deep tone in shadow.
- `assignProjectSwatches(projects)` computes every project's tile for the
  workspace at once. Projects are taken in `id` order; each takes its hashed
  slot if free, otherwise the next free slot seven on (seven is coprime with
  30, and the next slot *along* would be the neighbouring hue — red bumped to
  orange, the near-miss the palette exists to avoid). Under 30 projects no two
  tiles are the same. Past 30 the palette is full and the hashed slot stands.
- **Ordered by `id`**, which is arbitrary but fixed. Sidebar position and
  recency both change under the user's hands, and a tile that changed colour
  because its project was dragged up the list would be one nobody could learn.
- `ProjectIcon` reads the assignment through `useProjectSwatch`, off the same
  `projects` query the sidebar already polls, so every tile on screen agrees.
  Before the list has arrived, or for a name not in it, the hashed swatch
  stands in: for a project with no collision that is the tile it keeps.
- Projects sharing a folded name are one entry, as ADR-0072 decided.

## Consequences

1. Every tile changes once more on upgrade, because the palette changed shape;
   after that, a project with no collision keeps its hashed tile.
2. A project's colour can change once when another project is added that
   hashes to its slot and sorts before it by `id`. With v4 ids the chance of
   that is half the chance of a collision, so a few percent per added project.
   The alternative was the added project always yielding, which needs a
   creation order the `Project` contract does not carry; adding one to settle
   this was judged more contract than the problem deserves.
3. Two tiles are distinct only *within* a workspace: the same name may draw a
   different tile on another machine where it collides with something else.
4. The tile depends on the project list, so `ProjectIcon` paints a stand-in for
   the one frame before the list resolves. The stand-in is right for every
   project that does not collide.
