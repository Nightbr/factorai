# 66. The guide is illustrated from scripted shots of the mock bridge

Date: 2026-09-26

Status: Accepted. Roadmap item 61; reverses that item's rejection of the mock
bridge as a subject.

## Context

The guide under `apps/docs/docs` was fourteen pages with no pictures. On
2026-09-26 the user asked for every part to be illustrated: stills of the
surface each section describes, and GIFs for flows, naming three. The update
path, *Check for updates → Downloading → restart to update*. Settings →
Agents. The sidebar being reordered and grouped, with invented project names.

Item 61 had planned this as a manual pass in the real window against
`scripts/qa/fixture-workspace.py`, and had rejected the mock bridge because
"a picture of it is a picture of something else": no titlebar, no real PTY, no
real diff. Three things about the request change that weighing:

1. **Most of what it asks for are states, not a workspace.** An update that is
   downloading, a routine editor with its next runs, a drag halfway through a
   group, a card with a bad override path. The real window reaches them only by
   waiting for, or provoking, the real thing. The mock bridge reaches each from
   a fixture field.
2. **A GIF is a sequence of states at known times.** Driving the real window
   for one means synthetic input on the desktop, which has sent a click into
   another app once and has taken the session down once (the `manual-qa`
   skill). A browser that owns its own viewport has neither risk.
3. **Pictures rot.** A manual pass is a one-off; the next surface change makes
   its picture wrong and nobody re-takes it. A script can be re-run.

What a mock-bridge picture shows is still the renderer: the same React tree,
stylesheet and fonts the window draws. The window frame is cropped off every
documentation image anyway. The two real gaps are a real PTY's output, which is
written in by the fixture as bytes, and WebKitGTK's rasterisation, which is
Chromium's instead.

## Decision

**The guide's images are produced by Playwright scripts in
`tests/docs-shots/`, run by `pnpm docs:shots`, against the renderer and the
mock bridge.** The images go to `assets/images/guide/`, which is where item 61
had already decided images live.

- **One invented world**, `tests/docs-shots/world.ts`: the same four projects,
  two groups and session titles as `fixture-workspace.py` and the site's mock.
  Nothing is anyone's real work, so nothing is blurred.
- **Device scale 2, displayed at half.** Every file is `<page>-<subject>@2x`,
  and the site's `Shot` component declares it as a `2x` source. The app's
  12px type stays sharp, and the image is laid out at the size it had in the
  window.
- **GIFs are stills with holds, not recordings.** `Gif` in
  `tests/docs-shots/capture.ts` screenshots one clip per state and ffmpeg
  encodes them with one palette and a hold per frame. That is crisp at scale
  2, small, and independent of timing.
- **Its own Playwright config and port**, out of `pnpm e2e`. A picture is
  reviewed by looking at it, not asserted. Whoever changes a surface re-runs
  the script for that page and looks at the result.
- **What the mock bridge needs, it gets as a fixture field**, like any smoke
  test: `updateFound` walks the updater through checking and downloading to
  staged.

## Consequences

1. The README's five images in `assets/images/` still come from the real
   window through `doc-shot.sh`. That is item 61's last checkbox, and it is a
   different decision: a README's hero picture is the whole window, titlebar
   included.
2. A picture can disagree with the app only where the mock does. The mock is
   the same contract the smoke suite is written against, so a surface whose
   mock drifts has a test problem too.
3. The fixture's live-agent gap, a signed-in store, stops mattering for the
   guide. A terminal's content is bytes the fixture writes.
4. `ffmpeg` is needed to re-shoot a GIF. It is not needed to build the site,
   which reads the committed images.
