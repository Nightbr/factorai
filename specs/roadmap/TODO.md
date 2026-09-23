# TODO

The agreed next steps, in priority order — the single source of truth for "what should we work
on next". Consult it before re-deriving a plan from the specs and codebase. See
[`README.md`](./README.md) for how this folder works, and [`DONE.md`](./DONE.md) for what has
shipped.

**Only live work is listed here.** Cleaned out twice — 2026-08-18 and again **2026-09-17**, when
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
menu verified 2026-09-17, and the release pipeline builds, signs and publishes on a tag. Items 6
(titlebar), 7 (error UX) and 8 (the smoke pass) are what M5 still owes.

**M6 is down to three workstreams.** Items 39 and 58 landed 2026-09-21 (`DONE.md`): the site
builds from `apps/docs`, deploys to Pages on every push that touches it, answers on
**`factorai.build`** (ADR-0055) and opens on the hero one-pager. Both keep their numbers for a
remainder — the guide's content for 39, the screenshots, the motion and the e2e test for 58 —
and **item 61**, real screenshots in the guide, is the new entry that came out of them. Items
51, 31 and 59 are what M6 still waits on.

**The list is now headed by M6 — the public first release.** See the block below: five
workstreams, in build order, and **only those five gate it**. Everything under them, M5's own
remainder included, is post-release work and is not a reason to delay the tag.

### M6 — the public first release

**Decided 2026-09-17.** Today's releases are for people who were told about them; M6 is the one a
stranger finds. Five workstreams, in the order they should be built, each an item below:

1. **[Item 51](#51-macos--a-developer-id-certificate-notarization-and-the-end-of-the-permission-loop) — a signed, notarized macOS app.** The decision to pay for the Apple
   Developer Program was taken 2026-09-17. First because enrolment is the long pole: nothing else
   here waits on a third party.
2. **[Item 31](#31-two-channels-and-a-release-process-with-nothing-left-to-remember) — alpha and stable, and a release process with nothing left to remember.**
   Strangers on the update path make "the pipeline is trustworthy" a release criterion rather
   than housekeeping. **Built 2026-09-23 (ADR-0064)**: alpha builds itself from green `main`
   through a pointer release, stable is a promoted alpha. What is left is its first real run.
3. **[Item 59](#59-performance--one-audit-measured-then-the-fixes-it-names) — the performance audit, then the fixes it names.** Items 54 and 55 are its
   first two known findings and sit directly under it.
4. **[Item 39](#39-the-site--the-guides-content-now-that-the-build-carries-it) — the site: one Docusaurus build on GitHub Pages.** The build, the
   deployment and the domain landed 2026-09-21; the guide under `/docs` is scaffolded prose and
   is what is left.
5. **[Item 58](#58-the-hero--the-screenshots-the-motion-and-the-test-the-page-still-owes) — the hero one-pager**, which is that site's index and the first thing anyone
   sees. **The page landed 2026-09-21**; the entry is now the screenshots, the motion and the
   test it owes.

**Item 36 (the Homebrew cask) sits directly after them**, because it is the install path the site
will point macOS users at and its instructions change the day item 51 lands.

**What M6 deliberately does not block on.** The titlebar (6), the toast primitive (7), the manual
smoke pass (8), file drafts (2) and everything below. That is a choice, made 2026-09-17, and it
has a cost worth stating once: going public with no toast means a transient failure still has
nowhere to surface, and skipping item 8 means the first Finder-launched macOS run may be a
stranger's. Item 51's own verification list covers part of that ground on the platform where it
matters most.

**Item 4 was the one with dependents, and they are unblocked.** Items 31 (the channel picker), 32
(the theme control) and 35 (the notification toggle) were waiting on the surface it creates; the
switch item 33 wanted shipped with it. Each of those now needs a `SettingRow` and a section
heading rather than a settings feature — read them for what is left.

**Below the M6 block, a position is where a slot happened to be free, never a claim about
priority.** The first eight entries are the exception and are ordered deliberately: the five
workstreams, then the cask. **Item 42 (routines)** is the other one — asked for at high priority
on 2026-08-28 and placed for it. **Item 47 (the footer shell) shipped on 2026-09-01, the day it was asked
for, and item 49 (splits in that footer) on 2026-09-02, likewise**; their entries are in
`DONE.md`. **Item 50 rescoped that footer from the session to the project** on 2026-09-03, also
the day it was asked for; its entry is in `DONE.md` too. Items 12–14 —
the `Cmd+P` / `Cmd+Shift+F` / `Cmd+G` navigation trio — are high priority despite sitting
mid-list, and everything past 21 is simply the order things were asked for.

## 51. macOS — a Developer ID certificate, notarization, and the end of the permission loop

**Release-blocking. The decision this item was holding open was taken 2026-09-17: pay for the
Apple Developer Program.** Everything below follows from that, and it supersedes the interim the
free half shipped.

**Where it comes from.** A user report, 2026-09-03, in their words: *"il y a un petit bug avec les
droits, on me demande tout le temps le droit d'accéder aux mêmes dossiers. Je suis ramené dans les
paramètres pour autoriser une bonne fois pour toutes mais après redémarrage, rebelote."* Plus a
*"factorai was prevented from modifying apps on your Mac"* notification, and factorai's **App
Management** toggle showing as off after they had switched it on. Two mechanisms, one cause,
diagnosed in [ADR-0034](../adr/0034-macos-bundles-carry-a-self-signed-signature.md): TCC
anchors a grant to the app's designated requirement, so an identity that changes per build orphans
every grant, and `tauri-plugin-updater` writing inside `/Applications/factorai.app` is App
Management, whose only two escapes both key on an Apple **Team ID**.

**The free half shipped 2026-09-03** — releases are signed with a self-signed certificate held as
`APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD`, so grants anchor to it and App Management is
asked for once instead of once per version. That was the right interim and it is not the answer:
Gatekeeper still blocks the `.dmg`, and the prompt still appears.

**What the paid half buys, precisely.** A **Team ID**, which satisfies the same-team rule and
removes the App Management prompt entirely rather than making it stick; and **notarization**,
which removes the Gatekeeper step instead of relocating it — at which point item 36's cask drops
`--no-quarantine`. A Developer ID Application certificate is the only kind that produces either,
and Apple issues it only to paid members; that was always a policy wall, not a technical one.

- [ ] **Enrol, and get the certificate.** Apple Developer Program, then a **Developer ID
      Application** certificate exported as a `.p12`. Enrolment is not instant — it is the long
      pole of this whole roadmap and the reason this item is first.
- [ ] **An ADR superseding ADR-0034's decision**, not an amendment to it: the signing identity
      changes, which orphans every grant **one last time** on the first Developer ID release.
      Users have to be told that in the release notes, because it looks exactly like the bug this
      fixes coming back.
- [ ] **The workflow.** Swap the secrets to the Developer ID `.p12`, add `APPLE_SIGNING_IDENTITY`
      / `APPLE_ID` / `APPLE_PASSWORD` (an app-specific password) / `APPLE_TEAM_ID`, and let Tauri
      notarize and staple with `bundle.macOS` left as `{}`. The self-signed import step and its
      `add-trusted-cert` / passwordless-`sudo` lean come back out.
- [ ] **Verify on a real Mac, not from Linux.** `codesign -d -r- factorai.app` naming the
      Developer ID rather than a cdhash; `spctl -a -vv` accepting the `.dmg`; the stapled ticket
      surviving a download; and the App Management prompt gone rather than merely sticky.
- [ ] **The app still works signed, hardened and notarized.** `hardenedRuntime` was moot while
      nothing signed and takes effect now. Launch it, open a session, drive a PTY, open a file
      dialog, apply an update — the `manual-qa` lane, which is the only thing that can see this.

**What not to try**, kept from the free half: `NSUpdateSecurityPolicy` in our own `Info.plist`
maps team identifiers and is redundant once we have one, and an explicit ad-hoc `codesign` step
remains the dead end item 36 describes.

**One operational consequence worth not learning the hard way.** The `.p12` joins the minisign key
of ADR-0010 as a secret whose loss is felt by *users*: rotating it resets every permission every
user has granted. Losing the Developer ID one also costs the Gatekeeper trust until a new
certificate is issued and a release is notarized under it.

## 31. Two channels, and a release process with nothing left to remember

**Release-blocking. Decided and built 2026-09-23 —
[ADR-0064](../adr/0064-alpha-builds-itself-and-stable-is-a-promoted-alpha.md); what is left is
watching it run for real.** The design came out of an interview the same day; the ADR is the
contract and F14 / F11 / F17 / F29 in `05-features.md` carry the app side.

**What landed.**

- **Alpha builds itself** (`alpha.yml`): on every successful Quality run for a push to `main`,
  debounced by Quality's own `cancel-in-progress` and alpha's concurrency group, skipped when
  only `specs/`, `apps/docs/` or `*.md` moved. A real prerelease, `vX.Y.Z-alpha.N`, macOS and
  Linux only.
- **The alpha channel is a pointer release**, `alpha-channel`, whose one asset is the newest
  alpha's `latest.json`. Stable stays at `/releases/latest`, so every existing install keeps
  working.
- **Stable is a promoted alpha** (`gh workflow run promote`): the alpha's commit must have a
  green Quality run, it is tagged and rebuilt with the stable version, published as Latest
  after ADR-0014's check, then `CHANGELOG.md` and the next-minor bump land in one commit and
  alphas older than the previous cycle are pruned.
- **A hand-pushed `v*` tag fails** in `release-guard.yml` and publishes nothing.
- **The repo holds the next stable** (`0.49.0`); dev builds say `0.49.0-dev`. The placeholder
  special case in `vite.config.ts` is gone.
- **Notes come from `feat:` / `fix:` subjects** (`scripts/release/`, tested with `node --test`
  under `pnpm test`), with an optional headline on promote.
- **In the app**: `check_update` runs in Rust against the channel's endpoint and hands the
  plugin's own `Update` back; Settings › Advanced has the channel; About and the crash report
  name it. Leaving alpha never downgrades.

**Still open — each needs the workflows to run once on GitHub, which no local gate can do:**

- [ ] **The first alpha.** Watch `alpha.yml` after the next app-affecting push: `plan` picks
      `0.49.0-alpha.1`, the release is a prerelease, and `alpha-channel/latest.json` exists and
      lists both platforms.
- [ ] **Alpha to alpha on a real install.** Set a local install to Alpha, let the next alpha
      land, and see it update. Until then `check_update` is verified by types and review only.
- [ ] **The first promote, `0.49.0`.** Existing installs (on `0.48.2`) should see it as a normal
      update; the bump commit should say `0.50.0`; nothing should be pruned yet.
- [ ] **The macOS smoke pass** has still never happened — that is item 8, not this item, and this
      item does not pretend to close it.

**Deliberately not here:** macOS signing and notarisation (item 51), the Homebrew bump (item 36,
which hooks in at the end of `promote.yml`), hotfix branches (ADR-0064 consequence 2).

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
- [ ] **PERF-09** — item 54, session switch. **The `projectCwd` double-mount landed
      2026-09-20** and a smoke test holds it; the defect it was really causing was a PTY
      spawned with no cwd. **What is left is the measurement**: click-to-first-paint for a
      pooled session, a first open this run, and a cross-project switch, in the real window
      with the profiler on — plus the entry's other three candidates.
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
      above quotes before and after against them.

**What this item is not.** A rewrite, a virtualization project, or a dependency swap done on a
hunch. Tier P2 (the raw-bytes PTY channel, WebGL, the entry chunk, `git_status` change detection,
the graph window) is post-release and each of those is measured first; P3 is done when the
adjacent code is touched.

## 54. Switching session — time to the first thing on screen

**Asked for 2026-09-15**, unmeasured. The analysis this entry carried moved to
[`specs/10-performance.md`](../10-performance.md) **PERF-09** on 2026-09-20, with the audit's
verdict on each of its four candidates: the `projectCwd` double mount is confirmed and flickers,
the panel re-root is confirmed free, and "every hidden terminal still has layout" was understated —
they are rendered too, which is **PERF-04**. Tier P1 in both cases; the checklist is item 59's.

- [ ] **Measure first, in the real window** — click-to-first-paint for a pooled session, a first
      open this run, and a cross-project switch — then fix what the number names. The budget is
      spec P3's "session switch" row.

## 55. The markdown preview re-parses far more often than it changes, and mermaid pays for it

**Asked for 2026-09-15.** The analysis this entry carried moved to
[`specs/10-performance.md`](../10-performance.md) **PERF-13** on 2026-09-20, unchanged by the audit:
hoist and memoise the parse, make the render-time ref read explicit, cache the palette reads behind
the theme event, queue diagram renders, keep the old SVG during a re-render, and measure a
genuinely large document before deciding anything else is needed. Tier P1; the checklist is item
59's.

## 39. The site — the guide's content, now that the build carries it

**The build, the deployment and the domain shipped 2026-09-21** (`DONE.md`): `apps/docs`
([ADR-0051](../adr/0051-the-site-is-apps-docs-and-the-mark-may-move-there.md)),
`.github/workflows/pages.yml` on every push that touches it, and **`factorai.build`**
([ADR-0055](../adr/0055-the-site-lives-at-factorai-build.md)) with item 58's hero as the index.
What is left, and what still gates the release, is the **guide's own content**: seven pages
written from the specs and not yet checked against the running app.

**User ask, 2026-08-24, restated 2026-08-30**: *"we will write a full docs later for all factorai
features"*. Everything written for a *user* today is `README.md`, the five screenshots in
`assets/images/` and those seven pages. Everything else in the repository is written for whoever
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

- **Install**, currently the most under-served thing: the AppImage, the `.dmg` and — once item 51
  lands — a notarized one that needs no Gatekeeper step at all, plus the Homebrew cask (item 36).
- **First run** — adding a project, what discovery does, why sessions appear on their own.
- **The surfaces** — sessions and the terminal, Files, Changes, the graph, search, worktrees, and
  **routines** (F22): the schedule presets and the custom cron, the next-runs echo, catch-up and
  its window, the concurrency cap, what `Run now` answers when it declines, and the blue dot for a
  session running with no tab.
- **Settings**, and **keyboard shortcuts** — the defaults table F28 publishes, and the Keyboard
  section that rebinds them.
- **Troubleshooting**, where the known-and-non-obvious go: `claude` not found and the F11
  override, the AppImage's environment leaking into child processes, Linux specifics, and the
  macOS permission prompt (item 51) until it is gone.
- **Releases and channels**, sharing whatever item 31 settles rather than describing it twice.

What is left:

- [ ] **Every page checked against the running app, not against the spec it was written from.**
      The scaffold landed 2026-09-19 — Installation and updates, Projects, Sessions, Routines,
      Files (with Changes and Graph), Terminal, and Advanced (Profiles, Worktrees, Keyboard
      shortcuts). A page written from a spec is a page that describes the app as designed; the
      release is the first time a stranger reads it as the app as built. Troubleshooting and
      *First run* are the two the scaffold does not yet have.
- [x] **The site reuses `assets/images/`** — decided and measured 2026-09-21. A relative path
      out of `apps/docs/docs/` (`../../../assets/images/<name>.png`) is resolved by the MDX
      image loader: the build emits it under `/assets/images/` with a content hash, no
      `staticDirectories` entry is needed, and a path that does not exist fails the build rather
      than shipping a broken image. One copy per screenshot, so one re-shoot serves the README
      and the guide. The images themselves are item 61.
- [ ] **Versioning is deliberately off at first.** Docusaurus can version the docs per release;
      switching it on before there is a second release to compare against buys a directory of
      duplicates. Revisit when the stable channel has shipped twice.

## 58. The hero — the screenshots, the motion and the test the page still owes

**The page shipped 2026-09-21** (`DONE.md`): the five-step pinned intro, the app mock, the
eight-cell bento, the download band that reads the real release assets, and the About lines, live
at the site's root. **It is no longer what blocks the release.** What is left is the half the page
currently argues with code — real pictures of the real app — and the test that guards it.

**What the page has to say**, and `PRODUCT.md` is the contract for all of it: an ADE, not an
editor with an agent in a pane; the unit of work is a session; the human supervises, decides,
reviews and sets the rules. The four verbs are the page's spine, not decoration. What it must
**not** do is invent evidence — no user counts, no benchmarks, no logos, no testimonials, because
there are none and a fabricated one is the fastest way to lose the reader this page is for.

- [ ] **Screenshots, and the privacy problem item 41 already hit.** A dev build against the
      author's own workspace is full of client and employer names, and four blurred rows plus one
      legible one reads as a redacted document. The subject has to be **fabricated**, which is
      the same fixture item 41 needs for its GIF and item 61 needs for the guide — **build it
      once, in item 61**, and this entry becomes a choice of which shots the hero wants beside
      its coded miniatures.
- [ ] **Motion, if any, is honest.** The sidebar gesture is the one thing a still cannot show
      (item 41). A WebM of the real gesture from fake data belongs here as much as in the README;
      a generic animated mockup of a product that does not behave that way does not.
- [ ] **The e2e hero test** — button through the five steps, each headline asserted — and the
      byte-identity check for `apps/docs/static/img/factorai-icon.svg` against the brand master,
      the same way `geometry.test.ts` guards the favicon copy (B5). Owed since the promotion.
      **Plus a geometry test for `MetalMark.tsx`** (ADR-0052), the second hand-mirror of the
      master, which needs the same guard `geometry.ts` has.

**Not in scope:** a blog, a changelog page (`CHANGELOG.md` exists since item 31, ADR-0064; rendering it on the site is not this item), pricing, or a
newsletter. One page, one job.

## 61. Real screenshots in the guide, from a fabricated workspace

**Asked for 2026-09-21**, the day the site went live: *"for the docs, can we have some real UI
screenshots of part to illustrate the docs?"*. Today the guide is seven pages of prose and not one
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
the reason item 58 has never had a still. So the subject is **fabricated**, and it is the same
fixture items 41 and 58 want. Build it once here:

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
- [ ] **A signed-in fixture store, for the one shot that needs a live agent.** Opening a session
      spawns `claude --resume` in the fixture's config directory, where no account is set up, so
      the pane shows the trust prompt and then a sign-in screen. Running `claude` once
      interactively with `CLAUDE_CONFIG_DIR` pointed at the fixture store fixes it for good, and
      it is a human's job at the keyboard rather than something a session should arrange. Until
      then the Sessions and Terminal pages get the session list, the tab strip and a footer
      shell, none of which need an account.
- [ ] **One shot per guide page, each showing the one thing its page is about.** The fixture is
      built and the app is drivable against it — `scripts/qa/click.sh` reaches the renderer,
      re-verified 2026-09-21 — so what is left is the capture pass itself: Projects (the sidebar
      with its two groups, a project selected, its sessions listed), Sessions (the tab strip and
      a transcript; the status dots wait on a signed-in store), Routines (the schedule editor and
      the next-runs echo), Files / Changes / Graph (the panel in its three tabs, which the dirty
      tree and the merged branch are there for), Terminal (the footer shell with a split),
      Advanced → Worktrees, and Keyboard shortcuts (the Keyboard settings section). More than one
      picture per page is a page that stopped explaining.
- [ ] **Dark only.** The site is dark and the light palette does not render yet (item 32); a
      light shot would be of a theme neither the app nor the page currently shows.
- [x] **Where they live**, which was item 39's open checkbox: `assets/images/`, referenced from
      a guide page by a relative path, verified by a build 2026-09-21.
- [ ] **Re-shoot the five in `assets/images/` from the same fixture.** They predate it, the
      README and the guide should not show two different workspaces, and it is the same session
      at the keyboard.

**Whether this gates the tag is open, and the default is that it does not** — the M6 block names
five workstreams and this is not one of them. A guide that is correct and unillustrated is worth
shipping; say the word and it moves up.

## 36. A Homebrew cask, because the macOS build will stay unsigned

**Filed 2026-08-20**, out of the question "how complex is signing for macOS, and I don't want an
Apple developer account". The answer to the first half is *not very* — it is about
thirty lines of workflow YAML: import a `.p12` into a temporary keychain, then hand Tauri
`APPLE_SIGNING_IDENTITY` / `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` and let it notarize and
staple, with `bundle.macOS` left as `{}`. The answer to the second half is that the
certificate has to be a **Developer ID Application** one, which Apple issues only to paid
Developer Program members — a policy wall, not a technical one. A free Apple ID's Personal Team
signs for local development and cannot produce one.

**It stopped being what we do instead of paying, on 2026-09-17**, when item 51 took the decision
to buy a Developer ID certificate and notarize. A cask is still worth having — `brew install
--cask factorai` is how a developer installs a Mac app, and it composes with the updater we
already ship — but it is now a *convenience* rather than the only free way around Gatekeeper, and
**it drops `--no-quarantine` the day a notarized build ships**. Build it after item 51, not
before, or the instructions have to change twice.

Two dead ends, closed here so nobody re-explores them: a **self-signed** certificate is free and
Gatekeeper treats it exactly as unsigned, and an explicit **ad-hoc** `codesign` step changes
nothing because the linker already ad-hoc signs on Apple Silicon.

> **Amended 2026-09-03 by [ADR-0034](../adr/0034-macos-bundles-carry-a-self-signed-signature.md).**
> The self-signed dead end is a dead end *for Gatekeeper only*, and that sentence reads as
> closing the whole question. Gatekeeper trust and TCC persistence are different mechanisms:
> macOS anchors every privacy grant to the app's designated requirement, an ad-hoc signature has
> no identity to anchor to, and so every release orphaned every permission the user had granted.
> A self-signed certificate fixes that and changes nothing about Gatekeeper — so **releases are
> now signed with one**, and everything this item says about the cask, `--no-quarantine` and the
> Developer ID wall stands untouched. **Item 51** holds what is left. The ad-hoc dead end is
> unchanged and still a dead end.

- [ ] A tap repo — `Nightbr/homebrew-factorai` — holding `Casks/factorai.rb`: version, the
      universal `.dmg`'s URL, its sha256.
- [ ] A job in `promote.yml` **after `release`**, bumping the cask from the published stable's
      asset — stable only, since alphas are prereleases the cask must never point at (ADR-0064).
      It has to be after, because the sha256 is of the artifact that was actually uploaded, and it has to
      be idempotent, because re-running a release job is normal here (see item 31 and the `v0.10.1`
      post-mortem in `release.yml`'s header).
- [ ] **`auto_updates true` in the cask.** Not cosmetic: factorai replaces its own bundle in place
      (F14), so without it Homebrew and the app disagree about what is installed and `brew upgrade`
      fights the updater. This is the flag casks for self-updating apps carry.

**Be honest about what it buys, now that notarization is coming.** Before item 51 lands,
`--no-quarantine` is a flag the *user* passes and a cask cannot force — so it **moves** the bypass
into a command they were going to paste anyway rather than deleting it. After item 51, the flag
goes and what is left is the plain win: one command to install, one to upgrade, and a version
Homebrew and the app agree about.

**Linux is unaffected.** The AppImage carries no equivalent problem and stays as it is; there is
deliberately no `.deb` (F14 — the updater cannot replace one in place).

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
- **Worktrees**, which change what "the repository" means on screen. **Specified 2026-08-21
  and moved out to item 37** — it turned out to be a session feature that the graph happens to
  render, not a graph feature. What stays here is the graph's share of it: a `HEAD` chip per
  checkout, which is one more ref kind through machinery this item already owns.

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

- [ ] Migration `0020` `file_drafts(path PK, contents, base_hash, updated_at)`, and the two
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
  being away from the machine; item 7's toast is the other half and is not built.
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

## 7. M5 — error UX: a toast primitive, empty states, indexing feedback

- [ ] **`toast` does not exist in `@factorai/ui`** — the package ships 14 primitives and no
      toast/sonner. `05-features.md` § "Error UX" assumes one. Add it there (not in app code),
      following the shadcn-style convention the rest of the package uses.
- [ ] Route transient `AppError`s to a toast and view-specific failures to inline messages, per
      the tagged-union contract in `03-backend-rust.md` § "Errors".
- [ ] Empty states: no `~/.claude/projects/` (F1 — one-line explainer plus a link to install
      Claude Code), project with no sessions (F6 already offers `New session` here), empty search.
- [ ] Friendlier indexing UI on top of the `indexer:progress` events the sidebar already
      consumes.

## 8. M5 — release: the smoke pass on both platforms

The last mile before the app is something a teammate installs rather than runs from source.

**Three of the four landed 2026-08-14/17** — the icon set (with `09-branding.md`'s
regeneration command; **item 18** keeps the `.desktop` entry it did not cover), the README with
install instructions, and the tag-driven `tauri build` workflow that drafts a release with a
universal macOS `.dmg` and a Linux `.AppImage`. Two constraints it wrote into the README rather
than leaving a user to find: macOS builds are unsigned so Gatekeeper blocks them until quarantine
is cleared, and the Linux bundles carry a **glibc 2.39 floor** from ubuntu-24.04. What is left is
the pass nobody has run:

- [ ] Manual smoke pass on **macOS arm64** and **Ubuntu 24**. macOS is the untested platform:
      every gotcha in `DONE.md` so far is WebKitGTK-flavoured, and the login-shell PATH fallback
      in the claude probe (Q2) exists specifically for GUI launches on macOS and has never been
      exercised there. **Two surfaces now, not one** — as of 2026-08-17 the *session's own* PATH
      is resolved from the login shell too, which is a much wider blast radius than the probe
      (hooks, stdio MCP servers, the statusline, everything the agent runs from `Bash`). Run the
      verification list in `DONE.md`'s entry for it, and run it from a **Finder-launched** build:
      `pnpm dev` from a terminal inherits a healthy PATH and hides this whole class of bug.

**Exit criterion for M5** (`06-milestones.md`): a teammate installs the `.dmg` or `.AppImage` and uses
factorai for an hour without hitting a flow-breaking bug.

## 10. Interaction-level QA coverage

**Partly done — narrow this rather than reading it as unstarted.** The Playwright lane it called
"the path forward" exists: 75 `@smoke` tests across 14 files, covering the tree, the viewer, the
tab strip, search, zoom, the update badge, add-project and the missing-project state. What is
left is the *regression* lane and the depth, not the approach.

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

- [ ] Open the `tests/regression/` lane. The smoke suite is at ~110s against a stated budget of
      "a few seconds"; one of the two has to give, and that is inconsistency **E1**.
- [ ] Fixtures stay one-factory-per-shape in `tests/smoke/fixtures.ts`.
Deferred within this item: **Wayland support in `scripts/qa/`** (swap `wmctrl` /
`gnome-screenshot` for `swaymsg` / `grim`). X11-only is fine while the dev box is X11.

## 12. Command palette — `Cmd+P` quick-open by filename

> **Priority: HIGH for items 12–14** (user ask, 2026-08-14) — kept at the end of the file to avoid
> renumbering items 1–11 and their cross-references. Read them as sitting **right after M4 (items
> 1–3)**. Item 5's binding scheme shipped 2026-09-15, so each of these is now a map entry plus a
> call site. They're a coherent trio: don't build the third without the first.

The first of three navigation surfaces (12–14) that the desktop Claude Code app has and factorai
doesn't. They're specced separately because their **backends** differ wildly — a filename index, a
content grep, and a symbol index are three different problems — but they should land as **one
component**: a single palette modal with a mode prefix, VS Code style (bare = files, `#` = symbols,
`>` = commands later), not three modals that each reinvent the list, the fuzzy match and the
keyboard handling. Build the palette here; items 13–14 add modes to it.

**Prerequisite: none of the three exists in the specs yet.** `05-features.md` stops at F12, and its
keyboard table has no `Cmd+P`. Write F13 (this item) before coding, per the `spec-and-adr-workflow` skill — the
palette is a new surface with its own state, not a variation on the tree.

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
      lines and persistence while you click through them. The right-hand panel is a better home
      (it's where `Changes` and the graph already live), which makes the panel's tab strip a decision
      that three items now depend on. Settle it once.
- [ ] Clicking a hit must open the file **at that line**. `?file=` carries a path and nothing else
      today, so this needs `?file=…&line=N` (validated on `__root` beside the existing param) and
      a `revealLineInCenter` call once Monaco has mounted. Item 12 doesn't need this; this item
      does.
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
- **Where an `openFile` for a background session should land.** Nothing happens
  today and the agent is told so. A tab mark was tried and removed for colliding
  with the session status dot; the toast primitive item 7 wants is the likely
  home, since a transient event probably deserves a transient surface.
- **The off switch**, which is now a `SettingRow` in F11's modal — `prefsStore` and the
  Confirmations/Sessions pattern exist, so this is a row and a boolean rather than a surface.
- **`openDiff` and the write path** — its own ADR, and the thing that supersedes
  part of ADR-0009.

## 21. Post-MVP / deferred

Not duplicated here — [`06-milestones.md`](../06-milestones.md) § "Deferred" holds the ordered
list (MCP/IDE emulator, scheduler, grid overview, activity heatmap, external terminal launch,
multi-window, auto-updates, crash reporting, Windows, mobile). Items graduate from there into
this file when they become the next thing to do, not before.

**The keep-awake inhibitor travelled that way on 2026-08-17** — disqualified on the user's call as
too risky for now, and demoted to that list (entry 11), which holds the reasoning and the two open
design questions. It was the first item to go back rather than forward, and it should not be the
last: an item that has stopped being the next thing to do belongs there, not sitting here looking
queued. The short version, so nobody re-adds it by reflex: the danger is the **release** path, not
the feature — a leaked sleep inhibitor is invisible, which is ADR-0005's orphan-PTY problem on a
platform surface we don't control, and Linux has no single mechanism (logind / portal /
ScreenSaver).

Two viewer follow-ups sit between "shipped" and "deferred", and belong here rather than there
because F7 already commits to them:

- **Per-project tab system.** `?file=` is a single path today, validated on the `__root` route
  precisely so it can grow into a list. The end state is tabs switching between the project page,
  its sessions, and open files — at which point `FileViewerModal` stops being the host.
- **The PDF viewer's four follow-ups.** Preview itself shipped 2026-08-19 (pdf.js, bundled,
  continuous scroll with a text layer — F7, ADR-0018); these were scoped out of it deliberately,
  in the order they are worth doing:
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
    should align against nothing on the other side. Not started, and not blocking anything.

## 27. The window's bottom corners on Linux are still not pixel-clean

**Found 2026-08-16, after two attempts at it.** Cosmetic, and the reason it gets an entry rather
than a third attempt is that both cheap answers are now known to be wrong — see
[Q21](../07-open-questions.md) for the measurements, which are worth reading before touching this.

Where it stands: the corners are **square** on Linux, with the shell's 1px border running unbroken
into them. That is the least-bad shape, not a clean one. The WM rounds all four corners of the
frame it draws — its own outline traces a ~12px arc at the top-left, and at the bottom-left it
fades out over the last ~10 rows because our opaque client area is painted over the curve. So the
app covers the frame's arc, and the last few pixels before the corner read as a hairline that
stops early.

Ruled out, both verified on the real window rather than reasoned about:

- **`border-radius` on an opaque window.** Carves the shell away and whatever paints behind it
  fills the gap — a wedge of `bg-background` outside the arc, the border curving off into it.
- **A transparent window** (`transparent: true` in a `tauri.linux.conf.json`, `<html>`/`body`
  painting nothing). The geometry is right — a real 12px antialiased arc, desktop visible through
  it — but the corner then exposes the **compositor's drop shadow**, which is a grey smudge where
  the wedge was.

**The likely real fix is client-side decorations**, which is why this is worth doing next to
**item 6 / M5's custom titlebar** rather than on its own. With `decorations: false` the app owns
the whole frame: it declares its shadow margins through `_GTK_FRAME_EXTENTS`, draws the shadow
itself, and rounds the corners inside a region it controls — which is exactly how every GTK4 app
gets clean rounded corners on this desktop. Doing it as part of the titlebar work means one change
to the window shape rather than two.

Worth confirming when someone picks this up:

- Whether the artifact survives on **Wayland** (all of the above was measured on X11 + Mutter with
  server-side decorations) and under a different WM. It may be narrower than "Linux".
- Whether Mutter can be told not to draw its shadow under the client corner. If it can, the
  transparent-window route becomes viable without the titlebar work.
- Method, so this isn't re-derived: full-screen `gnome-screenshot`, crop the corner by the client
  geometry from `xwininfo -id <wid>`, and dump per-pixel luminance. Scaled screenshots lie about
  exactly the pixels this is about — the first round of this was diagnosed wrongly off one.

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

**Where the control goes is already decided, and the place to put it now exists** — F11 shipped
2026-08-20 with four sections and the `SettingRow` primitive, and **Appearance is deliberately not
one of them** because it would hold nothing until this lands. So the settings work here is a
section constant, a `Select` and a `prefsStore` key; everything else in this item is the feature.

## 34. Session status — the unread axis, and two upgrades worth waiting for

**The dot shipped 2026-08-18** — F10 is the design,
[ADR-0015](../adr/0015-session-status-from-the-terminal-title.md) the mechanism, `DONE.md`
the entry. Four things it left, in the order they are worth doing.

**The unread / never-opened axis** is the third thing the original feedback asked for and the only
part of it not built: durable `viewed_at` per session compared against `updated_at`, which needs a
migration and is orthogonal to the live PTY states. It is also what a
`finished` state would need in order to mean anything, so the two arrive together or not at all.

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
feature has to invent. Which section it goes in is the only open question (Sessions is about the
unit of work, so probably there rather than a new one).

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

## 37. Worktrees — the two pieces F21 v0 left

**F21 v0 shipped 2026-08-21 as v0.19.0** — see [`DONE.md`](./DONE.md) for what landed and the
four things it cost that the design did not predict. What follows is the remainder.

- [ ] **A `HEAD` chip per checkout in the graph.** This is item 1's share of the feature: one
      more ref kind through F18's existing badge machinery and its "the icon says where the ref
      lives" rule. In a worktree-heavy repository it is the reason to open a graph at all — three
      checkouts, visible at once, on the commits they are sitting on. Cosmetic, so it did not
      gate the release.
- [ ] **Watch whether `setWorktree` is ever called by a real agent.** Five live runs produced
      five worktrees and zero calls. The tool stays advertised because it costs nothing and is
      the only signal that is an intent rather than an inference — but nothing rests on it, and
      if it is still unobserved in a month, say so here rather than leaving it looking
      load-bearing.

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

- [ ] **1. Fixtures.** Log in to Codex, run three sessions in a scratch folder (one fresh, one
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
- [ ] **4. One profile per project.** What slice 2 left of it: migration 0022's index change
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

**Worktrees make "the current branch" ambiguous** (item 37, F21). Resolve it against the checkout
the panel is showing, which is the rule F21 already settled for the file panel — not against the
repository's `HEAD`, which may be a checkout nobody is looking at.

## 41. A GIF of the sidebar gesture, from fake data

**Filed 2026-08-27, deferred the same day.** The sidebar's drag — file into a
group, drop beside one, hold over a project to group the two — is the one feature
in this app that a still image cannot show. It is motion: a line that moves, a
ring that fills, a row that lands. The README section for it currently has no
image at all, because the alternatives were worse than none.

**Why a screenshot of the real app was rejected.** Taken 2026-08-27 and reverted
within the hour. A dev build against the author's own workspace means the sidebar
is full of client and employer project names, so every one has to be blurred — and
a picture of four blurred rows and one legible one says nothing about the feature
while looking like a redacted document. Framing around it (no project selected)
left 70% of a 1440×900 frame as empty pane. The tooling from that attempt is
worth keeping and is not the problem: `VITE_FACTORAI_SCREENSHOT=1`,
`scripts/qa/doc-shot.sh`, `scripts/qa/redact.py`, and the `app-screenshot` skill.

**What this actually needs, and why it is not cheap.** A GIF of the real app has
the same privacy problem as the screenshot, moving. So the subject has to be
**fabricated**: a sidebar rendered from invented projects with invented names, in
isolation, driven through the gesture at a watchable pace. That is a demo harness,
not a capture — and the pieces are not all there:

- The renderer can already be driven from fake data in a browser
  (`pnpm vite:dev` + `installMockBridge`, § 2d), and a fixture with plausible
  names is a few lines. That part is nearly free.
- What is missing is the **choreography**: dnd-kit is driven by pointer events, so
  a recording needs a script that presses, moves in small steps, dwells long
  enough for `GROUP_DWELL_MS` to read on screen, and releases — with pauses a
  human eye can follow rather than the 40ms steps a test uses.
- And the **capture**: Playwright records video as WebM, not GIF, so this wants
  either a WebM in the README (fine on GitHub) or a conversion step and a
  palette/size budget for a file that ships in the repo.

Worth doing when the sidebar's gesture stops changing — it moved three times on
2026-08-27 alone. A recording made against a gesture still being tuned is a
recording to redo.

Sequencing note: the mock-bridge fixture and the pointer choreography would also
give the smoke suite a way to demonstrate the drag at human speed for debugging,
which is the second reason to build it once rather than hand-roll a capture.

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
- [ ] A row in the `claude` section of `SettingsModal.tsx`, beside the binary path — same section,
      because both are "how we launch it". A free text field, not a hardcoded list: model ids
      outlive our releases, and a picker that does not know this month's names is a wrong picker.
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
