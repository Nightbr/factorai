# ADR-0026 — A routine runs without a tab, and Rust decides when

**Date:** 2026-08-29
**Status:** Accepted

Related:
[ADR-0005 — kill on quit is non-optional](0005-kill-on-quit-non-optional.md) ·
[ADR-0008 — factorai assigns new session ids](0008-factorai-assigns-new-session-ids.md) ·
[ADR-0011 — a project is a folder in the workspace](0011-a-project-is-a-folder-in-the-workspace.md) ·
[ADR-0013 — preferences storage split](0013-preferences-storage-split.md)

Specified as [F22](../../specs/05-features.md); sequencing in
[roadmap item 42](../../specs/roadmap/TODO.md).

## Context

Routines (F22) are per-project scheduled prompts: a cron expression, a prompt,
and an agent session started for you when it comes due. The feature is one
sentence long and every hard part of it is somewhere else, because three things
about how this app runs terminals were built on assumptions a routine breaks.

**The renderer owns every spawn.** `components/terminal/Terminal.tsx` is the only
`terminal_spawn` call site in the app. A session exists because a React component
mounted for a route you navigated to, and `useStartSession` says so in as many
words: *"Nothing else is needed to get a terminal: the session route mounts
`Terminal`, which spawns the PTY for whatever id is in the URL."* Nothing in
factorai has ever started an agent that a human did not, at that moment, ask for.

**Scrollback exists only in the renderer.** Terminals are pooled — one xterm per
session for the app's lifetime — and Rust keeps no copy of what a PTY printed.
F17 records the same fact from the other side: a webview reload keeps every PTY
alive and loses every scrollback, "since nothing snapshots or replays it". So a
PTY nothing is attached to is streaming `terminal:data` at no listener, and what
it printed is gone.

**A tab is a superset of a live session.** F16 fixed the invariant deliberately
in 2026-08-18 — a tab is an *open session*, it survives an exit and a quit, and
only closing removes it — and `terminalStore` states the consequence: `tabs` "is
always a superset of `bySession`'s keys". Nine surfaces read `bySession` as
"is this running".

A routine that opens a tab per fire is not the feature: ten projects with a
morning routine is ten tabs you did not ask for, and the point of scheduling
work is that you are not there. So the question this ADR answers is what
*starts*, what it is attached to, and who decides it is time.

There is also a dependency question. `annex-B-other-references.md` § B.1 asked,
in 2026, that honker be evaluated before any custom cron logic was written, and
asked this ADR to link back to it.

## Decision

**A routine fire spawns a real PTY with a hidden pooled xterm and no tab. The
runner in Rust decides when; the renderer still performs the spawn. Cron
expressions are parsed by `croner`; honker is rejected.**

Concretely:

1. **`RoutineRunner`, a Rust service on a wall-clock tick**, owns "what is due".
   It reads `routines`, compares against `last_run_at` in real time — never a
   tick count, because a suspended laptop counts no ticks — and emits
   `routine:fire { routineId, projectId, sessionId, prompt, cwd }`. The session
   id is minted here, by factorai, exactly as ADR-0008 has it.

2. **The renderer performs the spawn, into a hidden pooled host.** It mounts the
   same `Terminal` every session uses, with its host never made visible and no
   entry in `tabs`. This is nearly free after the 2026-08-28 pooling change,
   which already keeps every host that has been shown stacked in the pane with
   `visibility` toggled — a hidden routine host is that state from birth rather
   than after a switch.

   The alternative, spawning in Rust with a ring buffer replayed on attach, is
   the more independent design and was rejected **for now** as a second output
   path bought before anything needs it: it means a bounded per-session buffer,
   ANSI-safe truncation, a replay protocol, and a decision about what "enough
   scrollback" is. It becomes the right answer the day routines should run with
   the window closed, and F17's "Reload loses scrollback" is the second customer
   waiting for it.

3. **`tabs ⊇ bySession` is retired.** The invariant becomes *a tab is an open
   session; a session may run without one*. F16's three sentences otherwise
   stand unchanged, and opening a routine session from any list gives it an
   ordinary tab from then on. Every reader of `bySession` is audited in the
   slice that lands this, because "is running" and "is open" were the same
   question until now and several of them assume it.

4. **The prompt is argv, not keystrokes.** `SpawnOpts` gains
   `initial_prompt: Option<String>`, so argv becomes
   `claude --session-id <id> "<prompt>"` — and `--resume <id> "<prompt>"` on the
   other branch of the transcript probe, unchanged. Writing the prompt into the
   PTY after spawn is a race against the CLI's own startup that lands in a trust
   dialog when it loses, and bracketed paste makes it a quoting problem as well.

5. **`croner` (3.x) parses and projects the schedule**; the runner is ours.
   It takes the 5-field expressions people actually write (seconds optional),
   answers `find_next_occurrence`, and has explicit DST rules rather than
   incidental behaviour — a fixed-time job runs at the first valid instant after
   a spring-forward gap and once only in a fall-back overlap, which is the
   semantics F22 promises and Q25 records. A scheduler crate that also owns
   execution (`tokio-cron-scheduler`) is not wanted: the execution half is the
   part with all the project-specific rules in it — the cap, the queue, the skip,
   catch-up coalescing — and it would be fighting the crate immediately.

6. **honker is rejected, and § B.1's condition is what rejects it.** Its case was
   always "if the scheduler comes back", and its value is cross-process notify
   plus leader election on one `.db`. Routines run in the single process that
   owns the database, while its own GUI window is open; there is no second
   process to elect a leader among. Against that it is a **loadable SQLite
   extension** — a native artefact to build, ship inside a `.app` and an
   AppImage, and load at runtime — which is a packaging change of exactly the
   kind that costs a release. Revisit if factorai ever splits into a daemon and
   a GUI, which is the other case B.1 names.

7. **A fire is recorded when the session starts.** `last_run_at` is written at
   spawn, so kill-on-quit (ADR-0005) taking a running routine session does not
   make that fire eligible for catch-up. Re-running an agent that already did
   half the work — committed, pushed, opened a PR — is worse than skipping it,
   and the runner cannot tell those apart.
   → **Amended 2026-09-01 by
   [ADR-0030](0030-a-routine-fire-is-claimed-before-it-is-recorded.md)**: this
   paragraph was right and the first implementation of it was not. It recorded a
   fire when the runner *decided* on it, which is a different moment — and the
   emit asking the renderer to spawn reached nobody on launch, so every catch-up
   fire was written down as a run that never happened. A fire is now claimed
   first and recorded from `terminal_spawn`. The rule above is unchanged; it is
   finally what the code does.

## Consequences

- **Routines only fire while the app is open**, and only while the renderer is
  alive. That is the honest limit of this design and F22 states it in the
  feature's own terms rather than as a caveat. Catch-up on launch is what makes
  it usable; a daemon is what would remove it, and that is a different product
  decision than a scheduler.

- **`bySession` stops answering "does this have a tab"**, and any surface that
  conflated the two is now wrong in a way types will not catch. This is the
  migration cost of the feature and it is paid once.

- **An agent can now be running that you never started.** Every guard that
  matters is unchanged — irreversible actions still confirm, the quit dialog
  still asks (ADR-0020) — but the app gains a state where work is in flight with
  no window showing it. F22 answers that with the sidebar: a routine session
  appears in the session lists and feeds the project's status dot from the
  moment it starts, and roadmap item 35's notification trigger inherits a
  requirement not to assume an open tab.

- **The runner is a new writer of session ids**, which makes ADR-0008's "factorai
  mints the id" load-bearing in a second place. `session_routines` records the
  origin, with no foreign key, for the reason migration 0007 found the hard way:
  the `sessions` row does not exist yet when the runner writes.

- **`croner` is a load-bearing dependency** — the schedule is stored as the cron
  string it parses, so the preset picker, the custom field and the later MCP
  tool all speak one representation, and replacing the crate means keeping that
  dialect.
