---
name: manual-qa
description: Verify a change in the real Tauri window with scripts/qa — launch, screenshot, kill — what that loop actually catches, when xdotool input is legitimate and when Playwright is the safer tool. Use when asked to run the app, confirm a change works outside the tests, or drive something native (a PTY, a file dialog, the clipboard).
---

# The loop

An agent verifying its own changes runs:

```bash
scripts/qa/launch.sh                       # boots tauri dev, returns once window appears
scripts/qa/screenshot.sh /tmp/qa-1.png     # captures the active factorai window
scripts/qa/kill.sh                         # tears down factorai + orphan claudes
```

`FACTORAI_DEVTOOLS=1 scripts/qa/launch.sh` keeps DevTools open if you want the
inspector available.

# What this catches

Boot-time regressions — does the app start, does the first paint render, do
projects appear in the sidebar, did the indexer scan complete. That's enough to
catch the WebKitGTK / WebGL / PTY-flood class of crashes.

# Synthetic input

**Clicking and typing into the WebView does work** — corrected 2026-08-15. This
used to say `xdotool`'s synthetic input was filtered by WebKitGTK. It isn't:
buttons, the file tree, the viewer's controls and a GTK file chooser have all
been driven that way. The real rule is narrower — `xdotool key --window <id>`
uses XSendEvent and *is* ignored, plain `xdotool key` after focusing uses XTest
and isn't. See `scripts/qa/README.md`.

**Prefer Playwright anyway when you have the choice.** Not because synthetic
input fails, but because it can't miss: a stale window origin once put a click
into the user's Slack. `pnpm e2e` runs against `pnpm vite:dev`, where the
renderer boots browser-only through `isTauri()` / `mockInvoke()`, and it cannot
touch anything outside its own browser. Reach for `xdotool` when the thing under
test is native — a real PTY, a file dialog, the clipboard — and follow the
safety rules in `scripts/qa/README.md` when you do.

Wayland is not supported by these scripts (swap `wmctrl`/`gnome-screenshot` for
`swaymsg`/`grim` — deferred).

# Screenshots that ship

A screenshot in a commit is cheap. **A screenshot that ships — `README.md`,
`docs/`, a release note — is not the same act.** It is permanent and public, and
the window is full of the author's real work: client and employer project names,
personal repositories, `~/` paths, session titles naming both. Use the
`app-screenshot` skill, which owns that checklist along with
`VITE_FACTORAI_SCREENSHOT=1`, `scripts/qa/doc-shot.sh` and
`scripts/qa/redact.py`.
