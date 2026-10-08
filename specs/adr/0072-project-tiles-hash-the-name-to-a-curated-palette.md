# 72. Project tiles hash the display name to a curated palette

Date: 2026-10-08

Status: Accepted. Amends Q11 in `specs/07-open-questions.md`.

## Context

Q11 decided the project icon: initials over a colour hashed from the project
path, `hsl(h, 60%, 35%)` with white text. It was cheap and it was enough for
the four or five projects a workspace held when it was written.

With a dozen projects it stopped doing its job. A sidebar of ten projects
showed in two colours, and the tab strip — where the tile is 16px and the name
is truncated — could not be scanned by colour at all. Three things conspired:

- **The hash was weak on the inputs it got.** Every path in a workspace shares
  a long prefix, and the djb2 variant in use, `h * 33 ^ c` in double
  arithmetic, loses the high bits before the part of the string that differs.
- **HSL is not perceptual.** At 35% HSL lightness, blue, indigo, violet and
  magenta all read as "purple", and yellow-green, green and teal all read as
  "green". A hue circle with 360 positions had perhaps five tellable colours in
  it.
- **One tone.** Every tile had the same fill weight and the same white
  initials, so hue was the only thing that varied, and hue was the thing that
  was failing.

Separately, the path was the wrong seed. The name is what the human reads next
to the tile; a project moved on disk is the same project; and the same
repository checked out on two machines, or as a worktree beside its clone,
should draw the same mark.

## Decision

- **Seed on the display name**, folded to lower case and trimmed, hashed with
  FNV-1a (the hash the commit graph's author avatars already use, now shared
  from `lib/hash.ts`). `ProjectIcon` loses its `path` prop.
- **A curated palette, not a hue circle.** Eleven oklch hues, hand-spaced so
  that neighbours read as different colours when judged as a row of 16px
  tiles — not an even twelve, which stacks three greens and leaves red-to-orange
  thin. The band around hue 75 is empty: amber is the One Amber Rule
  (`DESIGN.md`), the `waiting` badge sits on the tile's own corner, and a tile
  that was itself amber would always look like the human's turn.
- **Two tones per hue**, for 22 swatches: a deep fill, `oklch(46% 0.13 h)`,
  with near-white initials, near the weight the old tile had; and a bright
  fill, `oklch(60% 0.15 h)`, with near-black initials. The ink flip is what
  makes the two tones read as different tiles rather than the same tile under a
  different light.
- **Fill and ink are fixed values, not theme tokens.** The pair is a property
  of `lib/icon.ts`, so it holds in both themes without the per-theme variant
  Q11 specified and nothing ever implemented.

## Consequences

1. Every project's colour changes once, on upgrade. There is no stored colour
   to migrate; the tile is derived, as it always was.
2. Two projects with the same display name draw the same tile. That is the
   point for a clone and its worktree, and a mild cost for two unrelated repos
   that happen to share a name — the name beside the tile is the same in that
   case too, so the colour was never going to tell them apart.
3. Collisions still exist: 22 swatches and a hash means two projects can land
   on one tile. Allocating colours globally, the way the graph allocates lanes,
   would avoid that at the cost of a project's colour changing when another is
   added; stable-per-name was judged the more valuable property for a mark the
   human learns.
4. `SearchHit.projectPath` is no longer needed to draw the icon; it stays in the
   contract for the row's hover title.
5. The guide and README screenshots show the new tiles the next time they are
   re-shot; they are derived from the fixture workspace (ADR-0071), so nothing
   has to be hand-edited.
