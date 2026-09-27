# 68. The first-run doors are tiles, at the optical centre

Date: 2026-09-27

Status: Accepted. Amends ADR-0067 decisions 2 and 4: the doors' form and the
halo's shape. Everything else in 0067 stands.

## Context

ADR-0067 shipped the empty workspace with two solid amber `lg` buttons,
*Add Project…* and *Import from… ▾*. Each had a halo: an 18px blur at 45%
amber. The user looked at it the same day and made three points:

- The buttons' look and feel was "not great".
- The block should be centred visually.
- Claude and Codex should have their icons.

Looking at the capture, the problems were:

1. **They looked like any form's buttons.** At 36px with medium-weight text, a
   pair of commands does not read as a choice between two ways to start.
2. **The halo was muddy.** A wide blur of amber at high opacity over the
   near-black ground comes out brown, not glowing.
3. **The block looked low.** It sat at the pane's geometric centre, and the eye
   reads the true middle of a tall area as sitting below it.

## Decision

1. **The two doors are Door Tiles** (DESIGN.md § Door Tile). The user chose
   this from three options, the other two being larger solid buttons and a
   solid button beside an outline one.
   - Each tile is 240px wide, on the panel tone, with a 1px amber edge.
   - Each carries a 20px amber mark, a semibold title and a muted hint:
     - **Add a folder**, *Any folder on this machine*. Its mark is `FolderPlus`.
     - **Import history ▾**, *From Claude Code or Codex*. Its mark is both
       agents' marks side by side.
   - Hover is a tonal step with the edge at full amber, not an amber fill.
2. **The agents' marks go wherever an agent is chosen for import:** the tile,
   every import menu item (the header's and the tile's), and the dialog title.
   They use the existing `AgentMark`.
3. **The halo is a ring, not a blur.** A spread shadow breathes from 1px at 10%
   to 4px at 22%, with a faint 16px bloom at the peak, on the same 3s loop and
   the same separate layer.
4. **The block sits at the optical centre**, using spacers of 2 : 3 above and
   below instead of `justify-center`.

## Consequences

1. The labels differ between the two places the doors appear:
   - The hero says *Add a folder* and *Import history*.
   - The sidebar's header menu keeps *Add Project…* and *Import from …*.

   A menu item names a command. A tile names a choice, with its hint saying
   what the choice covers.
2. The test ids are unchanged (`empty-add-project`, `empty-open-import`), so the
   smoke suite and the shot scripts did not move.
3. The Door Tile is a new component shape. DESIGN.md scopes it to "the same kind
   of fork in the road", so it does not become a card for every action.
