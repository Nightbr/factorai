# ADR-0051 — the site is `apps/docs`, and the mark may move there

**Date.** 2026-09-19
**Status.** Accepted. Amends `specs/09-branding.md` B6 and closes the location
question in roadmap item 39; item 58 records the hero's scenario.

## Context

Roadmap item 39 settled one Docusaurus site with the hero (item 58) as its
index, and left where it lives in the repository open, suggesting `site/` and
ruling out the root `docs/`, which then held the ADRs, the brand masters and the
README screenshots. Building the hero made both halves of that concrete.

The hero the brief asks for is a five-step animated intro whose last scene is a
forge: an industrial hammer strikes the factorai icon, with sparks, a flash of
amber and a moment of heat on the mark itself. B6 says the mark takes **no
effects** — no gradient, shadow, glow, stroke, bevel or rotation — and gives the
reason: the mark ships inside other people's docks and release pages, where a
treatment cannot be corrected later. That reason is sound and it does not
describe a scene on a web page.

## Decision

1. **The site is a workspace at `apps/docs`.** Not `site/`: the site is an app
   in this monorepo like the desktop renderer, and one `apps/*` glob gives it the
   same `pnpm install`, Biome, turbo, syncpack and knip as everything else. The
   root `docs/` folder is dissolved the same day so the word stops meaning three
   things: `docs/adr` → `specs/adr` (a decision sits beside the spec it
   constrains), `docs/brand` and `docs/images` → `assets/`.

2. **B6 gains one exception, for marketing surfaces only.** A transient effect on
   the mark — heat, glow, flash, shake — is allowed *while a scene plays*, on the
   site's hero or a launch video, provided the mark is the exact master at rest
   before and after. The fills, the ports cutting to the ground and the 45° cut
   never change. The exception does not reach the app, a dock, a README or a
   release page; the argument B6 makes about those surfaces is untouched.

3. **The site copies the icon master rather than importing it.** Docusaurus serves
   `static/`, and a build step to copy one SVG across is the same machinery B5
   already declined for the favicon. The copy is guarded the same way once the
   hero is promoted: a test that fails the moment it and `assets/brand/` diverge.

## Consequences

- Every reference to `docs/adr`, `docs/brand` and `docs/images` was rewritten in
  one commit, including the relative links inside the ADRs, which are otherwise
  immutable. Older ADRs and `DONE.md` entries that name `docs/adr` in prose
  describe where things were when they were written.
- `pnpm dev` still means the desktop app: the site's dev script is `start`, so
  turbo's `dev` task does not launch it. `pnpm --filter @factorai/docs start`.
- The quality workflow builds the site on every push, as it builds the renderer:
  `tsc` does not catch a broken MDX import or a dead internal link, and
  Docusaurus's build does.
- The hero's prototypes live under `src/pages/proto/` and are throwaway. Nothing
  under that path is a contract; the promoted page is.
