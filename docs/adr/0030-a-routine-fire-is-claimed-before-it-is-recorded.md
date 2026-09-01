# ADR-0030 — A routine fire is claimed before it is recorded, because the event asking for it can reach nobody

**Date:** 2026-09-01
**Status:** Accepted

Related:
[ADR-0026 — a routine runs without a tab, and Rust decides when](0026-a-routine-runs-without-a-tab.md) ·
[ADR-0008 — factorai assigns new session ids](0008-factorai-assigns-new-session-ids.md) ·
[ADR-0005 — kill on quit is non-optional](0005-kill-on-quit-non-optional.md)

Specified as [F22](../../specs/05-features.md) § "The fire"; storage in
[`02-data-model.md`](../../specs/02-data-model.md) § `routine_claims`, migration
`0016`.

## Context

A user reported that their daily routine was not running. The row said
otherwise: *last run 4h ago*, no error, the switch on, the next fire projected
correctly. The database said otherwise too — three fires recorded over three
days.

Only the first had produced anything. Of the three session ids on those fires,
one had a transcript, 122 turns, and a row in `sessions`; the other two existed
nowhere but in `session_routines`. No process, no transcript, no error. The one
that worked was a `Run now` pressed with the window already open. The two that
did not were both recorded at ~10:15 for a 09:00 occurrence — which is not a
scheduled tick at all, it is the catch-up fire on app launch.

**The mechanism.** ADR-0026 § 1 and § 2 split a fire in half: Rust decides,
the renderer spawns, and a `routine:fire` event joins the two. `routines.start()`
is called from `setup()` and its first tick is immediate — deliberately, because
"the first tick *is* catch-up". But `setup()` runs before the webview has loaded
the bundle, so `useRoutineFires` has not registered a listener, and Tauri does
not buffer an emit. The event was delivered to no one.

Then `fire()` wrote `last_fire_at`, `last_run_at`, `last_session_id` and
`session_routines` *before* emitting — the write-then-emit ordering the rest of
the app follows for good reasons. Here it meant the occurrence was **consumed**
by the decision to fire it. Nothing retried, nothing recorded a failure, and the
row claimed a run that never started.

That is the worst shape a failure can take in this feature. F22 exists so a human
who is not at the machine can trust that scheduled work happened; a silent
success is worse than a crash, and worse than not shipping the feature. Note also
that ADR-0026 § 7 already says *"a fire is recorded when the session starts"* —
the implementation recorded it when the fire was **decided**, and the difference
was invisible for as long as the emit always arrived.

Three fixes were on the table. **Gate the first tick on a renderer-ready
signal** — cheap, and fixes only launch; a reload, a webview crash or a slow
first paint mid-fire loses the event again, and it adds a handshake whose absence
silently stops all scheduling. **Move the spawn into Rust** — ADR-0026 § 2
already rejected that as a second output path (ring buffer, ANSI-safe
truncation, a replay protocol) bought before anything needs it, and that
reasoning is unchanged. **Make the event stop being the only copy of the
instruction.**

## Decision

**A fire is claimed, emitted, and only recorded when a PTY exists for it. The
event becomes a reminder of a row rather than the instruction itself.**

1. **`routine_claims` holds a fire in flight** (migration `0016`): the minted
   session id, its routine, the occurrence, and when it was claimed. The runner
   writes it before emitting and writes **nothing** on `routines`. It is in-flight
   state and never history — deleted the moment the session starts or the runner
   gives up — so the table is normally empty and a row that survives a restart is
   exactly the fire worth retrying.

2. **The occurrence stays unconsumed until the session starts**, which is what
   makes a lost fire retryable rather than merely reported. `plan` therefore takes
   the set of routines with a claim in flight and treats them as not due: without
   that, an occurrence nobody has consumed is due again in thirty seconds, and
   again, which is the failure mode the 2026-08-30 truncation fix already
   documents at the other end of this function.

3. **`terminal_spawn` records the fire**, through `Runner::mark_started`. It is
   the one place in the app a PTY comes into existence, and therefore the only
   honest answer to *did the session start*. Every human-started session calls it
   and finds no claim, which is the cheap half of the same rule: one place where
   "a session started" is known.

   **Not an acknowledgement the renderer sends back.** A second round trip to
   confirm what Rust just did is one more message that can be lost, which is the
   bug being fixed.

4. **The tick re-emits, the renderer drains on mount.** Every tick re-emits
   claims older than one tick — so a window that reloaded mid-fire gets the
   instruction again — and `routine_pending_fires` hands the renderer everything
   waiting as the first thing it does. The drain is what makes the launch-time
   catch-up fire reach a listener that exists. `startRoutineSession` was already
   idempotent per session id, so a fire arriving both ways starts one `claude`.

5. **A claim is given up on after five minutes, or when its catch-up window
   closes**, and the reason is written to `last_error`, consuming the occurrence.
   Two limits because they answer different questions: the grace period is *is a
   window ever going to take this*, and the catch-up window is the routine's own
   rule about lateness, which belongs to the schedule rather than to the plumbing.
   Giving up has to consume, because a claim that renewed itself forever is the
   loop `record_error` already exists to prevent.

## Consequences

- **The list can now say a routine did not run.** *No window started it, so
  nothing ran* and *its catch-up window closed before anything started it* join
  the errors `last_error` already carries. This is the whole point: the feature's
  promise is not that a fire always succeeds, it is that a fire never silently
  claims to have.

- **`last_run_at` and `last_fire_at` moved later**, from the decision to the
  spawn. Both are still written at spawn as `02-data-model.md` has always
  described them; nothing that reads them changes. A fire in flight is briefly a
  routine with a next-run in the past and no last-run, which is honest — for the
  second or so it lasts.

- **A fire lost to a quit is retried on the next launch, once.** The claim
  survives in the database, the drain finds it, and the routine's own catch-up
  window is what decides whether it still wants to run — the same rule a missed
  occurrence gets, now applied to a fire that was decided but never started.

- **`Run now` gained a fourth thing it can decline for**, reported like the other
  three (F22 § "Run now"): a fire for that routine is already starting.

- **This is the second bug in F22's scheduling half found in the wild, and both
  were invisible in the UI.** The first fired a routine every tick for a minute;
  this one recorded fires that never happened. Both came from a value being read
  as a fact about the schedule when it was really a fact about the moment
  somebody asked. Worth remembering the next time this file's neighbours are
  edited: the runner's own tests cannot see either failure, because both live in
  the seam between the runner and something else — `croner` in one case, the
  webview's lifecycle in the other.

- **Any future event that asks the renderer to *do* something inherits this
  requirement**, and `03-backend-rust.md` § "Tauri events" now says so. Events
  that ask the renderer to render a fact are fine as they are: the next reload
  reads the fact from the database anyway. `routine:fire` is the only one that
  was an instruction, and an instruction needs a copy that outlives its delivery.
