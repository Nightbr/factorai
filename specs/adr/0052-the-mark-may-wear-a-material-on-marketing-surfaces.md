# ADR-0052 — the mark may wear a material on marketing surfaces

**Date.** 2026-09-19
**Status.** Accepted. Amends `specs/09-branding.md` B6 and widens the
exception ADR-0051 opened.

## Context

ADR-0051 let a marketing scene put a *transient* effect on the mark — heat, a
flash, a shake — provided the mark was the exact master at rest before and
after. Reviewing the hero's forge on 2026-09-19, the flat master at rest was the
thing that broke the scene: a hammer with environment-lit steel and a bevelled
face stamps the page, and what it leaves behind is a flat vector. The ask was a
mark with light on it — a metallic housing with edge detail — and it was asked
for explicitly as a marketing-side exception.

## Decision

On marketing surfaces only, the mark may carry a **material**: gradients, a
bevelled edge, a brushed texture, a lip on the F, a drop into the housing, a
specular sweep. Three things do not move:

1. **The geometry is the master's.** Housing, corner radius, ports, the F and
   its 45° cut are the B2 numbers, mirrored by hand the way the app's
   `geometry.ts` mirrors them. A material is paint on those shapes, never a
   redraw.
2. **The ports still cut to the ground.** Nothing is painted behind them.
3. **The exception stays where ADR-0051 put it.** The app, a dock, a README, a
   release page and every one-colour context get the flat master. The site's
   navbar and favicon use the flat master too; only the forge scene wears the
   material.

## Consequences

- `apps/docs/src/hero/MetalMark.tsx` is the forged mark: an inline SVG on the
  B2 geometry with the treatment in `<defs>`. It is a second hand-mirror of the
  master, and it owes the same guard `geometry.ts` has: a test that fails when
  its numbers and the master's disagree. Owed with item 58's other tests.
- B6's "no effects" rule now reads with two exceptions, both scoped to marketing
  surfaces and both recorded in ADRs; the rule itself is unchanged everywhere
  else.
