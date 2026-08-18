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
**item 2**. M5 has not started — no settings modal, no keybinding scheme, no titlebar, no release
pipeline — and **items 4–8 are M5 in the order it should be built**.

**Item 4 is the one with dependents.** Items 31 (the channel picker), 32 (the theme control), 33
(the restore switch) and 35 (the notification toggle) all wait on the surface it creates, and each
of them is otherwise unblocked in part — read them for which half can land first.

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
- **Worktrees**, which change what "the repository" means on screen.

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

## 4. M5 — Settings (F11) and a real `prefsStore`

**Specified 2026-08-17, not built.** The clarify-needs pass this entry called for has happened, so
the design is [`05-features.md` § F11](../05-features.md) and this entry is sequencing again.
Decisions went to **Q24** (URL-driven modal, medium, explicit Save, `Cmd+,` idempotent, the entry
point) and [ADR-0013](../../docs/adr/0013-preferences-storage-split.md) (the storage split, and
`tauri-plugin-store` removed). **If this entry and F11 disagree, F11 wins.**

**What the interview changed, since three of these were not what the entry assumed.**

- **Not a route — a modal, with its state in the URL.** The route's real advantages were deep
  links, reload survival and back-closes, and all three come from the URL rather than from being a
  route. `FileViewerModal` already proves it with `?file=`.
- **`tauri-plugin-store` is removed, not finally used.** It is async, so it would flash default
  widths and zoom on every launch; and once Rust-readable settings go to SQLite nothing wants a
  JSON file. This entry's first checkbox said "`prefsStore` on `tauri-plugin-store`" — that is the
  line that changed.
- **`panelStore`'s `open`/`width` do not migrate.** The line is layout versus preference. Only
  `diffInline` moves.
- **Three sections, not four.** Appearance holds nothing until theme lands (item 32) and Advanced
  holds nothing until item 31's channel exists.
- **Item 22 folds into this item** rather than following it — see below.

**What the build is, in the order it should be done.**

- [ ] **Rust first.** `SettingKey` as a mirrored union, `get_setting`/`set_setting` over the
      `settings` table migration `0001` already created, and `find_claude_binary(override)` +
      `check_cli(override)` so **every** caller honours the override. Tests: round-trip, `None`
      deleting the row, the override winning over the probe, and the probe still working when it is
      absent.
- [ ] Types in `packages/types`, plus the `cmd` wrappers and `mockInvoke` cases.
- [ ] **Remove `tauri-plugin-store`**: both manifests and the `lib.rs` registration.
- [ ] `prefsStore` (`factorai.prefs`), with the one-time `diffInline` read-across out of
      `factorai.panel`, and `panelStore` to v2 dropping the key.
- [ ] Vendor shadcn **Switch** (`@radix-ui/react-switch`, pinned exact) and add **`SettingRow`** to
      `@factorai/ui` — label / description / control, built once so no future preference invents
      its own row.
- [ ] **`settingsDraft`**, pure: diff a draft against saved preferences, report which sections are
      dirty. This is where the interesting logic goes so it is testable in vitest rather than a
      browser.
- [ ] The modal: `?settings=` on the root route's `validateSearch`, left nav, Save/Cancel,
      click-outside disabled while dirty, per-section dirty dots.
- [ ] The three sections — Claude (detected + override, validating on blur), Editor (diff default),
      Confirmations (the two close-confirm switches — see below).
- [ ] The gear in `TopBar`, right of the tabs and left of the panel toggle.
- [ ] **Two** `@smoke` tests: the gear opens and `?settings=editor` deep-links; Save persists and
      Cancel discards. Everything else goes to item 10 rather than a suite already at 130 (E1).

**The close-confirm switches are this item's Confirmations section**, and were their own entry
(item 22) until 2026-08-17. They were blocked on this item's *surface* and nothing else, so
shipping them apart would leave a decided preference queued behind a page with one text field in
it — and they are what proves `SettingRow` against a real group. The `X` + shared-dialog half
already shipped (2026-08-16, `DONE.md`). Three things about them are reasoning rather than design,
so they live here rather than in F11:

- **It does not contradict § 1 of `AGENTS.md`.** "Every irreversible action keeps its confirmation"
  binds *the app* — it forbids factorai deciding on its own that an ask isn't worth it. A human
  turning it off is the fourth verb in `00-overview.md` § "The operating model": setting the rules
  agents run under. The rule stands; the human is allowed to set it.
- **The quit dialog is not covered by it.** F5 calls the window-close confirm mandatory and
  ADR-0005 makes kill-on-quit non-optional; that dialog is about losing *every* live session at
  once. The preference wires to the per-session path only.
- **Two switches, no master switch, both on by default.** The `X` and a tab's `×` are one row —
  the same deliberate gesture on a close affordance you aimed at. Middle-click is the second,
  because it has no aim to it and someone who finds the confirm tedious on a deliberate `×` may
  still want the question on a stray wheel-click. A general switch plus per-action overrides would
  produce a matrix with a dead cell and a UI that greys rows out to explain itself.

**Item 31 is still not blocked whole.** Its channel *picker* is one row in a section that does not
exist yet; the rest of that item — the process work, the alpha manifest, the automatic builds —
needs no settings surface and can land in either order.

**Size:** roughly 250–350 lines of Rust, ~40 of types, ~100 in `@factorai/ui`, ~650 in the
renderer, plus the docs. Two to four commits, smaller than F18.

## 5. M5 — keyboard shortcuts, as a scheme rather than a `useEffect`

`05-features.md` § "Keyboard shortcuts" lists six bindings; **none are wired**. The table is not
the hard part — the hard part is that this app has a terminal in it, so a global handler that
swallows a keystroke breaks typing to Claude.

- [ ] `useGlobalShortcuts()` at the shell layer, with an explicit rule for when the embedded
      terminal has focus (xterm gets first refusal on everything it binds).
- [ ] `Cmd/Ctrl + N` → new session in the active project. F6 shipped the buttons and explicitly
      left this unwired; it's the cheapest win in the table.
- [ ] `Cmd/Ctrl + K` (focus search), `Cmd/Ctrl + W` (kill active terminal),
      `Cmd/Ctrl + ,` (settings). **Item 4 deliberately does not wire this one** and leaves it here:
      adding a seventh one-off `useEffect` that this pass would immediately delete is the churn this
      item exists to end, and it would have to get the terminal-focus rule right on its own. Per
      Q24 the binding **opens and focuses, and does nothing when settings is already open** — both
      target platforms treat that key as idempotent, and the modal already has two dismissals.
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

- **True OSC 8 — answered 2026-08-17: the CLI does emit them, and the wiring already exists.**
  This was to be checked by grepping a live session for `\x1b]8;`; it got answered the expensive
  way instead, by an OSC 8 login link crashing the macOS app, then confirmed properly in the CLI
  binary (v2.1.233) which carries a `link(url)` helper whose whole body is an OSC 8 sequence. Note
  `claude --help` emits none, so a casual check says the opposite — the login screen is a different
  code path. xterm routes OSC 8 to
  `options.linkHandler`, **not** through `WebLinksAddon`, and that handler is now set and points at
  the same `onLinkActivated` gate as a regex link (F5). So for `https:` this half is done.

  What that leaves for this item is the **`file:`** half, which is the half it actually cares
  about: whether Claude Code marks up *paths* as OSC 8 as well as URLs, and if so, routing those to
  the viewer rather than the browser. `onLinkActivated` sends everything to the shell today, so a
  file link would open externally — the wrong destination per this item's own argument. The grep is
  still worth running, just for `file://` rather than for OSC 8 at all.
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
**item 4 / M5's custom titlebar** rather than on its own. With `decorations: false` the app owns
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

- [x] **Where does the channel live? — settled 2026-08-17: it is a preference, so the picker is
      ⛔ blocked on item 4.** The channel is a `get_setting`/`set_setting` customer, since the
      updater endpoint is chosen in Rust at runtime — which also restores the argument for building
      item 4's Rust half, left with a single caller when the keep-awake item was disqualified.

      **Only the picker is blocked, and that distinction is the useful part of this item.**
      Everything in 31a, the alpha manifest, the automatic builds and the versioning scheme need no
      UI at all and can land first. What waits is the row that lets you *choose* — so sequence this
      as: process work and alpha builds now, channel switch when item 4 lands. Do **not** invent a
      one-off settings surface to unblock it; that is precisely the mess item 4 exists to prevent,
      and the close-confirm switches have been waiting for the same reason.

      Until the picker exists, an alpha build is one someone installed deliberately — which is a
      fine first state, and an argument for shipping the channel *plumbing* early so the picker is
      a row rather than a project when it can finally be built.
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

**Where the control goes is already decided** — F11's Appearance section, which exists as a heading
the moment this lands and is deliberately absent until then. So this item owns the theme; item 4
owns the place to put it.

## 33. Restore open session tabs on launch, behind a preference

**User ask, 2026-08-17.** A switch in settings deciding whether the sessions you had open in
tabs come back when you restart the app.

**The switch is the easy half, and it is not the reason this needs a design pass.** Two things
have to be settled first, and one of them is a spec that currently says no.

### It contradicts F16, in as many words

[`05-features.md` § F16](../05-features.md) decided:

> **Order** is in memory and appends at the end. Persisting it would be meaningless: quitting kills
> every PTY (ADR-0005), so there are no tabs to restore.

And the section above it states the invariant the whole strip is built on: **"A tab is a running
PTY, not an open document."** `terminalStore` has no `persist` at all — deliberately, not by
omission. So per `AGENTS.md` § 2a the spec gets fixed **before** any code, or this item is
disqualified and says why. Do not build against F16 as written and leave the contradiction for
`08-inconsistencies.md` to find later.

### What is a restored tab, given the PTY is gone?

Kill-on-quit is non-optional (Q10, ADR-0005) and **this item does not reopen that** — it is about
what happens on *launch*, not about keeping processes alive across one. So a restored tab cannot be
a running PTY at restore time, and every answer costs something:

- **Respawn `claude --resume <id>` for each tab at launch.** Tabs mean what they meant. But this
  starts N real agents unattended, before you have looked at the window — which is **real money**
  in the words Q10 already uses, and it decides something on the human's behalf that
  `00-overview.md` § "The operating model" says the human decides. If this is the answer, the
  preference cannot default to on.
- **Restore inert tabs that spawn on click.** No process starts until you ask. But it breaks F16's
  invariant directly: the strip stops being an honest picture of what is running, and now has two
  kinds of tab that look alike and behave differently. F16 would need to say what an inert tab looks
  like, or the honesty it was built for is gone.
- **A "reopen 3 sessions?" prompt on launch.** The human decides, the invariant survives, nothing
  spawns behind your back. But it is a new surface, and a modal in front of a cold app every launch
  is its own kind of annoying — worth asking whether it earns that.

**Related and not the same:** resuming a session already works from the sidebar, one click. So the
honest question this item has to answer is what restore adds *over that*, for someone who had four
tabs open — and if the answer is "it saves four clicks", weigh that against starting four agents.

### Smaller things, all of which have precedent to follow

- **Persisted session ids go stale**, and `sidebarStore` already learned this the hard way: at
  ADR-0011 its persisted project ids stopped matching anything and were **dropped rather than
  remapped**, because remapping needed an async lookup that had to finish before first paint or the
  list rendered wrong and then jumped. A restored tab whose transcript is gone, or whose project was
  removed, gets the same treatment — dropped quietly, not an error.
- **Where the switch lives.** F11 ships three sections — Claude, Editor, Confirmations — and this
  fits none of them, so it wants a fourth (*Sessions*, or *Startup*). That is a small change to F11
  rather than a free slot, and item 32 is already queued to add Appearance.
- **`prefsStore` or the tab list?** The *switch* is a plain preference. The *tab list* is
  persisted state that happens to be read at launch, and it is closer to `sidebarStore`'s `expanded`
  than to a preference — ADR-0013's rule applies: nobody sets it in a settings page. Probably
  `terminalStore` gains a persisted `order` and nothing else does.
- **Worth knowing:** `04-frontend.md` listed a `lastProjectId` preference for a year and it was
  **deleted 2026-08-17** during F11's interview as something no feature had ever asked for. This is
  the first thing that would plausibly want it. That is not an argument for bringing it back — it is
  a note that if this item wants "where was I", it should say so out loud rather than quietly
  reviving a key that was removed for being speculative.

**Gated on a clarify-needs interview**, like items 1 and 4 were, and for the same reason: the
sequencing is trivial and the design is not. Nothing here is a design — it is the list of what the
interview has to answer, and the first question is whether F16's invariant bends or holds.

**Depends on item 4** for somewhere to put the switch. Nothing else blocks it.

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

**Depends on item 4**, and this is the user's own condition — "wait the setting modal to control
enable of desktop notif". A notification nobody can switch off is a bug, and F11 is where the switch
belongs rather than a fourth feature inventing its own home for a preference.

**The edge it fires on already exists.** F10's title parser produces exactly the
`working` → `waiting_input` transition this needs (shipped 2026-08-18), so there is no detection
work here at all — item 4 is the only thing this is actually waiting on.

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
