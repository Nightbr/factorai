# ADR-0020 — The quit confirm asks about work in progress, not about live processes

**Status.** Accepted (2026-08-21). Partially supersedes
[ADR-0005](0005-kill-on-quit-non-optional.md) — the trigger only.

## Context

ADR-0005 settled two things together: **kill-on-quit is non-optional**,
and the kill gets a **mandatory confirm dialog**. It wired the dialog to
the only signal that existed in M0 — "is any PTY alive" — because in M0
that was the same question as "is anything happening".

It stopped being the same question in F10 (ADR-0015), which gave a
session a status derived from Claude's own terminal title: `working`,
`waiting_input`, `stopped`. A live PTY sitting at its prompt is
`waiting_input`, and there is nothing in flight in it to lose.

F10 acted on that for *one* gesture — closing a single session only asks
while Claude is working (`needsCloseConfirm`) — and left the two
whole-app gestures on the old signal:

- the window close, gated in Rust on `live_count() > 0`;
- the updater's restart, gated in the renderer on the size of
  `bySession`.

So factorai stopped you on the way out to warn that "3 running Claude
sessions will be terminated" when all three had handed the turn back
hours earlier. A confirmation that fires when there is nothing to
confirm is not insurance, it is a keystroke — and the cost of that is
specific: it teaches you to dismiss the dialog without reading it, which
is exactly the dialog you want read on the day one of them *is* mid-run.

## Decision

**The confirm fires when Claude is working somewhere, and not
otherwise.** Both whole-app gestures, one rule:

- `TerminalManager::working_count()` counts handles whose status is
  `Working`. `CloseRequested` prevents the close and emits
  `app:quit-requested` only when that count is non-zero.
- `needsQuitConfirm` in `lib/quitConfirm.ts` is the renderer's copy of
  the same predicate, and the updater's restart is its only caller. It
  is a separate copy because the two gestures are decided on opposite
  sides of the IPC boundary, not because they may differ.
- **Kill-on-quit is untouched.** Every live PTY still dies, asked about
  or not. On the branch that no longer asks, the close handler calls
  `kill_all()` itself before letting the close through — the dialog's
  confirm was previously the only caller on that path, and `Drop` on
  `TerminalManager` is a crash backstop, not something Tauri's exit
  promises to run.
- **The dialog counts what dies, not what is working.** One working
  session beside three idle ones is still four processes ending, and the
  sentence says four. `quitConfirmSentence` owns that wording for both
  dialogs.

`app:quit-requested` gains `workingCount` alongside `liveCount` so the
renderer can say both numbers rather than infer one.

## Consequences

**Positive.**

- The dialog now means something every time it appears, which is the
  only property that makes a confirmation load-bearing.
- Quitting an app full of finished sessions is one gesture again.
- The three whole-app and per-session gestures finally agree on what
  "there is something to lose" means. They were two rules for one idea,
  which is how they came to disagree in the first place.

**Negative.**

- **A session parked on a permission prompt is not protected.** Claude's
  title reads idle while its own dialog is open, so that session is
  `waiting_input` and quitting will not ask about it. This is the gap
  F10 recorded as accepted for the per-session close, and this ADR
  inherits it rather than introducing it — closing that gap needs the
  `needs_permission` state F10 considered and did not build, and it
  closes for all three gestures at once when it lands.
- Status is derived from a terminal title, so the guard is now only as
  correct as `osc_title` is. A CLI that stopped writing the idle marker
  would make every session read as working and the dialog would revert
  to its old behaviour — annoying, not dangerous, which is the right
  direction for that failure to point.
- Rust now blocks the window-event handler for `kill_all`'s 500ms
  SIGTERM grace on the no-dialog path. Same cost the confirmed path
  already paid in `app_quit_confirmed`, and it is at quit.

## What this does not reopen

ADR-0005's "no config flag for detaching sessions" stands, and so does
its reasoning about stray agents costing real money. This ADR narrows
*when factorai asks a question*. It does not narrow what factorai kills,
and it does not add a preference — unlike the per-session close, which
has two switches, this one stays mandatory when it fires, because it is
about losing every live session at once.

## Related

- ADR-0005 (superseded in part), ADR-0015 (where status came from)
- `specs/05-features.md` § "Quit guard", § F10, § F14
- `apps/desktop/src/lib/quitConfirm.ts`
