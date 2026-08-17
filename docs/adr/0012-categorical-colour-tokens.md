# ADR-0012 — Categorical colour lives in tokens, not in the component that needed it first

**Status.** Accepted (2026-08-17). Arises from
[F18](../../specs/05-features.md) (git graph).

## Context

Every colour in this app so far has been **semantic**: `primary`, `destructive`,
`muted-foreground`, `border`. Each one means something — this is the action, this
is dangerous, this is secondary — and there is exactly one right answer for any
given element. The theme defines them once in
`packages/ui/src/styles/globals.css` and nothing else invents a hex value; F13's
status letters take their colour "from the theme, not from new hex values", which
is the rule stated as a rule.

F18's lane rail is the first thing in the codebase that needs the other kind.
Lane 3 is not more dangerous or more secondary than lane 2; it is simply **a
different lane**, and its colour carries no meaning beyond *not the same as its
neighbour*. That is categorical colour, and the semantic palette cannot express
it: there is no principled way to say which of `primary` / `destructive` /
`accent` is lane 4.

It is also not decoration that could be dropped. Colour is what makes an edge
traceable across a merge in a 6–12px pitch inside a 288px panel, and tracing an
edge is the entire job of the feature — a monochrome rail is measurably harder to
follow, and F18's whole justification is being trustworthy at a glance. So the
question is not *whether* categorical colour enters the app; it is where it
lives.

Three options:

1. **Local to the graph.** An array of colours in the graph component, or a
   Tailwind class list beside it. Smallest possible footprint, claims nothing
   about the design system.
2. **Tokens in `globals.css`**, named for the role rather than the consumer, both
   themes defined, and the graph is their first consumer.
3. **Block on `DESIGN.md`** (roadmap item 24), establish the palette there, then
   build F18 against it.

Option 1 is how a second, subtly different palette shows up. There is precedent
in this repo for the failure mode it invites: `pnpm format` was not gated, so the
tree drifted out of format in 32 files and nothing said so. A colour set that
lives inside one component is a colour set the next consumer copies and adjusts,
and by then there are two.

Option 3 inverts the dependency. Item 24 is a documentation item — one home for
design rules that already exist — and it was picked up as ready precisely because
it is cheap. Making it a blocker for a feature turns it into something else.

## Decision

Categorical colour is defined as **tokens in
`packages/ui/src/styles/globals.css`**, alongside the semantic ones, and F18 is
their first consumer rather than their owner.

- Named for the role, not the caller: `--lane-1` … `--lane-N`, not
  `--graph-branch-colour`. The next thing that needs a categorical scale — a
  multi-series chart, per-agent colour coding, per-worktree tinting — reuses
  these rather than adding a parallel set.
- **Both themes, per the theme rules**: the light values on bare `:root`, the
  dark values redefined in the dark block. A categorical hue that works on
  `#fff` and is unreadable on `#1a1a1a` is the normal outcome of picking six
  colours once.
- **Chosen against the background, not against each other in isolation.**
  Adjacent lanes must be distinguishable at a 6px pitch, which is a much harder
  constraint than looking distinct as swatches, and it is the constraint the
  scale is actually for.
- Consumed through the token, never a literal. A component that needs lane
  colour reads `var(--lane-N)`; the cycling logic (`index % N`) belongs to the
  consumer, the values do not.
- **The size of the scale is part of the decision**, because it is what the
  cycling wraps around. Small enough that every entry is genuinely distinct,
  large enough that adjacent lanes rarely collide after wrapping.

`DESIGN.md` (roadmap item 24) then **documents this rule** rather than inventing
it — which is what that item is for.

## Consequences

**Good.**

- The one genuinely cross-cutting decision in F18 has a record in the place
  § 5 says cross-cutting decisions go, instead of being an array inside a
  component nobody thinks to look in.
- The next categorical consumer inherits a scale that has already been made to
  work in both themes, which is the expensive half.
- Nothing in F18's own spec has to carry colour values, so the feature can be
  re-styled without editing a feature spec.

**Bad.**

- It is a design-system decision made in service of one feature, by that
  feature. The scale will be validated against lanes in a narrow rail and
  nothing else, so the first *other* consumer may well find a gap — a chart
  needing eight distinct series where lanes needed six.
- It slightly front-runs item 24: a rule now exists that `DESIGN.md` has to
  accommodate rather than derive. That is the accepted cost of not blocking a
  feature on a documentation item.

**What this does not decide.** Nothing here says how many lanes the graph draws,
how they compress, or what happens past the rail's width budget — that is F18.
And it does not make the semantic palette extensible: `primary` and
`destructive` still mean what they mean, and this is a second scale beside them,
not a loosening of the first.
