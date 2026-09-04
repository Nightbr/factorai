# Open questions — resolved

All 13 questions from the first planning pass have been resolved. This
file is now a decisions log; new questions get appended at the bottom
as we learn things during implementation.

---

## Q1 — Windows PTY support → **dropped**

**Decision.** macOS + Linux only for v1. Windows is moved to the
deferred list in `06-milestones.md`. We don't actively break Windows
code paths (we use `portable-pty`, `dirs`, etc.), but we don't test or
ship for it. Saves a class of PTY behavior + path encoding edge cases.

---

## Q2 — Claude binary discovery → **three-tier probe**

**Decision.** Probe in three tiers, in order:

1. `which claude` in the inherited process PATH.
2. User's login shell — `$SHELL -lc 'command -v claude'`, then
   `/bin/zsh`, then `/bin/bash`. Required because macOS GUI launches
   don't inherit a terminal PATH (homebrew, mise, asdf shims).
3. Probe a known list of candidate paths (homebrew, npm-global, mise,
   asdf, nvm versions, `.local/bin`, `.claude/local`).

Validate by running `claude --version` with a 2s timeout. Full
implementation sketch lives in `03-backend-rust.md`.

**Amended 2026-08-20, with F11: there is a tier 0, and there is no cache.**

- **Tier 0 is the user's override**, `SettingKey::ClaudeBinaryPath`, checked
  before the three above and with **no fallback to them** — a typo that quietly
  resolved to whatever the probe found would show a working version beside a path
  that does not work. It is a parameter on `find_claude_binary`, so every caller
  passes it and the settings page cannot disagree with the spawn.
- **The caching claim is a plan that was dropped**, and is struck from this
  answer rather than left to be trusted. It said "cache the result in the
  `settings` table", nothing ever wrote it, and F11 makes it wrong rather than
  merely unbuilt: `claude.binary` now holds the *user's override*, so a cache
  sharing that key could not tell a probe's guess from somebody's choice. The
  probe is a `which` plus a `--version` at spawn time, which is cheap enough not
  to want one — and a cache is what would go stale the day `claude` moves.

---

## Q3 — `~/.claude/` location → **profiles own it; `CLAUDE_HOME` seeds the first one**

**Original decision.** Read `CLAUDE_HOME` at boot; fall back to
`dirs::home_dir()/.claude`. No override in the settings UI for MVP. Adding one
later is trivial — the path is read in one place (`claude_dir()`).

**Superseded 2026-09-04 by F25 and
[ADR-0036](../docs/adr/0036-a-profile-is-a-config-directory-passed-per-spawn.md).**
The override arrived, and it arrived as more than a path: a `profiles` table,
where a row is one Claude identity and `CLAUDE_CONFIG_DIR` per spawned session
is what isolates it.

What changed about this answer, and what did not:

- **`CLAUDE_HOME` is now a seed, not the mechanism.** It is read once, by
  `services::profiles::ensure_default`, to create the default profile on an
  install that has none. After that the row is authoritative and the variable is
  not consulted again — otherwise Settings could show a directory sessions do not
  use, which is two sources of truth for one fact.
- **`CLAUDE_CONFIG_DIR` is now read before `CLAUDE_HOME`.** It is the CLI's own
  variable, so an export of it in the environment factorai was launched from *is*
  this machine's configuration directory; honouring `CLAUDE_HOME` alone would
  have us index one store while every session used another.
- **`claude_dir()` survives** as that seed and as `TerminalManager`'s fallback
  when no profile resolver is wired, which is every unit test and resolves to
  what a single-profile install has anyway. The "read in one place" property this
  answer relied on is what made the change small.
- **The conclusion holds: we still hold no credential.** A profile is a
  directory the CLI logs into. Creating one stops at making the directory empty,
  and credentials are never copied between them.

---

## Q4 — Encoded-path collision → **disambiguate via `cwd` from JSONL**

**Decision.** The mapping `path → directory name` Claude uses is
lossy. We resolve the real path **authoritatively** from the first
event's `cwd` field in any session under that project directory. The
character-substitution decoding is only used as a last resort when no
session has been recorded yet (empty project dir). Result is cached in
`projects.real_path`.

Practical implication: when scanning a new project dir, read the first
JSONL line of the first session file, extract `cwd`, persist. Done in
the indexer.

---

## Q5 — Indexer freshness → **debounce, suffix-read**

**Decision.** 1s debounce per file in the watcher. When the debounce
fires, read only the new suffix (offset = previous size) and append to
FTS. Full re-parse only happens on cold scan or when `(mtime, size)`
went backwards (truncation / replacement).

---

## Q6 — In-app vs. external terminal → **in-app default, external deferred**

**Decision.** Embedded xterm is the only path for MVP. "Launch in
external terminal" is a deferred feature (see `06-milestones.md`
deferred #5). Not a blocker, not P0.

---

## Q7 — JSONL parsing → **schema documented in 02-data-model.md**

**Decision.** Schema reverse-engineered and documented in
`02-data-model.md` § "Session JSONL format" with the explicit caveat
that Anthropic doesn't publish it. Rust parsing uses a tolerant
struct with `#[serde(flatten)]` for unknown fields and
`serde_json::Value` for content blocks. Unknown event types render as
collapsed JSON cards.

---

## Q8 — xterm themes → **2 themes only (light + dark)**

**Decision.** Ship just light and dark, synced to the app theme via a
small `palette → xterm theme` mapper. No theme picker, no custom
themes. Keep it simple.

---

## Q9 — Single-window vs. multi-window → **single for MVP**

**Decision.** One window. Multi-window is on the deferred list (#6)
as a follow-up for power users with many parallel agents.

---

## Q10 — Process orphans on quit → **always kill, confirm dialog**

**Decision.** Kill-on-quit is **non-optional and not configurable**.
On window close with live PTYs:

1. Tauri intercepts `CloseRequested`.
2. Frontend shows a confirm dialog: *"Quit factorai? N running Claude
   session(s) will be terminated."*
3. On confirm → `kill_all()` (SIGTERM → 500ms grace → SIGKILL) → exit.
4. On cancel → dismiss dialog, do nothing.

`kill_all()` is also wired to `Drop` on `TerminalManager` as a
last-ditch backstop so we don't leak children on crashes. No orphan
zombies, ever. The cost of a stray `claude` agent running unattended
is real money.

Full flow in `05-features.md` § "Quit guard".

---

## Q11 — Project icons → **initials-on-color, hashed**

**Decision.** Cheap and pure CSS:

- Hash the project path → HSL hue.
- First letter (or two) of the display name as the glyph.
- Background: `hsl(h, 60%, 35%)` for dark mode, `hsl(h, 60%, 85%)` for
  light. White / dark text accordingly.

No asset generation, no image processing. Drops into a `<ProjectIcon
name="..." path="..." />` component.

---

## Q12 — Crash reporting / Sentry → **skip for MVP**

**Decision.** Skip. `tauri-plugin-sentry` does not run "purely local" —
it needs a Sentry DSN, which means either Sentry SaaS or a
self-hosted Sentry instance (Docker compose stack, Postgres, Redis,
ClickHouse — a full deploy). Both are overkill for a personal tool.

Revisit when factorai gets external users (deferred list #8). For
personal-use error visibility, `tracing` + a local log file is enough.

---

## Q13 — Pre-existing repo state → **commit M0 directly on `main`**

**Decision.** Scaffold M0 directly on `main` as the first feature
commit. The repo is currently empty (only `README.md` + `.git`) so
there's nothing to disturb. Branch-based workflow starts at M1.

---

## New questions (added during implementation)

---

## Q14 — Where does the file tree panel live? → **app shell, not a route**

**Decision.** `FileTreePanel` mounts in `AppShell` and follows the route's
project, rather than being rendered by `routes/project.tsx`.

The feature was asked for as "a panel on the project page", but a tree that
vanishes the moment you open a session disappears exactly when it's most
useful — beside a running terminal. Shell placement is a superset of the
original ask and costs one `useParams({ strict: false })` lookup, the same
trick `Sidebar` already used.

Consequence: the app needed somewhere to hang the toggle, which is what
introduced `TopBar` (Q15).

---

## Q15 — Toggle affordance for a shell-level panel → **full-width top bar**

**Decision.** Add a 40px `TopBar` spanning the **whole** window, above the
sidebar, holding the brand (moved out of `Sidebar`), reserved space for a
future global search, and the panel toggle at the right.

Full width rather than content-width because the custom titlebar (M5) wants
that exact geometry — window controls right, drag region across the middle.
Building it content-width now would mean restructuring the shell then, and
leaves the app with two header rows at different offsets in the meantime.

No keyboard shortcut ships with it: `Ctrl+B` — the obvious binding — is
readline's back-a-char and tmux's prefix, so a global handler would break
typing inside the embedded claude terminal. Deferred to M5's keybinding
work.

---

## Q16 — Icon set for file types → **vscode-icons via unplugin-icons**

**Decision.** See ADR-0006. The mockup that prompted the feature was
Material Icon Theme, which ships 1250 loose SVGs and a Node-oriented entry
point; globbing those out of a pnpm-symlinked `node_modules` is fragile, so
we took the iconify collection with static per-type imports instead. Close
in spirit, not pixel-identical.

---

## Q17 — Keeping the tree fresh → **staleTime + focus refetch, no watcher**

**Decision.** Each directory query gets a 15s `staleTime` and opts into
`refetchOnWindowFocus` (the app-wide default is `false`), plus an explicit
refresh button in the panel header.

A recursive `notify` watcher on arbitrary project directories is a real
feature, not a flag: it needs ignore rules so `node_modules` / `.venv`
churn doesn't flood the channel, per-project watcher lifecycle, and inotify
watch-limit handling on Linux. The existing watcher is scoped to
`~/.claude/projects` and stays that way.

**Still the decision for the tree, and 2026-08-31 drew the line.** The viewer's
*open file* is watched now (F7 § "Freshness", `03-backend-rust.md` §
`FileWatch`), which is not this bet: one path, one watch, held for exactly as
long as a file is on screen, so there is no ignore rule to write and no
lifecycle to own. What that watch does not do is decorate the tree — a listing
still goes stale until you focus the window or press refresh.

---

## Q18 — Who owns the panel's tab strip? → **hardcoded; `Files | Changes | Graph`**

**Decision.** The strip is **hardcoded** — a fixed list in `panelStore`, not a
registry and not a plugin point. It carries Files (F12), Changes (F13) and Graph
(F18).

Selection persists **app-wide** in `panelStore` (next to `open` and `width`),
defaults to Files, and never switches itself. A tab strip that moves under you
while you type into the terminal below it is worse than no tab strip.

**Amended 2026-08-17, when F18 was specified.** This question originally decided
"exactly two tabs", and that number was the wrong thing to have written down.
What it was actually deciding is what its title asks — *who owns the strip* — and
that answer has not changed: it is hardcoded, and a third tab is a line in a
union type rather than an extension point.

The original reasoning stands and is worth keeping, because it is the test any
fourth claimant has to pass. Three features had claimed the slot F12 left: F9's
"Memory" tab (CLAUDE.md + plans), project-wide search results, and git status.
Git status won it because it is the one that must sit beside a running terminal,
and the other two had cheaper homes — CLAUDE.md is a file the tree can open, and
search wanted more width than 288px.

**F18 does not pass that test cleanly, and it took the slot anyway.** A commit
graph is a *glance* — you check where the repository is, then go back to work —
so "must sit beside a running terminal" is not really an argument for it, and it
is at least as width-hungry as the search results that were turned away. Both
objections were put to the user during the F18 interview and the call was to ship
the narrow rail here first, with a wide surface deferred (Q22). Recording it that
way rather than retrofitting a justification: the strip grew because a rail at
288px is genuinely useful and cheap, not because the graph satisfied the
criterion that decided this question the first time.

The width objection is therefore live rather than answered, and it is what Q22
holds.

---

## Q19 — Does a read-only Changes view model git's index? → **yes, three groups**

**Decision.** Staged Changes / Changes / Merge Changes, with the diff pair
following the group (HEAD↔index, index↔worktree, HEAD↔worktree).

The cheaper design — one flat list of "what differs from HEAD", ignoring the
index entirely — was considered and rejected. It is simpler and it is honest,
but it makes a partly-staged file unrepresentable: you cannot show both halves
of the change, and the `+N −M` badges stop adding up. Modelling the index costs
one enum on the row type and a second diff pair; getting the numbers wrong costs
trust in the panel.

Consequence: the diff viewer can't be fed from disk alone, which is why
`git_blob(path, head|index)` exists (ADR-0009).

---

## Q20 — How fresh is git status? → **poll while the panel is open**

**Decision.** One shared `git_status` query per project, `refetchInterval` 3s
whenever the file panel is open — on **either** tab, because the tree's
decorations read the same data — and no polling when it's closed.

Note this is deliberately wider than "poll while the Changes tab is visible":
once the tree paints status dots, tab visibility stops being the right trigger.
`Sidebar` already polls at 2s, so neither the pattern nor its cost is new, and
TanStack pauses intervals while the window is hidden.

A `.git` watcher was rejected for the same reason Q17 rejected a project-tree
watcher, plus one more: `.git/index` churns *during* an operation, so a watcher
would need debouncing back into exactly the behaviour polling already has.

**Evidence, from reading VS Code (2026-08-14).** It is watcher-driven, not
polled: a `**` watcher over the working tree plus a `DotGitWatcher`, and its
event filter explicitly drops `.git/index.lock` (worktree variants included) and
watchman fsmonitor cookie files, with `@throttle` on `status()` to coalesce
concurrent runs. That exclusion list is the cost of the watcher route stated
plainly — and the working-tree half is exactly the recursive watcher Q17 already
refused for the file tree (ignore rules, per-project lifecycle, inotify limits).
Polling stands. Their `@throttle` we get for free: TanStack Query dedupes
in-flight fetches per query key.

## Q21 — Rounded window corners on Linux → **no; the bottom two stay square**

**Decision.** The shell rounds its bottom corners on **macOS only**
(`isMacOS()` in `lib/platform.ts`). On Linux they are square and the border
runs unbroken into them.

Rounding is not free the way it is on macOS, where the OS clips the window to
its own radius and the corners we carve land on pixels it already discarded.
Linux clips nothing: `border-radius` on an opaque window carves the *shell*
away and whatever paints behind it keeps filling the corner. That shipped once
— a curve with a wedge of `bg-background` outside it and the border running
off into the wedge — and it is strictly worse than square.

**The WM does round its own frame**, measurably: its 1px outline traces a ~12px
arc at the top-left, and at the bottom-left it fades out over the last ~10 rows
and never reappears, because our opaque square client area is painted over the
curve. So a square corner is not a match for the frame — it covers the frame's
own arc, and that mismatch is the residual artifact we accept here.

**Transparency was tried and rejected (2026-08-16).** `transparent: true` in a
`tauri.linux.conf.json`, plus `<html>`/`body` painting nothing, does give a
real arc: measured 12 device px, antialiased, the desktop visible through it.
But a transparent corner exposes what sits behind the client area, and what
sits there is the **compositor's drop shadow** — so the notch reads as a grey
smudge rather than as a corner. Trading a hairline discontinuity for a visible
smudge is a bad trade. Not worth revisiting unless the shadow can be excluded
from that region, which X11 gives us no handle on.

## Q22 — Rail or wide graph? → **rail first, in the panel; wide modal deferred**

**Decision (2026-08-17, from the F18 interview).** The commit graph ships as a
**rail in the right panel**, designed for 288px from the first line. A **wide
surface is phase 2**: the same component in a near-fullscreen modal at
900–1200px, deferred rather than dropped.

This was the fork the interview existed to resolve, and it is genuinely a fork
rather than a preference, because the two build differently. In GitLens and
VS Code's Git Graph — the stated reference — the lane graph gets a *wide* surface
(an editor tab, an area spanning the window), and what lives in a narrow sidebar
is a **tree** of branches, tags and commits with at most a hint of a rail. Our
panel is 200–600px, narrower than either. So either the picture wanted is the
rail, which fits the panel and is the smaller build, or it is the graph as Git
Graph draws it, which wants a home other than the panel.

**Why the rail won, stated honestly.** Not because the rail is the better
picture — the wide surface is, and "how they diverged" is the question that most
wants horizontal room. It won because it is the cheaper thing to be wrong about.
The rail is a third tab, one component, and reuses the panel, the resizer and
F13's file rows; the wide surface is a new host, a new geometry, and a decision
about whether it is a modal, a route or an F16 tab. Shipping the rail buys the
daily 80% and produces the thing phase 2 widens.

**What keeps phase 2 cheap is that it is a hosting change.** The rail component
takes a width; at 1200px the pitch returns to its full 12px, subjects stop
truncating, and the detail pane moves from below the list to beside it. No second
layout algorithm, no additional backend data. The tabular layout Git Graph
actually uses — graph, subject, author, date, SHA as sortable columns — was
considered for phase 2 and set aside for exactly that reason: it would make phase
2 a second feature rather than a shell swap, which is how deferred phases stop
happening.

**Consequence for Q18.** The strip grows to three tabs, and the width objection
Q18 raised against project-wide search is not answered here — it is deferred to
phase 2. If the rail turns out to be the wrong picture at 288px, the answer is to
bring phase 2 forward, not to widen the panel past 600px.

## Q23 — Where does lane assignment run? → **Rust; the payload carries lanes**

**Decision.** `git_graph` returns each commit with its lane index, plus per row
the lanes passing through and where forks and joins land. The renderer draws SVG
from that and never holds a parent-adjacency graph.

Lane assignment is the feature — a bad layout is worse than no graph — so where
it runs decides where it can be tested and how paging behaves. Three reasons it
is Rust:

- **One pass, not two.** The revwalk is already in Rust. Assigning lanes as
  commits are emitted is a few dozen lines over state we are holding anyway;
  the alternative ships a parent list across IPC so the renderer can re-derive
  what the walk already knew.
- **It is testable where it matters.** `cargo test` builds real repositories in a
  `tempdir` — linear, branch-and-merge, octopus, orphan branch, unborn `HEAD` —
  with no `git` binary and no network. That is the leverage ADR-0009 credits
  `git2` with for the status matrix, and it applies twice as well to a layout
  algorithm. In the renderer the same coverage means Playwright, against a suite
  already past its time budget.
- **Paging stays honest.** Lanes are computed over the whole prefix on every
  call, so page 4 cannot disagree with page 1 (see `03-backend-rust.md` §
  `git`). Doing layout in the renderer means either threading the open-lane
  frontier across appends or reflowing the list on each one, and any instability
  there is visible as lanes jumping under the cursor.

**The counter-argument, which is real:** layout is conventionally a renderer
concern, and a payload with lanes baked in could fight a phase-2 surface that
wanted to lay the same data out differently. It doesn't, because width changes
the *pitch* and not the *assignment* — the same lane indices render at 6px or
12px. If phase 2 ever wants a genuinely different topology on screen, that is the
point to revisit this, and it would be a new question rather than an edit to
this one.

## Q24 — What shape is the settings surface? → **URL-driven modal, medium, explicit Save**

**Decision (2026-08-17, from the F11 interview). Built 2026-08-20, as decided.**
A **modal**, not a route, with
its open state and section in the **URL** as `?settings=claude|editor|confirmations`.
Medium width with the section nav in a left column. (`sessions` joined that list
2026-08-18 with F16's restore switch. What this question decided is the shape;
the section list is F11's, and F11 is where it stays current.) Changes are committed by an
explicit **Save**; Cancel discards.

This question existed because F11 named a `/settings` route and nobody had ever
argued for it — the roadmap's word was "inherited". Four things were decided, and
the reasoning matters more than the answers because each one has a cheaper-looking
alternative.

**Modal *and* URL, rather than modal or route.** The route's real advantages were
never about being a route: they were deep links, surviving a reload, and
browser-back closing the thing. All three come from the URL, and `FileViewerModal`
already proves the pattern with `?file=`. So the modal keeps the session visible
behind it and dismisses on Esc, and none of the route's benefits are given up. The
root route already has `validateSearch`, so the second param is nearly free.

**Medium, not near-fullscreen.** `FileViewerModal` is near-fullscreen because Monaco
needs the room. Three short sections in a full-window sheet is settings floating in
empty space.

**An explicit Save, which was the contested one.** A settings *page* conventionally
applies immediately, and that was the recommendation; the call went the other way,
and the consequences were then designed rather than discovered:

- Save is disabled until something changes, so the button is the dirty indicator.
- A dot marks any nav section holding an edit — with three sections and two more
  planned, "something is unsaved" without "where" makes you hunt through the nav.
- Esc and Cancel discard silently; **click-outside does nothing while dirty**,
  because it is the only dismissal you trigger by accident.
- Save writes the SQLite half **first**, so a failure is a clean no-op rather than a
  half-apply nobody can diagnose.

The accepted wrinkle: a `Switch` that flips without applying is making a promise it
has not kept until Save. Common in save-based settings, and the two affordances
above are what keep it honest rather than being decoration.

**`Cmd/Ctrl+,` opens and focuses; pressing it again does nothing.** Both target
platforms treat that key as idempotent for preferences, and the modal already has
two dismissals — a third gesture that also closes would give one key two meanings
depending on state you may not be looking at. **The binding is not wired by F11**:
roadmap item 5 replaces the per-shortcut `useEffect` pattern, and a seventh one-off
that item 5 would immediately delete is the churn that item exists to end.

**The entry point is a gear in `TopBar`**, not the sidebar footer. The footer was the
first recommendation (it is where the app's other app-level controls live) and was
rejected as already over-full — which turned out to be literally true and a bug: see
F14's note on the update badge clipping `ZoomControls`. Settings is app-level chrome
rather than session or project chrome, and item 6's window controls sit at the
window's outer edge, so the gear moves once by a fixed offset rather than competing.

## Q25 — What does a routine's schedule mean across DST and sleep? → **wall clock, fixed-time rules, catch-up on wake**

**Decision (2026-08-29, from the F22 interview). Not built** — roadmap item 42.
A routine's cron expression is **local wall-clock time**, and the two cases that
break naive schedulers are answered by `croner`'s documented rules rather than by
whatever falls out of the arithmetic (ADR-0026 § 5):

- **Spring forward, a time that does not exist.** A fixed-time routine (`0 30 2
  * * *`) runs at the first valid instant after the gap, on the same calendar
  day. It does not silently skip the day and it does not run twice.
- **Fall back, a time that happens twice.** A fixed-time routine runs **once**,
  at the first occurrence in wall-clock time. An interval routine (`*/15 * * * *`)
  runs on every wall-clock match, including inside the duplicated hour — which is
  what "every 15 minutes" means and what a fixed daily time does not.
- **Searching always moves in real time**, never in wall clock, so a next-fire
  projection cannot hand back a time already past.

**Sleep is not a third case, it is the same one.** Due-ness is `now` against
`last_run_at`, so a machine that was suspended for six hours has simply not
fired; the missed fires are caught up at wake inside the routine's window and
**coalesce** into one run. Nothing counts ticks — a tick counter reads a
suspended laptop as an idle one, which is the bug this sentence exists to
prevent.

**What this question does not settle**, and item 42 carries: the default
concurrency cap, whether a queued fire is visible while it waits, where a failed
fire surfaces (a `last_error` row, item 7's toast, or both), and whether run
history grows past one `last_run_at`.
