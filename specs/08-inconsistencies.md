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
out to be false and was rewritten. The four below are left because each needs a
decision, not an edit.

---

## Still open — four decisions

Everything else compiled on 2026-08-15 has been resolved and deleted, per the
rule above. What remains needs a call rather than an edit.

**C1 — The panel's tab strip.** Q18 decided the strip ships *"exactly two
tabs"* and is *"not a registry or a plugin point"*, after three features
contested the slot. TODO item 1 puts the git graph in it as a third. → amend
Q18, or find the graph another home. Entangled with the width question in item
1: Q18 disqualified project-wide search from this strip *because* it wanted
more than 288px, and a commit graph wants at least as much.

**C3 — Read-only, except where we plan to write.** ADR-0009 states
*"Everything is read-only. No staging, no discard, no commit"*. TODO item 19
(IDE emulation) applies hunks to the working tree. Needs a **superseding ADR**,
not an edit — ADRs are immutable (`AGENTS.md` § 5) — and that ADR has to say
what happens when the working tree moves under a pending approval.

**C4 — `~/.claude/` is read-only.** ADR-0004. TODO item 17 (rename a session
from inside factorai) writes a `custom-title` line into a session's JSONL,
which lives there. Same shape as C3, same remedy.

**E1 — The smoke suite's time budget.** `AGENTS.md § 2d` says the suite *"stays
under a few seconds"*. It is **75 tests in ~70 seconds**. Either the budget is
wrong or the suite has outgrown its lane — § 2d also promises a heavier
`tests/regression/` lane that was never created, which is probably the real
answer. See TODO item 10.

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
