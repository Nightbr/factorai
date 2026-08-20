# Inconsistencies — found, not yet resolved

A ledger of places where the project contradicts itself: doc against code, doc
against doc, or a process note against what actually happens when you run it.
Compiled 2026-08-15 by reading the specs against the code they describe.

**This file is not a decision record.** `07-open-questions.md` holds things that
have been *settled*; everything here is still open, and each entry needs a
verdict before it can move. Resolve them together in one pass, then delete the
entry — an item that has been fixed leaves no trace here.

**Status 2026-08-15:** the first sweep found 22. Seventeen were stale prose
against correct code and were fixed the same day; one was a claim that turned
out to be false and was rewritten. The four below were left because each needed a
decision, not an edit.

**Status 2026-08-17:** **C1 is resolved and deleted** — the F18 clarify-needs
interview amended Q18 to three tabs and recorded the width question it does *not*
answer as Q22, so nothing about the tab strip is contradictory any more. Building
F18 then added **C5** and re-measured E1's numbers, and F11's interview added
**C6**. Five left.

**Status 2026-08-19:** **C7** added while refreshing the README — the QA
screenshot helper carries a bug its own README documents for a sibling script
and not for it. Six left, and it is another one found by using the thing rather
than by reading it.

Worth noting what those two have in common: **both were found by reading the code a
spec described, not by reading specs against each other.** C5 and C6 are each a
claim that was true when written and quietly stopped being true, and neither would
have surfaced from a doc-only sweep. That is an argument for compiling this file
during feature work rather than in scheduled passes.

---

## Still open — six decisions

Everything else compiled on 2026-08-15 has been resolved and deleted, per the
rule above. What remains needs a call rather than an edit.

**C5 — `tests/` is not type-checked, in a repo whose types are hand-mirrored.**
Found 2026-08-17 while building F18. `apps/desktop/tsconfig.json` has
`"include": ["src"]`, so `pnpm typecheck` never looks at `tests/smoke/` — and
that is where `fixtures.ts` builds `GitStatus`, `DirListing`, `SessionPage` and a
dozen other cross-boundary objects by hand. Adding a required field to one of
them leaves every fixture silently invalid: F18's `GitStatus.head` did exactly
that, and only a Playwright assertion happening to touch the value would have
caught it. The IPC contract has **no codegen by design** (§ IPC), which makes
`tsc` the only thing standing between the two hand-written halves, and it isn't
looking at half the callers. → probably a `tsconfig.tests.json` plus a
`typecheck:tests` task in `turbo.json` and CI; needs a call on whether that runs
as its own task or the app's `include` grows, and on how many existing errors it
surfaces (not yet measured).

**C3 — Read-only, except where we plan to write.** ADR-0009 states
*"Everything is read-only. No staging, no discard, no commit"*. TODO item 19
(IDE emulation) applies hunks to the working tree. Needs a **superseding ADR**,
not an edit — ADRs are immutable (`AGENTS.md` § 5) — and that ADR has to say
what happens when the working tree moves under a pending approval.

**C4 — `~/.claude/` is read-only.** ADR-0004. TODO item 17 (rename a session
from inside factorai) writes a `custom-title` line into a session's JSONL,
which lives there. Same shape as C3, same remedy.

**E1 — The smoke suite's time budget.** `AGENTS.md § 2d` says the suite *"stays
under a few seconds"*. It is **114 tests in ~2 minutes** (measured 2026-08-17;
it was 75 in ~70s when this entry was written two days earlier, and F18 added
seven the same afternoon — the drift is ongoing and roughly linear in features
shipped). Note the five added in F18's second pass each caught something, two of
them real bugs: this is an argument for the `tests/regression/` lane, not against
writing tests. Either the budget is wrong or the suite has outgrown its lane — § 2d also promises a heavier
`tests/regression/` lane that was never created, which is probably the real
answer. See TODO item 10.

**C7 — `scripts/qa/geometry.sh` has `click.sh`'s frame-offset bug, and its README
says only `click.sh` does.** Found 2026-08-19 while capturing the README
screenshots. That file already documents, at length, that `click.sh`'s origin is
frame-relative rather than content-relative — (+47, +73) on this WM — because
`_resolve_wid.sh` returns what `wmctrl -lG` reports for the decoration window.
`geometry.sh` reads **the same helper** and is listed in the "What works" table
with a plain ✓, so a caller that trusts it to crop a screenshot gets a rectangle
shifted down and right, containing whatever sits behind the window. On this
desktop that is the *release* factorai, complete with live agent sessions — a
screenshot of the wrong app that still looks plausible, which is the worst
failure mode available.

The captures for the README worked around it with `xwininfo -id <wid>`, the same
source the README already prescribes for clicks. The decision this needs: whether
`_resolve_wid.sh` should return the client-area origin (fixing `click.sh` and
`geometry.sh` together, and invalidating every coordinate anyone has written
down against the current behaviour), or whether both callers should convert. Not
fixed here because it has callers and this was a docs change.

---

## What the resolved ones taught

Two patterns worth keeping in mind next time this file is compiled.

**A correction recorded in the wrong place is not a correction.** The accurate
account of WebKitGTK and synthetic input was sitting in TODO item 10 the whole
time, while `scripts/qa/README.md` and `AGENTS.md § 2e` went on asserting the
opposite — and it was those two that agents actually read, so QA strategy
followed the false version for days.

**The dangerous stale doc is the one that reads as instructions.** Most of the
seventeen were harmless — an overview naming the wrong editor costs a moment's
confusion. The two that mattered described *what to do*: a release entry
promising a prerelease that would have broken the updater, and a QA note
recommending against an approach that works.
