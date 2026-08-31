# Roadmap

Where the project tracks work: what to do next, and what's already shipped.

- **[`TODO.md`](./TODO.md)** — the agreed next steps, in **priority order**. The single source
  of truth for "what should we work on next" — consult it before re-deriving a plan from the
  specs and codebase.
- **[`DONE.md`](./DONE.md)** — shipped work, newest first, kept as a dated record of what
  landed and the gotchas found on the way.

## How it works

1. **Add** a new task to `TODO.md`, placed by priority. Keep `TODO.md` current — re-prioritize
   as context changes.
2. **Ship** it, then **move** the entry from `TODO.md` to the top of `DONE.md`, rewriting it as
   a past-tense summary and **dating** it (the day it landed). *Move*, not annotate: an entry that
   stays behind saying "shipped, see DONE.md" is how a list of what to do next turns into a list
   of what already happened. `TODO.md` was cleaned of eleven such entries on 2026-08-18.
3. **A part-shipped item keeps its number and is rewritten to what is left**, with one line saying
   which half landed and where its entry is. Items 1, 29 and 34 are the worked examples.
4. **Numbers are permanent ids, never reused and never renumbered.** They are cited from the specs,
   the ADRs, `DONE.md` and a few code comments, so a gap in `TODO.md`'s numbering is information:
   that item shipped, and `DONE.md`'s entry names its number. New items append.
5. Keep cross-references explicit across the split — a `DONE.md` entry that points back at a
   pending task should say "TODO item N", not a bare "item N".

That's the whole protocol: one list to pull from, one log to append to.

## How this relates to the rest of `specs/`

The roadmap is **sequencing**, not design. It says what to do next and in what order; it never
becomes the place a feature is specified.

- [`06-milestones.md`](../06-milestones.md) is the **arc** — M0…M5 with their exit criteria, and
  the deferred post-MVP list. It changes rarely. `TODO.md` is the working order *within* and
  *across* whatever milestone is open, and it also holds the small in-between items no milestone
  ever named.
- [`05-features.md`](../05-features.md) and the other numbered specs are the **contract** for
  behavior. If a TODO item and a spec disagree about what a feature should do, the spec wins —
  or the spec is wrong and gets fixed first, per the `spec-and-adr-workflow` skill.
- [`docs/adr/`](../../docs/adr/) holds decisions that constrain the approach. A TODO item that
  wants to relitigate one needs a superseding ADR, not a bullet here.

Practical consequence: when an item here lands, the same commit updates the spec it changed
(same skill), and *then* the entry moves to `DONE.md`. A `DONE.md` entry is a log of what
happened, not a substitute for the spec being right.
