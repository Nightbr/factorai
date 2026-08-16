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

Added 2026-08-16: **item 3 is the file tree's right-click menu**, taking the slot held open on
2026-08-15 for exactly this — so nothing between 4 and 21 moved. Same caveat as item 1: the slot
is where it landed, not a statement that it outranks M4's remainder.

Also added 2026-08-16, appended as **items 22–25** because numbering here is append-only. Read
**item 25 as the foundational one** despite sitting last: it redefines what a project is, and
until it lands "close a project" cannot work and no agent other than Claude can be supported.
22–24 are small (a confirm dialog, a button scale, a `DESIGN.md`).

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

## 3. File tree — right-click menu on a row (F12)

**User ask, 2026-08-16.** The tree has exactly one gesture today (click) and one destination (the
viewer). A right-click menu is where the other things you want to do with a file go — open it the
other way, take its contents, take its path — without any of them costing a permanent control in
a 288px-wide row. F12 is explicit that the row gains **no hover actions**; a context menu is how
that stays true while the actions still exist.

**Position is the slot freed on 2026-08-15, not a priority claim** — the file's own rule was that
the next item added takes it, so items 4–21 and every cross-reference into them stay put. Read it
as roughly the size of item 7, not as outranking M4's remainder.

**The actions, as asked.** Open · Copy to clipboard · Copy absolute path · Copy relative path ·
Select for the agent (later). Four of the five are shallow; the fifth is item 19's and is not
part of this build.

- [ ] **The primitive.** `@factorai/ui` ships `dropdown-menu` (radix, used by the sidebar's sort
      menu) and **no context menu**. Add `context-menu.tsx` on `@radix-ui/react-context-menu` —
      the sibling of a package already here, pinned exact like the other nine radix deps
      (`deps:check`), and shadcn-conventional in that folder. Do **not** hand-position the
      dropdown from `onContextMenu`: that re-implements the keyboard model, collision handling
      and focus return the primitive already ships. No ADR — same family, same version line, not
      a load-bearing new dependency by § 5's test.
- [ ] **Kill the native menu first, and verify rather than assume.** Right-click in the WebView
      currently gets whatever WebKitGTK / WKWebView draws, and `tauri.conf.json` says nothing
      about it. Radix calls `preventDefault` on the trigger, which covers the row — it does not
      cover a right-click on the panel's padding, the tree's empty space, or the terminal.
      Check what each platform actually does before deciding whether this needs an app-level
      suppression.
- [ ] **`Open` means the viewer; `Open in default app` is a second row.** The tree settled this
      already — single click opens Monaco (F7), and "open in the OS default app" lives in the
      viewer's header via `openExternally` (`shell:allow-open`, already granted). The menu should
      name both rather than collapse them into one ambiguous `Open`. **F12's spec text was stale
      here** (it still described double-click / `Enter` opening the default app, which `402a23c`
      replaced); corrected 2026-08-16 in the same pass that added this item.
- [ ] **`Copy to clipboard` is the file's contents as text**, and the ambiguity is worth settling
      out loud: the other reading — the file itself, for a paste into a file manager — has no
      reachable implementation. `navigator.clipboard.writeText` works on WebKitGTK (the viewer's
      copy-path button proves it) but `ClipboardItem` does not (see `copyImageToClipboard`'s
      comment in `lib/tauri.ts`), and there is no file-URI flavour to write from a webview.
      `read_file` already returns what the row needs to behave: `isBinary` and `truncated` mean
      the menu can **disable** the row rather than putting a null byte or half a file on the
      clipboard. An image copies through the existing `copyImageToClipboard` path instead.
- [ ] **`Copy relative path` is relative to the project root** — the only base that isn't a guess,
      and `root` is already threaded into every `FileTreeNode` for `list_dir`. POSIX separators
      (macOS + Linux only, § 8), no leading `./`. `Copy absolute path` is `entry.path` verbatim,
      untouched — no `~` collapsing: a path you copy is a path you paste into a shell.
- [ ] **Directories get the same menu with the contents row disabled**, not a second menu. Paths
      are meaningful for a directory; contents aren't.
- [ ] **Right-clicking a row selects it.** `panelStore` has a single `selectedPath` and the tree
      has no multi-select, so the menu acts on one row — and the row it acts on has to be the one
      visibly selected, or the menu is acting on something you can't see.
- [ ] **Say that the copy happened.** The viewer's copy-path button already has the pattern (a
      transient tick). A toast would be the other answer and there still isn't one — item 7.
- [ ] Smoke coverage in `tests/smoke/`: menu opens on right-click, each row fires the right call.
      Clipboard assertions in the Chromium lane need the permission granted in the fixture; the
      `writeText`-vs-WebKitGTK difference means a green test here does **not** prove the copy
      works in the app, so pair it with one manual pass (§ 2e).

**`Select for the agent` — deferred, and it belongs to item 19.** The real version is the IDE
emulation surface: the CLI asks its editor what is selected, and factorai answers. That is the
MCP server, its security boundary and its session-attribution question, none of which this item
should grow. Worth noting there is a **cheap floor** available with no MCP at all — write
`@<relative path>` into the active session's PTY, which is the mention syntax the CLI already
parses — but it inherits the same unanswered question item 19 has: *which* session, when a
project can have several and may have none running. Don't ship the floor as if it were the
feature; if it ships at all it ships as a stopgap that says so.

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

**Three items now wait on this one**, which is an argument for pulling it forward: item 20's
keep-awake toggle needs both the route and a Rust-readable setting, item 22's
confirm-before-killing-a-session toggle needs the route (renderer-only — no Rust read-back), and
the preferences other items keep wanting have still got nowhere to live.

**The surface itself is not settled, and that is what is actually blocking them** (noted
2026-08-16). F11 names four sections and this entry says "`/settings` route", but neither says
**where you click to get there**, and the modal-versus-route choice was never argued — it was
inherited. Both are cheap to decide and expensive to guess wrong, so this item wants a
**clarify-needs pass first**, the way item 1 does. What it has to answer:

- **The entry point.** Nothing in the app opens settings today. `TopBar` is the obvious home and
  is already contested — brand, session tabs, panel toggle, and item 6 is about to put window
  controls there. A gear in the sidebar footer (VS Code's answer) costs no top-bar width. The
  palette (item 12) is a third route in, and a fine *additional* one, but a surface reachable only
  by a keystroke is unfindable.
- **Modal or route.** A route deep-links (`#/settings`), survives a reload, and holds four
  sections without cramping — and it is cheaper here than it looks, because terminals live in
  `terminalStore` and survive navigation, so opening settings costs you nothing you were watching.
  A modal keeps the session visible behind it and matches `FileViewerModal`, but has no URL and
  gets tight fast. Decide it, then say so in F11 rather than leaving the next reader to infer it
  from a route file.
- **`Cmd/Ctrl+,` is already in item 5's table**, which quietly assumes the answer: a binding that
  toggles a modal and a binding that navigates to a route behave differently when you press it
  twice. Land the two decisions together.
- **What a section looks like** — a label / description / control row is the unit, and the
  Confirmations group in item 22 is the first real customer for it. Building the row primitive
  once here is what stops every future preference inventing its own layout.

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
      exercised there.

**Exit criterion for M5** (`06-milestones.md`): a teammate installs the `.dmg` or `.AppImage` and uses
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
- [ ] Open the `tests/regression/` lane. The smoke suite is at ~70s against a stated budget of
      "a few seconds"; one of the two has to give, and that is inconsistency **E1**.
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

## 15. Clickable file links in terminal output (OSC 8)

A path in the agent's output should take you to the file. Fourth member of the navigation family
above — items 12–14 are "I know roughly what I want, find it"; this is "the thing on screen
right now, open it", which is the cheaper and more frequent case.

**Most of the machinery is already here, and one decision has to change.** `Terminal.tsx` loads
`WebLinksAddon` with `onLinkActivated`, and the shell scope in `tauri.conf.json` already permits
absolute paths (`/[\w.][^\n]*`, guarded by `tests/shell_open_scope.rs`). So a file path is
*already* openable — but it opens **externally**, in whatever the OS says owns that extension.
That was right when the only links were `https://`. It is wrong for a file: `00-overview.md` §
"The operating model" puts review inside the app, and F7's Monaco viewer is where a file the
agent touched belongs. **A file link should open the viewer; a URL should keep going to the
browser.** Same addon, two destinations, chosen by scheme.

**Keep the modifier-click rule.** `onLinkActivated` ignores a bare click on purpose, and the
reason is in its doc comment: Claude Code is a TUI, a plain click lands on interactive output
often enough that acting on one would be an ambush. That reasoning is unchanged by the
destination, and this item must not quietly relax it.

**The fork to settle first — and it is cheap to settle.** Two ways for a path to become a link:

- **True OSC 8.** The CLI emits `ESC ] 8 ; ; file:///path ESC \` and xterm renders it; we do
  almost nothing. Depends entirely on Claude Code emitting them, which we don't control and
  haven't verified. **Check before designing anything**: PTY output already arrives as raw bytes
  (base64, `terminal:data`), so a one-off grep for `\x1b]8;` in a live session answers it.
- **A link provider.** `registerLinkProvider` over the buffer, matching path-like text — works no
  matter what the CLI emits, and covers `src/foo.ts:42` line references, which OSC 8 alone
  wouldn't give us. Cost is false positives, and a regex over every frame of a busy TUI needs a
  look at cost.

They aren't exclusive; OSC 8 when offered, provider as the floor, is a plausible answer. But
which one is load-bearing changes the size of this item by a lot.

**Open beyond that.** Relative paths need a base — the session's cwd is known, the agent's
working directory may not be. Does a `:line:col` suffix drive the viewer's scroll position (F7
takes a path today)? And a path that doesn't exist — stale output, a file the agent deleted —
should say so rather than opening an empty editor.

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

## 19. IDE emulation — the MCP server Claude opens files and diffs through

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

## 20. Keep the machine awake while a session is working (macOS + Linux)

An agent working for twenty minutes shouldn't be suspended halfway through because nobody
touched the keyboard. Hold a sleep inhibitor while work is in flight, release it when there
isn't any, and let the user turn the whole thing off.

**The settings half already exists as item 4 — don't build a second one.** F11 names four
sections (Appearance, Editor, Claude, Advanced) and item 4 brings the `/settings` route,
`prefsStore` on `tauri-plugin-store`, and `get_setting`/`set_setting` for values Rust reads back.
This toggle is one preference in that surface and one of those reads. **That makes item 4 a
prerequisite**, and it is a second item now pulling on it — worth weighing when ordering.

**"Active" is the design decision, and `live_count()` is the wrong answer.** It counts terminals,
not work: a session sitting at a prompt would pin the machine awake forever, which is a worse bug
than the one being fixed. The status heuristic already distinguishes
`running | idle | waiting_input | stopped` on its 200ms tick, so the signal is there. `running`
clearly holds the inhibitor and `idle`/`stopped` clearly don't. **`waiting_input` is the real
question**: the agent is blocked on a human who is, by hypothesis, not at the machine. Letting it
sleep is defensible (nothing is progressing); holding it awake is too (you want to come back to a
live session, not a resumed one). Decide it deliberately — it is the case that will actually
happen overnight.

**Releasing it is the dangerous half, and this repo already has the pattern.** A leaked inhibitor
is invisible: no window, no indicator, a laptop that quietly never sleeps and is flat by morning.
That is ADR-0005's orphan-PTY problem wearing a different hat, and it wants the same answer —
release on the *last* qualifying session ending, plus an explicit release on quit, plus `Drop` as
the backstop. Not just "release on quit": a session finishing at 02:00 must not hold the machine
until you close the app the next day.

**Mechanisms, and the platform risk is Linux.** macOS is settled — IOKit
`IOPMAssertionCreateWithName`, and the distinction that matters is
`PreventUserIdleSystemSleep` (what we want) versus keeping the *display* lit (what we don't;
burning a backlight for a headless agent is not the feature). Linux has no single answer:
systemd-logind's `Inhibit` over D-Bus covers most desktops, with `org.freedesktop.portal.Inhibit`
and the older ScreenSaver interface as the Wayland/portal variants. Worth pricing a crate that
already spans both against hand-rolling; either way a new dependency here is load-bearing and
takes an ADR (`CLAUDE.md` § 5).

**A toggle that lies is worse than no toggle.** If inhibition can't be established — no logind,
an unusual compositor, a denied portal — the app has to say so rather than show an enabled switch
that does nothing. Whatever the settings row is, it needs a state for "on, but not currently in
effect", which also means the command returns whether the assertion actually took.

## 21. Post-MVP / deferred

Not duplicated here — [`06-milestones.md`](../06-milestones.md) § "Deferred" holds the ordered
list (MCP/IDE emulator, scheduler, grid overview, activity heatmap, external terminal launch,
multi-window, auto-updates, crash reporting, Windows, mobile). Items graduate from there into
this file when they become the next thing to do, not before.

Two viewer follow-ups sit between "shipped" and "deferred", and belong here rather than there
because F7 already commits to them:

- **Per-project tab system.** `?file=` is a single path today, validated on the `__root` route
  precisely so it can grow into a list. The end state is tabs switching between the project page,
  its sessions, and open files — at which point `FileViewerModal` stops being the host.
- ~~**Image preview.**~~ **Shipped 2026-08-15** — `read_image` returns base64 plus a mime
  sniffed from the magic bytes, and the viewer renders it in an `<img>`. The asset protocol lost
  because its path scope is static and ours is "whatever project you opened". SVG is still
  source-only, deliberately.

## 22. Session header — rework the `Stop` button (F3 / F5)

**User ask, 2026-08-16:** the `Stop` button is wrong; an `X` plus a modal explaining that this
closes and kills the session would be better. Appended after item 21 for the same reason items
12–14 sit where they do — numbers here are append-only, so the deferred catch-all is no longer
the last section.

**The app already has the asked-for control, one component over — and that is the actual
finding.** `SessionTabs` gives every tab an `X` that opens a `Dialog`: *"Close this session? …
Closing the tab terminates its Claude session — the transcript is kept, but any work in progress
is lost. This cannot be undone."*, with `Keep it running` / `Close & kill session`, and
middle-click routed through the same confirm on purpose. The session header
(`routes/session.tsx:96`) does the same irreversible thing through a labelled `outline` Button
with a `Square` icon **and no confirmation at all**. So the two controls disagree about what the
act is called, what it looks like, and whether it's worth asking about.

**That makes this more than taste.** `00-overview.md` § "The operating model" — and `CLAUDE.md`
§ 1 — say every irreversible action keeps its confirmation. The header `Stop` is the one place in
the app where a single click ends a running agent with no undo and no question.

- [ ] Replace the labelled button with an `IconButton` + `X`, per the design rules (no background,
      hover colours the icon). The metaphor changes for the better too: `Square` says "halt a
      process", but the handler kills the PTY, disposes the pooled xterm **and navigates back to
      the project** — that is closing the session, not stopping it.
- [ ] **Reuse the tab strip's dialog; do not write a second one.** It lives inline in
      `SessionTabs.tsx` today with local `closing` state. Lift it to a shared component beside
      `QuitConfirm` (`components/dialog/`) and have both call sites drive it. Two confirm modals
      for the same act, free to drift apart, is precisely the bug this item exists to remove.
- [ ] Decide the stopped-session branch deliberately. The header swaps `Stop` → `Restart` when
      nothing is live, and a dead session needs no confirm. Recommendation: keep the swap and
      re-skin only the live branch — the ask is about the confirm, not a header redesign.
- [ ] Leave the kill-failure path alone. A failed `terminal_kill` still logs and navigates away,
      because the project page's status dot goes on telling the truth (the comment at
      `routes/session.tsx:70` is the reasoning). Don't grow an error modal here in passing.
- [ ] Two spec lines to fix in the same commit (§ 2a), one sentence each. F3 describes "a thin
      header for the project name + session id" and names no controls; F5's UI line still
      advertises a toolbar of "Resume/Restart, Kill, Copy selection, Search-in-terminal (`Cmd+F`)"
      — `SearchAddon` is loaded but nothing drives it, and copy-selection has no control at all.
- [ ] Smoke coverage: `session-tabs.spec.ts` already exercises the tab `×`; add the header path —
      `X` opens the dialog, `Keep it running` leaves the terminal live, confirming lands on
      `/projects/$id`.

**A preference to turn the confirm off — decided 2026-08-16. ⛔ Blocked on item 4.** Whether
killing a session asks becomes the user's call, **on by default**.

**Split this item when you pick it up.** The `X` + shared-dialog rework above is **not blocked**
and should ship on its own — it needs no preference to be an improvement, since today's header
button asks nothing at all. The switches below wait, and waiting on them must not hold the rest
hostage.

What blocks them is not the toggle logic, which is trivial, but that **there is nowhere to put
it**: the settings surface is undecided beyond F11 naming four sections. Where its entry point
lives, and whether it is a modal or a route, are open (see item 4) — and a preference whose home
is unknown cannot be specced, only guessed at. Unlike item 20's keep-awake, this one is
**renderer-only** — no `get_setting`/`set_setting`, just `prefsStore` — so item 4's *surface* is
the whole of the dependency; none of its Rust half matters here.

What to get right when it lands:

- **It does not contradict § 1**, and the entry should say why rather than leave the next reader
  to wonder. "Every irreversible action keeps its confirmation" binds *the app* — it forbids
  factorai deciding on its own that an ask isn't worth it. A human turning it off is the fourth
  verb in `00-overview.md` § "The operating model": setting the rules agents run under. The rule
  stands; the human is allowed to set it.
- **The quit dialog is not covered by it.** F5 calls the window-close confirm **mandatory** and
  ADR-0005 makes kill-on-quit non-optional; that dialog is about losing *every* live session at
  once and stays regardless of this toggle. Wire the preference to the per-session path only.
- **Middle-click is the accident case, and it gets its own row** (refined 2026-08-16). The tab
  strip routes middle-click through the confirm deliberately — *"a shortcut to the action, not a
  way around the question"* — and unlike the `×` it has no aim to it: you can hit a tab you
  weren't pointing at. Someone who finds the confirm tedious on a deliberate `×` may still want
  the question on a stray wheel-click, so collapsing the two into one switch takes that answer
  away.
- **So it is a settings group — and exactly two switches in it** (simplified 2026-08-16), both
  **on by default**:
  - **closing a session with the `X`** — the header's and a tab's `×` are one row, not two. They
    are the same gesture: a deliberate click on a close affordance you aimed at. Someone who
    wants that question in one place wants it in the other, and splitting them buys a row of
    settings for a distinction nobody holds.
  - **closing a tab by middle-click** — a different gesture, per the point above.
- **No master switch above the group.** A general "ask before killing" plus per-action overrides
  produces a matrix with a dead cell (general on → the per-action rows do nothing) and a UI that
  has to grey rows out to explain itself. Two peers, no hierarchy, and the group heading is the
  only grouping there is.
- **Quit belongs in the list as an un-switchable row.** F5 calls the window-close confirm
  **mandatory** and ADR-0005 makes kill-on-quit non-optional, so it is not configurable — but a
  Confirmations group that silently omits the app's most consequential confirm reads as an
  oversight. Show it, disabled, saying it always asks.
- **Store it as one keyed object, render it from a table.** `prefsStore` gets a `confirmations`
  record keyed by action id, and the section renders from a `{ id, label, description, default }`
  table so a future confirm is a row rather than a code change. **The table needs an entry rule
  or it becomes a junk drawer**: only actions whose cost is recoverable may appear — anything an
  ADR calls mandatory (quit) is listed and locked, and anything that writes to disk or to another
  process is not listed at all.
- **The `X` switch governs both call sites.** Same reason the dialog gets lifted into a shared
  component above — a preference that silences the header but leaves the tab strip asking is a
  bug wearing a setting's clothes.
- **`@factorai/ui` has no `Switch`.** That is the third primitive these items need — context menu
  (item 3), checkbox (item 25), switch (here) — all `@radix-ui/*` siblings of packages already in
  the workspace. Item 4's settings route wants the switch regardless, so add it there rather than
  three times over.

## 23. `Button`'s size scale is a web scale, not a desktop one

**User ask, 2026-08-16:** `+ New session` is too big — shrink the default button in the UI
package. It is `size="sm"` already (`routes/project.tsx:77`), which is the point: the scale
underneath it is wrong, not that one call site.

**`packages/ui` still ships stock shadcn sizing** — `default h-10 px-4`, `sm h-9`, `lg h-11`,
`icon h-10 w-10`, with `[&_svg]:size-4` in the base. That is sized for a web page with room to
breathe. This app is a dense desktop tool, **and every dense surface in it already says so by
overriding the primitive inline**:

- `routes/session.tsx` — `size="sm"` + `className="h-7 gap-1.5"` (twice)
- `viewer/FileView.tsx` — `size="sm"` + `h-6 … text-xs` (twice), same in `viewer/DiffView.tsx`
- `routes/project.tsx` — passes `<Plus className="size-3.5" />` to override the base `size-4`
- `layout/Sidebar.tsx` — the search `Input` is hand-shrunk to `h-8`

Six overrides fighting one default is the diagnosis. Fix the scale and delete them.

- [ ] Re-cut the `size` variants in `button.tsx` for this app's density, and re-check the base
      `[&_svg]:size-4` while you're there — if call sites keep passing `size-3.5`, the base is
      wrong.
- [ ] **Then remove the inline height overrides**, or the change is invisible: a call site pinning
      `h-6` doesn't care what the default became. This is the half that actually takes the time,
      and skipping it leaves the app looking exactly as it does now.
- [ ] **`Input` and `Select` are `h-10` too, and they pair with buttons.** Shrinking `Button`
      alone misaligns any row that has both — which the `/settings` route (item 4) is about to be
      full of. Decide one scale for the trio even if only `Button` changes today, and write the
      numbers down (item 24 is where they should end up).
- [ ] Check the dialog footers last: `QuitConfirm`, `SessionTabs`, `UpdateBadge` use the bare
      default, and a confirm button is the one place where *smaller* is not automatically better.
      A destructive action that is easy to hit by accident is the failure mode there.

**Two mechanical cautions.** `button.tsx` is vendored shadcn — 2-space, double-quoted, unlike the
rest of the repo — so edit the variants and **don't reformat the file**; `pnpm format` rewrites
all of `packages/ui` and buries the change. And `IconButton` is already dense and house-authored
(`sm: p-0.5 [&_svg]:size-3.5`): it is the reference for what "this app's scale" means, not a thing
to change alongside.

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
  the scale from item 23, colour and status semantics, density, hover and focus, empty states.
- It is the natural home for the numbers item 23 produces, which is an argument for doing 23
  first and letting the file start from something concrete rather than from principles.

## 25. Redefine what a project *is* — a folder you opened, not a Claude directory

**User ask, 2026-08-16, and the only genuinely foundational item on this list.** Its number is
append order, nothing else; by weight it belongs beside M4. It is also the prerequisite hiding
under three things already written down — closing a project, supporting agents other than Claude,
and F1's slightly embarrassed explanation of why a folder you've never run Claude in "cannot be
reached from the app at all".

**The ask.** A project is a **folder you open**, and Claude sessions are **linked into it** by an
explicit import step. Today the link runs the other way and there is no step: `full_scan()`
upserts a `projects` row for every directory under `~/.claude/projects/`, so your workspace is
whatever Claude has ever touched. In the user's words: *"aujourd'hui ça ajoute toutes les sessions
claude par projet sans contrôle — je pense que ça devrait juste être une étape d'import"*, and
*"au final un peu comme VS Code, sauf que tu peux avoir plusieurs projets ouverts dans la même
window"*.

**Why this is the blocker for closing a project.** *"Aussi pouvoir retirer/fermer un projet."* You
cannot, today, and it is not an oversight: a `DELETE FROM projects` is undone by the next
`full_scan()` or the next watcher tick, because the table is a **mirror** of a directory rather
than a record of a decision. Any close button built before this refactor is a button that lies
within one second. That is the argument for doing this first rather than bolting a close onto
what exists.

**Where the current design actually sits, so the refactor is priced honestly.** F1 states that the
project id being *"Claude Code's own directory encoding of the path"* is **"the whole design"** —
it is what makes `add_project` and the indexer's upsert land on the same row instead of
duplicating, and two tests guard it. That mechanism is good and shouldn't be thrown away; what
changes is that Claude's encoding stops being *identity* and becomes *one agent's foreign key*.

### The schema decision, which everything else waits on

`sessions.project_id` is `REFERENCES projects(id) ON DELETE CASCADE`, and `projects.id` is the
encoded Claude path. So "a project the user hasn't imported" has nowhere to hang its sessions, and
that is the knot. Two ways out:

- **Flag on the existing table** — add `imported`, keep the encoded id, show only imported rows.
  Cheapest, ships in a day, and is a lie the moment codex sessions arrive: their store won't use
  Claude's encoding, so a second agent needs a second id space anyway.
- **Split discovery from the workspace** — `projects` becomes what the user opened (surrogate id,
  canonical `real_path`, the pin, the display name), and what the scan finds stays in its own
  discovered-sessions space keyed by the agent's own identifier, joined to a project by canonical
  path. **Recommended**: it is the shape the multi-agent ask needs, and doing the cheap version
  first means paying for the split twice.

Either way, settle these in the same pass:

- **Migration must import everything that exists.** A user who already has thirty projects opens
  the new build and sees thirty projects — not an empty sidebar with a helpful modal. Anything
  else is data loss as far as the person using it is concerned.
- **Does the FTS index stay global?** Today it covers every session under `~/.claude/`. If import
  gates indexing, F4 can no longer find the conversation in a project you forgot to import — which
  is precisely when you search. Recommendation: **indexing stays global**, import is a workspace
  concern, and the import modal's candidate list is then just a query against something already
  built.
- **Leave a seam for other agents, build none of it.** An `agent` discriminator on a session
  ('claude' today) and an import path that takes one. ADR-0004 generalises with it: *every*
  agent's store is read-only, not just Claude's. Do not write a codex adapter in this item.

### The UI, as asked

- [ ] **Sidebar empty state gets two actions**, replacing today's sentence pointing at the
      `FolderPlus`: **Open project** and **Import from Claude Code**. Note the current copy leads
      with *"No projects found in ~/.claude/projects yet"* — after this item that sentence is
      backwards, since an empty workspace has nothing to do with what Claude has.
- [ ] **The header `FolderPlus` becomes a menu** with the same two items — same actions, one
      surface each for discovery and for repeat use. `DropdownMenu` is already in the sidebar for
      sort, so this is cheap; the real question is two dropdown buttons in a 180px-wide section
      header, which is a crowding problem before it is a code problem.
- [ ] **Import modal**: the Claude projects we know about, each a checkbox row, one `Import`
      button. Rows want path, session count and last activity — enough to answer "is this the one
      I mean". Settle: already-imported rows (checked and disabled, or filtered out), select-all,
      and a project whose folder is **gone** — importable but dimmed is the consistent answer,
      since every transcript is still there and F1 already takes that stance for `missing`.
- [ ] **`@factorai/ui` has no checkbox.** Fifteen primitives, none of them one. Add
      `@radix-ui/react-checkbox` in the package, same shape as item 3's context menu.
- [ ] **Pick one verb.** The ask says *Open project* in the empty state and *Add project folder*
      in the menu; they are the same action and must not have two names. VS Code says
      **Open Folder**; whatever we choose goes in both places and into F1.
- [ ] **Close / remove a project.** The sidebar row's context menu is the natural home — and note
      F1 explicitly **rejected** a right-click menu there, on the grounds that one action (pin)
      didn't justify building the system. That reasoning has expired: item 3 builds the system,
      and there are now three actions (close, reveal in file manager, pin). Revisit it
      deliberately in F1 rather than quietly contradicting it.
- [ ] **What closing destroys: nothing.** It removes the project from the workspace, leaves the
      index alone, and re-importing is instant — and it never touches `~/.claude` (ADR-0004). If a
      session in that project is **live**, closing it confirms first, reusing item 22's dialog
      rather than inventing a third one.

### Spec and ADR work, which is not small

F1 is written from the premise this item deletes — *"show every project under
`~/.claude/projects/`"* — so it gets rewritten, not patched. `02-data-model.md`'s schema section
follows the migration. F4 needs a sentence on whether search reaches unimported projects. And the
identity change wants **an ADR**: nothing in `docs/adr/` currently records "a project is a Claude
directory" — F1 asserts it in prose — so the new model should be the thing that gets recorded
properly. Q3 (a projects-dir override was rejected for MVP) sits next door; don't reopen it by
accident.

**Slice it, don't land it in one commit.** (a) schema, import gate, migration — invisible, and
where the risk is; (b) the import modal; (c) close a project; (d) the multi-agent seam. Each is
shippable on its own and (a) is the one that deserves the review.
