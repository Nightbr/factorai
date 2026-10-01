# 71. The README is illustrated from the same scripted world as the guide

Date: 2026-10-01

Status: Accepted. **Amends [ADR-0066](0066-the-guide-is-illustrated-from-scripted-shots-of-the-mock-bridge.md)**,
reversing its consequence 1. Issue #11 (roadmap item 61), its last checkbox.

## Context

ADR-0066 moved the guide's pictures to Playwright scripts against the mock
bridge, and kept the README's five images in `assets/images/` on the real
window through `scripts/qa/doc-shot.sh`, reasoning that a README's hero picture
is the whole window.

Those five predate the invented world. Item 61's last checkbox asked for them to
be re-shot "from the same fixture", so that the README and the guide stop
showing two different workspaces. Doing that in the real window means
`scripts/qa/fixture-workspace.py`, and that has a gap ADR-0066 consequence 3
named and left: a session opens `claude --resume` in the fixture's config
directory, which has no account. The sessions picture, the README's first and
most important, would show an agent that cannot start. Filling the store with a
real account to close the gap is not something an agent should do, and a human
doing it once leaves a picture nobody else can reproduce.

Two other facts weaken the reason for the real window:

1. **The window frame is cropped off anyway.** `doc-shot.sh` keeps the client
   area and drops the titlebar, which is the WM's, not factorai's. A 1440×900
   viewport of the renderer is the same rectangle.
2. **The guide's scripts already reach every state the README shows** — three
   tabs with three statuses, a search with results, a project's routines, a
   Changes panel with a diff open, the graph with a commit open. Each README
   picture is the same moment, framed wider.

## Decision

**The README's images are whole-window captures taken by the guide's scripts**,
in `tests/docs-shots/`, at the end of the test that sets up the matching guide
shot.

- `windowShot(page, subject)` in `tests/docs-shots/capture.ts` writes the full
  1440×900 viewport at device scale 2 to `assets/images/factorai-<subject>.png`,
  so a README image is 2880×1800 and GitHub scales it down sharp.
- Before the whole-window capture a test may dress what the guide's crop left
  out: expand the sidebar, write the agent's output into the terminal. It does
  so after the guide's own shot, so the guide image is unchanged.
- `pnpm docs:shots` re-takes both. There is one world, `tests/docs-shots/world.ts`.

## Consequences

1. The README, the guide and the site's mock show the same projects, groups and
   sessions, and nothing in any of them needs blurring.
2. A README picture can disagree with the app only where the mock does, as
   ADR-0066 consequence 2 already says of the guide.
3. `scripts/qa/doc-shot.sh` and `redact.py` stay, for a release note or a bug
   report that has to show this machine's real window. They no longer produce
   anything in `assets/images/`.
4. The images are four times the pixels of the old ones, 150 to 400 KB each.
