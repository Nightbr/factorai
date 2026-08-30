# ADR-0028 — An agent may schedule work but not unschedule it, and a routine records who touched it

**Date:** 2026-08-30
**Status:** Accepted

**Superseded in part by
[ADR-0029](0029-model-facing-tools-need-a-server-that-is-not-the-ide.md)**: every
decision below stands, but § 3's tools do not live on the IDE bridge. They could
not — the CLI caps that server's model-visible tools at two names — and they moved
to a server of our own.

Related:
[ADR-0029 — model-facing tools need a server that is not the IDE bridge](0029-model-facing-tools-need-a-server-that-is-not-the-ide.md) ·
[ADR-0017 — the IDE bridge writes one lockfile into `~/.claude/ide/`](0017-ide-bridge-writes-one-lockfile-into-claude-ide.md) ·
[ADR-0026 — a routine runs without a tab](0026-a-routine-runs-without-a-tab.md) ·
[ADR-0013 — preferences storage split](0013-preferences-storage-split.md) ·
[ADR-0004 — the `.claude` directory is read-only](0004-claude-dir-is-read-only.md)

Specified as [F22](../../specs/05-features.md) § "Routines over MCP"; sequencing
in [roadmap item 42](../../specs/roadmap/TODO.md) slice 3.

## Context

F22 slice 3 puts a routine tool group on the IDE bridge, so an agent can
schedule follow-up work in the project it is working in. The feature is four
tools over machinery that already exists — the commands, the runner and the
scheduler all shipped with slice 1 — and none of that is what this ADR is
about.

What it is about is that F22 recorded the slice's shape **against the
recommendation at the time**, and said so in the same paragraph:

> Decided as **full CRUD** — create, update, enable, delete — **with no off
> switch and no per-row provenance**, against the recommendation. Recorded here
> as a decision rather than an oversight: an agent can enable or delete a
> schedule unattended and leave no trace of having done it. […] Revisit before
> the slice is built.

This is that revisit, and it changes two of the three. Writing it down is the
point: reversing a decision the spec records, by quietly editing the spec, is
how the reversal comes to read as an oversight later — which is exactly what
that paragraph was written to prevent.

Three things make a routine different from everything else the bridge touches.

**It is a standing instruction, not an action.** `openFile` shows a file and is
over. A routine keeps running after the session that wrote it has exited, in a
project the human may not open for a week. It is the first object in factorai
that a process other than the human can bring into existence and leave behind.

**It is a write to our own database, which ADR-0017 § 6 did not settle.** That
section put `openDiff` and the accept/reject-hunk surface out of scope because
they would be the first time factorai wrote to a *repository*, contradicting
ADR-0009. Our own tables are a different boundary, and one the bridge has
already crossed: `setWorktree` writes `session_worktrees` (F21). The rule that
actually held there was scope — a path is checked against the session's
repository — and it is the rule this reuses.

**The human's own delete asks first.** F22: *"Deleting asks first, and also
leaves the running session alone."* A tool call has nobody to ask.

## Decision

**The agent gets `listRoutines`, `createRoutine`, `updateRoutine` and
`setRoutineEnabled`, scoped to its own session's project. It does not get
delete. Every write records the session that made it, and the list shows when
one did.**

### 1. No `deleteRoutine`, and disable is the reversible form

An agent can schedule work, amend it, and switch it off. Only a human
unschedules it.

The reasoning is `run_routine_now`'s, run backwards. That command deliberately
fires *through the runner's own path* so a manual run cannot become a second set
of rules for the same act. A `deleteRoutine` that skipped the confirmation the
editor asks for would be exactly that second set of rules — the same act, minus
the part that makes it safe — and unlike a manual run there is nobody watching
to notice.

Disable covers the need this slice was specified for. An agent that scheduled
something it should not have can stop it; what it cannot do is destroy the row
that says it did. Rejected: **full CRUD**, which is what F22 recorded, on the
grounds above. Rejected: **create only**, which cannot fix its own mistake and
would push an agent that wanted to correct a schedule into creating a second
one.

### 2. Provenance, in two columns, and it is shown

`routines` gains `created_by_session_id` and `last_modified_by_session_id`
(migration `0014`). **NULL means a human** — not "unknown", because every row
that predates the column came from the editor. No foreign key, for
`session_routines`'s reason (migration 0013): the `sessions` row is derived from
a transcript the indexer has not necessarily seen, while the bridge writes the
moment the agent calls.

**Two columns rather than one**, because an agent may amend a routine a human
wrote — see § 3. With only the author recorded, an agent rescheduling your
nightly digest leaves the row looking exactly as you left it, which is the trace
F22's paragraph asked for, missing.

The list shows **one mark for both facts**, with the tooltip saying which. The
question it answers is *has an agent touched this*, which is the question a
schedule that surprises you actually raises; authored-versus-amended is a
distinction most rows never carry and not worth two icons in a list built to be
scanned.

**No notification when an agent writes one.** F22's own test is frequency — a
signal you get every day is one you learn to dismiss — and the mark is the
ambient answer, the way the status dot is for a running session. Roadmap item 7's
toast remains the place a transient version of this would live if it turns out
to be wanted.

### 3. Scope is the session's project, and it is not addressable

No tool in the group takes a `projectId`. The project is resolved at spawn from
the session's own `SpawnOpts` and bound into the closure the bridge holds, so
there is no argument an agent can send to name another one. `updateRoutine` and
`setRoutineEnabled` check the id against that project's list before writing, and
answer "no routine <id> in this session's project" for an id from anywhere else
— which is also the right answer for an id that does not exist.

This is the database analogue of ADR-0017 § 3's path scope, and it is
load-bearing for the same reason that section gives: the token is readable by
anything running as the user, so it authenticates *a process on this machine*,
which is a weaker claim than it looks. The layer that holds is the one the
client cannot address.

**Within that project the agent may edit any routine, including one a human
wrote.** Restricting it to its own rows was the recommendation and was not
taken: "fix the broken schedule" is a real request, and a tool that refuses it
sends the agent to create a duplicate instead. `last_modified_by_session_id` is
what makes that survivable, and § 2 is why it exists.

### 4. Partial updates, because the editor's shape is not the agent's

`updateRoutine` accepts any subset of the fields and merges server-side. The
editor stays full-replacement: it is a form that genuinely holds every field,
and sending all of them is the honest write for it. Both reach one row-writing
function, with the editor's call being a patch that leaves nothing out.

The field that decides this is `catchup_hours`, whose `NULL` means *inherit the
app-wide default* rather than *no value*. An agent doing read-modify-write
against a full-replacement command would have to echo it back correctly to avoid
silently re-pinning or clearing the window. So the wire carries three states —
key absent (leave it), key `null` (back to the default), key a number (pin it) —
and the patch type is a double option to match.

### 5. Validation is stricter than the editor's was, for both callers

In the store, so one rule serves both:

- **A cron must parse *and* project a next occurrence.** `0 0 31 2 *` is a valid
  expression for a date that does not exist: it used to save cleanly and then
  never fire. A human at the editor has the next-fire line under the control to
  catch that; an agent has nothing, which is what turned a latent gap into a
  bug worth fixing now.
- **Name and prompt are bounded.** The prompt becomes argv on a spawn that may
  be hours away (ADR-0026 § 4) — unbounded, that is a spawn failure long after
  the call that caused it, with nobody watching.
- **20 routines per project.** The concurrency cap bounds what *runs*; nothing
  bounded what *accumulates*, and an agent inside a routine's own session can
  write more routines. Far above any hand-maintained list and low enough that a
  loop stops within a tick.

### 6. A new routine is enabled, as asked

`createRoutine` honours `enabled` and defaults it to true. A schedule that waits
for a human to arm it is a draft, and the agent will report it as scheduled
either way — which is worse than either honest option. What makes this safe is
§§ 1–3 and the cap, not a disarmed default.

### 7. Advertised unconditionally, and still no off switch

`tools/list` is fetched once at connect, so anything gated there is gated for the
life of the session. F21 hit this with `setWorktree` and advertises it
unconditionally; this group follows. The bridge-wide off switch remains F11's and
roadmap item 4's, and a second, subtly-broken switch for one tool group would be
worse than none — F22's "no off switch" is the one part of its recorded decision
that survives this ADR unchanged.

### 8. Every routine write announces itself

`routines:changed { projectId }` is emitted by a layer both callers go through.
The editor already invalidates its own query, so for it this is a belt on
braces; for a bridge write it is the only thing that stops an open Routines tab
showing a list that is no longer true. One emitter rather than one per caller,
for the reason `session:worktree` has one — two paths doing the same job for
different callers is how they come to disagree. Write, then emit, never the
other way: an event ahead of its row is a fact the next reload contradicts.

## Consequences

- **An agent can leave a standing instruction behind it.** That is the feature,
  and the guards are its cost: it cannot delete, it cannot leave the project it
  is in, it cannot exceed the cap, and it cannot write without the row saying so.
- **The mark is a surface that only appears when something is unusual**, which
  is the same instinct as the bridge's own header badge — a label for the healthy
  case is a label you stop reading.
- **`last_modified_by_session_id` is cleared when a human edits.** That is
  deliberate: it answers "who changed this last", and a human's edit is the most
  recent change. `created_by_session_id` is the standing fact and never moves.
- **The tool answers in 24-hour local time with an explicit offset**, whatever
  the app's clock setting says. That setting is a renderer preference (ADR-0013)
  the bridge cannot read, and the reader here is a model rather than a person —
  for which an unambiguous stamp beats a familiar one. Local rather than UTC
  because a cron expression means local time (Q25).
- **The conformance problem ADR-0017 records grows slightly.** These four tools
  are ours rather than the CLI's, so nothing about them can drift out from under
  us the way `openFile`'s schema can — but they are still names a model has to
  choose to call, and only running it tells us whether the descriptions are the
  ones it acts on.
