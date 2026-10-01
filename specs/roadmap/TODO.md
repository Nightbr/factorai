# TODO

The agreed next steps, in priority order — the single source of truth for "what should we work
on next". Consult it before re-deriving a plan from the specs and codebase. See
[`README.md`](./README.md) for how this folder works, and [`DONE.md`](./DONE.md) for what has
shipped.

**Only live work is listed here.** Cleaned out three times — 2026-08-18, **2026-09-17**, and
**2026-10-01**, before the move to GitHub issues (item 62), when items 31 and 55 closed, 21 and 37
were retired, 27 folded into 6, 41 was dropped and fourteen more were rewritten. On 2026-09-17
every remaining entry was checked against the code rather than against its own checkboxes; items
5, 15 and 24 were fully shipped and left, and seven others lost the half they had already
delivered. The first pass found eleven of thirty-four entries were announcements of their own
completion: the list had become a place to read history rather than a place to pick work up, and
`DONE.md` was already the history. An item whose whole scope shipped is gone from here. An item with a *remainder* keeps its number and is
rewritten to the remainder — items 1, 29 and 34 are here for that reason, each saying in one line
which half already landed and where the entry for it is.

**Numbers are permanent ids and are never reused.** They are append-only, and cited across the
specs, the ADRs, `DONE.md` and a few code comments — so a shipped item's number is not recycled
and a surviving item is never renumbered. Position is priority; the number is identity. If item N
is not here, it shipped, and `DONE.md`'s entry for it names the number.

**Where things stand.** M0–M3 shipped — scaffold, read-only browser, embedded terminal with
kill-on-quit, FTS5 search. M4 is one item from done: **item 2**, now down to drafts that survive a
quit, the secrets rule and F9's last two pieces. M5 is most of the way: **item 4 (settings, F11)
shipped 2026-08-20**, **item 5 (the keybinding scheme, F28) shipped 2026-09-15** with its macOS
menu verified 2026-09-17, and the release pipeline builds alphas from `main` and promotes stables
(ADR-0064), notarized on macOS since v0.52.0. Items 6
(titlebar), 7 (error UX) and 8 (the smoke pass) are what M5 still owes.

**M6 is down to two workstreams.** Items 39 and 58 landed 2026-09-21 (`DONE.md`): the site
builds from `apps/docs`, deploys to Pages on every push that touches it, answers on
**`factorai.build`** (ADR-0055) and opens on the hero one-pager. **Item 58 closed 2026-09-25**,
when the user called the iterated hero finished and dropped its remainder; item 39 keeps its
number for the guide's content, and **item 61**, real screenshots in the guide, is the new entry
that came out of them. Item 51 (notarization) closed 2026-09-27 and item 31 (the channels)
2026-10-01, so items 59 and 39 are what M6 still waits on.

**The list is now headed by M6 — the public first release.** See the block below: two
workstreams left, in build order, and **only those gate it**. Everything under them, M5's own
remainder included, is post-release work and is not a reason to delay the tag.

### M6 — the public first release

**Decided 2026-09-17.** Today's releases are for people who were told about them; M6 is the one a
stranger finds. Five workstreams, in the order they should be built; two are items below and
three have shipped:

1. **Item 51 — a signed, notarized macOS app.** **Done** 2026-09-27, in v0.52.0 (ADR-0069,
   `DONE.md`).
2. **Item 31 — alpha and stable, and a release process with nothing left to remember.**
   **Done** 2026-10-01 (ADR-0064, `DONE.md`): stable has been promoted four times and updates
   have been seen on real installs on both channels.
3. **[Item 59](#59-performance--one-audit-measured-then-the-fixes-it-names) — the performance audit, then the fixes it names.** Every P1 fix has
   landed (items 54 and 55 with them); the ADR accepting the budgets is what is left.
4. **[Item 39](#39-the-site--the-guides-content-now-that-the-build-carries-it) — the site: one Docusaurus build on GitHub Pages.** The build, the
   deployment and the domain landed 2026-09-21; the guide under `/docs` is scaffolded prose and
   is what is left.
5. **Item 58 — the hero one-pager**, which is that site's index and the first thing anyone
   sees. **Done**: the page landed 2026-09-21 and was declared finished 2026-09-25 (`DONE.md`).

**Item 62 (the roadmap on GitHub, PRs for every change) is P0 and sits directly after them.**
Set 2026-09-27: it does not gate the tag, but it lands right after the release or before it,
because the release is what brings the outside contributors it exists for. It goes ahead of
anything below this line as soon as it is free to start.

**What M6 deliberately does not block on.** The titlebar (6), the toast primitive (7), the manual
smoke pass (8), file drafts (2) and everything below. That is a choice, made 2026-09-17, and it
has a cost worth stating once: going public with no toast means a transient failure still has
nowhere to surface, and skipping item 8 means the first Finder-launched macOS run may be a
stranger's. Item 51's install-and-update check on a real Mac covers part of that ground on the
platform where it matters most; the Finder-launched PATH list is still item 8's.

**Item 4 was the one with dependents, and they are unblocked.** Items 32 (the theme control) and
35 (the notification toggle) were waiting on the surface it creates, as was item 31's channel
picker, which shipped; the switch item 33 wanted shipped with it. Each of those now needs a `SettingRow` and a section
heading rather than a settings feature — read them for what is left.

**Below the M6 block, a position is where a slot happened to be free, never a claim about
priority.** The first four entries are the exception and are ordered deliberately: the two
open workstreams, item 61 (which came out of item 39), then item 62. **Item 42 (routines)** is the other one — asked for at high priority
on 2026-08-28 and placed for it. **Item 47 (the footer shell) shipped on 2026-09-01, the day it was asked
for, and item 49 (splits in that footer) on 2026-09-02, likewise**; their entries are in
`DONE.md`. **Item 50 rescoped that footer from the session to the project** on 2026-09-03, also
the day it was asked for; its entry is in `DONE.md` too. Items 12–14 —
the `Cmd+P` / `Cmd+Shift+F` / `Cmd+G` navigation trio — are high priority despite sitting
mid-list, and everything past 19 is simply the order things were asked for — except item 17,
last on purpose at very low priority (2026-10-01).

## 59. Performance — one audit, measured, then the fixes it names

**Asked for 2026-09-17, release-blocking.** The audit landed on 2026-09-20 as
[`specs/10-performance.md`](../10-performance.md): the proposed budgets (P3), how a number is taken
(P4), twenty-eight findings scored impact × cost and tiered (P5), the surfaces checked and found
inside their budget (P6), and the one Linux measurement run (P7). That spec is the contract; this
entry is the checklist of what it says gates the tag.

**The rule that bounds the whole sweep**, and it is not negotiable: nothing here may be paid for
by disposing, detaching or re-creating a pooled xterm (`Terminal.tsx` § "Persistent xterm pool";
spec P1).

**Tier P1 is the M6 gate**, each item measured first and closed with its number rather than fixed
if the number is inside the budget. In the spec's order:

- [x] **PERF-01** — the FTS delete-by-session full scan (`session_id UNINDEXED`). **Landed
      2026-09-20**: `messages` is a real table and the index is external content over it
      (ADR-0053, migration 0020). Delete-by-session went from `SCAN` to a covering-index
      lookup — 8.0ms to 4.8ms at 232 sessions, 121.2ms to 8.9ms at 11 600, and a one-row
      session from 2.5ms to 0.0ms. Search returns the same hits in the same order.
- [x] **PERF-02** — one SQLite connection behind one mutex, the indexer writing through it.
      **Landed 2026-09-20**: `Db::read` hands out one of four read-only pooled connections and
      the two polls, the project list and search now use it. With a writer holding a 400ms
      transaction, a read went from 400.1ms to 0.33ms. `with`/`with_mut` are unchanged, so
      nothing that was serialised stopped being. The `off_main` half is PERF-07's.
- [x] **PERF-03** — full transcript re-parse on every change. **Landed 2026-09-20**: the
      indexer resumes from `indexed_bytes` and appends (migration 0021). One appended turn on
      a 31MB transcript went from 4.71s to 32.2ms, and on a 5MB one from 288ms to 14.5ms.
      `title_kind` keeps a `/rename` outranking a tail title, and four conditions still force
      a full parse. PERF-16 is the remaining half.
- [x] **PERF-04** — hidden pooled terminals are still rendered by xterm. **Landed
      2026-09-20**: a hidden pooled host is translated out of the viewport as well as
      hidden, so xterm's own `IntersectionObserver` pauses it, and its layout box is
      untouched. Background DOM row writes went from 41 to 0 per terminal at a moderate
      burst and 180 to 90 at a large one; half surviving the pause at volume is an open
      question recorded in the spec. **The macOS run is still owed** — the wheel region
      this pool is designed around is WKWebView's alone.
- [x] **PERF-05** — `list_sessions` canonicalises under the database lock on the main thread.
      **Landed 2026-09-20**: each distinct path is resolved once per call, and PERF-02 had
      already taken it off the lock. 593 resolutions became 305 and the command went from
      1.9ms to 1.3ms on the busiest project here — inside its budget before and after, so
      the index-time columns the entry also proposed are not being built.
- [x] **PERF-06** — `[profile.release]`. **Landed 2026-09-20**, in the **workspace root**,
      which is the only place cargo reads it — a member's copy is ignored with a one-line
      warning and shrank the binary by one kilobyte. 28.2MB to 16.4MB on Linux, and the
      macOS universal build carries two of them. Release builds go from 57s to 4m43s;
      `panic = "abort"` ends the process where a background task's panic used to toast.
- [x] **PERF-07** — the synchronous commands that spawn a process, walk the store or wait on
      I/O. **Landed 2026-09-20**: `off_main` moved out of `commands/git.rs` and thirteen
      commands went behind it, from `terminal_spawn` to `read_pdf`. `get_session_tail` also
      stopped deserialising the events it skips, 37-58ms to 30-32ms on a 33MB transcript.
      The binary cache the entry proposed was dropped — `03-backend-rust.md` had already
      decided against it, and the reason holds.
- [x] **PERF-08** — libgit2 out of the database write transaction. **Landed 2026-09-20**:
      `checkout_owners` builds the checkout map on a pooled reader before the transaction
      opens. The transaction went from 1.46-1.82ms to 0.14-0.19ms on this workspace.
- [x] **PERF-09** — item 54, session switch. **Landed 2026-09-26**, measured in a release
      build against the fixture workspace. Pooled switches were inside the 33ms budget already:
      the terminal painted at 24-33ms and the header at 11-18ms, with no `Loading…`. A first
      open was not: its header took 78-164ms against 100ms, because building and fitting the
      new xterm ran in the same task. That now waits for the task after the next paint, and
      the header lands at 10-15ms (82ms from the project page, was 246ms). Construction still
      slows as the pool grows, which is recorded in the spec entry and not fixed.
- [x] **PERF-10** — the file tree's per-row query observers and per-row decoration index.
      **Landed 2026-09-20**: one `FileTreeProvider` off `PanelBody` and a memoised row.
      Expanding a 2 000-entry directory went from 3 804ms to 1 911ms and the main-thread
      work on the next event from 9 171ms to 1 918ms. **Against a 100ms budget, so the
      surface still misses it by nineteen times** — the profile has resolved the
      conditional and virtualization is now PERF-29, in the spec's P2 tier.
- [x] **PERF-11** — idle polling cadence, and polls that continue while the window is
      unfocused. **Landed 2026-09-20**: `focusManager` listens to `tauri://focus` and
      `tauri://blur`, so an interval stops when the window goes behind something, and the
      two sidebar polls went from 2s and 5s to 15s. Backend calls over a 30s idle window
      went from 21 to 4 focused, and from 21 to 0 blurred. It also uncovered a bug the
      2s poll was hiding: remove, import and add-by-picker never invalidated the sidebar's
      own key, so the tree was refreshed by the poll rather than by the mutation.
      `git_status`'s own change detection is still open, in the spec entry.
- [x] **PERF-12** — persisted stores writing `localStorage` on every drag frame. **Landed
      2026-09-20**: `lib/persistStorage` defers the write by 150ms and flushes on the way
      out, for all seven persisted stores. A 60-step drag went from 60 writes and 4 980
      bytes to 13 and 1 002.
- [x] **PERF-13** — item 55, the markdown preview and mermaid. **Landed 2026-09-20**: the
      plugins and component map are hoisted, `MarkdownView` is memoised, the palette is
      read once behind a `MutationObserver`, diagrams render through one queue and a
      re-render keeps the old SVG. On a twenty-fence document, `getComputedStyle` calls
      went from 720 to 9 and the time to every diagram drawn from 3 379ms to 2 574ms.
      Chunked rendering is not needed and stays unbuilt.
- [x] **PERF-14** — background PTYs flushed at the active session's cadence. **Landed
      2026-09-20**: 100ms for a session another one is in front of, 16ms for the one you
      are looking at. The condition is `is_backgrounded`, not `!is_active` — before the
      renderer names a session nothing is in front, and writing it the other way slowed
      every terminal at the start of a run.
- [x] **The first-paint signal.** **Landed 2026-09-20**: `list_sidebar` logs "first sidebar
      answer" once per run, and P7's row is filled — **1 271-1 325ms** against a 1.5s
      budget. It also caught the measurement itself being wrong: a bare
      `cargo build --release` binary still points at the dev server and shows a connection
      error that counts as a painted window.
- [ ] **Accept the budgets** — an ADR once the numbers in P3 are agreed, and every `DONE.md` entry
      above quotes before and after against them. **This is the whole remainder** (re-checked
      2026-10-01): `10-performance.md` still reads "P3 — Budgets (proposed)". The macOS numbers
      PERF-04 and PERF-09 owe are measured in item 8's Mac pass.

**What this item is not.** A rewrite, a virtualization project, or a dependency swap done on a
hunch. Tier P2 (the raw-bytes PTY channel, WebGL, the entry chunk, `git_status` change detection,
the graph window) is post-release and each of those is measured first; P3 is done when the
adjacent code is touched.

## 39. The site — the guide's content, now that the build carries it

**The build, the deployment and the domain shipped 2026-09-21** (`DONE.md`): `apps/docs`
([ADR-0051](../adr/0051-the-site-is-apps-docs-and-the-mark-may-move-there.md)),
`.github/workflows/pages.yml` on every push that touches it, and **`factorai.build`**
([ADR-0055](../adr/0055-the-site-lives-at-factorai-build.md)) with the hero one-pager (item 58,
`DONE.md`) as the index.
What is left, and what still gates the release, is the **guide's own content**. The pages were
checked against the code on 2026-09-26, and what is left is the part only the real window can
confirm.

**User ask, 2026-08-24, restated 2026-08-30**: *"we will write a full docs later for all factorai
features"*. Everything written for a *user* today is `README.md`, the five screenshots in
`assets/images/` and those fourteen pages. Everything else in the repository is written for whoever
is building it: `specs/` is the design source of truth, `specs/adr/` is the decision trail, and
this file is sequencing. All three read as internal because they are.

**The README is a pitch, not a manual, and it stays that way** — settled 2026-08-30 when the
routines section arrived and its second half, which explained how to *configure* one, was cut the
same day. A section there says what a surface is for and shows it; how to set it up belongs on the
site, and every feature that ships between now and then adds to what the site owes rather than to
the README.

**The rule that keeps this from rotting: the site does not fork the specs.** It is a different
document for a different reader — how to install it, what the surfaces do, what to do when
something does not work — and where it needs a fact the specs own, it links rather than restates.
A second copy of a behaviour is a second thing to update in the commit that changes it.

What the guide holds, in the order a new user meets it:

- **Install**, currently the most under-served thing: the AppImage, and the `.dmg`, notarized since
  v0.52.0 (DONE item 51) so it needs no Gatekeeper step.
- **First run** — adding a project, what discovery does, why sessions appear on their own.
- **The surfaces** — sessions and the terminal, Files, Changes, the graph, search, worktrees, and
  **routines** (F22): the schedule presets and the custom cron, the next-runs echo, catch-up and
  its window, the concurrency cap, what `Run now` answers when it declines, and the blue dot for a
  session running with no tab.
- **Settings**, and **keyboard shortcuts** — the defaults table F28 publishes, and the Keyboard
  section that rebinds them.
- **Troubleshooting**, where the known-and-non-obvious go: `claude` not found and the F11
  override, the AppImage's environment leaking into child processes, Linux specifics, and the
  one-time macOS permission prompt on v0.52.0 (DONE item 51).
- **Releases and channels**, linking ADR-0064 rather than describing it twice.

What is left:

- [x] **Every page checked against the code, claim by claim.** Done 2026-09-26, against the
      renderer and Rust sources, with the browser lane for the project menu, the Keyboard
      section and the routine editor. Every page had something wrong. Examples: the add button,
      which has three entries and not two; the concurrency cap, which is app-wide and not per
      project; the `×` on a tab, which closes the session and does not stop it; SOPS files,
      which open locked; and the graph, which has no checkout picker. **First run** and
      **Troubleshooting** are written and in the sidebar.
- [x] **What only the real window can confirm**, left from that pass, **moved to item 8** on
      2026-10-01: it is that pass. The updater line came out of the list, seen on real installs
      in item 31 (`DONE.md`).
- [x] **Six app bugs the check turned up**, closed 2026-09-26. Five were fixed, one commit
      each: the quit note no longer says quitting always asks; a failed start and the profile
      badge no longer say *claude* for a Codex session; the confirmations say an agent is
      working rather than Claude; and a terminal selection can now be copied (`Ctrl+Shift+C` /
      `Cmd+C`, or right-click). The sixth, the Graph tab reading the project root, is F21's
      decision and not a bug: worktrees share one commit list.
- [x] **The site reuses `assets/images/`** — decided and measured 2026-09-21. A relative path
      out of `apps/docs/docs/` (`../../../assets/images/<name>.png`) is resolved by the MDX
      image loader: the build emits it under `/assets/images/` with a content hash, no
      `staticDirectories` entry is needed, and a path that does not exist fails the build rather
      than shipping a broken image. One copy per screenshot, so one re-shoot serves the README
      and the guide. The images themselves are item 61.
- [ ] **Decide on versioning.** It was deliberately off at first: Docusaurus can version the docs
      per release, and switching it on before there is a second release to compare against buys a
      directory of duplicates. The trigger was "when the stable channel has shipped twice", and it
      has shipped four times (0.49 to 0.52), so this is now a decision rather than a wait. Saying
      no is a fine answer while the guide only ever describes the latest stable.

## 61. Real screenshots in the guide, from a fabricated workspace

**Asked for 2026-09-21**, the day the site went live: *"for the docs, can we have some real UI
screenshots of part to illustrate the docs?"*. Today the guide is fourteen pages of prose and not one
picture, while the hero next door shows the app only as coded miniatures and a mock. The answer is
yes, and **the hard part is not the capture, it is the subject**.

**The capture tooling is already built and is not what is missing.**
`VITE_FACTORAI_SCREENSHOT=1` suppresses the `DEV` chip (`DevBadge.tsx`, passed through
`turbo.json`'s `globalPassThroughEnv`), `scripts/qa/doc-shot.sh` resizes the window so the client
area is exactly 1440×900 and crops the frame and shadow rather than resampling, and
`scripts/qa/redact.py` blurs a region read off a probe grid. The `app-screenshot` skill is the
loop end to end.

**What is missing is a workspace worth photographing.** The author's own is full of client and
employer project names, and a sidebar with four rows blurred and one legible reads as a redacted
document rather than as a product — the finding that killed the 2026-08-27 attempt (item 41) and
the reason the hero shipped with coded miniatures rather than stills. So the subject is
**fabricated**. Build it once here:

- [x] **A seeded workspace on disk**, not the mock bridge — `scripts/qa/fixture-workspace.py`,
      2026-09-21. `billing-api`, `docs-site`, `homelab` and `recipes` in the groups `Pro` and
      `Side projects`, the site mock's own names, so the hero and the guide show one invented
      world. Git history a graph can draw (a merged branch, two tags, one still open), a dirty
      tree for Changes, eight transcripts, and one routine. `CLAUDE_CONFIG_DIR` and
      `XDG_DATA_HOME` point the app at it and nothing outside it is written. The mock bridge was
      rejected: `pnpm vite:dev` draws the renderer from fake data in a browser, but it has no
      titlebar, no real PTY and no real diff, so a picture of it is a picture of something else.
      **It also found a real bug** — `CLAUDE_CONFIG_DIR` was not in `turbo.json`'s
      `globalPassThroughEnv`, so the app honoured it when run directly and silently ignored it
      under `pnpm dev`. Fixed in the same commit; it affected anyone with a non-default config
      directory exported, not only the fixture.
- [x] **Sessions with history**, from the transcripts the script writes: eight of them, in the
      JSONL shape specs/02-data-model.md records, with `ai-title` events so the list reads as
      sentences, tool-use blocks so the panel has touched paths, and timestamps spread over three
      weeks so the times read as times.
- [x] **A signed-in fixture store** — moot since 2026-09-26: ADR-0066 makes the guide's shots
      scripted from the mock bridge, and its consequence 3 says the live-agent gap stops
      mattering for the guide.
- [x] **The guide is illustrated**, 2026-09-26, and not by the manual pass this line planned.
      The user asked for every part to be illustrated, including GIFs of flows, such as the
      update going from *Check for updates* to *Update ready*. Most of that is states the real
      window reaches only by provoking them. So the pictures come from scripts in
      `tests/docs-shots/` against the mock bridge, re-runnable with `pnpm docs:shots`
      ([ADR-0066](../adr/0066-the-guide-is-illustrated-from-scripted-shots-of-the-mock-bridge.md)).
      This reverses the rejection of the mock bridge in the first checkbox above, and the ADR
      says why.
- **Dark only**, a constraint rather than a task: the site is dark and the light palette does not
  render yet (item 32), so a light shot would be of a theme neither the app nor the page shows.
- [x] **Where they live**, which was item 39's open checkbox: `assets/images/`, referenced from
      a guide page by a relative path, verified by a build 2026-09-21.
- [ ] **Re-shoot the five in `assets/images/` from the same fixture.** They predate it, the
      README and the guide should not show two different workspaces, and it is the same session
      at the keyboard.

**Whether this gates the tag is open, and the default is that it does not** — the M6 block names
five workstreams and this is not one of them. A guide that is correct and unillustrated is worth
shipping; say the word and it moves up.

## 62. The roadmap moves to GitHub — issues, a project, templates, and a PR for every change

**Filed 2026-09-27, P0**: done right after the public release, or before it if there is room.
It does not gate the tag. The roadmap is two markdown files one person and their agents edit in
place: `TODO.md` is the queue, `DONE.md` the log (5,000 lines between them). That works while
every change lands on `main` from one machine. It does not survive other people: an outside
contributor cannot claim, discuss or be assigned an item in a markdown heading, and PRs #4–#6 are
already from people who had nowhere to file what they fixed first. The move is to GitHub
**issues** for items, a **Project** for their order, and a **PR** for every change,
this repo's own sessions included.

**Decided 2026-10-01 in
[ADR-0070](../adr/0070-the-roadmap-is-github-issues-and-every-change-is-a-pr.md)**, which replaces
the protocol in `specs/roadmap/README.md` and the "Work on `main`, no PR ceremony" rule in
`AGENTS.md` and the `spec-and-adr-workflow` skill. The ADR is the contract; what follows is the
checklist of carrying it out.

### The migration

- [x] **Only live work migrates.** Every entry was re-checked against the code on 2026-10-01:
      items 31 and 55 closed as shipped, 21 and 37 retired (the PDF follow-ups became item 63,
      the `HEAD` chip went to item 1), 27 folded into 6, and 41 dropped. Fourteen others were
      rewritten to their true remainder. `DONE.md` has the entries.
- [ ] **One issue per live `TODO.md` item**, its body the entry as it stands, its open checkboxes
      as a task list, relative links rewritten to absolute ones. Labels for the kind (`bug`,
      `feature`, `perf`, `chore`, `docs`) and the area (`area:terminal`, `area:site`, …).
      **No milestones to start with** — decided 2026-10-01; the Project carries the order.
- [ ] **A GitHub Project, run as a kanban**: *Incoming* (filed, unread — where every new issue
      lands), *Needs triage* (read, waiting on a repro or a decision), *Qualified* (accepted, not
      scheduled), *Todo* (next, ordered by hand), *In progress*, *In review*, *Done*. The
      hand order in *Todo* replaces "position is priority". Migrated items land in *Qualified*,
      the head of this file in *Todo*. The built-in workflows do the moves they can: auto-add
      from the repo, closed or merged to *Done*.
- [ ] **Item numbers do not survive as issue numbers**, and they are cited from the specs, the
      ADRs, `DONE.md`, `alpha.yml` and about ten code comments ("roadmap item 7"). Issues and PRs
      share one counter and #1–#6 are taken, so item 7 cannot become #7. Keep the old number in
      an *Item* number field on the Project, and leave one table in `specs/roadmap/README.md`
      mapping item to issue. Rewrite the citations in mutable files to the issue URL; immutable
      ADRs keep theirs and resolve through the table.
- [ ] **`DONE.md` stops growing, and the ADR says whether it is deleted or frozen.** Immutable
      ADRs link into it and `AGENTS.md` says `DONE.md` entries cite its old section numbers, so
      deleting it leaves dangling links in files that cannot be edited. Frozen as an archive with
      a one-line header pointing at closed issues is the cheaper default. Closed issues and merged
      PRs are the log from then on; the gotchas a `DONE.md` entry used to record go in the PR
      body.
- [ ] **`TODO.md` goes once every item has an issue**, and `specs/roadmap/README.md` shrinks to
      the protocol and the mapping table. `06-milestones.md` stays: it is the arc, not the queue.

### Templates

- [x] **`.github/ISSUE_TEMPLATE/`** — landed 2026-10-01: a bug form (version, platform, install
      type, agent version, what happened, steps, expected, logs), a feature form (the problem,
      the proposal, which of supervise / decide / review / set the rules it serves, and an offer
      to build it), and `config.yml` turning off blank issues and pointing questions at
      Discussions and vulnerabilities at private reporting. **Blank issues off broke the crash
      screen's link**, which prefilled `?body=` on a bare `/issues/new`: it now names the bug form
      and fills its fields by id (F17), with a test that reads the form.
- [x] **`.github/CODEOWNERS`** and **`SECURITY.md`** — landed 2026-10-01.
- [x] **`.github/pull_request_template.md`** — landed 2026-10-01 (`1994c6a`): what changed and
      why, the issue it closes, the spec or ADR it touches, `pnpm e2e` and the real window
      declared (e2e is not in CI), and **screenshots or a video of the app on every PR**, from a
      fabricated workspace.

### PRs for everything, and who may merge

- [ ] **Branch protection on `main`, as rulesets.** Two, because the two rules need different
      bypass lists:
      1. *Required status checks* — Quality's jobs — with no bypass but the promote deploy key
         (below).
      2. *Required approving review (1)* from someone with write access, with the repository
         admin (the owner) on the bypass list **for pull requests only**, so the owner's PRs merge
         on green and nobody pushes straight to `main`.
- [ ] **Owner PRs auto-merge on green**: enable auto-merge on the repo, and sessions run
      `gh pr create` then `gh pr merge --auto --squash`. Squash, so the PR title is the commit and
      keeps the `feat:` / `fix:` prefix; the alpha pipeline (ADR-0064) still sees one green push
      to `main` per change.
- [ ] **External PRs need an internal approval**, which rule 2 gives them for free, and
      `CODEOWNERS` sends the request to someone. Quality already runs on
      `pull_request` without secrets; check that a fork's first run waits for "approve and run"
      and that nothing in it needs a secret.
- [ ] **`AGENTS.md` and the skills rewritten to be collaborative**: a branch (and a worktree, since
      several sessions share one tree) per task, small commits on it, a PR per slice citing its
      issue, "Push small and often" becoming "open the PR early". `spec-and-adr-workflow` and
      `quality-gate` say the same. The "Commits" section's no-PR rule goes.
- [x] **The promote deploy key on both rulesets' bypass list**, for `promote.yml`'s bump push —
      2026-10-01. The GitHub Actions app was the plan and GitHub refused it: it can bypass
      rulesets only on an organization's repository. The key's push starts workflows, so the bump
      commit carries `[skip ci]` (ADR-0070, amended). Confirmed by the next promote.
- [ ] **`CONTRIBUTING.md` rewritten for the stranger.** It exists and covers setup and the gate.
      Missing: `pnpm bytes:check` in its list, an HTTPS clone (or fork-then-clone), how to claim
      an issue, what will not be merged (no native Windows, no telemetry — PR #3), screenshots on
      every PR, the no-emoji / no-`--no-verify` rules, that a maintainer approves before merge,
      a note for contributors working through an agent, Discussions for questions, a
      `CODE_OF_CONDUCT.md`, and a link to `SECURITY.md`.
- [ ] **Repository settings**, in the UI: Discussions on (the issue chooser already links there),
      private vulnerability reporting on (`SECURITY.md` and the chooser link to it), squash merge
      only, auto-merge on, branches deleted on merge.

**This is alpha-era policy.** Auto-merge on green is right while alpha builds itself from every
green `main` and stable is a promotion a person makes (ADR-0064): the promotion is the review
point for what reaches stable users. If a second maintainer joins, or stable starts shipping from
`main` directly, rule 2's bypass is the thing to revisit.

## 1. Git graph — the wide surface, and the joins F18 deferred

**The rail shipped 2026-08-17** (F18, `DONE.md`); what follows is Q22's deferred phase and the
follow-ups the design named. None of it is started.

- **The wide surface.** The same component at 900–1200px with the detail beside the list rather
  than under it — a hosting change, not a second layout. F18's own note that `+N` is the common
  case at 288px is the strongest argument for bringing this forward: at panel width the row cannot
  show a tagged release on a branch tip without collapsing something.
- **Session ↔ commit linking**, the interesting one. The payload already carries what a join
  needs — full 40-character SHAs, and both author and committer timestamps.
- **A merge's parent picker**, so the file list can diff against either side rather than only the
  first.
- **A `HEAD` chip per checkout.** Worktrees shipped as a session feature (F21) that the graph
  happens to render; this is the graph's share of it, one more ref kind through F18's badge
  machinery and its "the icon says where the ref lives" rule. In a worktree-heavy repository it is
  the reason to open a graph at all — three checkouts, visible at once, on the commits they are
  sitting on. Item 37 carried it until it closed on 2026-10-01.

## 2. M4 — editing and saving a file (F26)

**Slice 1 shipped 2026-09-09** — `write_file`, the editable `FileView`, the four read-only cases,
the changed-on-disk banner and the in-memory draft store; the working-tree side of a diff followed
the same day. Both have entries in [`DONE.md`](./DONE.md). What follows is the remainder: drafts
that survive a quit, the secrets rule, and F9's last two pieces. **The last M4 deliverable.**

**Why it outranks its position.** `00-overview.md` § "The operating model" makes the human four
things — supervisor, decider, reviewer, and the one who sets the rules agents run under. Three of
those have surfaces; **this item is the whole of the fourth**, and what is left of it is the half
that decides whether an unsaved rule survives a quit.

Specs: [F26](../05-features.md#f26--editing-and-saving-a-file), amended F7 and F9,
`03-backend-rust.md` § `files`, `02-data-model.md` § `file_drafts`,
[ADR-0039](../adr/0039-factorai-writes-project-files-never-an-agents-store.md),
[ADR-0040](../adr/0040-an-unsaved-draft-is-content-not-a-preference.md),
[ADR-0041](../adr/0041-the-worktree-side-of-a-diff-is-the-editable-one.md).

### Slice 2 — drafts

- [ ] A migration (0023 or later — `0020` went to PERF-01's `messages` table)
      `file_drafts(path PK, contents, base_hash, updated_at)`, and the two
      commands behind it. Caps: 1MB per draft, 32MB total, oldest evicted first.
- [ ] Debounced persistence from the editor; a buffer equal to disk leaves no row.
- [ ] Restore compares `base_hash` against the file as read: equal → restore dirty; different →
      **drop the draft silently** and open clean. The silence is deliberate and stated in F26;
      the alternative is a stale buffer that can overwrite an agent's overnight work.
- [ ] Dirty dot on the file's row in the tree (F12 — the row already draws one for F13), and
      on its tab in the pane's strip, in place of the `×` until hover.
- [ ] **A preview tab pins on the first keystroke** (F7 — a single click in the tree replaces
      an unpinned preview tab, which would otherwise discard a buffer mid-edit).
- [ ] Unsaved files in the quit confirm (ADR-0020: it asks about work, not processes).
- [ ] Save deletes the row, and so does undoing back to disk — there is no Revert control.

### Slice 3 — secrets

- [ ] `lib/secrets.ts`: the filename list, matched on basename, with tests. Not "git-ignored"
      (that makes `dist/bundle.js` a secret) and not a content sniff (false-positives on any
      base64 blob, and cannot be stated in a sentence).
- [ ] F20's hand-to-the-agent control is absent on a secrets file.
- [ ] A secrets file's draft is memory-only — no row, still a tree dot, still in the quit confirm.

**Not the same thing as SOPS** (F27, item 53, shipped 2026-09-14), which is about a file whose
contents are ciphertext on disk. This is a plaintext secret with a well-known name, and the two
rules meet only in that neither buffer may reach `file_drafts`.

### What is left of F9

- [ ] "Create CLAUDE.md" when the project has none: one button, `write_file`, one known path,
      then open it.
- [ ] `commands/memory.rs::list_plans`, `read_plan`.

### Deliberately not here

Creating, renaming and deleting files from the tree — a context menu, a destructive class of
action needing the trash-not-unlink treatment ADR-0027 gave transcripts, and its own confirm
story. Separate item.

## 42. Routines — the skills picker, and what a lived-in scheduler still owes

**Slice 1 shipped 2026-08-29** — schema, runner, commands, the tabbed project view and its editor,
the two context-menu items, the origin icon and the tabless spawn. **Slice 3 shipped 2026-08-30** —
the MCP tool group, provenance and the cap. See [`DONE.md`](./DONE.md), [F22](../05-features.md),
[ADR-0026](../adr/0026-a-routine-runs-without-a-tab.md) and
[ADR-0028](../adr/0028-an-agent-schedules-work-but-does-not-unschedule-it.md).
What is left:

### Slice 2 — the skills picker

- [ ] `commands/routines.rs::list_skills` + `services/skills.rs`: a read-only scan of the project's
      `.claude/skills/` and the user's `~/.claude/skills/`, name and description from frontmatter
      (ADR-0004 is untouched — it is a read).
- [ ] The list beside the prompt field; clicking inserts `/name` at the cursor. The descriptions
      are the point: the question a routine's author has is *what can I call from here*.
- [ ] Later, and deliberately not first: a `/`-triggered autocomplete inside the textarea.

### Still open, and not blocking either slice

- The default concurrency cap is **2** and the default catch-up window **6 hours**; neither has
  been lived with. The cap has no visible queue either — a fire held back for the next tick is
  invisible until it runs.
- Where a failed fire surfaces. `last_error` is on the row today, which is the copy that survives
  being away from the machine. The toast is the other half: the primitive exists (ADR-0065), and
  nothing sends a routine failure to it yet.
- **Run history** — one `last_run_at`, or a table of runs. A table is what makes "why did last
  Tuesday's fail" answerable, and it is the natural home for the interrupted and skipped states
  this design already produces.
- **A routine session's origin icon before the indexer sees it** comes from `terminalStore`, which
  is not persisted — so after a renderer reload a routine's session shows in the sidebar as an
  ordinary pending row until Claude writes its transcript. The durable copy is `session_routines`;
  nothing reads it for a session with no `sessions` row yet.

**Neighbours.** Item 35 (notifications) has picked up the requirement that its trigger cannot
assume an open tab. Item 7 (toast) is half the error surface, and slice 3 added a second customer:
an agent writing a schedule gets a mark on the row rather than a notification, and a transient
version of that would live there.

**Observed 2026-08-30, CLI 2.1.251.** A real `claude` was asked in English to schedule something
and called `mcp__factorai__createRoutine` to do it. Re-run
`cargo test --test agent_tools_conformance -- --ignored` after a CLI upgrade and record the version
— we now depend on two of its behaviours read out of a shipped binary, and nothing in CI can prove
either still holds.

## 6. M5 — custom window titlebar

`decorations: false` plus minimise / maximise / close reimplemented in `TopBar`, which is already
full-window width for exactly this reason (Q15 chose that geometry up front so this wouldn't mean
restructuring the shell).

Needs: a drag region across the middle, per-platform control placement (traffic lights left on
macOS, buttons right on Linux), and a double-click-to-maximise handler. The shell's rounded
corners and border are already in place from the August fixes, so the window will actually look
like a window once the OS frame goes away.

**It also owns the Linux corners**, folded in from item 27 on 2026-10-01. The bottom corners are
square on Linux today — the least-bad shape, not a clean one: the WM rounds the frame it draws, and
our opaque client area paints over the curve. Two cheap fixes were tried and verified wrong on the
real window, and [Q21](../07-open-questions.md) has the measurements: `border-radius` on an opaque
window leaves a wedge of `bg-background`, and a transparent window exposes the compositor's drop
shadow as a grey smudge. With `decorations: false` the app owns the whole frame: it declares its
shadow margins through `_GTK_FRAME_EXTENTS`, draws the shadow itself, and rounds the corners inside
a region it controls, which is how every GTK4 app gets clean corners on this desktop. Check the
result on Wayland as well as X11 + Mutter, and measure it the way Q21 says (full-screen
`gnome-screenshot`, crop by `xwininfo` geometry, per-pixel luminance): scaled screenshots lie about
exactly these pixels.

## 7. M5 — error UX: transient errors through the toast

- [x] **A toast in `@factorai/ui`** — landed 2026-09-25 (ADR-0065): sonner, dressed in the
      palette's tokens, one `Toaster` in `AppShell`. Its first customer is F14's update
      failures (`DONE.md`).
- [ ] Route transient `AppError`s to a toast and view-specific failures to inline messages, per
      the tagged-union contract in `03-backend-rust.md` § "Errors".
      Then a mounted app's window-level errors go through the toast too, and `lib/errorNotice`
      shrinks to the crash-time fallback it is the only answer for.
- [x] Empty workspace (F1, ADR-0067): the first-run hero in the main pane, with an Import door
      per agent and a pointer to Settings → Agents when no agent is found.
- [x] Empty states, found shipped on 2026-10-01: a project with no sessions draws an `EmptyHero`
      (`routes/project.tsx`), and an empty search says "No matches for …".
- [x] Indexing feedback, found shipped on 2026-10-01: the sidebar footer shows
      "Indexing… N/M" off `indexer:progress`.

**What is left is the first unchecked box**: today `toast` has one caller (`useUpdater.ts`), and
`lib/errorNotice.ts` still handles every window-level error with a header calling itself a stopgap
waiting on this item. Routine failures (item 42) and a background `openFile` (item 19) are the next
two customers.

## 8. M5 — release: the smoke pass on both platforms

The last mile before the app is something a teammate installs rather than runs from source.

**Three of the four landed 2026-08-14/17** — the icon set (with `09-branding.md`'s
regeneration command; **item 18** keeps the `.desktop` entry it did not cover), the README with
install instructions, and the release pipeline, which is now alpha-from-`main` plus a promoted
stable (ADR-0064). macOS builds are signed and notarized since v0.52.0 (ADR-0069), so the
Gatekeeper step is gone; the Linux bundles still carry a **glibc 2.39 floor** from ubuntu-24.04.
Item 51 installed, launched and updated a notarized build on a real Mac, which is not this pass.
What is left is the pass nobody has run:

- [ ] **macOS arm64, from a Finder-launched build.** macOS is the untested platform: every gotcha
      in `DONE.md` so far is WebKitGTK-flavoured, and the login-shell PATH fallback in the claude
      probe (Q2) exists specifically for GUI launches on macOS and has never been exercised there.
      **Two surfaces, not one** — the *session's own* PATH is resolved from the login shell too,
      which is a much wider blast radius than the probe (hooks, stdio MCP servers, the statusline,
      everything the agent runs from `Bash`). Run the verification list in `DONE.md`'s entry for
      it ("needs a human on a Mac"): `pnpm dev` from a terminal inherits a healthy PATH and hides
      this whole class of bug.
- [ ] **What only the real window can confirm**, moved here from item 39 on 2026-10-01:
      - Terminal: copying a selection, paste from the right-click menu, and Ctrl/Cmd+click on a
        link in a real PTY.
      - Native surfaces: the folder picker, Reveal, the trash on delete.
      - macOS: the permission prompts, Cmd+Q, the context menu.
      - Status dots against real agent titles, and sessions appearing live from the watcher.
      - A routine firing, catching up and queueing.
      - The Windows/WSL pages of the guide.
- [ ] **The macOS numbers item 59 still owes**: PERF-04 (the wheel region is WKWebView's alone)
      and PERF-09, measured on the same Mac in a release build.
- [ ] **Ubuntu 24, the AppImage**, as a formal pass against the exit criterion below.

**Exit criterion for M5** (`06-milestones.md`): a teammate installs the `.dmg` or `.AppImage` and uses
factorai for an hour without hitting a flow-breaking bug.

## 10. Interaction-level QA coverage

**Partly done — narrow this rather than reading it as unstarted.** The Playwright lane it called
"the path forward" exists, and has grown: about 320 `@smoke` tests across 41 files by
2026-10-01. What is left is the *regression* lane, not the approach.

The doc correction it asked for is **done (2026-08-15)**. Worth noting how that went, because it
is the argument for this item: the accurate version was written *here*, in this entry, while
`scripts/qa/README.md` and what is now the `manual-qa` skill went on asserting the wrong one for days. A
correction recorded in a roadmap item is not a correction. It has to land where the reader looks.

The real reasons GUI-driven QA stays awkward here are duller than "WebKit filters input", and
they still stand: the sidebar reorders every ~2s (`refetchInterval`), so a coordinate measured
from a screenshot points at a different project by the time it's clicked; `tauri dev` can leave
two `factorai` processes running *different builds* — now distinguishable, since a debug build
titles itself `factorai DEV`; and `pnpm dev` doesn't rebuild Rust at all, so a new command needs
a full restart.

- [ ] Open the `tests/regression/` lane and move the heavy tests into it, or change the budget
      the `smoke-tests` skill states ("a few seconds"). One of the two has to give, and that is
      inconsistency **E1**. Fixtures stay one-factory-per-shape in `tests/smoke/fixtures.ts`
      either way — a standing rule, not a task.

Deferred within this item: **Wayland support in `scripts/qa/`** (swap `wmctrl` /
`gnome-screenshot` for `swaymsg` / `grim`). X11-only is fine while the dev box is X11.

## 12. Command palette — `Cmd+P` quick-open by filename

> **Priority: HIGH for items 12–14** (user ask, 2026-08-14) — kept at the end of the file to avoid
> renumbering items 1–11 and their cross-references. Read them as sitting **right after M4 (items
> 1–3)**. The binding scheme shipped 2026-09-15 (F28, ADR-0046, which already names `Cmd+P` as a
> future default), so each of these is now a map entry plus a call site. They're a coherent trio:
> don't build the third without the first.

The first of three navigation surfaces (12–14) that the desktop Claude Code app has and factorai
doesn't. They're specced separately because their **backends** differ wildly — a filename index, a
content grep, and a symbol index are three different problems — but they should land as **one
component**: a single palette modal with a mode prefix, VS Code style (bare = files, `#` = symbols,
`>` = commands later), not three modals that each reinvent the list, the fuzzy match and the
keyboard handling. Build the palette here; items 13–14 add modes to it.

**Prerequisite: none of the three exists in the specs yet.** `05-features.md` has no palette, and
its keyboard table has no `Cmd+P`. Write the next free F-number (F31 or later; F13 is the Changes
tab) before coding, per the `spec-and-adr-workflow` skill — the palette is a new surface with its
own state, not a variation on the tree.

- [ ] Palette shell in app code (`Command`-style modal): fuzzy filter, ↑/↓/Enter, Escape, scoped to
      the route's project. `@factorai/ui` has no combobox/command primitive — decide whether one
      goes in the package (it's the shadcn-conventional home) or the palette stays app-local.
- [ ] `list_project_files(project_path)` in `commands/files.rs` — a **recursive** walk, which
      `list_dir` deliberately is not. This is where the cost lives: it needs ignore rules
      (`.gitignore` + `.git`, `node_modules`, `target`, `.venv`), an entry cap, and a decision on
      caching. Use the `ignore` crate (ripgrep's walker) rather than hand-rolling gitignore
      semantics.
- [ ] Freshness. F12 chose "no watcher, `staleTime` + focus refetch" (Q17) for the tree and the
      same reasoning applies here, but a *stale* quick-open is more annoying than a stale tree —
      you type a filename you just created and it isn't there. Cheapest honest answer: cache per
      project with a short TTL, refresh on palette open, show the count so staleness is visible.
- [ ] Selecting a file opens it in the viewer — i.e. sets `?file=`, the mechanism F7 already has.

Scale check before optimising: this is a fuzzy match over a few thousand paths in a webview, which
is fine in JS. Don't move the matching into Rust until a real project makes it lag.

## 13. Project-wide content search — `Cmd+Shift+F`

Grep across the active project's files. **Not** F4: F4 searches *session transcripts* via SQLite
FTS5 and answers "which conversation was that", while this searches *the code on disk* and answers
"where is this string". Same word, different corpus, different backend — say so in the spec so
nobody merges them into one input.

- [ ] `search_files(project_path, query, opts)` — literal by default, with case-sensitive and
      regex toggles. Same `ignore`-crate walker as item 12; results streamed or capped (a match
      list on a large repo is unbounded), with per-file grouping and a line + column per hit.
- [ ] Results UI. A palette mode is the wrong shape for this — hits need file grouping, context
      lines and persistence while you click through them. The panel is the home: it has a tab
      strip now (`PanelTab = 'files' | 'changes' | 'graph'`, `panelStore.ts`), so search is a
      fourth tab.
- [x] Clicking a hit opens the file **at that line** — already possible: `__root` validates
      `&line=` / `&col=` (F19) and `FileView` places the caret. Nothing to build.
- [ ] Debounce and cancel in-flight searches — typing in a grep box fires a walk per keystroke
      otherwise.

Do **not** shell out to `rg`. It would be a fourth binary-discovery problem next to the one
`find_claude_binary()` already solves for `claude` (Q2), and `grep`/`ignore` as libraries have no
PATH story to get wrong.

## 14. Symbol search — `Cmd+G` (needs a symbol index; explore first)

The one the user explicitly wants and the one with real depth behind it: jump to a definition by
name across the project. Everything above is a filesystem walk; this needs **parsing**, which is a
new class of dependency for this codebase.

**Exploration first — deliverable is a written design + an ADR**, before any code. The three
approaches, cheapest to richest:

- **tree-sitter** — per-language grammars, a tag query per grammar, no external binary. Accurate,
  incremental, and the cost is one grammar crate per language you support. Most likely answer.
- **ctags/`universal-ctags`** — cheapest to implement, but it's an external binary the user may
  not have, i.e. Q2's discovery problem again. Weak.
- **LSP** — the richest (real definitions, references, types) and the heaviest: a server process
  per language, lifecycle management, and a protocol client. That's a product in itself; it also
  overlaps with item 19's IDE bridge, so decide whether these are one effort or two before either
  starts. **Partly answered 2026-08-19**: F20's first slice deliberately does *not* register
  `getDiagnostics`, precisely because we have no diagnostics source and a confident empty answer
  is worse than none. So the bridge does not pull this forward — but it is the consumer that would
  make it worth having, since diagnostics only reach the agent through that tool.

Design questions the ADR has to answer: which languages ship first; where the index lives (a new
SQLite table alongside the session index, or in-memory per project); when it's built (on project
open? lazily on first `Cmd+G`? in the background like the session indexer, with its own
`indexer:progress`-style event?); and what invalidates it, given F12's deliberate no-watcher stance
means nothing currently tells us a project file changed.

**Binding.** The user's preference is `Cmd+G`, and taking it means resolving two collisions
honestly:

- `05-features.md`'s keyboard table assigned `Cmd/Ctrl+G` to **go to line**. **That row is
  already gone** — removed 2026-09-15 with item 5's amendment, since Monaco ships go-to-line
  natively (`Ctrl+G`) inside the editor and the app-level binding was redundant. This collision
  no longer needs resolving; the chord is free.
- On macOS, `Cmd+G` is the system-wide **find-next**, and it's what Monaco's own find widget uses
  once `Cmd+F` is open. So a global `Cmd+G` must not fire while the find widget has focus — the
  same "who owns this keystroke" rule item 5 shipped for the terminal (`enabled`, `target`,
  `ignoreInputs` — see `lib/keymap.ts`).

VS Code's own answers are `Cmd+Shift+O` (symbols in file) and `Cmd+T` (symbols in project), both
free here. Recommendation: ship `Cmd+G` as asked, keep `Cmd+Shift+O` as an alias, and record the
choice in `07-open-questions.md` rather than leaving it implicit in a `useGlobalShortcuts` switch.

## 16. App-wide scrollbar styling

**Parked deliberately (2026-08-15) — do this one together, not solo.** It came up as a candidate
for a batch of unambiguous quick wins and was pulled back out, with one constraint stated:
**the bar has to stay visible enough to be usable.** That rules out the tempting version of this
task — hiding scrollbars, or fading them to near-invisible until scroll — which is exactly what
an unsupervised pass would have reached for, and would have traded a chunky bar for one you
cannot find. Everything below still stands; the bullet on "ideally only visible while scrolling"
is the part now in question.

Scrollbars are currently whatever WebKitGTK draws: a chunky native bar that eats width in the
288px file panel, overlaps content in dense lists, and looks nothing like the rest of the app. The
tab strip needed one hidden outright (F16), and two `@utility` classes now exist in
`packages/ui/src/styles/globals.css` — `scrollbar-none` and `scrollbar-hairline` — as the minimum
to get that shipped. That is not a design.

Worth noting how this was found: `scrollbar-none` was used in the tab strip **before it existed**.
Tailwind ships no scrollbar utilities, so the class was inert and the bar showed anyway — a
silently-missing class is the failure mode of styling by convention rather than by primitive.

What a real pass covers:

- **One treatment everywhere** — sidebar, file tree, Changes list, viewer, tab strip — thin,
  low-contrast, ideally only visible while scrolling. The gutters those panels reserve today
  (`pr-2`) exist to dodge the native bar and could shrink or go.
- **Overlay vs in-flow.** An overlay bar reclaims the gutter but sits on top of content, which is
  why the `+` button and the scrollbar collided in the first place. Decide once, apply once.
- **The native bar paints over dropdown menus** (seen 2026-08-30, sidebar). Open a session's row
  menu next to a scrolling sidebar and the scrollbar draws *on top of* the menu panel, striping it.
  It is not a `z-index` we can outbid: the menu is already portalled to the body at the top of the
  stacking order, and a platform-drawn scrollbar is painted by the engine outside the page's
  stacking contexts. So it is a reason to stop being platform-drawn — a styled
  `::-webkit-scrollbar` is a real element in the page and loses to the portal like anything else.
  Whichever treatment this pass picks, it has to be checked with a menu open over it.
- **`scrollbar-gutter: stable`** was rejected earlier for the release workflow's glibc reasons —
  no, for support reasons: it is recent in WebKit and this ships on WebKitGTK. Re-check before
  relying on it.
- **The two existing utilities collapse into whatever this becomes**, rather than accumulating a
  third.

Small, self-contained, and entirely cosmetic — but it touches every scrolling surface, so it wants
doing in one pass rather than one panel at a time.

**Two things landed ahead of this pass on 2026-08-18, from a bug report, and neither pre-empts it.**
A white bar down the right of every session on macOS turned out to be two faults stacked:

- **`color-scheme` was never declared**, so WebKit painted every platform-drawn widget — scrollbars
  above all, but also the caret, `::selection` and native control internals — for a white page.
  That is a root-cause fix, not a styling choice, and it is now on `:root` / `[data-theme="light"]`
  in `packages/ui/src/styles/globals.css`. **It changes the starting point for this item**: the
  native bars this pass was written against were the *light* ones, and every panel listed above now
  begins from a dark bar rather than a near-white one. Re-look before designing.
- **The terminal is now exempt** and draws no bar at all (`scrollbar-width: none`, in the desktop
  app's stylesheet, F5). The constraint above — visible enough to be usable — is about panels you
  navigate by position; a terminal's scroll position is transient and both Terminal.app and iTerm2
  draw nothing. It also had a problem no other panel has: xterm.css forces `overflow-y: scroll`, so
  its bar was permanent rather than on-demand, and `FitAddon` was charging the PTY two columns for
  it. Leave it out of the one-treatment-everywhere sweep, or decide deliberately to pull it back in.

Still parked, still wants doing together — the `pr-2` gutters, overlay-vs-in-flow and the fate of
the two utilities are all untouched by the above.

## 18. UI / branding: desktop integration assets

**The mark, the app icon set, the README and the in-app brand row all landed on 2026-08-17** —
see `DONE.md` and [`09-branding.md`](../09-branding.md). One sub-item is left, and it does not
block a release:

- **Desktop integration assets.** No longer speculative — **checked on 2026-08-17 against a
  running dev build, and the dock is wrong today.** `09-branding.md` § B9 has the detail. The
  window itself publishes the right icon (`_NET_WM_ICON` reads back as the mark), but the panel
  never looks at it: it matches the window's `WM_CLASS` (`factorai`) to a `.desktop` entry and
  takes that entry's `Icon=`. On this machine that resolves to
  `~/.local/share/icons/hicolor/*/apps/factorai.png` — a stale circular mark predating this
  identity — and both the release app and the dev build show it, since they share a `WM_CLASS`.

  So the work is the `.desktop` entry plus `hicolor` theme files shipped and installed by the
  bundle, not just an icon inside it.

  **The author's machine was repaired by hand on 2026-08-17**, which settles the design question
  and none of the delivery one. The `hicolor` tree was regenerated from the master at
  16/24/32/48/64/128/256/512 plus a `scalable` SVG, `Name` corrected, and the icon cache rebuilt;
  the panel picked it up without a restart, and **the notched silhouette renders correctly in a
  real panel at ~22px** — the one thing about this mark nobody had yet seen outside a screenshot.
  But it edited `~/.local/share`, so it holds for one user on one machine and a fresh install
  still gets whatever the bundler writes.

  Two details for whoever does the bundler work: the entry should name the app `factorai`, not
  `FactorAI`, and a `256x256@2` directory takes a **512px** file — the AppImage's own integration
  put 256 there. macOS is still untested: nobody has run the `.icns` past a real dock or
  Spotlight.

## 19. IDE emulation — the MCP server Claude opens files and diffs through

**The read-only bridge shipped 2026-08-19 and the CLI connects** (observed against 2.1.235):
the lockfile and its reaping, the authenticated handshake and `tests/ide_ws_scope.rs`, the MCP
layer with three tools, and the wiring that starts a bridge with each PTY. The design is
[F20](../05-features.md) and
[ADR-0017](../adr/0017-ide-bridge-writes-one-lockfile-into-claude-ide.md); the write path
is the half that is still only a decision. What is left:

- **A tool call observed end to end.** `openFile` reaching the viewer has only
  been driven by unit tests; the connection and handshake have not.
- **Surfacing a bridge that never connects.** The header now badges the one
  failure we can name without guessing — the bridge did not bind. The two other
  shapes of "it isn't working" need a timer and a threshold to detect: a client
  that never attaches (indistinguishable from one still starting, since the
  CLI's autodetect polls for 30s) and one that detaches while the PTY lives on
  (what `/ide` disconnect looks like). Both are real failures worth catching and
  neither is worth a badge that cries wolf; decide the threshold deliberately.
- **`selection_changed`, the ambient half.** Handing files over is explicit now
  (F20 § "Handing files to the agent"); this is the other one, where merely
  selecting in the viewer tells the agent what you are looking at and its footer
  says "4 lines selected · In foo.ts". Deferred rather than dropped — note its
  its lines are 0-based on the wire — the same as `at_mentioned`'s, which was
  established the hard way (F20).
- **Shift-click ranges across directories in the tree.** They stop at a
  directory boundary today because the tree is recursive and each node fetches
  its own listing, so nothing holds a flat list of what is visible. Wider ranges
  mean lifting those listings out of their nodes.
- **An `openFile` for a background session lands in a toast.** Nothing happens
  today and the agent is told so. A tab mark was tried and removed for colliding
  with the session status dot, and the toast it was waiting on exists now
  (ADR-0065), so this is a call site rather than a decision. The comments in
  `services/ide/protocol.rs` and `ui_state.rs` still describe the removed tab
  mark; fix them in the same commit.
- **The off switch**, which is now a `SettingRow` in F11's modal — `prefsStore` and the
  Confirmations/Sessions pattern exist, so this is a row and a boolean rather than a surface.
- **`openDiff` and the write path** — its own ADR, and the thing that supersedes
  part of ADR-0009.

## 63. The PDF viewer's four follow-ups

**Split out of item 21 on 2026-10-01**, when that entry was retired. Preview itself shipped
2026-08-19 (pdf.js, bundled, continuous scroll with a text layer — F7, ADR-0018); these were scoped
out of it deliberately, in the order they are worth doing. None is started.

- **A find bar.** `Cmd+F` across the document, with match highlighting and next/prev. The text
  layer is already there, so this is a match index and a scroll-to-match rather than new
  plumbing. **The shape is settled**: F7's find widget shipped 2026-09-09 — Monaco's, restated
  in the app's palette — and this bar matches it rather than inventing a second look. What is
  still open is only where the bar sits, because a floating widget over a PDF has no editor to
  scroll a blank row into.
- **Go-to-page.** A number box beside the counter. Small, and only obviously worth it once a
  document long enough to want it is in front of someone.
- **Outline sidebar**, from `getOutline()` — real navigation for a spec or a book. Needs a
  layout decision the pane doesn't currently have room for.
- **Rendered PDF diff.** A changed `.pdf` in the Changes tab dead-ends on "Cannot preview binary
  file" today. Two `PdfView`s scroll-synced by page is the obvious shape; the open questions are
  what "changed" means for a page (any pixel? any text?) and whether an added or deleted page
  should align against nothing on the other side.

## 29. Error boundaries — per-surface, so one crash costs one pane

**The root boundary and the crash screen shipped 2026-08-17** (F17, `DONE.md`). What was
deliberately left is the interesting half: root-only means a crash in the file tree still takes a
running terminal's pane down with it. The shape when someone picks this up:

- Boundaries around the **panel**, the **viewer**, and **each session pane** — the last one is the
  one that matters, since a live agent is the only thing in this app that is expensive to lose.
- A failed surface should degrade to a message **inside its own box**, not a full-screen takeover.
  That is a different component from `CrashScreen`, not a prop on it — the full-screen one owns
  Reload, and reloading the whole webview is exactly what a contained failure should not offer.
- **Check what TanStack Router already covers first.** Routes take an `errorComponent`, so the
  per-route case may want no hand-rolled boundary at all. Establish what it catches (render errors
  in the route, loader rejections) versus what it doesn't, rather than shipping a second mechanism
  that overlaps it.
- Still true at every level, and worth restating so nobody expects otherwise: **no** React boundary
  catches event handlers, `setTimeout`, or unhandled rejections. Those are item 7's toast path, and
  the two should stay separate surfaces.

A smaller one: the crash screen has no test that actually renders it — `crashReport`/`issueUrl` are
unit-tested, but nothing throws inside a mounted tree. A `@smoke` case needs a deliberate way to
make the mock app throw; worth adding when the per-surface work lands, since that is when the
boundary logic stops being trivial.

## 32. Light theme — make the palette that already exists actually render

**Split out of item 4 on 2026-08-17**, during F11's interview, because it is a feature and not a
row in a settings page. Nothing sets `data-theme` anywhere, so **the light palette in
`packages/ui/src/styles/globals.css` has never rendered** — it is dead CSS that has been maintained
in every token change since.

Three unbuilt things, and the CSS is the part that is already done:

- [ ] Something that sets `data-theme` — a preference in `prefsStore` (`system` / `light` / `dark`),
      applied to `<html>`, defaulting to following `prefers-color-scheme`.
- [ ] **A second Monaco theme.** `components/viewer/monaco.ts` defines exactly one,
      `factorai-dark`, behind a `themeDefined` latch that assumes there will only ever be one.
- [ ] **Q8's palette→xterm mapper, which was specced and never built.** `Terminal.tsx` hardcodes
      `{ background: '#0c0e12', foreground: '#d4d4d8', cursor: '#e5b455' }`. Q8 decided "two themes
      synced to the app theme via a small mapper"; the mapper does not exist, so the terminal would
      stay dark inside a light app.

**And a pass over every surface**, because a token existing is not the same as a surface being
judged in it. F18's lane colours are the sharpest case: eight categorical hues chosen against a 16%
background, with light values written but never once looked at. Expect real corrections there.
The pass also has four hardcoded `bg-[#0c0e12]` to replace with a token: `Terminal.tsx`,
`ShellPane.tsx`, `SubAgentTranscript.tsx` and `routes/session.tsx`.

**Where the control goes is decided, and the section exists**: Settings has an **Appearance**
section now, holding the 24-hour clock. So the settings work here is one more row there, a `Select`
and a `prefsStore` key; everything else in this item is the feature.

## 34. Session status — the unread axis, and two upgrades worth waiting for

**The dot shipped 2026-08-18** — F10 is the design,
[ADR-0015](../adr/0015-session-status-from-the-terminal-title.md) the mechanism, `DONE.md`
the entry. Four things it left, in the order they are worth doing.

**The unread / never-opened axis** is the third thing the original feedback asked for and the only
part of it not built: durable `viewed_at` per session compared against `updated_at`, which needs a
migration and is orthogonal to the live PTY states. It is also what a
`finished` state would need in order to mean anything, so the two arrive together or not at all.
It has to be agent-agnostic: Codex sessions have their own status source (`run-state`, F30), and
the unread axis is about the human having looked, not about which agent wrote the turn.

**`needs_permission` is a verified recipe sitting unused.** F10 records it in full — `claude
--settings '{"preferredNotifChannel":"ghostty"}'` plus
`CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK=1` yields `OSC 777` notifications carrying the
permission and plan-approval messages. It was dropped as not worth a settings file for a fourth
state, and reinstating it is additive. The consequence to weigh first is in F10: a session parked on
a permission prompt currently reads as `waiting_input` and so closes without a confirm.

**And the upgrade that supersedes the whole mechanism**: `OSC 21337 TAB_STATUS`, structured
`indicator=…;status=Working…` with `idle | busy | waiting`, is already in the CLI behind a gate
compiled to `return !1`. When that ships live it replaces the glyph rule and hands us `waiting` as a
first-class state. `scripts/qa/osc-probe.sh` is how you find out.

**Free and not taken:** the title carries Claude's own derived session name, so live tab titles cost
nothing but keeping a string the parser already has.

## 35. Desktop notifications when a session wants you

**User ask, 2026-08-18, filed with the session-status work (item 34) and deliberately split from it.** When a session goes
`working` → `waiting_input` while you are not looking at it, notify the OS.

**Depended on item 4, which shipped 2026-08-20** — the user's condition was "wait the setting modal
to control enable of desktop notif", and it is met: a notification nobody can switch off is a bug,
and the switch is now a `SettingRow` beside the other four preferences rather than a home this
feature has to invent. It goes in the **Sessions** section, which exists now: that section is
about the unit of work, and so is this.

**The edge it fires on already exists.** F10's title parser produces exactly the
`working` → `waiting_input` transition this needs (shipped 2026-08-18), so there is no detection
work here at all — **nothing is blocking this item now.**

**What it actually costs**, since the trigger is free:

- `tauri-plugin-notification`, which is **not** in `Cargo.toml` today — a new load-bearing
  dependency, so it wants its own ADR or a line in this one's.
- macOS asks the user for notification permission the first time. Decide what happens when they
  decline, and do not ask on launch — ask the first time a notification would fire.
- **Do not notify for the session you are looking at.** The window's focus state and the active
  session both gate it; the whole value is sessions you are *not* watching.
- Coalescing, so four sessions finishing together are not four banners.
- Clicking the notification should focus the window and open that session.

**Worth knowing before designing it.** Claude Code has its own notification path and its own
opinion about when you are away: it suppresses notifications with `disabledReason: "user_present"`
unless `CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK` is set, and its idle notification is 60s
delayed by default (`messageIdleNotifThresholdMs`, which is **not** reachable through `--settings` —
verified). None of that is needed if the trigger is item 34's edge, which is instant. Do not
reintroduce the CLI's notification channel for this; it is slower than the signal we already have.

**Item 42 (routines) adds a requirement here.** A routine's session runs with **no tab**, so
whatever notices "this session wants you" cannot be driven off the tab strip or off anything that
assumes a session is open. That is the case this feature is most useful for — an agent that started
while you were elsewhere — and the easiest one to miss when the trigger is written.

## 38. More agents — Codex first, then Gemini CLI, OpenCode and Cursor, behind one seam

**User ask, 2026-08-24; specified 2026-09-22** as [F30](../05-features.md) with
[ADR-0060](../adr/0060-an-agent-is-four-capabilities-each-of-which-may-be-absent.md) (the seam:
four optional capabilities), [ADR-0061](../adr/0061-a-project-runs-one-profile-and-that-profile-names-its-agent.md)
(a project runs one profile, whose agent is the project's agent) and
[ADR-0062](../adr/0062-a-session-id-the-agent-mints-is-adopted-from-its-title.md) (Codex's id
is adopted from the terminal title). The word is **agent**, not harness: `agent` is the column,
the constant and the module.

**Every Codex fact in F30 was read from source (`rust-v0.155.1`) and the installed binary, not
from disk** — Codex had never run on the machine it was specified on. Slice 1 exists to change
that before a line of parser is written.

Slices, in order; each is its own commit series against `main` and each moves here when it lands:

**Shipped outside the slices, so nobody re-files them:** importing Codex sessions (`a319f66`) and
the agent's mark on search hits (`9aa372a`).

- [ ] **1. Fixtures — the rest.** Slice 3 landed one real thread under `tests/fixtures/codex/`;
      what is left is the multi-session set below and the **[unverified]** sweep. Log in to Codex, run three sessions in a scratch folder (one fresh, one
      resumed with a second turn, one with a tool call and an approval), rename one thread, archive
      one, trash one rollout by hand and reopen `codex resume`. Record the OSC-0 title sequence of
      one full turn through a PTY. Land the rollouts, `session_index.jsonl` and the title log under
      `tests/fixtures/codex/`, and turn every **[unverified]** in F30 into **[source]**, a fixture,
      or a correction — in particular: `thread-id` in the title before the first message, the wire
      spelling of every `type`, an HTTP MCP server defined wholly by `-c`, and whether a trashed
      rollout upsets the resume picker. No app code.
- [x] **2. The seam and the Agents section** — shipped 2026-09-22, `DONE.md`. Also carried
      the parts of slice 4 that did not need the migration: the agent picker on the profile
      form, per-agent profile resolution and `CODEX_HOME`, the Codex default profile seeded on
      first sight of a binary, and the **app default star** in Profiles that writes
      `agent.default`. Two feedback rounds moved the default-agent choice out of the Agents cards
      (binaries only) and into Profiles, and gave both agents their vendor marks.
- [x] **3. Status and adoption** — shipped 2026-09-22, `DONE.md`. The `run-state` word drives
      the dot; the truncated `thread-id` prefix plus the rollout that appears at the first turn is
      the adoption (ADR-0062 amended). Slice 1's fixture came with it: one real thread, sanitised,
      under `tests/fixtures/codex/`, and the title sequence of one turn as test literals.
- [ ] **4. One profile per project.** What slice 2 left of it: a migration (0023 or later — 0022
      is taken) for the index change
      (`UNIQUE (project_id)`), `Profile ▸` grouped by agent, and `set_project_profile` clearing
      one row rather than every agent's.
- [x] **5. Discovery, transcripts, search** — shipped 2026-09-22, `DONE.md`. Discovery by
      `session_meta.cwd`, the rollout reader mapped onto the indexer's events,
      `sessions.transcript_path`, Codex's auto-title from `session_index.jsonl` as `ai`, FTS rows,
      delete via the recorded path. Left: sub-agents by `parent_thread_id`, a `custom` title kind
      (Codex's index does not tell a user's rename from its own name).
- [x] **6. Tools** — shipped 2026-09-22 with slice 3: `-c mcp_servers.factorai.url` plus
      `bearer_token_env_var` at spawn, the token in the environment. **Left of slice 6:**
      `routines.agent` and the routine form's select.
- [x] **Add to agent context for Codex** — shipped 2026-09-22 through `codex queue --thread
      --message` (F30 § "The IDE bridge, and what Codex gets instead"); needs the adopted id, so
      it works from the first turn on, and it is a turn rather than a composer insert.
- [ ] **The other half of the bridge for Codex**, two substitutes, neither built: an `openFile`
      tool on factorai's own MCP server (the model opens a file for you — a decision, not a
      follow), and a live tail of the session's rollout for `custom_tool_call` paths (the viewer
      follows the agent, about a second late). Each is its own F30 section before code; the
      app-server protocol stays out until it drops its experimental label (ADR-0060).
- [ ] **7. The rest.** Gemini CLI, OpenCode, Cursor, each as one `Agent` value against the settled
      seam, each starting with its own slice 1. The seam is reopened only for a fifth capability,
      by a new ADR.

**Still true from the original entry, and now where it belongs:** the IDE bridge (ADR-0017) stays
Claude-only until a second protocol has been observed end to end; `agents/mod.rs`'s "no
`trait AgentStore`" note is replaced in slice 2, not contradicted; the quit guard and kill-on-quit
are unaffected because a PTY is a PTY.

## 40. Pull requests and merge requests — GitHub and GitLab, from inside factorai

**User ask, 2026-08-24.** The agent produced a branch and some commits; the next thing a human
does is open a PR or an MR, and today that means leaving the app.

**This crosses two boundaries at once, so it needs its own ADR (§ 5).** ADR-0009 says every
repository read goes through `git2` and *"everything is read-only. No staging, no discard, no
commit"* — a pull request is not even a working-tree write, it is a **network** write, and the
only network the app does today is `tauri-plugin-updater` checking for a release (F14). Item 19
already owes an ADR for writing to the working tree; this is a second, different one, and it is
the one with a credential in it.

**Authentication is the load-bearing question, not the API.** Two shapes:

- **Shell out to `gh` and `glab`**, which are already authenticated on the machine of anyone who
  would want this. Discovery is the three-tier probe `services/claude_cli.rs` already
  implements — the same problem, already solved here — and factorai stores no credential at all.
- **A personal access token in the `settings` table**, which is a plaintext SQLite column in the
  app's data directory. Defensible only with a keychain dependency we do not have.

**Take the first for v1**, and record it in the ADR so it is not re-argued: it is the option where
"where is the secret" has the answer *not here*. § 8's "no Claude OAuth helper — rely on the
user's existing `claude login`" is the same reasoning, one tool over.

**Start read-only, which costs no write ADR at all** and is useful on its own: for the checked-out
branch, is there a PR/MR, what state is it in, what do its checks say, and open it in a browser.
That composes with the Changes tab and with item 1's graph, and it is the half a human looks at
most.

Then, in order:

- [ ] **Host detection.** The remote URL via `git2` decides GitHub, GitLab or self-hosted; a
      self-hosted GitLab needs a base-URL setting. A repository with several remotes — fork plus
      upstream is the normal case — has to be asked about rather than guessed at.
- [ ] **The read slice**: PR/MR for the current branch, state, checks, open in browser.
- [ ] **Create from the current branch**, title and body. The interesting version is the body
      **drafted from the session that produced the commits**, which is exactly the session ↔ commit
      link item 1 defers — so the two are worth landing near each other.
- [ ] **Review threads in the app**, which is the § 1 *review* verb and is bigger than everything
      above it combined. Scope it separately; do not let it ride along.

**Worktrees make "the current branch" ambiguous** (F21). Resolve it against the checkout
the panel is showing, which is the rule F21 already settled for the file panel — not against the
repository's `HEAD`, which may be a checkout nobody is looking at.

## 43. A simpler way to hand a file to the agent — a drop target and a visible control

**User feedback, 2026-08-31.** The capability exists and the *gesture* is the problem: today the
only ways to put a file in front of the agent are a right-click on a tree row
(`FileRowMenu.tsx`, "Add to agent context") and the viewer's selection mention
(`FileView.tsx`), both landing on `cmd.ideMention` / the F20 bridge. Neither is visible until you
already know it is there, and neither accepts a file from outside the project tree. Asked for as
"drag-and-drop, or an Add file button somewhere".

- [ ] **A visible control.** F12 refuses hover actions on a tree row at 288px and that stays true,
      so this is a control on the session surface rather than on the row — near the terminal, where
      the thing you are adding context *to* is. It opens the tree's own selection, or a native file
      dialog for a path outside the project, and calls the same `ideMention`.
- [ ] **Drag a tree row onto the terminal.** In-app, so dnd-kit (ADR-0016), the same as
      `SessionTabs` — not HTML5 DnD, which § 4 rules out. Multi-select already exists
      (`panelStore.selectedPaths`) and the menu already acts on it; the drag should too.
- [ ] **Drop a file from outside the app.** This is *not* the banned HTML5 path — it is Tauri's own
      window-level drag-drop event, which is the thing that swallows HTML5 DnD in the first place.
      Verify it fires on both platforms before designing around it, and decide what a path outside
      the project root means: `ideMention` is scoped (see `05-features.md` § F20, "the human's own
      mention path shares the scope"), so an out-of-project drop either widens that scope or is
      refused with a reason.
- [ ] A keyboard path beside the drag, per § 4 — the visible control above is most of it, but the
      tree needs a key that adds the current selection without the mouse.

**Open.** Whether a folder drop means the folder or its files, and what feedback the terminal gives
that a mention landed — today the only acknowledgement is the row's transient mark, which is on a
surface you may have dragged away from.

## 44. A default model, set once in Settings

**User feedback, 2026-08-31.** Every session spawns whatever the CLI defaults to; choosing a model
means typing `/model` in each one. Wanted as a preference.

- [ ] `SettingKey::ClaudeModel` (`models/`, `services/settings.rs`) — the SQLite `settings` table,
      not `prefsStore`, because **Rust** reads it at spawn (ADR-0013 decides this).
- [ ] Pass it as `--model` where the argv is built in `services/terminal.rs` (beside `--resume` /
      `--session-id` / `--mcp-config`). Empty means unset, and unset must pass no flag at all —
      the CLI's own default is a real answer and overriding it with a stale pin is worse than
      nothing.
- [ ] A row per agent in `components/settings/AgentsSection.tsx`, beside that agent's binary path —
      same card, because both are "how we launch it". A free text field, not a hardcoded list:
      model ids outlive our releases, and a picker that does not know this month's names is a
      wrong picker.
- [ ] **Codex too** (F30): its own key and its own flag, passed where `agents/codex.rs` builds
      the argv. Rewritten 2026-10-01 — this entry was written when Claude was the only agent.
- [ ] A `--resume`d session keeps the model its transcript already has; check what the CLI does
      when `--model` and `--resume` disagree before assuming either.

**Open.** Whether this belongs per-project as well as globally — a project pinned to a cheap model
for routine work is the obvious second ask, and item 42's routines are the case where it matters
most. What is *not* open any more: the model is not a field on a profile. Item 45 considered
folding it in on 2026-09-04 and rejected it — it conflates identity with cost policy, and running
a cheap model on your own account would have needed two profiles over one config directory, which
the scan cannot allow. See `DONE.md`'s entry for that item. So this one is independent of profiles
rather than sequenced behind them.

## 48. The file viewer's column — the three pieces the first cut left

**Shipped 2026-09-07** — the column, the measured fallback to a split under the tree, the strip of
open files with preview tabs, and the demoted modal. See [`DONE.md`](DONE.md) for what landed and
what driving the dev app caught, and
[ADR-0037](../adr/0037-the-viewer-is-a-column-with-a-measured-fallback.md) for why this
host and not the other five. What is left is small and independent:

**`Escape` landed 2026-09-16, and it went the other way**: ADR-0047 scoped it to "focus is in
this pane", and there it **closes the file** rather than handing focus back — the ambush this
item worried about is answered by the scope instead. `useFileViewer.open` now asks for focus so
the keystroke reaches the pane at all (`viewerFocusVerdict`). What that leaves is the original
half, and it is smaller: **where focus goes once the last file is closed**, which is the terminal
and needs a focus path nothing else has wanted yet.

- [ ] **Focus returns to the session when the pane empties.**
- [ ] **Reordering tabs by drag.** `SessionTabs` has the dnd-kit worked example (ADR-0016) and the
      4px activation constraint that keeps a click a click; a keyboard path ships beside it or it
      is half a feature. Nobody has asked to order files yet.
- [ ] **A diff at 400px.** Legible but cramped — two gutters and a wrapped hunk in a column that
      narrow. The expand affordance is the answer for now; `diffInline` and the pane's width are
      the two knobs worth trying before anything is built. Check the PDF at the same width while
      you are there: nothing in ADR-0018 answers it, and a continuous-scroll page at 400px is
      either fine or unreadable.

## 52. The file viewer, and the panel with it, in a window of its own

**Chosen 2026-09-07** alongside item 48, from the same six-host prototype, and deliberately split
out of it: this is the app's first *second window*, and none of item 48's problems are its problems.

**What it is.** A control in the panel header opens a second window carrying the whole panel —
Files, Changes, Graph — beside the viewer. The main window keeps its own panel; clicking a file
there opens it in the detached window and raises it, rather than doing nothing, which is the
failure that looks like a broken link. Closing the detached window brings the viewer back. Inside
it, the same measured rule as item 48 decides tree-beside-viewer or tree-above-viewer.

**Why it is its own item and its own ADR.** Three problems that item 48 does not have:

- **Window lifetime.** Kill-on-quit (ADR-0005) and the quit confirm (ADR-0020) both assume one
  window. A second window that outlives the main one, or that the quit path forgets, is the orphan
  problem on a surface we don't control.
- **State.** Zustand over `localStorage` does not live-sync between windows. One set of open files
  per checkout was chosen precisely so the strip *moves* rather than forking — which means the two
  windows have to agree about it, and today nothing makes them.
- **The route.** The detached window needs a route that renders the panel and the viewer and
  nothing else, on the same hash history, without a session in it.

None of it is started until item 48 has shipped and been lived with.

## 60. The oxlint rules the Biome migration left off

**Deferred 2026-09-21**, in ADR-0054, which swapped Biome for oxlint + oxfmt and deliberately did
not change renderer behaviour in the same commit. Two families are off in `.oxlintrc.json`, each
with its reason written beside it there. This item is the work of turning them on.

- [ ] **The React Compiler family — 77 findings.** `react/refs` (53), `react/set-state-in-effect`
      (12), `react/immutability` (9), `react/preserve-manual-memoization` (2) and
      `react/exhaustive-effect-dependencies` (1). Biome 1.9 had no equivalent, so none of this
      code was ever written against them. They are not style: a ref read during render and a
      `setState` in an effect are the two ways a pane goes stale, and the Hero's scrubber and the
      terminal's xterm wiring are exactly where they fire. Expect a real reading of each, not a
      fix-all — and expect some to be correct as written, in which case the suppression carries
      the reason.
- [ ] **Four `jsx-a11y` rules — 9 findings.** `no-autofocus` (2), `no-static-element-interactions`
      (4), `no-noninteractive-element-interactions` (1), `prefer-tag-over-role` (2). Every other
      `jsx-a11y` rule is already on and green. Each of these fires on a deliberate pattern —
      `autoFocus` in a dialog that opens onto one field, `role="separator"` on a resizer that is a
      focusable widget rather than an `<hr>`, pointer handlers on containers whose keyboard path
      is bound elsewhere — so the work is deciding, per site, between a keyboard path that is
      genuinely missing and a suppression that says why it is not.
- [ ] **While in there: `oxfmt` import sorting, and one root `oxlint`.** `sortImports` would
      rewrite 181 files and gate the ordering Biome's `organizeImports` was configured for and
      never enforced. A single root `oxlint` run — now 191 ms for the tree — would replace the
      per-package fan-out and lint `tests/` and `scripts/`, which nothing has ever linted. Both
      are one-line config changes with a wide diff behind them; neither belongs in a commit with
      the other two.

## 17. Rename a session from inside factorai

Reading the name `/rename` set is done (F2). Setting one from the app is not, and it is a bigger
question than it looks: `custom-title` lines live in the session's own JSONL under
`~/.claude/`, which **ADR-0004 declares read-only** — the CLI owns that tree. Appending to a file
Claude Code has open, from a second process, is exactly the kind of thing that ADR exists to
prevent.

Options, none free:

- **Append a `custom-title` line** to the transcript, as the CLI does. Simple, and the name shows
  up in Claude Code too. But it writes into a file another process is actively appending to, and
  it supersedes ADR-0004 — which needs a new ADR, not a shrug.
- **Keep the name in our own database**, overriding the transcript for display. No writes to
  `~/.claude` at all, so ADR-0004 stands — but the name exists only in factorai, and `/rename`
  and the app can then disagree about what a session is called.
- **Drive the CLI**: send `/rename <name>` to the session's PTY. Uses the owner of the file to do
  the writing, which is the tidy answer — but only works while a session is live, and typing into
  someone's terminal to change metadata is a strange mechanism.

Worth doing — the user manages names with `/rename` today and has a hook proposing names from the
issue/PR — but it wants the ADR-0004 question answered first.

**Re-checked 2026-10-01, and kept at very low priority on the user's call** — last in this file for
that reason. The first option is now ruled out twice: ADR-0039 restates that factorai writes files
in the user's project and never inside an agent's own store. And Codex sessions (ADR-0060) mean an
answer that only drives Claude's CLI covers half the sessions. So the realistic shape is the second
option, a name in our own database, and the question left is whether `/rename` and the app
disagreeing is acceptable.

