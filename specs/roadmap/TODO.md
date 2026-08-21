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

**A position is where a slot happened to be free, never a claim about priority.** Items 12–14 —
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
`scripts/qa/README.md` and `AGENTS.md § 2e` went on asserting the wrong one for days. A
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
keyboard table has no `Cmd+P`. Write F13 (this item) before coding, per `CLAUDE.md` § 2a — the
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


**Graduated from `06-milestones.md` § Deferred (was #1) on 2026-08-15.** Re-implement
switchboard's WebSocket MCP server so the `claude` CLI treats factorai as its editor: file opens
land in our viewer, and diff approvals happen in our UI — including the **accept / reject hunk**
surface the MVP skipped.

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

- What does the current `claude` CLI actually speak? Switchboard's implementation is the
  reference, but the protocol has moved; the emulator has to match today's CLI, and that is a
  research task before it is a build task.
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

Design rules today live in `CLAUDE.md` § 4 — cursor-pointer as a base rule, icon buttons paint no
background, chevrons colour on hover, repeatedly-actioned rows keep their affordances visible —
plus whatever a component's own doc comment says (`IconButton`'s is a small design essay), plus
per-feature UI notes in `specs/05-features.md`. A `DESIGN.md` that doesn't say what it *takes
over* becomes a fourth place, and this repo already knows what that costs: `08-inconsistencies.md`
§ "What the resolved ones taught" — a rule recorded where nobody reads it is not a rule.

So the first decision is boundaries, not content:

- `CLAUDE.md` § 4 either **moves wholesale** into `DESIGN.md` and links out, or `DESIGN.md`
  doesn't exist. Two lists of design rules is the failure.
- `specs/` keeps per-feature behaviour; `DESIGN.md` holds what is true across every surface —
  the control scale, colour and status semantics, density, hover and focus, empty states.
- **It starts from concrete numbers rather than principles**, because they exist now: `Button`'s
  desktop scale shipped 2026-08-17 (`default h-8 · sm h-7 · lg h-9 · icon 8`, base icon `size-3.5`,
  with `Input` and `Select` moved to `h-8` so a row holding both lines up), and `AGENTS.md` § 4 has
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

## 28. Order the pinned projects by hand (F1)

**User ask, 2026-08-16:** the pinned block should be in the order *you* choose, not the order a
sort picked for you. Appended after item 27 — numbering here is append-only.

**What pinning is today.** `projects.pinned` is a boolean column, set through `pin_project`, and
F1 is explicit that it is the column and **not** a client-side list. The block's *internal* order
is nobody's choice: `groupProjects` in `Sidebar.tsx` filters the already-sorted list in two, so a
pinned project sits wherever the sidebar's sort control put it — `recent` keeps the backend's
`last_session_at DESC`, `name` is a `localeCompare`. Pinning three projects to the top and having
them shuffle every time one of them runs a session is the complaint.

**The real decision is what the sort control means afterwards**, and it has to be made before any
schema. F1 chose deliberately that the sort *"applies inside both groups, so the control means one
thing wherever you look"*. A hand-ordered pinned block contradicts that, and there are only two
honest resolutions:

- **Manual order always wins in the pinned block**, and the sort control governs `rest` alone.
  Simplest to explain — "you pinned these, you arranged them" — but it makes the control mean two
  things after all, and the block needs to *say* it's manually ordered or the control looks broken.
- **Manual is a third value of the sort control** (`recent | name | manual`), applying to the
  pinned block only, with the two existing sorts still reaching inside it. Keeps one control with
  one meaning, at the cost of a mode nobody discovers.

Pick one and write it into F1 in the same commit (§ 2a) — the current F1 sentence is wrong under
either.

- [ ] **Storage: an ordinal column, not an overloaded flag.** `pinned` stays a boolean; add
      `pin_order INTEGER` beside it. **Check the highest migration on an up-to-date `origin/main`
      before naming the file** — 0001–0005 exist locally and migrations are keyed by *name*, so a
      second `0006` cannot be renumbered once it has run anywhere (§ 2b, the 0004 collision).
- [ ] **One command that writes the whole order**, e.g. `reorder_pinned_projects(ids: Vec<String>)`
      in `commands/projects.rs`, rewriting every ordinal in a single transaction. A per-row
      "move up" command looks cheaper and isn't: it leaves gaps, races the 2s refetch, and has no
      way to reject an order that no longer matches what the user saw.
- [ ] **Decide where a newly pinned project lands** — top or bottom of the block. `pin_project`
      currently writes a flag and nothing else; it now has to assign an ordinal too, and
      *unpinning* has to decide whether the old position is remembered for a re-pin (recommendation:
      it isn't — a repin goes to the end, and that is one less piece of invisible state).
- [ ] **The gesture, cheapest first.** The row's `ContextMenu` already exists (item 25) and already
      carries Pin / Unpin, so **`Move up` / `Move down` rows in it are nearly free** and are a
      complete answer to the ask. Drag-and-drop is the nicer gesture and **no longer needs the ADR
      this entry asked for**: dnd-kit landed 2026-08-18 for the session tabs (ADR-0016), so the
      dependency is already load-bearing and paid for, and `SessionTabs` is the worked example —
      `verticalListSortingStrategy` instead of the horizontal one. Two things from that work carry
      over: **do not** reach for HTML5 drag-and-drop (it does nothing on macOS, § 4), and the
      keyboard path is still required — the tabs took `Alt`+arrows rather than dnd-kit's
      `KeyboardSensor`, for reasons that apply to a row you also activate with Enter. Ship the menu
      rows first regardless; they are the cheap complete answer.
- [ ] **Optimistic update or it will fight the poll.** The sidebar refetches every 2s and
      `usePinProject` already shows the pattern (`onMutate` rewrites the cached list). A reorder
      that waits for the round-trip will visibly snap back; the optimistic write has to cover the
      ordering, not just the flag.
- [ ] **Keep the ordering rule pure and exported**, the way `sortProjects` is — the whole point of
      that shape is that the rule is testable without a render. `Sidebar.test.ts` /
      `SidebarProject.test.ts` cover the unit; add one `@smoke` case that reorders and asserts the
      order survives a refetch.

**Not a general project ordering.** This is the pinned block only. `rest` stays sorted, because a
hand-ordered list of every project the workspace has ever seen is a thing to maintain rather than
a feature.

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

## 36. A Homebrew cask, because the macOS build will stay unsigned

**Filed 2026-08-20**, out of the question "how complex is signing for macOS, and I don't want an
Apple developer account". The answer to the first half is *not very* — tolaria does it in about
thirty lines of YAML (`release-build-artifacts.yml`: import a `.p12` into a temporary keychain,
then hand Tauri `APPLE_SIGNING_IDENTITY` / `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` and let
it notarize and staple; its `bundle.macOS` is `{}`). The answer to the second half is that the
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

## 37. Worktrees as a first-class session citizen (F21)

**Specified 2026-08-21** — [F21](../05-features.md) and
[ADR-0019](../../docs/adr/0019-a-worktree-is-a-checkout-not-a-project.md) hold the design and the
reasoning. Nothing is built. Moved out of item 1's last bullet, which had it filed as a graph
concern; it is a session concern the graph happens to render.

**Why it is worth doing before the picker anyone would ask for first.** An agent that runs
`git worktree add` leaves factorai describing the wrong directory — tree, Changes, decorations and
the graph's working row all key off `projects.real_path` — and the session doing the work usually
is not in the project at all, because `claude` keys its store by cwd. Two bugs fall out of the same
slice, and both are live today: the bridge refuses every `openFile` in a worktree (F20's `Bridge`
warning), and a session started in any subdirectory restarts as a fresh conversation instead of
resuming.

**Agent-driven, deliberately.** The agent creates the worktree and says where it went; factorai
follows. A human picker is the *follow-up*, for when the two fall out of sync — not the primary
mechanism, which would ask the human to keep a process they are supervising in sync by hand.

Four slices, in this order. The order matters: slice 2's spawn fix has to land before slice 3's
roll-up, or the roll-up produces sessions that restart as new conversations.

### 2. Rust: detection, the spawn fix, the table

- [x] `git_worktrees` — landed 2026-08-21, plus a `worktree_paths` sibling for the bridge,
      which asks per resolve and does not need a `Repository::open` per checkout. Six tests,
      including the symmetric case (the same set seen from the linked worktree) and a checkout
      whose directory has been deleted.
- [x] **The spawn runs in the session's recorded cwd.** Landed 2026-08-21, alone, as the bug
      fix it is on its own merits. **In Rust, not the renderer** —
      `TerminalManager::resume_cwd` over a `session_cwd` callback, because `Terminal.tsx` learns
      `sessionCwd` from a query that resolves after it has already spawned. Prefers the recorded
      folder only when the transcript is actually in it; four tests, including one that spawns
      somewhere other than the folder it was handed.
- [x] Migration `0006_session_worktrees.sql` — landed 2026-08-21, no competing 0006 on
      `main`. Read and written through `services/sessions.rs`, which is also where the spawn
      fix's `recorded_cwd` lives. **`0007` removed its foreign key the same day**: a session
      with no `sessions` row yet — the case the feature exists for — could not be written at
      all. Cleanup moved to `reap_deleted`.

### 3. The bridge: the tool, the scope, the roll-up

- [x] `setWorktree { path }` — landed 2026-08-21, advertised unconditionally, accepting a
      checkout *or* any path inside one (liberal costs nothing when the containment set is
      git-derived). A refusal names the checkouts that do exist, so the agent can retry
      usefully rather than guess again.
- [x] **The scope is the union**, recomputed per resolve — landed 2026-08-21 as
      `resolve_within_any`, with the session's cwd always in the set so a non-repository project
      behaves exactly as it did. Both cases are asserted, and the human's mention path was
      widened with it (it would otherwise have refused the files the tree was showing).
- [x] `getWorkspaceFolders` reports `cwd`, `worktrees`, a labelled `viewing` and a `hint`
      naming the new tool. `folders` keeps its old shape, so an agent reading only that key sees
      no change.
- [x] `session:worktree` event → the renderer, persisted first and then emitted.
- [x] Roll-up — landed as a second pass in `commands::projects::reconcile`, touching only rows
      the exact-path pass left unlinked. **Exact checkout match, not containment**, which keeps it
      symmetric with pass 1. Five integration tests in `tests/worktree_rollup.rs`, including the
      two that pin the boundary: an unrelated repository is not claimed, and a subdirectory of a
      checkout does not roll up.
- [ ] **Conformance pass against the real CLI, and record the version. This is the last box,
      and it is the premise.** F20 records that a tool call from the shipped binary is still
      unobserved, and nothing since has observed one. If `claude` does not call `setWorktree`,
      the `openFile` inference and the `sessions.cwd` default still work — the floor is passive,
      not broken — but the headline behaviour is unproven until this runs.

### 4. The renderer

- [x] Panel re-roots on the resolved checkout — landed 2026-08-21 behind `useActiveCheckout`,
      which is the three-step resolution in one place. Expand state re-keyed from the project id
      to the **checkout path**, since it holds absolute paths.
- [x] `gitGraph` **needed no change**: it keys on the project folder, which does not move when
      the panel follows the agent, and checkouts share one object DB and one set of refs. The
      obvious reading of this box — key it on the checkout — would have refetched a page of
      identical commits on every switch.
- [x] Header badge gains a worktree mark only when off the project's own checkout, plus the
      revert `IconButton`. The revert deletes the row through `clear_session_worktree`; clearing
      only the in-memory signal would let the stored path win the next read.
- [x] `text-xs` checkout mark on rolled-up sidebar sessions (the directory name, no query
      needed), checkout named in the panel's `h-9` header when it is not the project's own.
- [ ] **`HEAD` chip per checkout in the graph** — the only visible piece still open, and it is
      item 1's share of this: one more ref kind through F18's badge machinery. Cosmetic, so it
      did not gate the rest.

Six smoke tests in `tests/smoke/worktrees.spec.ts` cover the resolution from both the persisted
column and the `cwd` fallback, the revert reaching the backend, and — the one that matters most —
that a session in the project's own checkout grows no new furniture at all.

**Deferred, deliberately, and F21 says why for each:** the worktree picker; telling the agent when
a human moves the panel; creating or removing a worktree from factorai (ADR-0009 stands); new
sessions starting in the shown checkout.
