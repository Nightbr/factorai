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
   than housekeeping. The channel mechanism is open, including a manifest hosted on the site.
3. **[Item 57](#57-performance--one-audit-measured-then-the-fixes-it-names) — the performance audit, then the fixes it names.** Items 54 and 55 are its
   first two known findings and sit directly under it.
4. **[Item 39](#39-the-site--a-docusaurus-build-carrying-the-guide-deployed-to-pages) — the site: one Docusaurus build on GitHub Pages**, the guide under `/docs`,
   a custom domain to decide.
5. **[Item 56](#56-the-hero--a-one-pager-that-makes-someone-want-this-at-the-sites-root) — the hero one-pager**, which is that site's index and the first thing anyone
   sees.

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
diagnosed in [ADR-0034](../../docs/adr/0034-macos-bundles-carry-a-self-signed-signature.md): TCC
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

**Release-blocking.** A public first release means strangers on the update path, so the two things
this item holds — a pipeline that cannot ship a half-built release, and an **alpha** channel
beside **stable** — stop being housekeeping. The tag-driven pipeline is the incumbent and the
answer is **open**: a moving `alpha` tag, a manifest hosted on the Pages site items 39 and 56 are
building, or something else entirely. Decide it here and write the ADR.

**User ask, 2026-08-17**, immediately after cutting v0.9.0 by hand. Two halves: make the existing
process leave nothing to remember, and add an **alpha** channel beside **production** that builds
often and on its own.

Written from having just done it end to end, so the gaps below are observed rather than imagined.

**Item 36 is the distribution half and is deliberately separate**: a Homebrew cask, plus the step
that bumps it after `publish`. It belongs beside this item rather than inside it — this one is about
the pipeline being trustworthy, that one is about macOS staying unsigned.

### 31a. What the current process actually leaves to a human

The pipeline works — `release.yml` is tag-driven, rewrites the three version fields from the tag,
and drafts a release with signed bundles plus `latest.json`. What it does not do is anything about
the steps *around* it:

**Two of these are closed and are in [`DONE.md`](./DONE.md)**: the matrix race that put each
platform's assets in a different draft (one `create-release` job before the matrix, 2026-08-17),
and automatic publication with the missing-platform guard kept
([ADR-0014](../../docs/adr/0014-alpha-releases-publish-themselves.md), 2026-08-18). The cost of
the second is that no person sees a release before the world does, which promotes the first
bullet below from tidy-up to the next real gap.

- [ ] **Nothing enforces "tag a commit Quality has passed".** `release.yml` says so in its own
      header and `quality.yml` says it "deliberately does NOT gate the release". So the guarantee
      is a human remembering to look — cutting v0.9.0 meant polling `gh run list` and waiting
      before tagging. A tag push should **verify the commit has a green Quality run and fail loudly
      if not**, rather than building an unverified commit and finding out later.
- [ ] **The version fields are never bumped, and something in the repo now reads them.** All three
      sit at `0.1.0`; the tag rewrites them at build time. `release.yml` argues for that
      deliberately — "no bump commit to forget, no chance of a tag disagreeing with a file" — and
      that reasoning still holds. **But the cost landed the same day it was written about**: the
      crash screen (F17) reads the version through a Vite `define`, so every dev build claimed to
      be `0.1.0` until it was taught to say `(untagged dev build)`. Decide it properly rather than
      per-consumer: either the tag stays the only truth and *anything* reading the version handles
      the placeholder, or a real bump lands (with the "forgot to bump" failure automated away).
      **The user asked for the bump**, so the burden is now on the tag-only scheme to justify
      itself.
- [ ] **There is no `CHANGELOG.md`.** `DONE.md` is the de facto source and the GitHub release body
      is hand-written after the fact each time — `generateReleaseNotes: true` produces notes that
      then get replaced. Either derive the notes from `DONE.md` or keep a changelog; writing them
      twice is the current state.
- [ ] **`gh release edit --notes-file` reports a stale `untagged-…` URL** on a draft. Harmless, but
      it looks like it edited the wrong thing; worth a note wherever this gets written down so the
      next person doesn't chase it.
- [ ] **The macOS smoke pass has still never happened** — that is item 8, not this item, but a
      release process that has never once been exercised on one of its two target platforms is the
      real gap and this item should not pretend to close it.

### 31b. Channels — and the constraint that decides the whole design

**⛔ The obvious implementation is broken, and it is written down in `release.yml` already.** The
action sets `prerelease: false` *deliberately*, because GitHub's `/releases/latest` — which the
updater endpoint resolves through — **skips prereleases entirely**. So "mark alpha releases as
prerelease" would leave every alpha user polling a 404 forever. Alpha cannot live at
`/releases/latest/download/latest.json`. That is the first thing to solve, not a detail.

Plausible answers, to be chosen rather than assumed:

- a **moving `alpha` tag** with a fixed asset URL (`/releases/download/alpha/latest.json`), which
  sidesteps `latest` entirely and lets alpha releases be marked prerelease honestly;
- a manifest hosted outside releases, decoupling the channel from GitHub's release semantics —
  **cheaper than it was**, because items 39 and 56 are standing up a Pages deployment anyway, so
  `factorai.<domain>/updates/{alpha,stable}.json` costs a file in that build rather than a new
  piece of infrastructure. Its cost is that the site's deploy becomes part of the release path,
  which is exactly the kind of coupling to decide deliberately rather than discover.

**Verified about Tauri's updater (2026-08-17, v2 docs) so nobody designs against the wrong model:**

- There is **no built-in channel concept**. The endpoint's dynamic variables are exactly
  `{{current_version}}`, `{{target}}` and `{{arch}}` — there is no `{{channel}}`.
- Endpoints can be set **at runtime** via `updater_builder().endpoints(...)`, and the docs give
  channel-switching as the example use. **This is the good news and it should shape the design:**
  one build can serve both channels, with the channel a *preference* rather than a separate
  artifact. That avoids two build matrices and two download pages.
- Default comparison is `update.version > current`. So **leaving alpha for production is a
  downgrade and will not happen by itself** — it needs `version_comparator` overridden, or the user
  reinstalling. Decide what "switch back to stable" means before shipping the switch.

Consequences to settle:

**Where the channel lives was settled 2026-08-17 and unblocked when item 4 shipped**: it is a
`get_setting`/`set_setting` customer, so it is a second `SettingKey` variant, a match arm and one
`SettingRow` in F11's first **Advanced** section. Everything else here needs no UI at all.

- [ ] **Alpha versioning.** The manifest `version` must be valid SemVer. `0.9.1-alpha.3` sorts
      correctly above `0.9.0`; a date-based scheme needs checking against the comparator, not
      assumed. Whatever is picked has to keep alpha ahead of production without ever overtaking the
      *next* production release.
- [ ] **"Builds more often and automatically" — how often?** Every push to `main` is the literal
      reading and means a ~12-minute two-platform build per commit (seven commits landed today
      alone). A nightly cron that skips when nothing changed is far cheaper and probably what is
      actually wanted. Decide, and state it, because this is the line item that costs CI minutes.
- [ ] **Does alpha gate on Quality?** It should — an automatic channel that ships red commits is
      worse than no channel. Same mechanism as 31a's first bullet.
- [ ] **The app should say which channel it is on.** An alpha build that looks identical to a
      production one produces bug reports nobody can place. The `DEV` pill in `TopBar` is the
      existing precedent for this kind of marker, and the crash report (F17) already carries the
      version — it should carry the channel too.

**Not in scope, deliberately:** macOS code signing / notarisation. It is a real gap (the `.dmg` is
unsigned and Gatekeeper blocks it until quarantine is cleared) but it is an Apple-account problem,
not a process one, and folding it in here would stall everything else.

## 57. Performance — one audit, measured, then the fixes it names

**Asked for 2026-09-17, release-blocking.** Two performance reports are already filed as items 54
and 55, both from the same week, both unmeasured. A public release is the wrong moment to
discover the third one from a stranger, so this item is the sweep: **measure every surface, write
the numbers down, then fix what the numbers name** — in that order, because at least two of the
candidates in item 54 are cheap enough that fixing the wrong one would be indistinguishable from
fixing nothing.

**The two findings already filed are this item's first two entries**, kept as their own items
because each has its own analysis: **item 54** (time from clicking a session to the first thing on
screen) and **item 55** (the markdown preview re-parsing on every host render, with mermaid
multiplying it).

**The rule that bounds the whole sweep**, and it is not negotiable: nothing here may be paid for
by disposing, detaching or re-creating a pooled xterm. `Terminal.tsx` § "Persistent xterm pool"
keeps one terminal per session alive for the app's life, and the reason it does not reparent is a
macOS wheel bug its comment records. That is the change that looks like a win in a profile and is
a regression in the window.

- [ ] **Write the budgets down first**, so "slow" stops being a matter of opinion: cold launch to
      a usable window, session switch to first paint, keystroke-to-glyph in a PTY under load,
      search latency on a real workspace, tree expand on a large repository, and the memory a
      session-heavy app holds after an hour. A budget nobody agreed to is not a budget.
- [ ] **Measure in the real window, on both engines.** The `manual-qa` lane with the React
      profiler; a Playwright run sees none of this, and WebKitGTK and WKWebView have already
      diverged on zoom, clipboard and scrolling.
- [ ] **The surfaces worth measuring, in the order they are likely to hurt**: startup and first
      paint; the indexer and FTS5 against a workspace with hundreds of sessions; the sidebar's
      `refetchInterval` (every ~2s, and it reorders rows); ten live sessions with output arriving
      in all of them; the graph walk on a large repository; the file tree on a directory with
      thousands of entries; and the renderer bundle, where the heavy chunks (Monaco, pdf.js,
      mermaid) are lazy and should be proved still lazy.
- [ ] **Rust side too.** Lock hold times across the command boundary — the terminal freeze in
      `DONE.md` was a `child.lock` held across `wait()` and it deadlocked the GTK main thread, so
      this is a class of bug this repo has already shipped once.
- [ ] **Fix, then re-measure against the budget**, and record both numbers in the `DONE.md` entry.
      A performance fix with no before and after is a story.

**What this item is not.** A rewrite, a virtualization project, or a dependency swap done on a
hunch. If the numbers say the app is inside its budgets on a surface, the entry for that surface
is one line saying so — which is worth as much as a fix, because it stops the next person
re-deriving it.

## 54. Switching session — time to the first thing on screen

**Asked for 2026-09-15**, unmeasured: the report is that changing session takes visibly longer to
show anything than it should. So the first task is a number, not a patch — the candidates below
are what reading the code suggests, and at least two of them are cheap enough that fixing the
wrong one would be indistinguishable from fixing nothing.

**What is already right, and must stay right.** The xterm pool (`Terminal.tsx` § "Persistent xterm
pool") keeps one terminal per session alive for the app's life: a switch toggles `visibility` in
`showOnly`, it does not rebuild a buffer or reparent a host, and the reason it does not reparent is
a macOS wheel bug the comment there records. `FileTreePanel` and the shell footer hang off
`AppShell`, not off the route, so neither unmounts on a switch (ADR-0032). Nothing in this item may
be paid for by disposing, detaching or re-creating a pooled terminal — that is the change that
looks like a win in a profile and is a regression in the window.

- [ ] **Measure first, in the real window.** Click-to-first-paint for three cases, which are not
      the same case: a session whose terminal is already pooled, one being opened for the first
      time this run (a `terminal_spawn` plus `claude --resume` redrawing the transcript), and a
      switch that also crosses projects. The `manual-qa` lane, with the React profiler on;
      a Playwright smoke run cannot see any of this.

**The candidates, in the order they are worth checking.**

- **The route's three queries gate the header.** `SessionView` reads `list_projects`,
  `list_sessions` and `list_profiles`, and `App.tsx`'s app-wide default is `staleTime: 1000` — so
  any switch more than a second after the last read refetches. Cached data still renders, so
  this should not be visible; what *is* visible is that `projectCwd` is `null` until
  `list_projects` answers, and `projectCwd` is in the dependency list of `Terminal`'s mount effect.
  A cold switch therefore runs that effect twice, and the first run reaches `attachPty` with a null
  cwd. Worth fixing on its own merits whatever the profile says.
- **The first frame is deliberately the old grid.** The mount effect defers `fitToHost`,
  `scrollToBottom` and `focus` into a `setTimeout(…, 0)`, and an adopted host gets a second
  `fitToHost` plus a full `refresh` in a `requestAnimationFrame`. Both are correct — the layout is
  not real any earlier — but they are also the two places a switch can be seen to settle rather
  than appear.
- **Every hidden terminal still has layout.** `showOnly`'s own note says it: a background session's
  rows are laid out, though never painted, as its output arrives, and `content-visibility: hidden`
  is not used because it zeroes descendant geometry and brings back the measurement bug the pool
  exists to avoid. That comment asks for exactly this — a profile at a session count that hurts.
  Ten live sessions is the case to measure; if it is flat, say so in the comment and close the
  question.
- **The panel re-roots on the switch.** `useActiveCheckout` recomputes `root`, `FileTreePanel`
  draws `Loading…` while `isLoading`, and the tree relists. For two sessions in the same checkout
  the root does not change, so this should be free; confirm that it actually is, rather than the
  panel blanking and redrawing the same tree.

**What good looks like.** Switching between two pooled sessions in one checkout paints the header
and the terminal in the frame after the click, with no `Loading…` anywhere in the panel. A session
being opened for the first time cannot do that — the transcript comes back through the PTY — but
it can paint its chrome immediately and wait for the body, which is not what "nothing for a
moment, then everything" does today.

## 55. The markdown preview re-parses far more often than it changes, and mermaid pays for it

**Asked for 2026-09-15**, with a large document and a document full of diagrams as the two cases
that hurt. Two separate causes with one symptom, and the first one is the one to fix.

**The document is re-parsed on every render of its host.** `MarkdownView` is not memoized, and
react-markdown 10 has no incremental parse — it runs remark and rebuilds the whole hast tree every
time it renders. Its host is `FileView`, which holds the edit buffer's state machine
(`useEditBuffer`: dirty, saving, save error, conflict, banner), the SOPS plaintext and its four
states, a `sops` status query, the selection the footer's mention button reads, and the preview
toggle itself. Every one of those state changes re-parses the entire document. Even a host that
re-rendered for a good reason would not be able to skip it: `remarkPlugins={[remarkGfm]}` and the
`components` object are fresh literals on each render, so no `memo` would ever bail out.

- [ ] **Hoist what does not change and memoize what does.** `remarkPlugins` becomes a module
      constant; `components` becomes a `useMemo` on `[path, onOpenPath]`, which is all the three
      overrides actually capture; `MarkdownView` gets `memo`. Confirm with the profiler that a
      keystroke in the footer's search, a save, and a `sops` query settling each stop re-parsing
      the document.
- [ ] **`previewSource` reads a ref during render** (`FileView.tsx:304`:
      `dirty ? bufferRef.current : file.contents`). It works because the editor is unmounted while
      the preview is up, so the buffer cannot move underneath it — but it is a render-time read of
      mutable state, and it is what makes the preview's input look like it changes on every render
      when it does not. Whatever shape the memo takes has to make that explicit rather than inherit
      it.
- [ ] **Measure a genuinely large document before deciding anything else is needed.** There is no
      virtualization: a long README becomes one DOM tree under the `prose` classes in one pass. If
      re-parse-on-every-render is the whole story, stop there — chunked rendering is a much
      larger change and should not be started on a guess.

**Mermaid is the second cause, and it multiplies the first.** Each fence is a `MermaidDiagram` that
calls `loadMermaid()` in its own effect:

- **`loadMermaid` reads the palette off the document on every call** — nine `getComputedStyle`
  reads through `diagramPalette` and `currentFontFamily`, one forced style recalculation per
  diagram, to compute a key that is almost always identical to the last one. The module already
  caches the *configuration* behind `configuredFor`; it does not cache the reads that produce the
  key. A palette moves on a theme switch (item 32), which is an event, not a per-render condition.
- **Every diagram renders independently and concurrently** against the one global mermaid
  instance — no queue, no batching — and each `render` builds a temporary node, runs DOMPurify
  and hands back an SVG *string*, which `MermaidDiagram` then parses a second time with
  `DOMParser` and adopts with `importNode`. A document with twenty diagrams does that twenty
  times, unthrottled, on the first frame the preview is up.
- **A `code` change empties the host before the new SVG lands** — state goes back to `pending` and
  the effect `replaceChildren()`s the node — so each diagram collapses to zero height and the page
  reflows through it. Keeping the old SVG until the new one is ready is the obvious fix and costs
  nothing, since the failure path already keeps the source.

The 2.5MB dynamic `import()` (ADR-0021) is not on this list: it is paid once, only by documents
that have a fence, and it is the right trade.

## 39. The site — a Docusaurus build carrying the guide, deployed to Pages

**Release-blocking, and settled 2026-09-17: one site, one deployment, one workflow.** A Docusaurus
app whose **index is the hero one-pager (item 56)** and whose `/docs` is the guide. Two
deployments were considered and dropped — two domains, two sets of links to keep honest, and a
hero that cannot link straight into a guide page without leaving its own origin.

**User ask, 2026-08-24, restated 2026-08-30**: *"we will write a full docs later for all factorai
features"*. Everything written for a *user* today is `README.md` and the five screenshots in
`docs/images/`. Everything else in the repository is written for whoever is building it: `specs/`
is the design source of truth, `docs/adr/` is the decision trail, and this file is sequencing. All
three read as internal because they are.

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

Mechanics, now that the shape is decided:

- [ ] **Docusaurus, in this repository**, so a behaviour change and its documentation can land in
      one commit — the same argument the specs already win. Where it lives inside the repo is the
      one open question: a `site/` (or `website/`) directory is the obvious answer, and it must
      not be `docs/`, which already holds `adr/`, `brand/` and `images/`.
- [ ] **Deploy through the Pages *artifact* workflow, not the serve-a-branch-folder mode.**
      Pointing Pages at a folder would publish the decision trail as a website by accident.
- [ ] `.github/workflows/pages.yml` on push to `main`, alongside `quality.yml` and `release.yml`.
      It has to be cheap enough to run on every push, or it will be skipped and go stale.
- [ ] **Whether the site reuses `docs/images/`** or keeps its own copies. Screenshots go stale on
      their own schedule; one copy is one re-shoot. The `app-screenshot` skill owns how they are
      taken, including the DEV badge and the blurring of private project names.
- [ ] **A custom domain, or the default `nightbr.github.io/factorai`.** Wanted eventually; decide
      before publishing so the links in the README and in every release note are written once. A
      domain also decides whether item 31's manifest can live here.
- [ ] **Versioning is deliberately off at first.** Docusaurus can version the docs per release;
      switching it on before there is a second release to compare against buys a directory of
      duplicates. Revisit when the stable channel has shipped twice.

## 56. The hero — a one-pager that makes someone want this, at the site's root

**Asked for 2026-09-17, release-blocking.** The index of item 39's site: one page, stylish and
inspiring, that says what factorai is and gets a stranger to the download. It is the first thing
anyone sees and today it does not exist — the README is a pitch written for someone already
looking at the repository, which is a different reader entirely.

**What it has to say**, and `PRODUCT.md` is the contract for all of it: an ADE, not an editor with
an agent in a pane; the unit of work is a session; the human supervises, decides, reviews and sets
the rules. The four verbs are the page's spine, not decoration. What it must **not** do is invent
evidence — no user counts, no benchmarks, no logos, no testimonials, because there are none and a
fabricated one is the fastest way to lose the reader this page is for.

- [ ] **The page.** Hero statement, the four verbs as the argument, three or four surfaces shown
      rather than described, install for macOS and Linux, and a link into the guide. One column,
      readable on a phone, and fast — a landing page that loads slowly is an argument against the
      product it sells.
- [ ] **It looks like the app.** `DESIGN.md` is the palette, the type scale and the named rules;
      the site inheriting them is what makes the download feel like the same thing as the page.
      `.impeccable/design.json` is the machine-readable sidecar if the theme wants generating.
- [ ] **Screenshots, and the privacy problem item 41 already hit.** A dev build against the
      author's own workspace is full of client and employer names, and four blurred rows plus one
      legible one reads as a redacted document. Use `VITE_FACTORAI_SCREENSHOT=1`, the
      `app-screenshot` skill and a **fabricated** workspace, which is the same fixture item 41
      needs for its GIF — build it once.
- [ ] **Motion, if any, is honest.** The sidebar gesture is the one thing a still cannot show
      (item 41). A WebM of the real gesture from fake data belongs here as much as in the README;
      a generic animated mockup of a product that does not behave that way does not.
- [ ] **Download links resolve to the real artifacts** — the `/releases/latest` asset for each
      platform, or whatever item 31 settles for channels, so the page cannot go stale between
      releases. A hero with a dead download is worse than no hero.

**Not in scope:** a blog, a changelog page (item 31 owes the changelog question), pricing, or a
newsletter. One page, one job.

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

> **Amended 2026-09-03 by [ADR-0034](../../docs/adr/0034-macos-bundles-carry-a-self-signed-signature.md).**
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
- [ ] A job in `release.yml` **after `publish`**, bumping the cask from the published asset. It has
      to be after, because the sha256 is of the artifact that was actually uploaded, and it has to
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
[ADR-0039](../../docs/adr/0039-factorai-writes-project-files-never-an-agents-store.md),
[ADR-0040](../../docs/adr/0040-an-unsaved-draft-is-content-not-a-preference.md),
[ADR-0041](../../docs/adr/0041-the-worktree-side-of-a-diff-is-the-editable-one.md).

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
[ADR-0026](../../docs/adr/0026-a-routine-runs-without-a-tab.md) and
[ADR-0028](../../docs/adr/0028-an-agent-schedules-work-but-does-not-unschedule-it.md).
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
[ADR-0017](../../docs/adr/0017-ide-bridge-writes-one-lockfile-into-claude-ide.md); the write path
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
[ADR-0015](../../docs/adr/0015-session-status-from-the-terminal-title.md) the mechanism, `DONE.md`
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

## 38. More harnesses — Codex, Gemini CLI, OpenCode, Cursor, behind one seam

**User ask, 2026-08-24.** factorai spawns, resumes, indexes and watches exactly one CLI. The ask
is the general version: a harness abstraction, a default harness in settings, and per-harness
configuration — so the ADE is about agent sessions rather than about `claude` sessions.

**Half the seam already exists, and it is the cheap half.** `agents/mod.rs` is the discovery
source layer, `discovered_projects.agent` is a column with `DEFAULT 'claude'` written so a second
agent is an INSERT and not a migration, and `sessions` inherits the agent through
`discovered_id`. That module also states, deliberately, that there is **no `trait AgentStore`**,
because a trait with one implementor is a guess about the second one's shape. This item is where
that guess stops being necessary — so the trait gets written here, from a real second implementor,
and the note in `agents/mod.rs` gets replaced rather than quietly contradicted.

**The expensive half is everything that is Claude-shaped and does not know it.** Each of these is
a separate decision, and none of them are the same size:

- **Spawn and resume.** `services/terminal.rs` calls `find_claude_binary` and then
  `session_flag`, which picks `--resume` or `--session-id` by whether a transcript exists
  (ADR-0008). No other harness is obliged to have either verb, and one that has neither can still
  be launched — it just cannot be *resumed*, which is a capability the UI has to be able to render
  as absent instead of broken.
- **Transcripts.** `services/jsonl.rs`, the indexer and the FTS5 rows all read Claude's JSONL
  under `~/.claude/projects/<encoded-path>/`. Every other harness has its own location, its own
  record shape and its own idea of what a turn is. **Verify each one on disk before writing a
  parser for it** — this is a research task first and a build task second, and it is the part most
  likely to be wrong if taken from documentation.
- **Status.** ADR-0015 derives `working` / `waiting_input` from the glyph Claude writes into the
  terminal title. A harness that sets no title, or a different one, yields nothing — so decide
  what an unknown status *looks* like, because a dot that says `working` because it defaulted
  there is worse than no dot.
- **The IDE bridge.** ADR-0017 writes one lockfile into `~/.claude/ide/` and speaks the dialect
  CLI 2.1.235 speaks, with `ideName: "factorai"`. That is Claude's protocol, not an industry one.
  The bridge stays Claude-only until a second harness's protocol has been observed end to end;
  advertising it generally before then would be inventing an interoperability we have not tested.
- **Settings.** `SettingKey` has exactly one variant today (`ClaudeBinaryPath` → `claude.binary`).
  A default-harness choice plus a binary override *per* harness is either one variant per harness
  or a parameterised key; pick which before the second harness lands, because the column name is
  what an operator sees in `sqlite3` and the convention is set by migration `0001`.
- **The UI.** Launching a session becomes a choice — a default from settings, overridable at
  launch — and a session row has to say which harness it is. F11 grows an Agents section. The
  quit guard and kill-on-quit are unaffected: a PTY is a PTY.

**Do one second harness end to end before generalising to four.** A trait derived from one
implementor is a guess; from two it is a fact; from four written simultaneously it is a rewrite
with three untested branches. Codex is the natural first, because
`annex-A-cli-agent-patterns.md` § A.1 already carries the shape of its CLI probe and notes exactly
this progression, and ADR-0011 already thought about what a codex session means for
a project's identity.

**And grade the capabilities, rather than requiring all of them.** A harness that can only be
*spawned* — launch it in a PTY, no transcript indexing, no status, no bridge — is already worth
having, and is a small slice. Browse, search and status then degrade per harness instead of
blocking the whole item on the hardest parser.

- [ ] An ADR for the seam (§ 5, cross-cutting pattern): discovery, spawn descriptor, transcript
      reader, status source — four capabilities, each independently optional, and what the UI does
      for each one a harness lacks.
- [ ] Codex end to end, or as far as its capabilities go, with the trait falling out of it.
- [ ] `SettingKey` growth plus F11's Agents section: default harness, per-harness binary override.
- [ ] Then Gemini CLI, OpenCode and Cursor, each as its own slice against the settled seam.

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
[ADR-0037](../../docs/adr/0037-the-viewer-is-a-column-with-a-measured-fallback.md) for why this
host and not the other five. What is left is small and independent:

- [ ] **`Escape` returns focus to the session.** It closes nothing today, which is the important
      half — over a pane you are reading beside the agent, the modal's reflex is wrong. Moving
      focus into the terminal needs a focus path nothing else has wanted yet, which is why it is
      not in the first cut.
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

