# TODO

The agreed next steps, in priority order — the single source of truth for "what should we work
on next". Consult it before re-deriving a plan from the specs and codebase. See
[`README.md`](./README.md) for how this folder works, and [`DONE.md`](./DONE.md) for what has
shipped.

**Only live work is listed here.** Cleaned out 2026-08-18, when eleven of this file's
thirty-four entries were announcements of their own completion: the list had become a place to
read history rather than a place to pick work up, and `DONE.md` was already the history. An item
whose whole scope shipped is gone from here. An item with a *remainder* keeps its number and is
rewritten to the remainder — items 1, 29 and 34 are here for that reason, each saying in one line
which half already landed and where the entry for it is.

**Numbers are permanent ids and are never reused.** They are append-only, and cited across the
specs, the ADRs, `DONE.md` and a few code comments — so a shipped item's number is not recycled
and a surviving item is never renumbered. Position is priority; the number is identity. If item N
is not here, it shipped, and `DONE.md`'s entry for it names the number.

**Where things stand.** M0–M3 shipped — scaffold, read-only browser, embedded terminal with
kill-on-quit, FTS5 search. M4 is one item from done: the **CLAUDE.md / plans** half, which is
**item 2**. M5 has started: **item 4 (settings, F11) shipped 2026-08-20** and items 5–8 are the
rest of it in the order it should be built — no keybinding scheme, no titlebar, no release
pipeline yet.

**Item 4 was the one with dependents, and they are unblocked.** Items 31 (the channel picker), 32
(the theme control) and 35 (the notification toggle) were waiting on the surface it creates; the
switch item 33 wanted shipped with it. Each of those now needs a `SettingRow` and a section
heading rather than a settings feature — read them for what is left.

**A position is where a slot happened to be free, never a claim about priority** — with one
exception, **item 42 (routines)**, which was asked for at high priority on 2026-08-28 and sits
third because of it. **Item 47 (the footer shell) shipped on 2026-09-01, the day it was asked
for, and item 49 (splits in that footer) on 2026-09-02, likewise**; their entries are in
`DONE.md`. Items 12–14 —
the `Cmd+P` / `Cmd+Shift+F` / `Cmd+G` navigation trio — are high priority despite sitting
mid-list, and everything past 21 is simply the order things were asked for.

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

## 2. M4 — CLAUDE.md & plans (F9)

The first place the app is not read-only, and the last M4 deliverable.

**Re-read its importance (2026-08-15).** `00-overview.md` § "The operating model" makes the human
four things — supervisor, decider, reviewer, and the one who sets the rules agents run under.
Three of those have surfaces already; **this item is the whole of the fourth**. As a "browse and
edit some markdown" feature it looked optional. As the human's only lever on how agents behave,
it is the load-bearing one, and its position in this list understates it.

- [ ] `commands/memory.rs`: `read_claude_md`, `write_claude_md`, `list_plans`, `read_plan`
      (`03-backend-rust.md`). Writes go through the same path validation as the read commands —
      ADR-0004 says `~/.claude/` is read-only, and this is a *project* file, so it isn't a
      violation, but the boundary is worth stating in the ADR trail.
- [ ] Dirty-state save flow with an explicit Save action, plus the on-disk-changed-while-dirty
      modal (F9 edge case).
- [ ] "Create CLAUDE.md" stub button when the project has none.

**Where does it live? — settled by Q18.** F9 says "side panel tab *Memory*", written when the
side panel was notional. That slot went to `Changes`: the tab strip is hardcoded and not a
registry — `Files | Changes | Graph` as of 2026-08-17, when Q18 was amended for F18. Memory is
turned away by the same reasoning either way, because it
takes the cheaper route it should have anyway —
`CLAUDE.md` is **a file the tree opens**, with editability switched on for that one path, which
also makes plans free (they're `.md` under `.claude/plans/`). Update F9 to match before building;
it still describes the tab.

## 42. Routines — the two slices slice 1 left

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

### Slice 3 — routines over MCP — **done 2026-08-30**

- [x] Four tools: `listRoutines`, `createRoutine`, `updateRoutine`, `setRoutineEnabled`.
      **The revisit F22 asked for happened and changed two-thirds of the recorded decision** —
      no `deleteRoutine`, and provenance in two columns, shown on the row. The off switch stayed
      absent; F11 / item 4 own the bridge-wide one. ADR-0028 has the reasoning, including why
      "an agent may edit a human's routine" went the other way from the recommendation.
- [x] **They are not on the IDE bridge, and the first version was.** The CLI registers that
      connection under the hardcoded key `ide` and shows the model two of its tools, so the slice
      shipped correct, fully tested and invisible to every agent. They live on factorai's own MCP
      server now (`services/agent_tools/`), handed to each session at spawn. ADR-0029.
- [x] An acceptance test that runs a real `claude`: `tests/agent_tools_conformance.rs`,
      `#[ignore]`, green against CLI 2.1.251.
- [x] Migration `0014`: `created_by_session_id`, `last_modified_by_session_id`. NULL means a human.
- [x] `routines:changed`, emitted by a layer both callers share — the only thing that stops an open
      Routines tab going stale under a bridge write.
- [x] A cron must now project a next run, not merely parse; name and prompt bounded; 20 routines
      per project.

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

## 5. M5 — keyboard shortcuts, as a scheme rather than a `useEffect`

`05-features.md` § "Keyboard shortcuts" lists six bindings; **none are wired**. The table is not
the hard part — the hard part is that this app has a terminal in it, so a global handler that
swallows a keystroke breaks typing to Claude.

- [ ] `useGlobalShortcuts()` at the shell layer, with an explicit rule for when the embedded
      terminal has focus (xterm gets first refusal on everything it binds).
- [ ] `Cmd/Ctrl + N` → new session in the active project. F6 shipped the buttons and explicitly
      left this unwired; it's the cheapest win in the table.
- [ ] `Cmd/Ctrl + K` (focus search), `Cmd/Ctrl + W` (kill active terminal),
      `Cmd/Ctrl + ,` (settings). **F11 shipped without wiring this one**, deliberately, and it is
      still here: adding a seventh one-off `useEffect` that this pass would immediately delete is
      the churn this item exists to end, and it would have to get the terminal-focus rule right on
      its own. The modal exists and `useSettingsModal().open()` is the whole call. Per Q24 the
      binding **opens and focuses, and does nothing when settings is already open** — both target
      platforms treat that key as idempotent, and the modal already has two dismissals.
- [ ] A binding for the file-tree toggle. **`Ctrl+B` is unavailable** — readline's back-a-char
      and tmux's prefix (Q15). Pick something that survives a terminal-focused window, or accept
      that the toggle stays mouse-only and say so in F12.
- [ ] Sidebar list navigation (F2: ↑/↓, Enter) belongs to the same pass.

The table is also about to grow: **items 12–14** add `Cmd+P`, `Cmd+Shift+F` and `Cmd+G`, and item
14 wants the table's current `Cmd/Ctrl+G` (go to line) row *removed* because Monaco provides it
natively. Land the scheme first if those items get picked up together — three more global bindings
is exactly the point where one `useEffect` per shortcut stops being survivable.

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

## 8. M5 — release: icons, README, tagged builds, smoke pass

The last mile before the app is something a teammate installs rather than runs from source.

- [x] Real icon set — 2026-08-17. The mark, the full `src-tauri/icons/` tree and the README
      header; construction and the regeneration command are in
      [`09-branding.md`](../09-branding.md). **Item 18** keeps the two sub-items this did not
      cover — the `.desktop` entry and the in-app brand row.
- [x] README with install instructions — 2026-08-14.
- [x] GitHub Action: `tauri build` on tag push, artifacts attached to the release — 2026-08-14.
      Draft release (**not** a prerelease — `/releases/latest` skips those and the updater
      resolves through it), universal macOS `.dmg` + Linux `.AppImage`, version taken from
      the tag. **No signing flow** — that's what auto-updates would need (deferred #7). Two
      constraints now documented in the README rather than discovered by a user: macOS builds
      are unsigned so Gatekeeper blocks them until quarantine is cleared, and the Linux bundles
      carry a **glibc 2.39 floor** because they're built on ubuntu-24.04 (22.04 begins
      deprecation 2026-09-17). Widening that floor means an `ubuntu:22.04` container on a
      supported runner, not pinning the dying image.
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

- [x] Cover the flows `scripts/qa` cannot reach — opening a file from the tree, the viewer's
      markdown toggle, search-hit navigation, the quit-confirm dialog — 2026-08-15.
- [ ] Open the `tests/regression/` lane. The smoke suite is at ~110s against a stated budget of
      "a few seconds"; one of the two has to give, and that is inconsistency **E1**.
- [ ] Fixtures stay one-factory-per-shape in `tests/smoke/fixtures.ts`.
- [ ] **Fix `click.sh`'s origin.** Found 2026-08-17: it resolves the *decoration* window's origin
      from `wmctrl -lG` while its doc comment promises content-relative coordinates, and on X11 +
      Mutter the two differ by (47, 73). So every click lands a row low, and the **top 73px of the
      content area cannot be clicked at all** — which is the session header and the panel's tab
      strip. `scripts/qa/README.md` documents the workaround; the fix is for `_resolve_wid.sh` to
      report `xwininfo -id <wid>`'s absolute upper-left instead. Cheap, and it silently corrupts
      every QA click until someone does it.

Deferred within this item: **Wayland support in `scripts/qa/`** (swap `wmctrl` /
`gnome-screenshot` for `swaymsg` / `grim`). X11-only is fine while the dev box is X11.

## 12. Command palette — `Cmd+P` quick-open by filename

> **Priority: HIGH for items 12–14** (user ask, 2026-08-14) — kept at the end of the file to avoid
> renumbering items 1–11 and their cross-references. Read them as sitting **right after M4 (items
> 1–3)**, and land item 5's binding scheme with or before them. They're a coherent trio: don't
> build the third without the first.

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

- `05-features.md`'s keyboard table currently assigns `Cmd/Ctrl+G` to **go to line**. That row can
  simply go: Monaco ships go-to-line natively (`Ctrl+G`) inside the editor, so the app-level
  binding is redundant.
- On macOS, `Cmd+G` is the system-wide **find-next**, and it's what Monaco's own find widget uses
  once `Cmd+F` is open. So a global `Cmd+G` must not fire while the find widget has focus — the
  same "who owns this keystroke" rule item 5 needs for the terminal.

VS Code's own answers are `Cmd+Shift+O` (symbols in file) and `Cmd+T` (symbols in project), both
free here. Recommendation: ship `Cmd+G` as asked, keep `Cmd+Shift+O` as an alias, and record the
choice in `07-open-questions.md` rather than leaving it implicit in a `useGlobalShortcuts` switch.

## 15. Clickable file links in terminal output — shipped 2026-08-19 (see [`DONE.md`](./DONE.md))

Shipped as **F19**. The fork this entry left open is settled and the answer was
the cheap one: the CLI marks up URLs with OSC 8 and never paths, so the link
provider is load-bearing and OSC 8 contributes nothing here. Every open question
it listed is answered in [`05-features.md`](../05-features.md) F19 — the base a
relative path resolves against, `:line:col` driving the viewer, and what a path
that isn't there does (it never becomes a link).

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

**Designed 2026-08-19; not built.** The blocking questions below are answered in
[ADR-0017](../../docs/adr/0017-ide-bridge-writes-one-lockfile-into-claude-ide.md)
and the behaviour is specified as [F20](../05-features.md). What is settled: the
protocol as of CLI 2.1.235, one server per session (the port *is* the session
id), the three-layer boundary with path scoping as the real one,
`tokio-tungstenite` plus hand-rolled JSON-RPC, `ideName: "factorai"`, and a
read-only first slice that leaves ADR-0009 untouched. Its relationship to item
15 is settled too: that shipped, and this routes what the CLI drives by protocol
while F19 covers everything it merely prints.

**Built 2026-08-19, and the CLI connects** (observed against 2.1.235): lockfile
and its reaping, the authenticated handshake and `tests/ide_ws_scope.rs`, the
MCP layer with three tools, and the wiring that starts a bridge with each PTY.
The conformance pass paid for itself on the first run — see F19's neighbour in
`05-features.md` for the `Sec-WebSocket-Protocol` finding that every green unit
test had missed.

What is left:

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

The original entry, kept because it is the argument for doing it at all:


**Graduated from `06-milestones.md` § Deferred (was #1) on 2026-08-15.** A WebSocket MCP server
so the `claude` CLI treats factorai as its editor: file opens land in our viewer, and diff
approvals happen in our UI — including the **accept / reject hunk** surface the MVP skipped.

**Why it graduated.** Under `00-overview.md` § "The operating model" this stops being a nicety
and becomes the mechanism for two of the four verbs. Everything the app does today is
*pull* — the human goes and looks at the Changes tab, the tree, the diff. IDE emulation is the
**push** half: the agent asks, and the human decides in place. That is the difference between an
app you check and an app you work in, and nothing else on this list closes it.

**It is the first time factorai writes code, and that needs an ADR.** Accept/reject hunk means
writing to the working tree. Every existing decision points the other way — ADR-0004 makes
`~/.claude/` read-only, ADR-0009 says every repository read goes through `git2` and *"everything
is read-only. No staging, no discard, no commit"*. Applying a hunk is none of those things and
supersedes part of ADR-0009. Write that ADR before the code, not after; it also has to say what
happens when the working tree moved under a pending approval, which is the failure case that
matters and the one a demo never hits.

**A local WebSocket server is a security boundary, and this repo has never had one.** Any process
on the machine can connect to a localhost port. What authenticates a client, what a connected
client is allowed to ask for (read any path? write any path?), and whether the port is
per-session or per-app are load-bearing questions, not configuration. Getting this wrong turns a
developer tool into a local RCE, so it is the first thing to design and the first thing to test.

**`Select for the agent` belongs here**, and is the one action of the five asked for in the file
tree's right-click menu (shipped 2026-08-16) that deliberately did not land: the real version is
this surface — the CLI asks its editor what is selected, and factorai answers.

Worth keeping from that deferral: there is a **cheap floor** available with no MCP at all — write
`@<relative path>` into the active session's PTY, which is the mention syntax the CLI already
parses, and `Copy relative path` already produces exactly that string. But it inherits the
attribution question below: *which* session, when a project can have several and may have none
running. Don't ship the floor as if it were the feature; if it ships at all, it ships as a stopgap
that says so.

**Open questions, roughly in blocking order.**

- What does the current `claude` CLI actually speak? The emulator has to match today's CLI, and
  reading its behaviour directly is the only reliable source — older third-party emulators were
  written against a protocol that has since moved. That is a research task before it is a build
  task.
- Scope of the emulation: file open only (small, immediately useful, no writes) versus the full
  diff-approval loop (the valuable half, and the one that writes). These are separable and the
  first is a genuine milestone on its own.
- How does it interact with item 15? Both make the agent's output actionable — one by protocol,
  one by parsing what it printed. If the CLI drives opens over MCP, item 15's link provider
  becomes a fallback for everything *not* routed that way rather than the main path.
- Does an emulated editor have to be told which session it belongs to? factorai runs many PTYs
  at once; a server that can't attribute a request to a session can't put the diff in the right
  tab.

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
- ~~**Image preview.**~~ **Shipped 2026-08-15** — `read_image` returns base64 plus a mime
  sniffed from the magic bytes, and the viewer renders it in an `<img>`. The asset protocol lost
  because its path scope is static and ours is "whatever project you opened". SVG is still
  source-only, deliberately.
- ~~**PDF preview.**~~ **Shipped 2026-08-19** — pdf.js, bundled, continuous scroll with a text
  layer (F7, ADR-0018). Four follow-ups were scoped out of it deliberately, in the order they are
  worth doing:
  - **A find bar.** `Cmd+F` across the document, with match highlighting and next/prev. The text
    layer is already there, so this is a match index and a scroll-to-match rather than new
    plumbing. Wait for item 13's project-wide search to settle the find-bar shape first — two
    find UIs that don't match each other is worse than one arriving later.
  - **Go-to-page.** A number box beside the counter. Small, and only obviously worth it once a
    document long enough to want it is in front of someone.
  - **Outline sidebar**, from `getOutline()` — real navigation for a spec or a book. Needs a
    layout decision the pane doesn't currently have room for.
  - **Rendered PDF diff.** A changed `.pdf` in the Changes tab dead-ends on "Cannot preview binary
    file" today. Two `PdfView`s scroll-synced by page is the obvious shape; the open questions are
    what "changed" means for a page (any pixel? any text?) and whether an added or deleted page
    should align against nothing on the other side. Not started, and not blocking anything.

## 24. `DESIGN.md` — one home for the design rules

**User ask, 2026-08-16, explicitly later.** Not now, and worth stating why it isn't free.

Design rules today live in the `frontend-conventions` skill — cursor-pointer as a base rule, icon buttons paint no
background, chevrons colour on hover, repeatedly-actioned rows keep their affordances visible —
plus whatever a component's own doc comment says (`IconButton`'s is a small design essay), plus
per-feature UI notes in `specs/05-features.md`. A `DESIGN.md` that doesn't say what it *takes
over* becomes a fourth place, and this repo already knows what that costs: `08-inconsistencies.md`
§ "What the resolved ones taught" — a rule recorded where nobody reads it is not a rule.

So the first decision is boundaries, not content:

- the `frontend-conventions` skill either **moves wholesale** into `DESIGN.md` and links out, or `DESIGN.md`
  doesn't exist. Two lists of design rules is the failure.
- `specs/` keeps per-feature behaviour; `DESIGN.md` holds what is true across every surface —
  the control scale, colour and status semantics, density, hover and focus, empty states.
- **It starts from concrete numbers rather than principles**, because they exist now: `Button`'s
  desktop scale shipped 2026-08-17 (`default h-8 · sm h-7 · lg h-9 · icon 8`, base icon `size-3.5`,
  with `Input` and `Select` moved to `h-8` so a row holding both lines up), and the `frontend-conventions` skill has
  since grown the menu metrics, the two type sizes and the icon-button rule. One leftover to record
  rather than re-derive: the viewer's toolbar buttons keep `h-6 text-xs` on purpose, a step below
  `sm`, and an `xs` variant is the way to retire them **if a third call site ever wants one** —
  don't add it for two.

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

## 31. Rework the release process — smooth, gapless, and two channels

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

- [x] **The matrix raced on creating the release — fixed 2026-08-17 while cutting v0.10.1.** Both
      jobs created a draft for the same tag, so Linux's assets landed in one and macOS's in the
      other, each with a `latest.json` listing only its own platform. Publishing either would have
      shipped a single-platform release whose manifest told every other platform there was nothing
      to update to. **Both jobs reported success**, and `gh release view <tag>` shows whichever
      draft it picks — complete on its own terms — so nothing about the failure is visible without
      counting assets. Four earlier releases won the same race by luck.
      `create-release` now makes exactly one draft before the matrix and the builds upload into it
      by `releaseId`. That this was found by hand, on the release where the dice went the other way,
      is the argument for the rest of this item.

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
- [x] **Publishing is automatic while factorai is alpha — done 2026-08-18, and the protection was
      kept.** This item asked for exactly that ("alpha is exactly the case where you do *not* want a
      human in the loop") while insisting the missing-platform guard survive, so the gate moved
      rather than went: `release.yml` grew a `publish` job that `needs: build` — a failed platform
      still skips publication — and, before un-drafting, counts the four required assets and
      re-reads `latest.json` for both a `darwin-*` and a `linux-*` key. That last check is the
      v0.10.1 case specifically, which a green matrix cannot catch, because on that release both
      jobs *did* report success. See [ADR-0014](../../docs/adr/0014-alpha-releases-publish-themselves.md),
      which amends ADR-0010's consequence 2.

      **The honest cost, recorded here rather than buried in the ADR:** there is no longer any
      moment where a person sees a release before the world does, so the item directly above —
      nothing enforcing "tag a commit Quality has passed" — stops being tidy-up and becomes the
      next real gap. Revisit the whole trade when alpha ends; it is priced on shipping several
      times a day to a handful of users.
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
- a manifest hosted outside releases (GitHub Pages / a branch), decoupling the channel from
  GitHub's release semantics.

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

- [x] **Where does the channel live? — settled 2026-08-17, and unblocked 2026-08-20 when item 4
      shipped.** The channel is a `get_setting`/`set_setting` customer, since the updater endpoint
      is chosen in Rust at runtime — and that pair now exists, keyed by `SettingKey`, so this
      channel is **a second variant, a match arm and one `SettingRow`** rather than a surface.
      It also needs F11's first new section: **Advanced**, which is deliberately absent until it
      has content (an empty section reads as a bug).

      Everything in 31a, the alpha manifest, the automatic builds and the versioning scheme still
      need no UI at all and can land in any order beside it.

      Until the picker exists, an alpha build is one someone installed deliberately — which is a
      fine first state.
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

## 36. A Homebrew cask, because the macOS build will stay unsigned

**Filed 2026-08-20**, out of the question "how complex is signing for macOS, and I don't want an
Apple developer account". The answer to the first half is *not very* — it is about
thirty lines of workflow YAML: import a `.p12` into a temporary keychain, then hand Tauri
`APPLE_SIGNING_IDENTITY` / `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` and let it notarize and
staple, with `bundle.macOS` left as `{}`. The answer to the second half is that the
certificate has to be a **Developer ID Application** one, which Apple issues only to paid
Developer Program members — a policy wall, not a technical one. A free Apple ID's Personal Team
signs for local development and cannot produce one.

**So this item is what we do instead of paying.** `brew install --cask --no-quarantine factorai`
is the only free way to *remove* the Gatekeeper step rather than explain it, and it composes with
the updater we already ship.

Two dead ends, closed here so nobody re-explores them: a **self-signed** certificate is free and
Gatekeeper treats it exactly as unsigned, and an explicit **ad-hoc** `codesign` step changes
nothing because the linker already ad-hoc signs on Apple Silicon.

- [ ] A tap repo — `Nightbr/homebrew-factorai` — holding `Casks/factorai.rb`: version, the
      universal `.dmg`'s URL, its sha256.
- [ ] A job in `release.yml` **after `publish`**, bumping the cask from the published asset. It has
      to be after, because the sha256 is of the artifact that was actually uploaded, and it has to
      be idempotent, because re-running a release job is normal here (see item 31 and the `v0.10.1`
      post-mortem in `release.yml`'s header).
- [ ] **`auto_updates true` in the cask.** Not cosmetic: factorai replaces its own bundle in place
      (F14), so without it Homebrew and the app disagree about what is installed and `brew upgrade`
      fights the updater. This is the flag casks for self-updating apps carry.

**Be honest about what it buys.** `--no-quarantine` is a flag the *user* passes; a cask cannot
force it. So this **moves** the bypass rather than deleting it — but it moves it into a command
they were going to paste anyway, instead of a dialog they meet after the download. That is the
whole of the win, and it is worth having.

**What it does not decide.** Whether to eventually pay. Notarization is the only thing that removes
the step instead of relocating it, and a notarized build makes this cask *nicer* (drop the flag)
rather than redundant — so this item is not an argument against that one. Revisit when factorai has
users who aren't its author.

**Linux is unaffected.** The AppImage carries no equivalent problem and stays as it is; there is
deliberately no `.deb` (F14 — the updater cannot replace one in place).

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
- [x] **A fifth signal: the paths a shell command names.** Shipped 2026-08-24, hours after the
      fourth, on the shape it cannot see — the agent did the whole hour through `Bash`, so no
      `file_path` ever appeared. `sessions.touched_paths` (migration 0010) keeps the last eight
      candidates instead of one, because reading command lines is loose enough that a single
      value is noise most of the time. `DONE.md` has the numbers and the one cost worth knowing
      (0009's column is left behind rather than dropped, so an older build sharing the data
      directory still opens).
- [x] **The human's worktree picker.** Shipped 2026-08-24, on a user's report of the shape no
      inference can reach: the agent created a worktree and drove it by `git -C` and absolute
      paths, so its cwd never moved and the bridge never heard from it. The remaining three
      deferrals stand (telling the agent when the human moves the panel, creating worktrees from
      factorai, and new sessions starting in the shown checkout).

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

## 39. User documentation, hosted on GitHub Pages

**User ask, 2026-08-24, restated 2026-08-30**: *"we will write a full docs later for all factorai
features"*. Everything written for a *user* today is `README.md` and the four screenshots in
`docs/images/`. Everything else in the repository is written for whoever is
building it: `specs/` is the design source of truth (§ 6), `docs/adr/` is the decision trail, and
this file is sequencing. All three read as internal because they are.

**The README is a pitch, not a manual, and it stays that way** — settled 2026-08-30 when the
routines section arrived and its second half, which explained how to *configure* one, was cut the
same day. A section there says what a surface is for and shows it; how to set it up belongs on the
site, and every feature that ships between now and then adds to what the site owes rather than to
the README. F22's own configuration — the preset picker and the custom cron, the next-runs echo,
the catch-up window, the concurrency cap and what `Run now` answers — is the first entry on that
list.

**The rule that keeps this from rotting: the site does not fork the specs.** It is a different
document for a different reader — how to install it, what the surfaces do, what to do when
something does not work — and where it needs a fact the specs own, it links rather than restates.
A second copy of a behaviour is a second thing to update in the commit that changes it, and § 6
already says which copy wins.

What it holds, in the order a new user meets it:

- **Install**, which is currently the most under-served thing: the AppImage, the unsigned `.dmg`
  and the Gatekeeper step it costs, and the Homebrew cask once item 36 lands.
- **First run** — adding a project, what discovery does, why sessions appear on their own.
- **The surfaces** — sessions and the terminal, Files, Changes, the graph, search, worktrees, and
  **routines** (F22): the schedule presets and the custom cron, the next-runs echo, catch-up and
  its window, the concurrency cap, what `Run now` answers when it declines, and the blue dot for a
  session running with no tab.
- **Settings**, and **keyboard shortcuts** once item 5 gives it a table worth publishing.
- **Troubleshooting**, where the known-and-non-obvious go: `claude` not found and the F11
  override, the AppImage's environment leaking into child processes, Linux specifics.
- **Releases and channels**, sharing whatever item 31 settles rather than describing it twice.

Mechanics worth deciding up front:

- [ ] A generator, and an ADR for it if it becomes load-bearing on the release path (§ 5).
- [ ] **Deploy through the Pages *artifact* workflow, not the serve-a-branch-folder mode.**
      `docs/` in this repository already holds `adr/`, `brand/` and `images/`; pointing Pages at
      that folder would publish the decision trail as a website by accident.
- [ ] `.github/workflows/pages.yml` on push to `main`, alongside `quality.yml` and `release.yml`.
- [ ] Whether the site reuses `docs/images/` or keeps its own copies. Screenshots go stale on
      their own schedule; one copy is one re-shoot.
- [ ] A custom domain, or the default `nightbr.github.io/factorai`. Decide before publishing, so
      the links in the README are only written once.

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
most.

## 45. Several Claude profiles, isolated by config directory, assigned per project

**User feedback, 2026-08-31.** One machine, several Claude identities — a personal account and a
work one, or a throwaway config for testing hooks. Today there is exactly one: `claude_dir()` in
`lib.rs` reads `CLAUDE_HOME` once at boot and everything downstream — the indexer, the transcript
reader, the IDE lockfile, the spawned session — assumes that single directory for the life of the
process. Asked for as "manage multiple profiles, create one, set a default, and point a project at
one from Settings".

**The mechanism is `CLAUDE_CONFIG_DIR` per spawned session**, which is the CLI's own isolation
boundary: credentials, `settings.json`, `projects/`, `ide/`, hooks and MCP config all live under
it. So a profile *is* a directory plus a name, and switching profile is an environment variable on
one child process — not a login, not a token we hold. That keeps Q3's answer and § 8's "no Claude
OAuth helper" intact: the secret is still not here.

- [ ] **A `profiles` table** — id, name, config directory path, `is_default`. Plus a nullable
      `profile_id` on `projects`, which is the one-to-many the request describes: a project with no
      profile uses the default, so an existing install keeps working with zero rows written.
      Deleting a profile that projects point at has to be decided rather than cascaded — reassign
      to default is the sane answer, and it is a confirmation, not a silent move.
- [ ] **Creating one.** A name and a directory. "Create" means make the directory if it is missing
      and leave it empty — the CLI populates it on first run and asks the user to log in, which is
      correct and is the only place authentication should happen. Never copy credentials from one
      profile directory into another: that is exactly the "where is the secret" line the settings
      spec refuses to cross.
- [ ] **Pass it at spawn.** `cmd.env("CLAUDE_CONFIG_DIR", …)` in `services/terminal.rs`, beside the
      `TERM` and `CLAUDE_CODE_SSE_PORT` writes, resolved from the session's project. It is a diff
      over the inherited environment like everything else there, so it goes through
      `services::child_env` conventions rather than around them.

**Three things break the moment the directory stops being global, and each is the real work:**

- [ ] **The IDE bridge lockfile (F20, ADR-0017).** We advertise at
      `<claude_dir>/ide/<port>.lock` and the CLI discovers it under *its own* config directory. A
      session spawned with a profile therefore finds nothing and the bridge is silently dead — no
      error, just a session that cannot see the editor. Either write the lockfile into every
      profile's `ide/` directory, or write it per spawn into the one that session will use; the
      second is narrower and cleans up with the session, which is what `lockfile::remove` already
      does at shutdown.
- [ ] **The indexer scans one `projects/` directory.** `Indexer::claude_dir` and
      `spawn_initial_scan` walk a single tree; with profiles there are N, and sessions from all of
      them belong in the same sidebar. This is the largest piece: the scan becomes per-profile and
      the walk has to know which profile a transcript came from.
- [ ] **`projects.id` is the encoded directory name and collides across profiles.** The same
      repository under two config directories produces the *same* primary key from two different
      trees. Either the key gains the profile, or the table gains a profile column and a composite
      key — a schema decision with a migration behind it, and the reason this item is not a small
      one. `sessions.project_id` and the FTS tables follow whatever it decides.

- [ ] **Settings UI.** A `profiles` section in `SettingsModal.tsx` — list, create, rename, set
      default, delete — and the per-project assignment. The assignment plausibly belongs on the
      project rather than in the global modal, since that is where a project's other settings would
      go; decide before building both.
- [ ] **Show which profile a session is running under.** An identity that is invisible is an
      identity you use by accident. The session surface needs to say it, at least where the model
      and the binary would be said.

**Open.** What `CLAUDE_HOME` means once profiles exist — the honest reading is that it seeds the
default profile's directory at first boot and is then a normal profile row, rather than staying a
second mechanism that outranks the table. And whether a *running* session can change profile: it
cannot, since the variable is read at spawn, so the UI has to make a reassignment mean "next
session" and say so.

**Sequencing.** Item 44's `SettingKey::ClaudeModel` is a per-project preference of the same shape
and hits the same "global or per-project" question — settle it once, in whichever lands first.

## 48. The file viewer as a split under the tree, chosen in Settings — and a wider panel

**User feedback, 2026-09-01.** The viewer is a 90vw × 85vh modal
(`FileViewerModal.tsx:75`), so reading a file covers the terminal you opened it from. Asked for as
a viewer **inline, under the file tree**, with a setting to choose between that and the full-screen
modal, a draggable height for the inline pane, and a wider file panel to read in.

**F7 already committed to this shape**: "`FileView` is written self-contained and modal-agnostic,
and `FileViewerModal` is just its first host". This item builds the second host. Item 21's
per-project tab system is the eventual third and is not blocked by it.

- [ ] **The split host.** Tree above, viewer below, inside `FileTreePanel`. Same pattern as
      item 47 and the same precedent: `GraphView.tsx:188` with `PanelResizer` and a clamped
      `panelStore` height (`MIN_DETAIL_HEIGHT` / `MAX_DETAIL_HEIGHT` / `DEFAULT_DETAIL_HEIGHT` are
      the shape to copy, not the values to reuse). Layout state, not a preference — ADR-0013.
- [ ] **The mode setting.** `fileViewerMode: 'modal' | 'split'` in `prefsStore`, which is a genuine
      preference and renderer-only, so it does not go near the SQLite `settings` table. A row in
      the **editor** section of `SettingsModal.tsx`, beside `diffInline`, which is the same kind of
      choice about the same surface.
- [ ] **Raise `MAX_PANEL_WIDTH`.** 600 today (`panelStore.ts:21`), chosen when the panel only ever
      held a tree. A Monaco pane at 600px is a narrow column, and the comment on
      `MIN_PANEL_WIDTH` says the ceiling's real constraint out loud: the panel is taking columns
      from the terminal. So the new ceiling has to be relative to the window rather than another
      constant — a fixed 900 leaves nothing for the agent on a laptop — and the session pane needs
      a floor it cannot be dragged below. `clampPanelWidth` is pure and unit-tested; keep both
      properties.
- [ ] **Every view has to survive the narrow host, not just Monaco.** The markdown renderer, the
      image view, `SvgPreview` and pdf.js all render inside `FileView`. F7 turned the minimap off
      because it was "noise at modal width" and that argument only gets stronger; word wrap is
      already on. The PDF is the one to check first — a continuous-scroll document at 400px is
      either fine or unreadable, and nothing in ADR-0018 answers it.
- [ ] **Routing and the two agents that open files.** The open file is `?file=` on the `__root`
      route, so F19's terminal path-click and F20's IDE bridge both arrive through it and land in
      whichever host the preference names. In split mode, opening a file with the panel closed has
      to open the panel — silently doing nothing is the failure that looks like a broken link.
- [ ] **`Escape`.** It closes the modal today. In split mode it must not close the panel by
      reflex; decide what it does close, if anything.

**Open.** Which sidebar the width ask meant. The file panel is the one the viewer would sit in and
is read as the target here, but the left sidebar has its own ceiling —
`MAX_SIDEBAR_WIDTH = 480` (`sidebarStore.ts:24`) — and if that is the one that feels cramped it is
a one-line change with none of the above behind it. Confirm before building the wrong half.
