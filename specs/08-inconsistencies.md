# Inconsistencies — found, not yet resolved

A ledger of places where the project contradicts itself: doc against code, doc
against doc, or a process note against what actually happens when you run it.
Compiled 2026-08-15 by reading the specs against the code they describe.

**This file is not a decision record.** `07-open-questions.md` holds things that
have been *settled*; everything here is still open, and each entry needs a
verdict before it can move. Resolve them together in one pass, then delete the
entry — an item that has been fixed leaves no trace here.

Each entry says what disagrees with what, where, and what kind of call it needs:

| Disposition | Meaning |
| --- | --- |
| **Doc** | The code is right and the doc is stale. Mechanical fix, no discussion needed. |
| **Decide** | A genuine choice. Neither side is obviously wrong. |
| **Verify** | The claim may have been true once; someone has to check before acting. |

---

## A. Docs describing a stack we stopped using

**A1 — CodeMirror vs Monaco.** ADR-0007 chose Monaco and
`04-frontend.md:288`, `05-features.md:303` and `06-milestones.md:110` all say
so. Two places still say CodeMirror: `00-overview.md:76` ("Open a file in
CodeMirror with syntax highlighting") and `00-overview.md:110` (the
switchboard comparison row, `CodeMirror 6 via npm in renderer`). The overview
is the file a newcomer reads first, so it is the worst place for this. → **Doc**

**A2 — A session status that doesn't exist.** `00-overview.md:80` lists
`running / stopped / busy`. The real type is
`running | idle | waiting_input | stopped` (`packages/types`), and `busy` has
never existed. → **Doc**

**A3 — Auto-updates listed as dropped.** `00-overview.md:94` still has
"Auto-updates (electron-updater) — Replace later with `tauri-plugin-updater`
once we publish releases" in the *Explicitly dropped from MVP* table. It
shipped 2026-08-14 (F14, ADR-0010) and the app has since self-updated in
anger. `06-milestones.md` § Deferred already strikes its copy through; the
overview didn't get the same treatment. → **Doc**

**A4 — How a new session starts.** `00-overview.md:75` says "Start `claude` or
`claude --resume <id>`". ADR-0008 changed that: factorai mints the id and new
sessions launch with `--session-id`, with `--resume` only for existing ones.
Half-true as written. → **Doc**

## B. Build and platform claims that contradict what CI ships

These matter more than they look: they are what someone reads to answer "what
do I download", and three of them promise an artifact that does not exist.

**B1 — Linux targets.** `01-architecture.md:124` promises
`.deb` + `.AppImage` (x64 + arm64). Reality: `release.yml` builds
`--bundles appimage` on `ubuntu-24.04`, **AppImage only, x86_64 only**. The
`.deb` was dropped deliberately — the updater can replace an AppImage in place
but never a `.deb`, which `README.md:64`, `05-features.md:681` and `DONE.md`
all explain correctly. arm64 Linux was never built at all. → **Doc**

**B2 — A Windows artifact in the macOS/Linux milestone.**
`06-milestones.md:152` sets the M5 exit criterion as "a teammate can install
the .dmg / .deb / .msi". `.msi` is Windows, which the same file declares out of
scope four lines earlier at `:148`. The `.deb` is B1 again. → **Doc**

**B3 — `AGENTS.md:290`** documents `pnpm tauri build` as producing
`.app/.dmg/.AppImage/.deb`. `tauri.conf.json` lists targets
`["app", "dmg", "appimage"]`. → **Doc**

**B4 — "Draft pre-release".** `roadmap/TODO.md:242` describes the release
action as producing a *draft pre-release*. `release.yml:149` sets
`prerelease: false`, with a comment explaining that it **must** be false:
GitHub's `/releases/latest` skips prereleases entirely, and that is the URL the
updater endpoint resolves through, so a prerelease would leave every installed
app polling a 404. The draft half is right; the prerelease half is not just
stale but describes a configuration that would break updates. → **Doc**

**B5 — The same `.deb` claim** repeats in `roadmap/TODO.md:254`'s restatement
of the M5 exit criterion. → **Doc**

## C. Specs that block work already planned

Each of these is a spec saying "no" to something the roadmap says we're doing.
The roadmap entries already flag them, but the specs themselves are unchanged,
and per `CLAUDE.md` § 2a the spec gets fixed *before* the code.

**C1 — The panel's tab strip.** Q18 decided the strip ships *"exactly two
tabs"* and is *"not a registry or a plugin point"*. TODO item 1 puts the git
graph in it as a third. → **Decide** — amend Q18, or find the graph another
home. (See also the width question raised in item 1; the two are entangled.)

**C2 — F9 still describes a tab it doesn't get.** `05-features.md:413` specs
Memory as a *"Side panel tab"*. Q18 gave that slot to Changes and sent
CLAUDE.md to "a file the tree opens". TODO item 2 says to fix F9 before
building; it hasn't been fixed, so the spec currently contradicts the decision
that overrode it. → **Doc**

**C3 — Read-only, except where we plan to write.** ADR-0009 states
*"Everything is read-only. No staging, no discard, no commit"*. TODO item 19
(IDE emulation) applies hunks to the working tree. That needs a **superseding
ADR**, not an edit — ADRs are immutable (`CLAUDE.md` § 5). → **Decide**

**C4 — `~/.claude/` is read-only.** ADR-0004. TODO item 17 (rename a session
from inside factorai) writes a `custom-title` line into a session's JSONL,
which lives there. Same shape as C3. → **Decide**

## D. Specs written in the present tense for things not built

Not drift so much as tense: a reader can't tell these from shipped behaviour.

**D1 — F1's missing-project row.** The spec describes a grayed-out
`(missing) /Users/.../foo` row. Nothing stats `real_path`, so it never renders
(TODO item 3). → **Doc** — mark unbuilt, or build it.

**D2 — Six specced commands that aren't registered.** `03-backend-rust.md`
lists `read_claude_md`, `write_claude_md`, `list_plans`, `read_plan`,
`get_setting` and `set_setting`. None are in `invoke_handler` — they belong to
TODO items 2 and 4. → **Doc** — mark them planned.

**D3 — Two registered commands that aren't specced.** `check_claude_cli` and
`app_quit_confirmed` exist and are called, and appear nowhere in the command
list. This is the drift direction `CLAUDE.md` § 4 explicitly wants caught.
→ **Doc**

## E. Process notes contradicted by running them

**E1 — The smoke suite's time budget.** `AGENTS.md:90` says the suite *"stays
under a few seconds"*, and `TODO.md:290` reasons from that budget. It is
currently **66 tests in ~60 seconds**. Either the budget is wrong or the suite
has outgrown its lane — `AGENTS.md` § 2d also promises a heavier
`tests/regression/` lane that was never created, which may be the real answer.
→ **Decide**

**E2 — `scripts/qa/README.md` says clicks don't work.** Its *"What does NOT
work"* table (`:30`–`:38`) states that WebKitGTK drops synthetic XTest input
before React sees it, and builds a two-option recommendation on top of that
premise. **Disproved on this machine 2026-08-15**: `xdotool` clicks drove the
sidebar's Add-project button and then a GTK file chooser end to end. Both
`click.sh`/`key.sh`/`type.sh` rows and the "To actually drive the React UI"
section rest on the false claim. → **Verify** — it may still hold on other
setups, so establish where the truth lies before rewriting.

**E3 — TODO item 10 reads as unstarted.** It calls Playwright-against-
`vite:dev` *"the path forward"*. That lane exists with 66 tests across 12
files. The item should close, or narrow to whatever it still actually wants.
→ **Doc**

## F. Smaller gaps

**F1 — `_meta` is undocumented.** `02-data-model.md` covers `projects`,
`sessions`, `messages_fts` and `settings`. The migration bookkeeping table
`_meta` (`0001_init.sql`) appears nowhere. → **Doc**

**F2 — Version fields say `0.1.0` everywhere** — `tauri.conf.json`,
`apps/desktop/package.json`, `Cargo.toml`, both workspace packages — while
releases are at v0.5.0. This is **deliberate**: the tag is the single source of
truth and `release.yml` rewrites the three fields at build time so no bump
commit can be forgotten. But that reasoning lives only in a comment at the top
of the workflow, so to anyone reading the repo it looks like four-way drift.
→ **Doc** — say it somewhere a reader will find it.

**F3 — Window title.** `00-overview.md`'s Identity table gives the window
title as `factorai`. Debug builds now set `factorai DEV`
(`#[cfg(debug_assertions)]` in `setup()`). Trivial, but the table reads as
exhaustive. → **Doc**

---

## How to use this

Most of it is **Doc** — a single pass fixes it, and the fixes are independent
of each other, so they can land in one commit without a discussion. What is
worth actual time is § C, where four decisions each gate a roadmap item, and
**E1** and **E2**, which are about whether our own tooling docs can be trusted
— E2 in particular has been steering QA strategy away from an approach that
appears to work.
