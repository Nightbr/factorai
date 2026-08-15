# TODO

The agreed next steps, in priority order — the single source of truth for "what should we work
on next". Consult it before re-deriving a plan from the specs and codebase. See
[`README.md`](./README.md) for how this folder works (and [`DONE.md`](./DONE.md) for shipped
work).

Context (2026-08-14): **M0–M3 are shipped** — scaffold, read-only browser, embedded terminal
with kill-on-quit, FTS5 search. **M4 is nearly done**: `read_file` + the Monaco file viewer
landed early alongside the file tree (ADR-0007), and the diff half shipped 2026-08-14 with the
Changes tab (F13). Only the **CLAUDE.md / plans** half is left — item 2. **M5 has not started** — no settings route, no keybinding scheme,
no titlebar, no release pipeline. Item 2 closes M4; items 4–8 are M5 in the order it should be
built; **items 12–14 are high-priority despite their position** — the `Cmd+P` / `Cmd+Shift+F` /
`Cmd+G` navigation trio, added 2026-08-14, kept at the end only so the earlier numbers stay
stable.

Added 2026-08-15: **item 1 is the git graph**, taking the slot the Changes tab freed. It sits at
the top of the list because that is where the freed slot was, **not** as a claim that it outranks
M4's remainder — it is gated on a clarify-needs interview and has no spec yet, so nothing about
it is ready to build. Re-order it once that interview has happened and its size is known.

## 1. Git graph — the commit tree, branches and tags

**Not started, and not to be started from this entry.** The next step is a **clarify-needs
interview**, then a spec; only then code (`CLAUDE.md` § 2a). Placement and scope are settled
below and the rest is a list of what the interview has to answer — nothing here is a design, and
none of it belongs in a spec until it has been through one, because the roadmap is sequencing and
never the place a feature gets specified (see [`README.md`](./README.md)).

**Why it's worth building.** GitKraken is currently open alongside factorai for exactly one
purpose: *seeing* where the repository is — which branches exist, what's on them, how they
diverged. Everything a git GUI is usually for — committing, rebasing, merging, resolving — is
already done by agents in the terminal factorai embeds. So the half of GitKraken that justifies
its weight is the half factorai doesn't have, and the half that doesn't is the half we'd never
build. That asymmetry is what makes this a viewer rather than a git client, and it is the whole
reason it's tractable.

**Scope, as agreed 2026-08-15.** Read-only visualization: the commit graph with its lanes, local
and remote branch refs, tags, and where `HEAD` is. Four things are settled and no longer open:

- **It lives in the right panel**, beside `Files` and `Changes`.
- **It is bound to the project folder**, and to that alone — `Repository::discover()` from the
  project root, exactly as F13 already does.
- **A project with no repository shows an empty state**, not an error. `git_status` already
  resolves `repoRoot: null` rather than rejecting, and `ChangesView` already renders
  `Not a git repository.` from it; the graph does the same thing.
- **No session linking in the first cut.** Relating a commit to the session that produced it is
  the interesting question and is explicitly deferred, not dropped.

**Worktrees are a later phase** — they change what "the repository" means on screen and
shouldn't complicate the first cut.

**Two spec consequences to settle before code, both cheap but neither silent.**

1. **This amends Q18.** `07-open-questions.md` decided the strip ships *"exactly two tabs"* and
   is *"not a registry or a plugin point"*, after three features contested the slot. A third tab
   is a change to that decision and the question text has to be rewritten to say so — per
   `CLAUDE.md` § 2a the spec gets fixed first. Note Q18's other half still holds and is worth
   keeping: selection persists app-wide in `panelStore` and **never switches itself**, because a
   strip that moves while you type into the terminal below is worse than no strip.
2. **Width is the real design constraint, and Q18 set the precedent.** The panel is 200–600px
   (`MIN_PANEL_WIDTH`/`MAX_PANEL_WIDTH`), and Q18 disqualified project-wide search from this
   strip *specifically because* it "wants more width than 288px". A commit graph is at least as
   width-hungry. So the first cut has to be designed for a narrow rail from the start (graph +
   subject, everything else on selection or hover), rather than designed wide and then squeezed.
   This is the thing most likely to make the feature land badly.

**The reference is GitLens / VS Code's Git Graph, not GitKraken** (agreed 2026-08-15) — a
denser, more restrained take on the same picture. It also sharpens the width question rather
than answering it, and that tension is the first thing the interview should resolve: in those
tools the lane graph gets a **wide** surface — an editor tab, or an area spanning the window —
while what lives in a narrow sidebar is a **tree** of branches, tags and commits, with at most a
hint of a rail. Our right panel is 200–600px, narrower than either. So one of two things is
true, and they build differently:

- the picture wanted is the **rail** — lanes and subjects in a column, GitLens's sidebar
  density — which fits the panel as decided and is the smaller build; or
- the picture wanted is the **graph** as Git Graph draws it, which wants a wide surface and
  therefore a home other than the right panel, whatever that turns out to be.

Nothing else in the item depends on which; everything about the layout does.

**Non-goals, and they're load-bearing.** No commit, stage, rebase, merge, cherry-pick, push or
fetch. ADR-0009 already binds every repository read to `git2` and says the app writes nothing;
beyond that, `git2` is compiled `default-features = false`, so network transport isn't merely
unimplemented, it isn't linked in. Adding an operation later means revisiting that ADR, not
adding a button.

**What already exists to build on.** `services/git.rs` owns `Repository::discover()` from the
project root, the status walk, blob reads at `head`/`index`, and the `git_err` mapping;
`commands/git.rs` is the boundary; the renderer has never learned libgit2 exists and shouldn't
start now. Freshness today is polling while a panel is open, not a watcher (Q17) — F13 and F12
both take that stance and a graph has no reason to break it.

**Where the difficulty actually is.** Not the data — a `revwalk` with `TOPOLOGICAL | TIME` and
`repo.references()` gets the raw material in a few dozen lines. It's (a) **lane assignment**: the
layout that turns a DAG into legible rails is the feature, and a bad one is worse than no graph;
(b) **scale** — a large repo has hundreds of thousands of commits and neither the walk nor the
renderer can be eager, so paging/virtualisation is a design input, not an optimisation to add
later; (c) **fitting it into 200–600px**, per the width note above.

**For the clarify-needs pass.** What placement settled, and what it didn't. Roughly in the order
they block each other:

- **Rail or wide graph?** The fork above. It decides the layout, and layout decides the rest.
- What is the unit of "enough"? Which behaviours from those tools are load-bearing for the actual
  daily use, and which are noise that happens to be on screen? This is the question the whole
  feature hangs on, and a narrow panel forces it to be answered honestly.
- Scope of the walk: all refs, or the current branch and its neighbours? How far back by default,
  and what does "load more" look like in a rail?
- Does it need remotes at all, given nothing fetches — i.e. remote-tracking refs read from what
  is already in `.git`, and is a stale `origin/main` useful or misleading?
- Interaction floor: what happens on click? Selecting a commit implies showing it, which implies
  a diff surface — and one already exists (F13, ADR-0007's Monaco). Reuse it, or is selection
  purely a highlight in the first cut?
- Refresh: F13 polls while the panel is open. A graph changes far less often than a working
  tree — does it poll at all, or refresh on tab focus and after a session exits?
- Deferred but worth not painting into a corner: when sessions do get linked, what does the
  graph need to have kept around for that to be additive rather than a rewrite?

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
side panel was notional. That slot went to `Changes` (item 1): the tab strip is `Files |
Changes`, hardcoded, not a registry. So Memory takes the cheaper route it should have anyway —
`CLAUDE.md` is **a file the tree opens**, with editability switched on for that one path, which
also makes plans free (they're `.md` under `.claude/plans/`). Update F9 to match before building;
it still describes the tab.

## 3. `missing` flag on `Project` (F1 + F6)

Two features are each waiting on the same one-field change, and one of them is papering over it
with a backend guard.

`list_projects` reports the `cwd` recorded in the transcript and never stats it. So: F1's
"grayed-out (missing) row" is unimplemented, and F6's new-session buttons can't pre-disable for a
path that resolved once and has since been deleted. Today that case is caught in
`spawn_with_argv`, which refuses the spawn and prints the error in the terminal pane — correct,
but the user only learns after clicking.

- [ ] Add `missing: bool` to `Project` in `packages/types` + the Rust struct (hand-mirrored, per
      `CLAUDE.md` § 4), set by stat-ing `real_path` during the indexer scan — not per
      `list_projects` call.
- [ ] Sidebar renders the missing row grayed with the decoded path (F1).
- [ ] Both `+` entry points disable on `missing`, same tooltip treatment as the null-`realPath`
      case (F6).

Keep the backend guard regardless. `portable_pty`'s `CommandBuilder::cwd` does not fail on a
missing directory — it silently starts the child in `$HOME`, which files the session under the
wrong project. The UI flag is the affordance; the guard is the invariant.

## 4. M5 — Settings route (F11) and a real `prefsStore`

Several items above want somewhere to put a preference, and there is nowhere: `panelStore` is
zustand-over-localStorage, and `tauri-plugin-store` is installed on both sides (JS + Cargo) but
unused.

- [ ] `prefsStore` on `tauri-plugin-store`, and migrate `panelStore`'s `open`/`width` onto it
      (F12 says it migrates "when F11 lands" — this is that). Expanded tree paths stay
      unpersisted, deliberately.
- [ ] `/settings` route with the four sections F11 names: Appearance, Editor, Claude, Advanced.
- [ ] `get_setting` / `set_setting` for the values Rust needs to read back — the claude binary
      path override (the escape hatch the three-tier probe's failure message already promises)
      and, if it ships, the projects-dir override. Note Q3 decided *against* a projects-dir
      setting for MVP; don't quietly add it, supersede Q3 if you want it.
- [ ] Theme + font size reach xterm through the palette→theme mapper (Q8: two themes, no picker).

## 5. M5 — keyboard shortcuts, as a scheme rather than a `useEffect`

`05-features.md` § "Keyboard shortcuts" lists six bindings; **none are wired**. The table is not
the hard part — the hard part is that this app has a terminal in it, so a global handler that
swallows a keystroke breaks typing to Claude.

- [ ] `useGlobalShortcuts()` at the shell layer, with an explicit rule for when the embedded
      terminal has focus (xterm gets first refusal on everything it binds).
- [ ] `Cmd/Ctrl + N` → new session in the active project. F6 shipped the buttons and explicitly
      left this unwired; it's the cheapest win in the table.
- [ ] `Cmd/Ctrl + K` (focus search), `Cmd/Ctrl + W` (kill active terminal),
      `Cmd/Ctrl + ,` (settings — needs item 4).
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

- [ ] Real icon set — see **item 18**, which is the whole branding pass rather
      than a checkbox. Now the most visible gap: the app self-updates and ships
      signed bundles while still wearing a placeholder icon.
- [x] README with install instructions — 2026-08-14.
- [x] GitHub Action: `tauri build` on tag push, artifacts attached to the release — 2026-08-14.
      Draft pre-release, universal macOS `.dmg` + Linux `.deb`/`.AppImage`, version taken from
      the tag. **No signing flow** — that's what auto-updates would need (deferred #7). Two
      constraints now documented in the README rather than discovered by a user: macOS builds
      are unsigned so Gatekeeper blocks them until quarantine is cleared, and the Linux bundles
      carry a **glibc 2.39 floor** because they're built on ubuntu-24.04 (22.04 begins
      deprecation 2026-09-17). Widening that floor means an `ubuntu:22.04` container on a
      supported runner, not pinning the dying image.
- [ ] Manual smoke pass on **macOS arm64** and **Ubuntu 24**. macOS is the untested platform:
      every gotcha in `DONE.md` so far is WebKitGTK-flavoured, and the login-shell PATH fallback
      in the claude probe (Q2) exists specifically for GUI launches on macOS and has never been
      exercised there.

**Exit criterion for M5** (`06-milestones.md`): a teammate installs the `.dmg` / `.deb` and uses
factorai for an hour without hitting a flow-breaking bug.

## 9. Retire or re-wire the dead session-read commands

`get_session` and `get_session_tail` survive from the JSONL viewer removed in `c6374d6` (F3).
They are correct, tested, and called by nothing. `05-features.md` keeps them "available for
future use (e.g. a search-hit context preview)".

Pick one and act, because a command surface with dead entries in it drifts silently:

- **Wire it** — F4 hits currently open a session's terminal with no context beyond the `snippet()`
  excerpt; a bounded preview around the hit is the obvious use, and the tail-first paging the
  viewer used is still the right shape for it.
- **Or delete it** — and say so in F3, so nobody re-adds a viewer by accident.

Note the cost of *not* deciding is nonzero: `pnpm deps:unused` (knip) has to keep being told
these are intentional.

## 10. Interaction-level QA coverage

`scripts/qa/` reliably catches boot-time regressions and not much else. The path forward is the
one `CLAUDE.md` § 2d already names: **Playwright against `pnpm vite:dev`**, where the renderer
runs browser-only through `isTauri()` / `mockInvoke()`.

Correct the docs while you're in there: `scripts/qa/README.md` (and `CLAUDE.md` § 2e, which
repeats it) says XTest input is filtered by WebKitGTK before it reaches React. That's too strong —
on this box clicks *do* land in the webview; what gets dropped is `--window`-targeted key events
(`xdotool key --window <id>`), which need window focus plus an untargeted `xdotool key` instead.
The real reasons GUI-driven QA is unreliable here are duller and worth writing down instead: the
sidebar reorders every ~2s (`refetchInterval`), so a coordinate measured from a screenshot points
at a different project by the time it's clicked; `tauri dev` can leave two `factorai` processes
running *different builds*, both windows identically titled, so the same click gives contradictory
answers; and `pnpm dev` doesn't rebuild Rust at all, so a new command needs a full restart.

- [ ] Grow `tests/smoke/` past the current handful, and open the `tests/regression/` lane that
      the smoke-suite budget ("a few seconds") is already pushing against.
- [ ] Cover the flows the tests can reach and `scripts/qa` cannot: opening a file from the tree,
      the viewer's markdown toggle, search-hit navigation, the quit-confirm dialog.
- [ ] Fixtures stay one-factory-per-shape in `tests/smoke/fixtures.ts`.

Deferred within this item: **Wayland support in `scripts/qa/`** (swap `wmctrl` /
`gnome-screenshot` for `swaymsg` / `grim`). X11-only is fine while the dev box is X11.

## 11. `Changes` tab — shipped 2026-08-14 (see [`DONE.md`](./DONE.md))

Was a separate item, merged into item 1 during the design interview and shipped with it. The
tab-slot contest it flagged is resolved in `07-open-questions.md` Q18: the strip holds
`Files | Changes` and is not a registry — Memory (item 2) and search results (item 13) get
cheaper homes.

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
      (it's where `Changes` is also queued, item 11), which makes the panel's tab strip a decision
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
  overlaps with the deferred MCP/IDE-emulator work (`06-milestones.md` deferred #1), so decide
  whether these are one effort or two before either starts.

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

## 16. App-wide scrollbar styling

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

## 18. UI / branding: app logo, icon and desktop assets

The app ships with Tauri's placeholder icon. It self-updates, publishes signed bundles and has a
public README — the icon is the last thing that still says "scaffold".

This is a design job with a long tail of mechanical work, which is why it isn't just "draw a
logo":

- **The mark itself.** A logo that reads at 16px in a dock and at 512px in an about box. The app's
  existing visual language is a starting point: amber accent on near-black, terminal-adjacent,
  `FolderGit2` standing in as the brand glyph in `TopBar` today.
- **Every size and format Tauri wants.** `tauri.conf.json` lists `32x32.png`, `128x128.png`,
  `128x128@2x.png`, `icon.icns` (macOS, multi-resolution) and `icon.ico` (Windows, which we don't
  ship but the bundler still wants). `tauri icon` generates the set from one source PNG — feed it
  a 1024px master.
- **Desktop integration assets.** The `.deb`/AppImage need a `.desktop` entry with the right
  categories and a scalable icon; macOS wants the `.icns` to look right on a dark dock and in
  Spotlight. Neither is exercised by our current builds because nobody has installed one on a
  fresh machine.
- **The in-app brand row.** `TopBar` shows `FolderGit2` + "factorai" in text; a real mark replaces
  the glyph, and the wordmark may or may not survive next to it once session tabs take the row.
- **README and release presentation.** The screenshots are already there; a logo gives the repo a
  header image and the releases a recognisable icon.

Sequence that avoids rework: mark → 1024px master → `tauri icon` → desktop entry → in-app brand
row. Nothing here blocks a release, and every release without it ships the placeholder.

## 19. Post-MVP / deferred

Not duplicated here — [`06-milestones.md`](../06-milestones.md) § "Deferred" holds the ordered
list (MCP/IDE emulator, scheduler, grid overview, activity heatmap, external terminal launch,
multi-window, auto-updates, crash reporting, Windows, mobile). Items graduate from there into
this file when they become the next thing to do, not before.

Two viewer follow-ups sit between "shipped" and "deferred", and belong here rather than there
because F7 already commits to them:

- **Per-project tab system.** `?file=` is a single path today, validated on the `__root` route
  precisely so it can grow into a list. The end state is tabs switching between the project page,
  its sessions, and open files — at which point `FileViewerModal` stops being the host.
- **Image preview.** The viewer is text-only; images need bytes, so either a base64 mode on
  `read_file` or the Tauri asset protocol with a path scope. Binary files currently offer
  open-in-default-app, which is an acceptable holding position.
