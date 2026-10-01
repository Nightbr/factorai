<!--
Title: a conventional prefix — feat:, fix:, refactor:, test:, docs:, chore: —
and a sentence about the change. PRs are squash-merged, so the title becomes
the commit on main.

One PR, one slice. If it does two things, it is two PRs.
-->

## What and why

<!-- What changes for someone using factorai, and why. Link the issue. -->

Closes #

## Contract

<!-- The contract changes in the same PR as the code (AGENTS.md, "Branches, commits and PRs"). -->

- [ ] No spec or ADR change needed
- [ ] Spec updated: <!-- specs/… -->
- [ ] ADR added: <!-- specs/adr/NNNN-kebab-case-title.md -->

## How it was checked

CI runs the whole gate except `pnpm e2e` (Playwright). Tick what you ran.

- [ ] `pnpm e2e`
- [ ] Used the change in the real window (`pnpm dev`), which UI and behaviour
      changes need: type checking does not validate UX
- Platform: <!-- macOS / Linux / Windows via WSL 2 -->

## Screenshots or video

<!--
Required on every PR: show the app with the change in it.

- A visible change: before and after screenshots, or a short video (drag a
  .mp4 or .gif into this box) when it moves, such as a drag, an animation, or
  a flow across several steps.
- No visible change (a refactor, a backend fix, CI): show the surface it
  touches still working in the real app.

Use a fabricated workspace, not your own projects or sessions: no real paths,
names or tokens on screen.
-->

## Notes for the reviewer

<!--
Anything that surprised you, anything you are unsure of, anything the next
person to touch this code should know. This is where the gotchas go.
-->
