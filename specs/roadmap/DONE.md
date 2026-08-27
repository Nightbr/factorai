# Done

Shipped work, newest first. Items move here from [`TODO.md`](./TODO.md) when they land; see
[`README.md`](./README.md) for the workflow.

- **A dev build runs under its own app identifier — ADR-0024** — 2026-08-27, user ask, after a
  dev run broke the installed release. `tauri dev` merges
  `apps/desktop/src-tauri/tauri.dev.conf.json`, whose only field is
  `identifier: dev.factorai-dev`, so `app_data_dir()` resolves to
  `~/.local/share/dev.factorai-dev/` — database and WebKit `localStorage` both.

  **What it fixes is not a folder collision, it is a migration.** Both builds opened one
  `factorai.db`, and 0011 dropped `projects.pinned` from it while the installed release still ran
  the `PROJECT_SELECT` that names that column: `list_projects` returned `db: no such column:
  p.pinned` and the sidebar sat on `Loading…` — with no bad code in the release and nothing
  recoverable short of rebuilding it. Migrations are forward-only, so every future one had the same
  reach.

  One field, not a code path, and the reasons are in the ADR: `FACTORAI_DATA_DIR` read in `setup()`
  moves the database and leaves the webview storage behind, and so does a `#[cfg(debug_assertions)]`
  suffix — Tauri resolves that directory from the identifier before our code runs. The `--config`
  file stays at one key because the CLI merges with RFC 7386 semantics, which **replace** arrays
  rather than merging them; `app.windows` in there would silently drop the window's dimensions.

  A dev database starts empty and the indexer rebuilds `sessions` from `~/.claude/projects`;
  `projects` and `settings` are what a copy is for, via SQLite's backup API rather than `cp`, since
  the release's WAL is not checkpointed. `scripts/qa/launch.sh` needed no change — it shells out to
  `pnpm run dev` — and `tauri build` never reads the file.

- **Project groups — spec `05-features.md` F1, ADR-0025** — 2026-08-27, user ask, after a
  `clarify-needs` interview. A group is a row that holds projects; you make one from the header
  menu or by **holding one project over another for ~800ms**. Shipped as three commits — the tree,
  the interface, the gesture — because the dwell is the part most likely to want tuning on its own.

  **The storage moved, one day after item 28 put it on the project row.** `sidebar_rows` (migration
  0012) owns the structure, and `projects.sort_order` is dropped. Groups make the sidebar two
  levels, and an ordinal on the project row cannot express that: it would mean "position at the top
  level" or "position inside my group" depending on a *different* column, and order split across two
  tables cannot interleave a group row with a loose project — which reinstates the two-tier list
  item 28 had just flattened. So **ADR-0025 supersedes ADR-0023**, which is the mirror of the call
  made the day before: there the prior decisions were extended and got links, here one is replaced
  and gets a supersede. The test is the same in both directions — is a shipped decision being
  revised, or built on?

  A group *is* a row: no `project_groups` table, because a group has no attributes beyond its name
  and a second table would buy a join plus the possibility of a group with no row.
  `reorder_sidebar(rows)` replaces `reorder_projects(ids)` and takes the whole tree, which is what
  makes moving a project between groups one atomic write; it keeps the stale-set rejection and now
  also catches a row named at two levels at once, which a per-scope check cannot see. No sub-groups,
  enforced by `CHECK (kind = 'project' OR parent_id IS NULL)` in the schema rather than only in the
  commands.

  **The interview overturned four things the roadmap entry had assumed**, all recorded in ADR-0025:
  the normalised table over `group_id`, no `project_groups`, `Name`/`Recent` **dissolving** the
  groups into one flat list rather than sorting within them, and the ADR situation above. The dwell
  was asked for at 2000ms and shipped at 800 — creating a group is reversible, two seconds of
  holding a button reads as the app having hung, and what prevents accidents is the pending action
  being *visible* before it commits, which is what the filling ring is for.

  **The bug that matters, and how it survived everything.** All three commits went in green — 440
  unit tests, 196 Playwright tests, clippy, the lot — and in the real app **no write ever landed**.
  Two serde mistakes:

  - `SidebarRow` emitted `row_id` while `@factorai/types` declared `rowId`. On an **enum**,
    `rename_all` renames the *variants* and does nothing to the fields inside them; that needs
    `rename_all_fields`. The drift was **asymmetric**, which is what hid it: `SidebarChild` is a
    struct, where `rename_all` does apply, so a group's children arrived correctly while the rows
    holding them did not.
  - `SidebarOrder` had no `tag`, so serde used its **externally tagged** form — `{"Project":{…}}` —
    and could not parse `{"kind":"project","rowId":…}` at all. Every `reorder_sidebar` call was
    refused before the command body ran.

  Neither mechanism that looks like it would catch this does. `tsc` checks the renderer against
  `@factorai/types` and `@factorai/types` against nothing. The Playwright suite goes through
  `mockInvoke`, which **fabricates camelCase in TypeScript** and never asks serde what it would
  emit. `tests/wire_shape.rs` now pins the literal JSON, and the rule going forward is that **any
  tagged enum crossing the boundary belongs in that file** — plain structs are far less treacherous,
  because there `rename_all` does what it looks like.

  This is § 4's "if the two sides drift, that's a bug we want to catch in review, not at runtime",
  and it went to runtime anyway. Worth knowing *why* review missed it: both sides read correctly in
  isolation. `#[serde(tag = "kind", rename_all = "camelCase")]` looks exactly like the thing that
  produces `{ kind: 'project', rowId: … }`.

  **Three more things found only by using it**, each fixed at its cause:

  - Radix returns focus to the menu trigger as the menu closes, which lands *after* `onSelect` has
    mounted the inline editor — and an editor that commits on blur closes itself instantly.
    `onCloseAutoFocus` is prevented on all three menus. One focus on mount is still not enough from
    a menu (the focus scope tears down afterwards, leaving `activeElement` on `BODY` — measured), so
    `InlineEdit` takes focus again on the next frame.
  - `InlineEdit`'s focus/select cannot live in the `ref` callback: an inline callback is a new
    function every render, so React reattaches it and re-runs `select()` before every keystroke.
    Typing "Pro" left "o".
  - A keyboard **nudge** is not a **drag**, and they cannot share a rule. A drag aims at a target,
    so dropping on a group's header means "the top of this group". A nudge walks the list, and the
    slot above a group's first child is the top level. Routing the nudge through `moveRow` made
    `Alt`+ArrowUp on a first child a permanent no-op; `nudgeRow` is separate and states the boundary
    cases as its own rules.

  **`scripts/qa/` gained a fix and two rules**, all three of which cost time here. `key.sh` and
  `type.sh` had used `xdotool --window` — the XSendEvent path this repo's own README documents as
  filtered by WebKitGTK — so for months neither could put a character into the WebView while the
  README's table marked them ✓. They now activate the window, send through XTest, and refuse if
  another pid holds focus. And the two rules: **activating the window dismisses an open popup**
  before your click lands (so a click *inside* a menu must skip the activation `click.sh` does), and
  **`gnome-screenshot` takes focus** — a capture between opening an inline editor and typing into it
  blurs the editor, which sent this QA pass chasing a rename bug that did not exist alongside one
  that did.

  **Verified in the dev app against the live database**: 0012 carried the existing hand order
  forward with all 13 project links and 150 sessions intact; the group created, renamed and
  persisted; a project dragged in; an intra-group reorder; the dwell producing a group holding the
  drop target then the held row, with the amber ring and `NEW GROUP` label visible mid-hold; and a
  collapsed group springing open and accepting the drop inside.

  **Left open as C9**: the design sidecar says a hovered menu row is `secondary`, while every menu
  primitive uses `accent` — noticed because the new `Move to group ▸` submenu's open state looked
  loud, and it turned out to be matching what the app has always done.

- **Order every project by hand — spec `05-features.md` F1, ADR-0023** — 2026-08-26, user ask,
  after a `clarify-needs` interview. Pinning is gone; `projects.sort_order` (migration 0011) is
  where a project sits, written by dragging the row. The sort control **survives and grows a
  `Manual` mode** beside `Name` and `Recent` — which is the one place the interview overturned the
  filed plan, and it disposed of that plan's stated cost ("after this there is no name-ordered way
  to find a row").

  A pin is a one-bit approximation of an ordering: it says "this matters" and nothing else, and it
  forced the list into two tiers that the sort control then had to mean the same thing inside both
  of. One hand-ordered list has no tiers. `reorder_projects(ids)` writes the whole order in one
  transaction and **rejects a stale id set**; `add_project` puts a new project on top with
  `MIN(sort_order) - 1`; the drag is dnd-kit on the whole row with the tab strip's 4px activation
  constraint, `Alt`+arrows beside it, and `Move up` / `Move down` in the slot Pin / Unpin vacated.

  **Two migration facts, both measured, both of which the TODO entry had wrong.** They are recorded
  in 0011's own comments because the second one outlives this feature:

  - **Dropping `pinned` needed no table rebuild.** SQLite's `DROP COLUMN` restriction is on
    *table-level* CHECK constraints, not inline column ones — the drop rewrites the `CREATE TABLE`
    text and re-parses it, so an inline `CHECK` leaves with its column. Verified against the real
    0004 schema on SQLite 3.45.0: the drop returns `Ok`, `missing`'s own inline CHECK still fires
    afterwards, and the `discovered_projects` links are untouched. A table-level CHECK or an index
    on the column fails with `error in table t2 after drop column: no such column: pinned`.
  - **And the rebuild the entry described could not have worked.** It called for
    `PRAGMA foreign_keys = OFF` around a `DROP TABLE`, because that drop fires
    `discovered_projects.project_id`'s `ON DELETE SET NULL` and unlinks every session. That pragma
    is a **silent no-op** here: `Db::migrate` runs every migration inside one `conn.transaction()`,
    and SQLite ignores it inside a transaction. Measured — the pragma leaves `foreign_keys` at `1`
    and the child row is nulled. Any future migration that rebuilds a referenced table has to stash
    and restore the links itself, or teach the runner to run that one outside the shared
    transaction.

  **Three things found by using it, which no amount of type-checking would have caught:**

  - **The row needed `select-none`.** `draggable={false}` on the row's `<Link>` is required — a
    native anchor is draggable by default and that drag is the HTML5 one, dead on macOS — but with
    it off, native **text selection** takes the gesture instead. The row did not move and five rows
    of grey highlight appeared. dnd-kit adds neither property, and `touch-action` is only the touch
    half of the same problem.
  - **The 0011 seed is visible and correct on real data.** This machine had three pinned projects;
    after the migration they sat at ordinals 0–2 with the rest alphabetical after them, so a pin
    was carried forward as a *position* rather than discarded.
  - **`scripts/qa/` had no way to drive a drag**, which is why the first two of these took so long
    to see. `drag.sh` is new: press, step, release, with the intermediate moves that dnd-kit's
    activation distance requires. It deliberately does **not** carry `click.sh`'s (47, 73)
    frame-offset bug — it resolves the client area from `xwininfo` — and it asserts focus by **pid**
    before pressing, which `click.sh` does not do at all. Worth reading before C7 is fixed.

  **A caution for the next agent doing this kind of QA.** Screenshotting a `xdotool` drag is much
  harder than it looks: a 14-step drag completes in well under a second, so a capture 0.8s later is
  *post-drop* and reads as "the lift never rendered". Two rounds were spent chasing a ring that was
  rendering fine. The lift styles were settled in one Playwright call reading `getComputedStyle`
  mid-drag, and only then confirmed in the real window by holding the button down for 2.5s — where
  the ring measures exactly `(31, 34, 37)`, `--border`. **Prove a style with Playwright; use the
  real window for the things only it has**, which here was the migration running against a live
  database.

  **No `sidebarStore` version bump**, reversing the filed plan a second time: adding `manual`
  *widened* `ProjectSort` rather than replacing anything, so every persisted value stays valid —
  and this machine's persisted `sort: 'name'` survived the upgrade, which is the behaviour visible
  in the QA pass. Migrating someone off a mode still on the menu would discard a preference they
  set. Only the default for a fresh install moved.

  **ADR-0023 supersedes nothing**, also reversing the filed plan. ADR-0011 decided project identity
  is a uuid rather than a path and merely *cited* pins as a benefit — an ordinal is the same kind of
  decision a path-derived id would throw away, so the argument is strengthened, not revised. ADR-0016
  decided the drag library, which is what this builds on; only its sentence naming the future surface
  reads stale. A supersede link means "this decision was revised", and spending it on two decisions
  that stand would have told the next reader that a project is no longer a folder in the workspace.

  **Left open as `08-inconsistencies.md` C8**: the sidebar's lift is tonal plus a hairline ring, per
  `DESIGN.md`'s new Lifted-Row Rule, while `SessionTabs` puts `shadow-lg` on the tab it is dragging
  — undocumented, and against the same Shadow Vocabulary. Two drag treatments, one documented.
  Changing the shipped tab strip was out of scope here.

- **A search hit names its project — spec `05-features.md` F4** — 2026-08-24, shipped as
  **v0.24.0**, user ask. Search is workspace-wide, and a result row said only which *session* it
  came from. That is half an answer: a session title does not place a conversation, several
  projects hold a "Fix the flaky test", and an untitled session showed nothing but a uuid. The
  project the hit belongs to was already resolved by the query — it is what scopes the search — and
  simply was not carried out.

  `SearchHit` now carries `projectName` and `projectPath`, JOINed from `projects` through the
  `sessions` → `discovered_projects` link the search already walks, and the row leads with the
  project's `ProjectIcon` and name before the session title.

  **Two decisions worth keeping:**

  - **Resolved live, never stored on the FTS row.** Same reason `messages_fts` stopped carrying a
    project id in migration 0004: a workspace id is not stable across a remove and a re-add. The
    join is also what makes a *renamed* project read correctly in hits indexed before the rename.
  - **The path travels, not just the name.** `ProjectIcon` hashes its hue from the path, so a hit
    labelled by name alone would colour the same project differently here than in the sidebar and
    the tab strip — and the colour is what those two surfaces are actually scanned by.

- **Frontmatter in the markdown preview — spec `05-features.md` F7 + F11, ADR-0022** — 2026-08-24,
  shipped as **v0.23.0**, user ask with a screenshot. A `---` block at the top of a document
  rendered as *prose*: react-markdown has no frontmatter plugin, so remark read the fences as a
  thematic break or a setext underline and ran `title:`, `status:`, `reviewers:` and their YAML
  punctuation together into one paragraph — including the `#` comments, which is how a note reading
  "no Linear project" ended up in the middle of a sentence. The metadata was on screen and
  unreadable, which is worse than laying it out or dropping it.

  It is now a **collapsible panel of fields** above the prose, and the state it opens in is a
  preference (`frontmatterOpen`, Editor section, default on).

  **Four decisions worth keeping:**

  - **A real YAML parser, `yaml`, not a regex over `key: value`.** The tempting version needs no
    dependency and reads a quoted value containing a colon, a `#` inside a string, a block scalar
    and an inline list *wrongly* rather than failing on them — and a metadata panel quietly showing
    the wrong owner is worse than the paragraph it replaced. Parsed with `mapAsMap: true`, because a
    plain JS object reorders integer-like keys and these are read in written order.
    `remark-frontmatter` solves the other half — it teaches remark to skip the block, which is not
    the half that was hard.
  - **The split is ours and it is conservative.** First line `---`, closed by `---` or `...`, CRLF
    and a BOM tolerated — and a document whose fence never closes is left exactly as it was. That
    one opens with a thematic break, and a failure card on every document that starts with a rule
    would have been a worse bug than the one being fixed.
  - **The chevron is not written back to the preference**, unlike the diff viewer's inline toggle.
    That one is a reading mode you stay in; this is a peek at one document, and a setting edited by
    accident is worse than one more click. The panel is keyed by path so the next document starts
    from the preference again.
  - **The default is settled by history, not taste.** On, because the fields were already on screen
    before there was a panel to put them in. Same rule `restoreTabs` follows: a switch arriving
    after the behaviour must not quietly take something away.

  Four value shapes and no more — text, no-value (an em dash, since a blank cell reads as a
  rendering that gave up), a chip row for a list in the *neutral* hue, and an indented field list
  for a nested map. A URL value is handed to the OS like a markdown link. A block that will not
  parse, or that parses to something other than a mapping, keeps its source in the dashed frame a
  missing image and a broken mermaid fence already use.

  **Not done, deliberately:** TOML (`+++`) and JSON frontmatter are not handled — nothing in the
  corpus this viewer serves uses either. No per-field treatment: a `status: Draft` is text, not a
  coloured chip, until something asks for it.

- **Mermaid diagrams in the markdown preview — spec `05-features.md` F7, ADR-0021** — 2026-08-24,
  shipped as **v0.22.0**, user ask. A `mermaid` fence in a rendered `.md` used to be a code block of
  `graph TD` lines.
  It now draws. This is the one kind of content where the rendered view was strictly *worse* than
  the source view, and the documents this viewer is pointed at — `specs/`, `docs/adr/`, whatever
  an agent just wrote — are exactly the ones with diagrams in them.

  **Four decisions worth keeping, three of which are not the obvious one:**

  - **The override is on `pre`, not on `code`.** Returning a diagram from the `code` component
    leaves it wrapped in the `<pre>` react-markdown already emitted, which is styled as a code
    block and is not allowed to contain flow content. And the source is read off the **hast
    node**, not off React `children` — children here is a rendered `<code>` whose own children may
    be split across several text nodes, and reassembling a diagram out of those is how it loses a
    line break.
  - **The palette is converted at render time, not copied into hex.** Mermaid derives most of a
    diagram's colours from a few seeds with `khroma`, which parses hex and **not `oklch()`** —
    hand it a token from `globals.css` and it silently produces black. So `mermaidTheme.ts` reads
    the custom properties off the document and converts them. A second copy of the palette in hex
    would have been half the code and would have gone stale the first time a token moved; the
    amber moved 3% on 2026-08-19. The light theme (item 32) now costs nothing here.
  - **`suppressErrorRendering: true`, which is not mermaid's default.** Left on, a fence that
    won't parse appends a bomb-glyph diagram into the DOM with nothing saying which fence produced
    it. Off, `render` throws and cleans up its own temporary nodes, and the failure is reported in
    place with the fence's source kept and shown — a diagram that won't parse is still what the
    author wrote.
  - **The SVG is parsed and adopted, not `dangerouslySetInnerHTML`.** Mermaid has already run its
    output through DOMPurify (`securityLevel` stays `strict`), so this is not the sanitising step;
    it is how the markup becomes real nodes without an escape hatch `biome`'s recommended set
    rejects. Parsed as `text/html`, **not** `image/svg+xml`: the HTML parser puts inline SVG in the
    right namespace and tolerates the `<foreignObject>` label markup, which is not always
    well-formed XML.

  Mermaid is ~2.5MB — larger than Monaco — so it sits behind a dynamic import a level below the
  viewer's own chunk and nothing loads it unless a document actually has a fence. It is in
  `optimizeDeps.include` for the reason Monaco and pdf.js are: a chunk discovered mid-interaction
  prebundles and reloads the page at exactly the wrong moment.

  **Not done, deliberately:** no pan, no zoom — a wide diagram scrolls sideways in its own
  container. `ImageView`'s controls are the shape that would take. Mermaid is wired into
  `MarkdownView` only, not the diff viewer.

- **F21's fifth signal — the paths a shell command names — spec `05-features.md` F21, roadmap
  item 37** — 2026-08-24, shipped as **v0.22.0**, on a user's screenshot of factorai naming `pearl` and its old branch
  while their agent worked in `../pearl-eng-3333`. Hours after the fourth signal shipped, and
  defeated by it in the one way the fourth signal cannot see: the agent did the entire hour
  through `Bash`. 44 shell calls, and not one `Read`, `Write` or `Edit`, so a harvest of
  `file_path` and `notebook_path` found nothing at all and both cwds went on correctly naming
  the checkout the session started in.

  **So a shell command's own paths are harvested too**, which is the fourth signal's trade taken
  one step further rather than a new one. A command line is not a path list, so it is read
  *loosely* — every absolute-path-shaped token, bounded by whitespace and shell punctuation. Two
  rules exist only because real transcripts contain them: a `/` after a word character starts
  nothing (`e2e/playwright.config.ts`, `sed -n 's/a/b/'`), and a token beginning `//` is a URL's
  authority (`:` has to be a start boundary for `PATH=/a:/b`, which makes `https://linear.app/…`
  look like two paths).

  **The looseness is why the signal became a list, and the two are one decision.** Replayed over
  the real transcript, "the last absolute path anywhere in the session" belonged to no checkout in
  31 of 42 candidates — `/dev/null`, `/usr/bin/env`, a scratch script — and to the main checkout
  in 4 more. A single stored value would have spent most of the hour naming something useless, and
  the panel would have snapped back to the project on every one of them. `sessions.touched_paths`
  keeps the last eight (migration 0010) and the resolution takes the most recent entry that lands
  in a **linked** checkout, which makes every other candidate free. Over that transcript it
  answers `pearl-eng-3333` from the first command that named it onwards.

  **0009's column is left in place, unread, and that is the interesting cost.** Dropping it was
  the plan — a stale column answering the same question as its replacement is how a later reader
  picks the wrong one — until the obvious consequence: migrations run on open, one data directory
  is shared by every build on the machine, and the installed release still selects
  `s.last_touched`. A drop turns running an older factorai after a newer one into "no such column"
  on the sessions list. Every migration before this one was additive and got the property for
  free; this is the first that had to choose.

  **The section in the spec used to be called "why there are only two".** It is now "the signals,
  and the shapes that keep defeating them", because that heading is the honest record: five shapes
  have reached a user, each defeating every signal that existed when it arrived, and every one of
  those signals was *correct* and about the wrong place. The question to ask the sixth is not "is
  this true" but "what is it evidence of".

- **The quit and restart confirms ask about work, not about processes — ADR-0020, spec
  `05-features.md` § "Quit guard" and F14** — 2026-08-21. Closing the window or restarting for an
  update used to stop and warn whenever *any* PTY was alive, so an app left open beside four
  finished sessions asked before every quit. It now asks only when Claude is actually working
  somewhere. F10 had already made this distinction for closing one session
  (`needsCloseConfirm`); these were the two gestures it did not cover, and they were still on
  `live_count()`.

  **Kill-on-quit is untouched** (ADR-0005): every live PTY still dies, asked about or not. That
  is the part with a trap in it — the dialog's confirm was the **only** caller of `kill_all()` on
  a window close, so skipping the dialog would have left those children to `Drop`, which Tauri's
  exit does not promise to run. The close handler now calls `kill_all()` itself on the silent
  branch, synchronously, because the 500ms SIGTERM grace has to elapse before the process goes.

  **The dialog counts what dies, not what is working.** One working session beside three idle ones
  is four processes ending, and `quitConfirmSentence` says four — "Claude is working in 1 of 4
  live sessions. Quitting terminates all 4". Building that sentence from the working count would
  have been the honest-sounding version of a lie. The `of N` clause is dropped when every live
  session is working, because "1 of 1" reads as a placeholder somebody forgot to finish.

  **One rule, two doors.** `lib/quitConfirm.ts` owns the predicate and the wording for both the
  quit guard and F14's restart badge. They are decided on opposite sides of the IPC boundary —
  Rust gates the window close, the renderer gates `relaunch()` — which is exactly the shape that
  let them drift before: the restart shipped with no confirmation at all until 2026-08-17.

  **Two things the real app taught that the tests could not.** Verified with `scripts/qa/`, and
  both branches needed a live `claude`:

  - **The working window is seconds wide, and that made the first two attempts read as a pass.**
    A resumed session writes its idle title about a second after spawn, so closing "right after
    clicking a session" hits the *silent* branch and looks like the feature working when nothing
    was ever working. Catching the dialog needs a real turn and the close in the **same shell
    invocation** — a `wmctrl -c` issued from a later tool call is already too late, because
    reading the screenshot in between is wall-clock the agent does not account for.
  - **`wmctrl -i -c $WID` is the right way to close it.** It sends `_NET_CLOSE_WINDOW`, which is
    what the titlebar `×` sends, so it exercises `CloseRequested` exactly — with no cursor
    anywhere near another application's window. `scripts/qa/README.md`'s warning about a stale
    origin sending a click into the user's Slack applies to every alternative.

  Known gap, inherited rather than introduced: a session parked on a permission prompt reads as
  `waiting_input` (Claude's title says idle while its own dialog is open), so quitting will not
  ask about it. Closing that needs F10's unbuilt `needs_permission` state, and it closes for all
  three gestures at once when it lands.

- **Worktrees as a first-class session citizen — spec `05-features.md` F21, ADR-0019, roadmap
  item 37** — 2026-08-21, shipped as **v0.19.0**. An agent that runs `git worktree add` used to
  leave factorai describing the wrong directory: tree, Changes, decorations and the graph's
  working row all keyed off one string. Now the panel follows it, the header names the checkout
  beside its branch, and a session the agent ran in a worktree appears under the project you
  actually added instead of becoming one you never asked for.

  **A worktree is a checkout of a project's repository, never a row in `projects`** (ADR-0019 §
  1). Sessions roll up by repository with ADR-0011's exact-path match tried first, so adding the
  worktree yourself — the workaround people had — keeps its sessions where they were. It is not
  the prefix scan ADR-0011 rejected: a checkout is neither ancestor nor descendant of the
  project, so this is membership in a set git enumerates.

  **The bridge's scope is the repository's checkouts plus the session's cwd**, re-derived from
  git per resolve (ADR-0019 § 2). The agent's `setWorktree` moves what the panel *shows* and
  cannot move what the bridge *allows*, which is what keeps the validator a UX check rather than
  a security boundary. This closed a live bug: an agent editing in a worktree could not open a
  single file, and the session showed F20's `Bridge` warning on every attempt.

  **Four things this cost that the design did not predict**, each found by using the app rather
  than by a test — which is the pattern worth carrying forward.

  - **The premise was wrong.** The whole design assumed the agent would say where it went. Three
    live runs, three worktrees created, **zero** `setWorktree` calls. Our end was fine — a
    hand-written MCP client over the real socket switched the panel on demand — the agent simply
    does not reach for the tool. What works is `sessions.last_cwd`: the agent `cd`s into the
    worktree and `claude` relocates its whole store directory, and reading the *last* recorded
    cwd catches that with no cooperation at all. The interview had rejected that signal on the
    grounds that "an agent working in a worktree by absolute path never changes claude's own
    cwd", which the first real session falsified.
  - **Reading the last cwd is only safe because resolution is containment.** A session's cwd
    follows every `cd` a shell command makes; one transcript churned through
    `apps/desktop/src-tauri` and once `node_modules/.pnpm/@xterm+xterm@5.5.0/…`. All of those are
    inside the main checkout and resolve to it. Compare the raw value to the project root instead
    and you mark every session whose agent moved around — which the sidebar mark did, for one
    commit, before it was removed entirely on user feedback.
  - **A foreign key to a derived table cost a write.** `session_worktrees` shipped referencing
    `sessions(id)`, and a brand-new session has no row there — that table is derived from
    transcripts. So the case the feature exists for, an agent creating a worktree early, failed
    the insert while the event fired anyway. Migration 0007 dropped the constraint; cleanup moved
    to `reap_deleted`, which already exempts live sessions. 0006's own comment had argued for
    exactly this, which is what made the FK an inconsistency rather than a trade-off.
  - **Correct data with a stale list looks identical to a broken feature.** The index carried the
    new checkout 11 seconds after the agent moved, and the panel sat on main until a 30s
    `gitWorktrees` poll came round. `sessions:changed` now invalidates that list — it fires for
    precisely the change that matters — and the re-measured lag is one second.

  Two remainders stayed open and are item 37's: the graph's per-checkout `HEAD` chips
  (cosmetic), and watching whether `setWorktree` is ever called by a real agent. The worktree
  picker was deferred here and shipped three days later — see below.

- **F21's fourth signal and the human's picker — spec `05-features.md` F21, roadmap item 37** —
  2026-08-24, shipped as **v0.21.0**, on a user's screenshot of factorai naming the wrong branch while their agent worked
  in a worktree it had just created. All three signals had fired correctly and all three pointed
  at the wrong tree.

  **The shape.** The agent ran `git worktree add -b … ../pearl-eng-3834`, then drove that
  checkout entirely through `git -C ../pearl-eng-3834 …` and absolute paths. Its own cwd never
  moved, so 0008's `last_cwd` — the fix for the *previous* failure, where the agent `cd`'d —
  kept naming the checkout the session started in. It called no `setWorktree`, and it reads and
  writes files through its own tools rather than the bridge, so no `openFile` arrived either.
  Nothing was broken. The data was right and simply was not about where the work was.

  **So the transcript's `tool_use` paths are read after all** — the signal F21 explicitly
  rejected, for a reason that is still true: it means parsing another program's internal tool
  schema. The cost is paid rather than argued away — every step of the parse may find nothing, an
  unrecognised shape yields no path rather than an error, and if the schema moves this stops
  contributing while the two cwds carry the feature exactly as before. What tipped it is that the
  alternative is a panel confidently describing the wrong directory, which is the failure the
  whole feature exists to prevent.

  Two asymmetries make it safe, and both are load-bearing. It is read **ahead of** the cwds,
  because the case it exists for is one where they are correct and useless — read them first and
  this step never runs where it was needed. And it is believed **only when it names a linked
  checkout**, because an agent working in a worktree reads the main checkout all day (a shared
  config, a sibling package, the spec it works from), and counting that would flicker the panel
  on every tool call.

  **The picker shipped in the same pass**, and the deferral was right: v0 existed to find out
  whether agent-driven following works, and it does — but an agent can work in two checkouts at
  once, and no inference can rank them. The header's checkout mark became the trigger of a menu
  listing every checkout, the revert moved inside it so the header carries one control rather
  than two, and the mark's gate moved from "the checkout is not the project's own" to "the
  repository has more than one checkout". A pick writes the same `session_worktrees` row a signal
  writes and is marked `pinned` in the renderer, which is what stops the next `openFile` dragging
  the panel back out of the checkout a human just asked for.

  **Three things worth carrying forward.**

  - **A derived column needs a version stamp, not a cleverer `IS NULL`.** 0008 backfilled itself
    with `cwd IS NOT NULL AND last_cwd IS NULL`, which worked and does not generalise: the same
    shape for `last_touched` never converges, because a session that called no tools legitimately
    has nothing to find and would reparse on every scan for ever. `sessions.parse_version` is the
    general form — bump the constant, every row reparses exactly once.
  - **Comparing paths means comparing resolved paths.** `git_worktrees` has always
    canonicalized; the session's side had not. An absolute path with a `..` in it, or a shell's
    logical cwd through a symlink, matches no checkout and the panel sits silently on the
    project. `list_sessions` now resolves on the way out — and deliberately not on the way in,
    since `resume_cwd` probes `encode_path(cwd)` for a transcript claude stored under the path it
    was *given*.
  - **The user was looking at a header, not a panel.** The bug arrived as "it has not detected
    the worktree", from a branch name in the session header. Whatever else moves, that string is
    what a supervising human reads to know which tree they are being shown.

  **Two follow-ups shipped as v0.21.1**, both from the same user looking at the menu on a real
  repository rather than at a fixture.

  - **A row is a name, and a subtitle only when there is a second fact.** The row printed the
    checkout's name beside its branch, which in any repository that names a worktree after its
    branch is one fact printed twice — both halves truncated to the prefix they share, and one
    overflowed the menu instead of ellipsing inside it (`truncate` on a flex child does nothing
    without a `min-w-0` chain). Now 384px, the branch as a subtitle only when the name does not
    already carry it, no `main` chip (git's main checkout is the first row, and beside a branch
    called `main` the word stuttered), and name/branch/path on hover.
  - **A checkout on no branch names its commit.** The badge was absent for a detached `HEAD`,
    which is right for a folder that is not a repository and wrong beside a checkout mark that is
    present: the gap read as "nothing to say" rather than "no branch". Short SHA behind a commit
    icon, because a detached HEAD is a position in history rather than a name for one.

- **Settings — spec `05-features.md` F11, Q24, ADR-0013, roadmap item 4** — 2026-08-20. The
  app's first place to put a preference. `?settings=claude|editor|confirmations|sessions` on the
  root route drives a medium modal with the nav in a left column, an explicit Save, and a gear in
  `TopBar`. Four sections: the Claude binary and its override, the diff-mode default, the two
  close-confirm switches (roadmap item 22, which folded into this) and F16's restore-tabs switch.

  **The problem it solved was not "the app needs settings".** Three features in a row had arrived
  needing somewhere to put a preference and found nowhere — the close-confirm toggles, item 31's
  release channel, and a diff mode parked in `panelStore` with a comment apologising for it. Two of
  those are now rows; the third is a row and a match arm when somebody wants it.

  **Preferences live in three places and "who reads this?" decides** (ADR-0013). Layout you dragged
  stays in `panelStore`/`sidebarStore`/`zoomStore`; preferences the renderer alone reads go in the
  new `prefsStore`; anything **Rust** reads goes in the SQLite `settings` table through
  `get_setting`/`set_setting`, keyed by a mirrored `SettingKey` union. `tauri-plugin-store` — a
  dependency in both manifests, registered in `lib.rs`, with no caller on either side since M0 —
  is removed rather than finally used: it is async, so every persisted value would have flashed its
  default for a frame.

  **Five things worth keeping.**

  - **`check_cli` calling the finder directly is how a settings page lies.** The override had to be
    a parameter on `find_claude_binary`, not a field on `TerminalManager`, or the page would have
    reported "not installed" for a binary sessions were spawning from perfectly well. It reaches
    the spawn through a callback read *per spawn* — which is also what makes "running sessions are
    unaffected" true without anything having to invalidate a cache.
  - **`installed` means the binary resolved, not that `--version` answered.** A wrapper script or a
    hanging `--version` is a real state, and letting a version probe veto a working binary is the
    same class of mistake as ignoring the override. The row says "Found, but it reported no
    version" and Save stays enabled.
  - **Validating on blur is where the feedback is, not where the guarantee is.** Typing a path and
    clicking Save straight after would have written something never probed, so Save re-checks an
    unknown path itself and fails with the reason. A path already known bad greys the button out.
  - **The `diffInline` handover needed its own module, and this is the interesting bug.** Both
    stores are `zustand/persist` on localStorage and both hydrate at import time, and `panelStore`'s
    v3 migration rewrites `factorai.panel` without the key — so a snapshot taken lazily inside
    `prefsStore` would read the old value *or* read nothing depending on which file Vite loaded
    first. `store/diffInlineHandover.ts` is imported by both, which is what makes the read
    provably precede either write. Thirty lines for one boolean, because silently resetting
    somebody's choice is not the kind of small that is fine.
  - **The restore switch is honoured at hydration, not at quit.** Dropping the persisted tabs on
    the way in means the switch describes *launch* and nothing has to be remembered when the window
    closes. It defaults **on**, and that default is settled by history rather than taste: restore
    shipped unconditionally in F16 because this surface did not exist yet.

  **The stale plan this deleted.** `03-backend-rust.md` described caching the resolved binary and
  version back into `settings` as `claude.binary`/`claude.version`/`claude.resolved`. It was never
  built and now must not be: `claude.binary` holds the *user's override*, and a cache sharing that
  key could not tell a probe's guess from somebody's choice.

  Verified in the real window as well as in Playwright — the detected row read
  `/home/nightbringer/.local/bin/claude · 2.1.237`, a bad override showed its error and disabled
  Save, a good one round-tripped through the `settings` table, and clearing the field deleted the
  row. Click-outside was checked both ways: it dismisses a clean modal and does nothing to a dirty
  one.

- **PDF preview in the file viewer — spec `05-features.md` F7, ADR-0018** — 2026-08-19, user ask,
  scoped in a clarify-needs interview. A `.pdf` used to reach `read_file`, hit a null byte in the
  first 8KB and dead-end on "Cannot preview binary file" — the app handing the document to another
  app. It now renders: continuous scroll, selectable text, zoom from 100%, and a password prompt
  for an encrypted one.

  **The cheap version works on exactly one of our two platforms.** WKWebView has Apple's PDF
  viewer built in; WebKitGTK has none. So an `<iframe>` fed the bytes renders on macOS and shows a
  blank pane on Linux — F16's HTML5 drag-and-drop bug with the platforms swapped, and shipped for
  the same reason it was: QA happens on one machine. pdf.js is bundled instead, and ADR-0018 closes
  the `<iframe>` route explicitly so a future WebKitGTK doesn't quietly reopen it.

  **pdf.js needs four asset sets on disk, not the two the plan assumed.** `standard_fonts/` and
  `cmaps/` were expected; `wasm/` (JBIG2 and JPEG2000 decoders, plus qcms) and `iccs/` were found
  by reading the package. That matters because a scanned PDF — the case the 32MB cap exists for —
  is usually JBIG2 or JPX inside, and this webview has no network for any of it to come from.
  `vite/pdfjsAssets.ts` stages all four into `public/pdfjs/` at startup, version-stamped so it is
  free after the first run and self-correcting on an upgrade, and gitignored because 4MB of
  node_modules belongs in the build rather than the history.

  **Three findings worth keeping.**

  - **`GlobalWorkerOptions.workerPort` cannot serve two documents.** It is one `Worker` and pdf.js
    takes ownership: destroying a loading task terminates it, and the next document fails with
    "PDFWorker.create - the worker is being destroyed". React's development double-effect makes it
    fire immediately — open, destroy, open — so nothing rendered at all. `?worker&url` plus
    `workerSrc` keeps the worker bundled *and* gives each document its own.
  - **A ref read during render is not a measurement.** The view opened fit-width first, and the
    fit scale came from `stageRef.current?.clientWidth` — null on the render that mounts the stage,
    so every document silently opened at 100% instead. Caught by the zoom smoke test, which reset
    to fit and got a different number than it opened with. Measuring it properly needed
    `ResizeObserver` state, because the stage also reads **zero while the modal is still animating
    open** — the trap Monaco's `automaticLayout` note describes. **All of it then came out**: the
    user's call is that a PDF opens at 100%, since a pane-derived scale reads differently in every
    pane. Worth keeping anyway — the next thing in this app that measures a pane inside the modal
    meets both halves of this.
  - **`pdf_viewer.css` is 6347 lines of Firefox's viewer.** Importing it to get the 145-line
    `.textLayer` block would drop `:root` blocks, XFA widgets and `button` rules into this app's
    cascade. So the block is copied into `pdfTextLayer.css` — and then formatted by biome like every
    other CSS file here, the same call the vendored shadcn primitives got, which is why the drift
    test compares rules with the whitespace dropped rather than byte for byte.

  Verified against real pdf.js rather than a mock: the smoke fixtures are a genuine two-page
  document and a genuine RC4-encrypted one (password `letmein`), so the worker, the asset paths and
  the decryption path are all exercised by `pnpm e2e`. `vite:build` confirms the other half — the
  hashed worker chunk and the `/pdfjs/*` URLs land in `PdfView`'s own chunk, 428KB of it, separate
  from the viewer's and never fetched until a PDF is opened.

  Deferred, in `TODO.md` § 21: a find bar (waiting on item 13 to settle the find-bar shape),
  go-to-page, an outline sidebar, and rendered PDF diffing — a changed `.pdf` in the Changes tab
  still dead-ends on the binary card.

- **Clickable file links in terminal output — roadmap item 15, spec `05-features.md` F19** —
  2026-08-19, user ask, scoped in a clarify-needs interview. Ctrl/Cmd-click a path the agent
  printed and it opens in the viewer, at the line if the path carried one; a directory reveals
  itself in the tree instead. Same modifier gate as the other two kinds of link, and the
  destination is the correction item 15 existed to make — a file the agent touched belongs in F7's
  viewer, not in whatever the OS says owns `.ts`.

  **The fork item 15 left open is settled, from the CLI binary rather than by inference.** Its only
  OSC 8 emitter is the `link(url)` helper F5 already quotes, and it is used for URLs; nothing marks
  up a path. Grepping 2.1.235 for `file://` finds ripgrep's `--hyperlink-format` templates vendored
  inside it, which is a convincing false positive and not us. So the link provider is load-bearing
  and OSC 8 contributes nothing here. The cost the entry feared — "a regex over every frame of a
  busy TUI" — does not exist either: xterm calls `provideLinks` for the hovered line, on mouse
  move.

  **Three findings worth keeping.**

  - **xterm's link-provider ordering is silent and load-bearing.**
    `Linkifier._checkLinkProviderResult` shows provider N's links only once every earlier provider
    has replied with something *falsy*, and `WebLinksAddon` always replies with an array — `[]`
    when it found no URLs, which is truthy. So anything registered after it can never produce a
    visible link: no error, the text simply doesn't underline, and the click falls through to the
    TUI's mouse reporting. Found by doing exactly that. Ours is registered ahead of the addon,
    which is safe in both directions because it excludes URL spans before tokenising and replies
    `undefined` rather than `[]` — a contract now pinned by a test that says so.
  - **Radix does not hand focus back to xterm.** Measured, not assumed: after Esc closed the
    viewer, an `x` never reached the prompt. The terminal now refocuses on close, deferred a tick
    because Radix restores focus during its own unmount, and only when the viewer was opened from
    *that* terminal.
  - **A string offset is not a cell offset.** A wide character is one character of
    `translateToString` and two cells of buffer, so the underline drifts left by one cell per wide
    character before the path — invisible in a Latin-only test. `cellAt` walks cells; a fake buffer
    models exactly that case.

  Verification was generous about what looks like a path and strict about what exists:
  `path_kinds` answers file / directory / missing for a batch, once per hovered line, cached with
  positives kept forever and negatives expiring after 10s — a file the agent just wrote must not be
  unclickable for the rest of the session. `Makefile` is not a link, deliberately: a grammar that
  accepts a bare word links the sentence "run the test" to a `test/` directory.

- **IDE bridge, read-only half — roadmap item 19, spec `05-features.md` F20, ADR-0017** —
  2026-08-19, shipped in v0.16.0. factorai presents itself to the `claude` CLI as its editor: the
  agent connects over a per-session socket and can ask for a file, which opens in the viewer at the
  line it named. That is the *push* half of `00-overview.md`'s operating model — the agent asks and
  the human decides in place — and it is the first thing the app does that isn't the human going to
  look.

  The protocol was read out of CLI 2.1.235 rather than inferred: `~/.claude/ide/<port>.lock` with
  the port in the *filename*, a WebSocket carrying `X-Claude-Code-Ide-Authorization`, and
  `CLAUDE_CODE_SSE_PORT` selecting among lockfiles rather than adding a search path. ADR-0017 holds
  the decisions, including the narrow amendment to ADR-0004 that writing that one lockfile needs.
  Three tools — `openFile`, `getWorkspaceFolders`, `getOpenEditors` — and `getDiagnostics`
  deliberately absent, because with no diagnostics source a tool that always answers "no problems"
  is a false one the agent acts on. Nothing writes, so ADR-0009 is untouched.

  **The conformance pass paid for itself on its first run, which is the whole argument for having
  one.** Everything was green — ten socket tests against a real client and a real handshake — and
  the real `claude` found the lockfile, probed the port, connected, completed the handshake and
  **reset with nothing sent**. One header: the CLI builds its socket as
  `new WebSocket(url, { protocols: ["mcp"] })`, and a client offered no subprotocol in return is
  entitled to treat the connection as unusable. No test caught it because our own test client never
  asked for one. That is the gap only a run against the shipped binary can close, and it is why
  ADR-0017 asks for the pass by name.

  **Two indicators were built and both were wrong, on user feedback.** A tab mark for "the agent
  wants you in that session" used `--primary`, which is `--color-status-waiting`'s *exact* value —
  so it was indistinguishable from "waiting for input", on a tab already carrying a status badge. A
  blue "connected" dot replaced it in the header and was wrong for a better reason: a badge for the
  healthy case is a label that is always on, and that is a label you stop reading. What shipped is
  the inverse — nothing while it works, a badge with the reason when the bridge is broken, because
  an agent that *cannot* open a file looks exactly like one that chose not to.

  Still open, in item 19: the write path (`openDiff`, its own ADR), a threshold for reporting a
  client that never attaches, and where an `openFile` for a background session should land.

- **A README about the product, a lockup to put at the top of it, and the licence that badge
  needed — part of roadmap item 18, specs `09-branding.md` §§ B4 / B5 / B5a** — 2026-08-19, user
  ask, scoped in a clarify-needs interview. The README was organised around how the app is built;
  it is now organised around what it does — three verb-led pillars (run / find / inspect), four
  screenshots that match today's build rather than 2026-08-14's, and an alpha warning at the top
  instead of a Status section two screens down. Install collapsed to six lines with the Gatekeeper
  and glibc snags folded into a `<details>`; the dev commands moved to a new `CONTRIBUTING.md`
  that routes to `AGENTS.md` rather than restating it. `LICENSE` is MIT — a public repo without
  one is all rights reserved, which is not what a Releases page means to say.

  **`docs/brand/factorai-lockup.svg` is the new asset** and B5a specifies it. It is the header
  lockup from B8 drawn to a file, at the app's own proportions so the two cannot drift, in the
  amber-dominant colourway B5 had drawn and rejected — rejected *as the icon default*, on the
  grounds that it fights the UI beside it, which an asset that never appears in the UI does not
  do. The default colourway is unusable here anyway: its housing is the ground colour, so it would
  leave a floating F. The wordmark is Inter SemiBold outlined to paths, because GitHub has no
  Inter and a live `<text>` element renders in whatever the reader's browser substitutes.

  **Two things found while doing it, both fixed.** First, B4 claimed the brand "adopted the colour
  that was there" and it was **false**: the mark is `#FFB020`, `--primary` was `oklch(78% 0.17 75)`
  = `#F5A400`, three percent apart and sitting side by side in the header since the brand row
  landed. Nothing compared them until the lockup had to pick one. The app moved to the brand value
  (`oklch(81.3% 0.165 75)`, which round-trips exactly), not the reverse, because the mark is what
  ships in other people's docks; `--color-status-waiting` moved with the accent, and the light
  theme keeps its darker step since `#FFB020` on a 98% ground fails contrast — item 32's problem.

  Second, **`scripts/qa/geometry.sh` has the same frame-offset bug `click.sh` does** and its
  README does not say so. It reports the `wmctrl -lG` origin, which here is (+47, +73) off the
  client area; cropping a screenshot to it slices into whatever sits behind the window, which on
  this desktop is the *release* factorai. Captures for this work used `xwininfo -id <wid>`
  instead. Filed in [`08-inconsistencies.md`](../08-inconsistencies.md) rather than fixed, since
  the fix has callers.

- **Open session tabs come back on launch, and a tab is now an open session — specs
  `05-features.md` §§ F16 / F11, `04-frontend.md`, `07-open-questions.md` Q24** — 2026-08-18, from
  the user ask of 2026-08-17 and the clarify-needs interview roadmap item 33 was gated on.

  **F16's invariant was the first question and it bent.** "A tab is a running PTY, not an open
  document" became **"a tab is an open session; the dot says whether it is running; a tab goes when
  you close it, and only then."** The strip is driven off a persisted `tabs` list now, so a tab
  survives its process exiting and survives a quit — which is what makes restoring it mean
  anything. ADR-0005 is untouched: every PTY still dies at quit, and nothing is brought back
  running.

  **The app already disagreed with itself here**, which is what made the reversal easy to argue.
  The session route deliberately does *not* navigate away when a process exits — so you could sit
  reading `[process exited]` with `Restart` under your hand while the strip had already deleted
  that session's tab. One rule fixes both surfaces, and F10's `stopped` dot, wired since 2026-08-18
  and never once drawn in a tab because a stopped tab could not exist, is what carries the
  difference. No dimming and no second treatment: at 14px that says the same thing twice.

  **Respawn-at-launch was rejected, and item 33's stated reason for rejecting it was wrong.** That
  entry called N resumed sessions "real money". They are not: `claude --resume` loads its transcript
  and sits at a prompt, spending nothing. What actually rules it out is N processes, N sets of MCP
  servers and N runs of claude's own `SessionStart` hooks — which match `resume` — all executing
  before you have looked at the window. Restored tabs are inert; **the first thing that starts a
  process is your click**, and clicking a stopped tab restarts it, including the one you are already
  on, where a `navigate` to the route you are standing on remounts nothing.

  **The near-miss worth recording: `bySession` does not change meaning.** Nine surfaces read it as
  "is this running", and TypeScript would have caught almost none of them if the meaning had shifted
  underneath — the dangerous ones read `.status`, `Object.keys()` or `id in bySession`, none of which
  a nullable field breaks. So the persisted list is a *second* field in the same store, which is what
  `order` already was, and the surfaces that genuinely wanted "open" moved to a derived
  `openSessions` record instead: sidebar project rows, sidebar session rows, the project page's list,
  and the ordering that floats what you have open above recency. `pendingSessions`, `UpdateBadge`'s
  count and the session header's Close-versus-Restart deliberately stayed on `bySession`.

  That reverses one line of `projectStatus`'s reasoning — "a grey dot on every project you have ever
  opened is noise" — and narrowly: the dot is not shown for every project you have opened, but for
  every project you have a tab open in, which is a set you control with the `×`.

  **Two things were found on the way, both older than this feature.**

  - **`terminal_list` had no caller in the renderer at all**, while `terminalStore` *and*
    `ErrorBoundary` both carried comments describing a reload re-syncing from it. So the crash
    screen's "reloading keeps your sessions alive" was half true — the processes survived in Rust
    state and every tab vanished, leaving running agents reachable only through the sidebar. Fixed
    first, as its own commit, because it is correct under the *old* invariant too and needs the same
    merge restore needs.
  - **F16 claimed closing "always asks"**, stale since F10 gave the strip a status to consult. The
    code has asked only while Claude is working for some time.

  **The switch the ask began with is not here, deliberately.** F11 is specified and unbuilt, so the
  preference has nowhere to live that is not half of item 4. Restore ships on, unconditionally, and
  F11 gained a fourth **Sessions** section holding the switch — defaulting on, so it changes nothing
  when it arrives. It is a checkbox in item 4 rather than a memory.

  **Verified in the running app**, which is the only place the interesting half shows: five tabs
  persisted from a previous run came back grey with **zero** spawns in the log, the sidebar marked
  them at both levels, and the first `claude --resume` appeared only when a tab was clicked. The
  smoke test asserts the same shape against a seeded `factorai.terminals`; the staleness filter, the
  reducers and `openSessions` are vitest.

- **The update badge fits the footer, a day after the spec said it did — specs `05-features.md`
  § F14** — 2026-08-18, user report, on the first release where anyone could see the badge at all.

  **The fix existed only in prose.** F14 has said since 2026-08-17 that the label was shortened to
  `⟳ Update ready` with the version in the tooltip, because the long form —
  `⟳ v0.2.0 ready · Restart` — sets a min-content width the footer does not have and clips its
  neighbour instead of degrading. `UpdateBadge.tsx` was last touched 2026-08-14. Nobody caught it
  because the badge only renders when an update is **staged**: the app has to have downloaded a
  newer version than the one you are running, which on a machine that ships several releases a day
  is a state you pass through rarely and never on purpose. The first render was a user's, on
  v0.13.1, and it was clipped mid-word — 174px of badge against a cell ending at 157.

  Three mechanisms now, in the order the space runs out: the short label with the version in the
  tooltip; `inline-flex` + `max-w-full` + `truncate`, so the badge hugs its content and can never
  exceed its cell; and below ~120px of cell — the 180px sidebar floor — a container query that hides
  the label entirely, leaving the mark. That last one is not polish: truncation alone yields a pill
  reading `Upd…`, which is a broken word rather than a degradation.

  **The test is the part worth keeping**, since this bug's whole biography is "nothing ran the code
  path". `update-badge.spec.ts` now drives the reported case — sidebar squeezed to its floor, zoom
  at 120% — and asserts the badge's right edge against the zoom controls' left, because a clipped
  element still reports a bounding box and only the neighbour relationship catches it. Verified by
  restoring the old markup: 174 against 157, caught.

- **Tab reordering works on macOS: dnd-kit, because the OS drag session is not ours to use — specs
  `05-features.md` § F16, `01-architecture.md`, ADR-0016, `AGENTS.md` § 4** — 2026-08-18, user
  report: "on macOS tabs reordering is not working. Maybe it is time to use a well-known drag&drop
  working lib?"

  **The premise needed one correction and the diagnosis needed none.** It was never our arithmetic:
  `dragstart` fires, the tab dims, and nothing follows, because
  `tauri-runtime-wry-2.11.2/src/lib.rs:4894` returns `true` from Tauri's drag-drop handler for
  every drag session on the window, and `wry-0.55.1/src/wkwebview/drag_drop.rs` only lets WKWebView
  see a drag when that handler returns `false`. The page therefore never receives `dragover`. Linux
  works by accident of a different implementation — `webkitgtk/drag_drop.rs:94` returns `false` from
  `drag_motion` and only claims drags carrying file paths — and `scripts/qa` is X11-only, which is
  the whole story of how a reorder shipped working on one of our two platforms. The correction: a
  "well-known lib" only fixes this if it is **pointer**-based. `react-dnd`'s `HTML5Backend` would
  have failed identically.

  **Three ways out, and the user picked the library.** `"dragDropEnabled": false` on the window is a
  verified one-line fix — with no handler installed wry passes every callback through — but it
  spends a window-level capability on one strip: no native file-drop ever, and a landmine for
  whoever adds it later, on macOS only, silently, with nothing in CI able to see either half. A
  hand-rolled pointer drag was the other option. dnd-kit won on the argument that a second
  reordering surface is already specified (roadmap item 28, pinned projects), so the dependency is
  paid for twice, and that a drag needs a keyboard path we would otherwise hand-write too.

  **What the library changed on purpose.** The dragged tab is now the element itself rather than a
  cloned drag image — the clone existed only because the browser snapshots the source *after*
  `dragstart`, so the in-flight dimming landed on the image. The order commits on drop, with the
  neighbours sliding under a transform during the gesture, where before every `dragover` rewrote the
  list. That last change deletes `dropIndex` and its unit tests: `closestCenter` plus
  `horizontalListSortingStrategy` own the midpoint rule now. Auto-scroll came free, and the strip
  overflows, so dragging to its edge scrolls it — which the old code could not do at all.

  **Three details are load-bearing and are in the ADR rather than in anyone's head.** A 4px
  activation distance, because dnd-kit suppresses the click after an activated drag and without the
  threshold clicking a tab would stop switching session. `PointerSensor` only: dnd-kit's
  `KeyboardSensor` lifts with the space bar, and space on a `role="tab"` means activate — so the
  keyboard path is `Alt`+arrows, one place per press, with `aria-keyshortcuts` to say so. And the
  library's `attributes` are deliberately not spread onto the tab, since they would overwrite
  `role="tab"` with `role="button"` and point `aria-describedby` at instructions that are not true
  here.

  The e2e tests moved from `dragTo` (which dispatches HTML5 events nothing listens for now) to a
  real pointer drag, plus one for the mid-drag preview and one for the keyboard nudge. Worth being
  plain about the limit: those run in Chromium, so they can prove the gesture works and cannot prove
  it works in WKWebView — that is exactly the gap this bug lived in. `01-architecture.md`'s stack
  table also stopped claiming codemirror and marked, which ADR-0007 had superseded.

  **One bug, reported within the hour of shipping it: the tab zoomed while you dragged it.** dnd-kit
  hands the active item a transform whose `scaleX` is `over.rect.width / activeNodeRect.width`
  (`core.esm.js:2997`) — for a `DragOverlay` that morphs into the target's box, which we do not use —
  so a tab sized by its title grew or shrank to whatever it was passing over. `CSS.Translate` instead
  of `CSS.Transform` is the whole fix. **The tests could have caught it and didn't**, which is the
  part worth keeping: the mid-drag test asserted the *neighbour* slid and said nothing about the
  element in flight. It now asserts the dragged tab's own width is unchanged, against a fixture with
  one deliberately capped-width title — with equal widths the ratio is 1 and the regression is
  invisible. Verified by reverting: 110px of distortion.

- **One hover card at a time, chips that stay inside their box, the graph's empty line on the other
  tabs' pixel, and 28px menu rows — specs `05-features.md` § F18, `04-frontend.md`, `AGENTS.md`
  § 4** — 2026-08-18, user ask, three reports in one pass over the graph.

  **"Commits that persist if you hover them while moving the mouse fast" were five cards at once.**
  Every row is its own Radix `HoverCard` root and roots know nothing of each other, so removing the
  open delay earlier the same day meant crossing five rows opened five cards, each sitting out its
  own 150ms close delay stacked over the session pane — five entrance animations at five different
  offsets, which is the whole of the "weird hover effect". F18 and `CommitRow` both *claimed* Radix
  kept one card open at a time and swapped its content between triggers; it does not, and nothing
  had checked. `GraphView` holds the carded sha for the list now, so opening one closes the last,
  with the close **guarded on the sha** because the row you left reports closed a delay after the row
  you arrived at reports open. Rows are `memo`'d with sha-taking callbacks to pay for it — a
  list-wide open state otherwise re-renders 300 rows per row crossed.

  **The overflowing chip was two overflows with one cause: an unbounded flex item.** In the card, a
  56-character branch name printed straight through the border and across the graph beside it —
  `flex-wrap` wraps items, it does not shrink one that is wider than its container. On the row, the
  cap lifted on the chip's own hover, which was supposed to make a truncated name readable in place;
  at 288px it cannot be, so it grew past the panel edge and took the subject off the row on the way,
  under the pointer, as you swept. The row keeps its cap now, the card bounds its chips with
  `max-w-full` and **wraps** their labels, and un-truncating is one job in one place.

  **The empty line's 4px.** Files and Changes render inside a `py-1` scroll wrapper in
  `FileTreePanel`; the graph renders outside it, because it owns its scrolling and docks a detail
  pane. So `Not a git repository.` — the same sentence, one click apart — sat 4px higher on one tab
  than the other two. The three identical private `Empty` helpers are one `PanelEmpty` in
  `components/layout`, and the graph repeats the wrapper's padding explicitly. The test asserts the
  two `y` values are equal, which is the only form of that assertion nobody has to re-eyeball.

  **The menu was tightened in the primitive, not at the call site.** shadcn's `py-1.5` items,
  `pl-8` indicator gutter and `text-sm font-semibold` label are proportions for a 16px-body web app
  and read as a chunkier application beside this one's 26px rows: 32px rows became 28px, the gutter
  28px, and the label the same quiet uppercase `text-xs` as `PROJECTS` above it. It landed on
  `DropdownMenu` *and* `ContextMenu` in `@factorai/ui` — the sidebar's sort menu was the one
  reported, and a menu that is 28px in one corner and 32px in another is worse than either. Item
  text stayed `text-sm`: 14px is the floor for anything you read to navigate, so shrinking a menu
  means its padding. Now a house rule in `AGENTS.md` § 4.

  Two tests, both verified by reverting the fix and watching them fail: 5 cards where ≤1 is allowed,
  a 394px chip in a 288px card, and 78px against 82px for the empty line.

- **Session status: working, waiting, stopped, read out of Claude's terminal title — specs
  `05-features.md` § F10 + § F16, `03-backend-rust.md`, ADR-0015, `scripts/qa/README.md`** —
  2026-08-18, user ask (roadmap item 34), interviewed, specified and built the same day.

  The green dot only ever meant "the PTY is alive". `TerminalStatus` had carried four variants since
  M2 and **two of them were never assigned anywhere in the crate**; the spec described status
  heuristics on a 200ms tick that did not exist. So the state everyone assumed was there had no
  source, and choosing one was the whole job.

  **The mechanism came from reading prior art and then verifying it, and verifying overturned
  it.** The documented approach matches braille spinner frames in the `OSC 0` title, and
  Claude Code 2.1.234 contains no braille codepoint at all — so that check is dead. Booting the
  CLI in a PTY and capturing raw bytes found what does work: the title carries the state in its
  first character, `✳` when idle and an animating `◐ ◑` while working. It needs no configuration, no
  settings file, no env changes and no hooks.

  **Corrected later the same day, after a second read of their code.** The first version of this
  entry, of F10 and of ADR-0015 all said their busy state was therefore dead. It is not — `OSC 9;4`
  progress is their other source and it works, so the braille check is redundant rather than
  load-bearing. The correction makes the argument stronger rather than weaker: a glyph list went
  stale and *nothing reported it*, because a second source covered for it. We chose to have one
  source, so it has to be the one that cannot go stale.

  **So the rule enumerates the *idle* marker and treats everything else as working**, which is the
  half that survives version drift — any spinner glyph the CLI adopts later still reads correctly,
  and an enumerated spinner list is exactly the thing that goes stale without anyone noticing. An
  unrecognised title holds the previous state, so the worst a future Claude can do is stop this
  improving the dot; it cannot make the dot lie.

  Four mechanisms were rejected with evidence, and F10 records each so nobody investigates them
  twice: `OSC 9;4` progress (real, brackets a turn exactly, but only when the CLI thinks it is
  talking to iTerm2 — so it costs a `TERM_PROGRAM` lie to learn what the title says plainly),
  `OSC 777` notifications (verified working, buys `needs_permission` for a settings file plus 6s of
  latency), hooks, and transcript tailing. Plus `OSC 21337 TAB_STATUS` — a *structured* protocol
  already in the binary, `indicator=…;status=Working…`, gated behind a function compiled to
  `return !1`. That is the upgrade to take when it ships, and the reason to supersede ADR-0015.

  **Two bugs the tests found, both worth keeping.** The scanner has to be stateful because an 8KB
  read lands wherever it lands, and the split test failed on its first run: a chunk ending exactly
  on `ESC ]` was judged "not a sequence" and its carry thrown away, losing the title that completed
  on the next read. Running out of input and seeing a non-digit are different answers. Separately,
  the QA probe's trust-prompt answer sat inside its read branch, so a probe parked on that prompt
  never answered it and reported the title missing — a false negative *about the CLI*, which is the
  worst thing a check like that can do.

  **A screenshot changed a decision.** Project rows aggregate their sessions, and this shipped with
  `working` ranked first on the reasoning that a project with anything running is busy. Rendered, a
  project holding one working and one waiting session read as plain green — so four blocked sessions
  and one busy one would hide all four. Flipped to attention-first: a working session resolves
  itself, a waiting one never does.

  Also here because this is where it was found: `child_env` now strips
  **`CLAUDE_CODE_CHILD_SESSION`**. A `claude` inheriting it saves **no transcript**, which would
  take out the index, search and `session_flag`'s probe — and it sits outside the `$APPDIR` gate,
  because a `.app` on macOS is where it turned up. And the title carries Claude's own derived
  session name (`✳ Date command`), so live tab titles are now free for the taking.

  What it leaves: the **unread / never-opened axis**, deferred by choice, and **item 35** (desktop
  notifications) which is held behind item 4 on the user's own condition — the notification gets a
  switch before it gets a voice. `needs_permission` was dropped by choice too, and F10 keeps the
  verified recipe for reinstating it.

- **The graph's rows are indented like every other row, and the author disc is dark — specs
  `05-features.md` § F18** — 2026-08-18, user ask, the third pass on the same screenshot.

  **The indent.** `laneInset` reserves exactly enough rail for the outermost disc to be drawn
  *whole*, and "whole" is not "with air around it": lane 0's avatar sat with its left edge on x=0,
  against the panel border, while Files indents 6px and Changes 12px. `ROW_PAD_LEFT` is 12 — the
  number Changes and the graph's own `Empty` / Load-more already agreed on — and the scroller gained
  the `py-1` the other two tabs share, so switching tabs no longer shifts the first row by 4px.

  It is a constant applied as an inline style, not a `pl-3` class, because `fitRefs` has to subtract
  it from the text budget: a class would leave the indent and the budget free to drift, and the
  symptom of that drift is chips that fit on paper and truncate on screen. `WorkingRow` takes the
  same inset — it sits directly above HEAD's row, so 12px of disagreement between them reads as the
  rail bending.

  **The disc, tuned twice in one conversation.** `oklch(62% 0.14 h)` → `oklch(80% 0.07 h)` →
  `oklch(45% 0.09 h)`. The first was too saturated, the second traded loud for *bright* — a
  near-white disc is the lightest thing in the panel, so it still won the row it was supposed to sit
  quietly in. The third is dark enough to sit under the lane ring around it and still tinted enough
  that twelve hues are tellable apart. Four candidates were rendered rather than argued about, and
  `32%` was rejected from the render: the disc dissolves into the background and only the ring and
  the initials read, which costs the one thing the avatar exists for.

  **The ink flipped, which is the part worth keeping.** It was darker than the fill while the disc
  was pastel and is near-white now the disc is dark — both correct, and neither derivable from the
  other without knowing the fill. That is why `avatarInk` lives in the same file as `avatarColour`
  rather than at the call sites, and why the test asserts the **absolute** 50-point lightness gap: a
  signed assertion would need rewriting on every retune, which is the same trap as pinning the ink
  to `--card`.

- **The bar grew 2px, the commit subject stopped shouting, and the author discs went pastel — specs
  `05-features.md` § F16 and § F18, `04-frontend.md`, `AGENTS.md` § 4** — 2026-08-18, user ask, the
  follow-up to the entry below after seeing it rendered. Three unrelated things in one pass because
  all three are the same screenshot.

  **+2px, three places.** `TopBar` 40 → 42px (`h-10.5`), the brand mark 16 → 18px (`size-4.5`), a
  tab 28 → 30px (`h-7.5`). The 40px bar was cut for a 12px label; with 14px in it the strip read
  packed. Worth knowing: **Tailwind v4's fractional spacing steps are derived, not enumerated**, so
  `h-10.5` is not in any list you can grep — a class that does not resolve fails *silently* by
  rendering the element's default height. Measured in the browser rather than assumed: 42 / 18 / 30.

  **The commit subject rests at `secondary-foreground` and takes `foreground` on its row's hover.**
  It was `--foreground` on every row, 96% lightness repeated down the whole column, and a list where
  everything shouts equally has no focus. A selected row keeps full foreground without a hover,
  because selection is a state — the same distinction the panel toggle draws, now written down in
  `AGENTS.md` § 4 so the next list does not have to rediscover it.

  **The author disc went `oklch(62% 0.14 h)` → `oklch(80% 0.07 h)`**, because a dozen saturated dots
  down one rail compete with the lane colours, which are the thing the rail exists to show.

  **The half of that which was not cosmetic: the initials.** Both call sites painted them `--card` —
  near-black in the dark theme, **white in the light one**. That works today by coincidence, and
  lightening the disc would have made the coincidence load-bearing: the day item 32 renders, white
  initials would land on a pastel disc. `avatarInk` now returns a dark tone of the disc's own hue
  from the same function as the fill, so the contrast is a property of `lib/avatar.ts` rather than of
  whichever theme is mounted, and `avatar.test.ts` pins the 50-point lightness gap. Caught before it
  rendered, which is the thing `color-scheme` in `globals.css` records having learned the other way.

- **14px is the floor for labels, and a tab is 240px wide — `AGENTS.md` § 4, specs `05-features.md`
  § F16** — 2026-08-18, user ask. "La font-size n'est pas consistent sur l'app. En 100%, le terminal
  et le commit message sont ok mais le reste est un peu petit (nom des tabs, tout le panneau de
  gauche, les icons). D'ailleurs les tabs pourraient être un peu plus large par défaut."

  **The diagnosis is that the app has two sizes and was using the smaller one for navigation.**
  123 font-size call sites, effectively `text-xs` (12px, 68) and `text-sm` (14px, 55). The two
  things the report called fine are the 13px terminal and the commit subject at `text-sm`;
  everything it called small was `text-xs` — tab labels, the sidebar's session rows, the panel's
  `Files Changes Graph`. So this is not a scale that needs re-cutting, it is a rule nobody had
  written down: `text-sm` for what you read to navigate, `text-xs` for metadata and status. That
  rule is now `AGENTS.md` § 4, which is the point of the change — the sizes were a one-line fix
  each and would have drifted back within a month.

  **What moved.** All three tab strips (`SessionTabs`, `FileTreePanel`'s `TabButton`,
  `CommitDetail`'s `DetailTab`) and the sidebar's nested rows — sessions, the pending "New session",
  "N more…", "Loading…"/"No sessions yet". The session tab's cap went `max-w-44` → `max-w-60`
  (176 → 240px), with the avatar 14 → 16px and the close `×` 12 → 14px so the tab reads as one
  object. `ChangesView`'s hand-written `text-[11px]` heading became `text-xs`, so the app's two
  uppercase section labels are one size.

  **What deliberately did not move**, since the alternative was tried on paper first: no 13px step
  (a third size answers the "which size is this" question with "it depends"), no global icon bump
  (`IconButton`'s 14px base is the reference for this app's density — see item 23), and not the
  root font-size, which would have lifted every existing inconsistency by 6% and desynced the rem
  sizing from the px constants. The sidebar's footer, `PROJECTS` header and `missing` badge stay
  12px: they are status and metadata, which is what the rule now says 12px is for.

  Two things worth keeping:

  - **The panel's minimum width was load-bearing on the label size.** `MIN_PANEL_WIDTH` was 200px
    and its header lays out three tab labels plus, on the Files tab, three icon buttons — collapse,
    refresh, close; at 14px that row no longer fits. A floor exists to keep a panel usable, so a
    header that cannot fit its own tabs means the floor is wrong, not the labels. **Raised to 256,
    from a measurement rather than the arithmetic**: 224 was the estimate and it was still 20px
    short — `scrollWidth` 243 against a 223px content box, with the close button pushed to 2px off
    the panel edge, eating the header's own padding. Persisted widths are clamped on read, so a
    stored 200 comes back as 256 with no migration.
  - **`gitGraph.ts`'s `CHAR_PX = 6.5` is why the 13px option was not free.** It turns a pixel
    budget into a character budget to decide how many ref chips fit a commit row, and it is
    calibrated to 12px. Any change to `--text-xs` re-tunes it silently rather than visibly. Keeping
    the two sizes as they are left that constant honest and out of the diff.

- **`sessions:changed` has a listener — specs `04-frontend.md` § "Projects and sessions: no store",
  `05-features.md` § F6** — 2026-08-18, user report. Two symptoms, one cause: a session started in a
  project just added from the picker did not show up under that project, and a tab kept the short id
  it was born with instead of taking the title claude derives a few seconds later.

  **The backend was innocent and was checked first**, because the report pointed straight at it
  ("adding a second project made the session appear", which is what `add_project` → `scan_project` →
  `discover()` would fix). It does not need fixing: `scan_dir_path` already calls `discover()` when a
  store directory has no row yet, which is the freshly-added-folder case, and
  `the_first_session_in_a_freshly_added_folder_indexes_from_the_watcher` now pins that. Two
  false leads worth knowing: an end-to-end test of the real watcher on macOS fails for a reason the
  app never hits — `TempDir` hands back `/var/folders/…` while FSEvents reports
  `/private/var/folders/…`, so `project_dir_for_event` can't strip the prefix and drops every event;
  canonicalize the fixture root. And the user's own database showed every row correctly indexed
  minutes after each session started, which is what moved the search to the renderer.

  **Nothing in the renderer listened to the event.** `events.onSessionsChanged` existed in
  `lib/tauri.ts` with zero call sites, while `routes/session.tsx` carried a comment saying the
  refetch was "`sessions:changed`-driven". The only thing keeping any session list current was the
  sidebar's 5s poll, which lives inside `SessionList` — mounted only while a project row is
  *expanded*. So a session in a collapsed project was invisible, and the tab strip, which has no poll
  at all, could never learn a title. `useSessionsSync`, mounted once in `__root.tsx`, invalidates that
  project's session list plus `projects` (whose `sessionCount` / `lastSessionAt` are aggregates over
  the same rows, and the sidebar's default sort). The polls stay, as the net under a missed event.

  **The sidebar also unions live-but-unindexed sessions now**, which the project page has always
  done: claude writes no transcript until you send a message, so for that window the list you look at
  to find a session *under its project* said "No sessions yet" about a project with a running PTY.
  `pendingSessions` in `lib/sessionGroups.ts` is that derivation, shared by both surfaces.

  **The reason this shipped unnoticed is the mock bridge**: `mockListen` registered nothing and
  returned an unlisten stub, so no smoke test could reach event-driven behaviour, and M1's "events
  wired" deliverable passed with one end of the wire missing. It now keeps its handlers and publishes
  `window.__FACTORAI_EMIT__` when a fixture is installed; `tests/smoke/pending-session.spec.ts`
  mutates the fixture and fires the event, which is the shape of "the watcher caught up" and fails on
  both counts without the hook.

- **A session's `PATH` comes from the login shell now, not from this GUI process — spec
  `03-backend-rust.md` § `TerminalManager`, `05-features.md` § F4 edge cases** — 2026-08-17, user
  report. The symptom was three unrelated-looking failures at once in an app-launched session:
  `SessionStart:startup hook error … /bin/sh: bash: command not found`, `/mcp` reporting `Failed to
  reconnect to github: -32000`, and a statusline that rendered nothing. One cause. A GUI
  application inherits launchd's (or the session manager's) environment and has never sourced an rc
  file, so Homebrew and every version-manager shim are missing from its `PATH` — and a hook is run
  as `/bin/sh -c "<command>"`, where `/bin/sh` is found by absolute path but the bare `bash`
  *inside* the command is not. The plugin invoking `bash` by name was correct and was the messenger.

  **`services/shell_path` asks a shell**: `$SHELL -ilc 'printf "%s" "<sentinel>${PATH}<sentinel>"'`,
  once, on a thread off `setup()`, cached in a `OnceLock`. This is the `fix-path-for-mac` pattern VS
  Code and most Electron dev tools use, and it was taken as prior art rather than reinvented — the
  five details that make it work on real machines (both flags, sentinels, `/dev/null` stdin, a
  timeout, reading `$SHELL`) are in the module docs and the spec.

  **The reason it lands in `child_env` rather than at the spawn site** is that there is one
  env-construction helper and it must stay that way; `changes_for_current_env()` returns a diff over
  the inherited environment and never builds one, so `HOME`, `SSH_AUTH_SOCK`, `LANG` and the rest are
  untouched. There is no `env_clear` and no hardcoded environment on this path — the original bug
  report guessed there was one, and there wasn't. What there was, was an honest inheritance of a
  `PATH` that was already wrong before we touched it.

  **Two things found while doing it, both now pinned by tests.** First, the `$APPDIR` rule and this
  one meet on the same key: `with_path` has the last word and has to *remove* `PATH` from the
  AppImage diff first, or `apply_to`'s `env_remove` pass unsets the variable it just set. Second,
  the login shell's answer needs the `$APPDIR` strip applied to it too — zsh and bash extend the
  `PATH` they inherit rather than building a fresh one, and on this machine `$SHELL -ilc` demonstrably
  came back with `$APPDIR/usr/bin` still on the front, twice over, from two nested AppImages.

  **The test that matters is at the PTY, not at `EnvChanges`.** Every unit test in `child_env` still
  passes with the `changes_for_current_env()` call deleted from the spawn site; `terminal::tests::
  a_child_runs_with_the_login_shell_path` spawns a real child running `printf '%s' "$PATH"` and does
  not. That was checked by breaking it on purpose — the same lesson v0.5.0 taught one layer down, and
  the reason that layer's regression test drives a real `CommandBuilder`.

  **Still to verify, and it needs a human on a Mac** (folded into the M5 smoke item in `TODO.md`):
  from a **Finder-launched** build, `echo $PATH` contains `/bin` and the host's Homebrew prefix,
  `command -v bash node npx git` all resolve, no hook-error banner on startup or on prompt submit,
  `/mcp` connects its stdio servers, a `statusLine` renders, and `node --version` matches the
  terminal's. On macOS, `pnpm dev` from a terminal inherits a healthy `PATH` and will hide all of it
  — that is the single most likely way to produce a false pass there.

  **But the cheap repro is on Linux, under `pnpm dev`**, which is worth knowing before booking a
  Mac. Turborepo's strict env mode (the `XDG_DATA_DIRS` gotcha in `AGENTS.md`) strips `PATH`
  additions on the way in, so the dev app's own `PATH` is thin for a different reason and to much
  the same effect: measured here, it was missing 15 entries the login shell has — nvm, pyenv's
  shims, `~/.local/share/pnpm`, `~/.yarn/bin`, `~/.local/bin`, `~/.cargo/bin`, gcloud. Compare
  `/proc/<claude-pid>/environ` against `/proc/<app-pid>/environ` after starting a session; with the
  fix the child matches the logged `resolved login shell PATH` byte for byte and not the app's own.

- **The brand row — part of roadmap item 18, spec `09-branding.md` § B8** — 2026-08-17, user ask.
  `TopBar` drops `FolderGit2` for the real mark, and the name is now set one way everywhere:
  `factor` in the text colour, `ai` in `--primary`, from a `BrandWordmark` component rather than a
  string spelled out per site. The empty state uses the same lockup one size up.

  **The open question this was waiting on is answered.** Item 18 said to do it after session tabs
  landed or do it twice, since the wordmark might not survive beside a full strip. Checked against
  three live tabs: mark, wordmark and dev badge hold the left end and the strip takes the middle
  without crowding.

  **The geometry is mirrored by hand** into `components/brand/geometry.ts`, on the same reasoning
  `CLAUDE.md` § 4 gives for the IPC types — the renderer gets a component that inherits
  `currentColor` and needs no asset plumbing. `geometry.test.ts` is what makes that safe rather
  than a slow leak: it reads the master SVG and fails on any divergence, and it also pins
  `public/favicon.svg` byte-identical to the master, since Vite only serves `public/` and a build
  step to copy one file is more machinery than the copy is worth.

  **The ports mask needs a unique id per instance** — two marks sharing one id means the second
  renders unmasked, as a plain rounded square with no notches. `useId` supplies it, colons
  stripped, which a `url(#…)` reference is better off without.

- **The mark, and every app icon — part of roadmap item 18, spec `09-branding.md`** — 2026-08-17,
  user ask. A notched dark housing with an amber F cut into it. The housing reads as a machine
  from above and as a chip package, which is the two halves of the name without either being
  spelled out; three glyphs never fit a 16px square. Construction discipline from Linear (one flat
  colour per element, no outline, no gradient, no bevel), motif and palette from Factorio.

  **The ports are the load-bearing part.** Three notches on each side, none top or bottom, and
  they cut to *transparency* rather than to a colour. That is what makes the outline unmistakable
  at 16px, because a dock icon is judged as a silhouette before it is judged as a drawing — and it
  is why B6 forbids painting anything behind them. It also means the mark is untested against a
  badly-composited dock, which is now the interesting half of what item 18 still has open.

  **The F is drawn, not set.** Every installed face was tried inside the housing, matched on cap
  height rather than point size — the only fair comparison, since every face sets its own ratio —
  and they all lost the same way: a text face is drawn to sit in a line with neighbours on both
  sides, so alone in a square it leaves air and reads as an F in a font. Inter Black came closest
  by being the widest. Drawing it also retires the font-licensing question.

  Three of the numbers in B2 are eye corrections and will read as errors to anyone with a ruler:
  bars lighter than the stem (1.95/1.85 against 2.5, because a horizontal always reads heavier
  than a vertical), the mid bar lighter than the top bar, and the whole letter nudged 0.3 cells
  right of box centre because an F is left-heavy. The single 45° cut on the mid-arm terminal is
  the mark's one piece of character, borrowed from the primitive Linear builds its whole identity
  from; at 16px it degrades to a taper, which is the right failure mode.

  **Two things worth keeping.** `tauri icon` takes the **SVG** directly, and should — item 18 and
  `06-milestones.md` both said to feed it a 1024px PNG, but it rasterises each size natively from
  vector instead of downsampling one bitmap, and on a grid-aligned mark that is visible at 32px.
  And the first cut of the ports was asymmetric — 1.1 cells deep on the left, 1.5 on the right,
  from an off-canvas offset trick — which nobody notices until they do, and then cannot stop
  noticing. Both are recorded in `09-branding.md`.

- **The git graph — roadmap item 1, spec F18** — 2026-08-17, user ask. Interviewed, specified and
  built the same day, in four commits: the spec, then the Rust half, then the primitives, then the
  rail. The tab strip is now `Files | Changes | Graph`, which amends Q18.

  **The interview was the load-bearing part**, and its record is Q22: GitLens gives a lane graph a
  *wide* surface and puts a tree in a narrow sidebar, and our panel is 200–600px, narrower than
  either. The call was the rail first, with a wide modal deferred as a *hosting* change rather than
  a second layout — and Q18 records honestly that the graph took the tab slot without passing the
  test that awarded it, since a graph is a glance rather than a terminal companion.

  **Lane assignment runs in Rust** (Q23) and the payload carries lane indices plus per-row edges;
  the renderer draws SVG and never holds the DAG. That put the algorithm where `cargo test` can
  build `tempdir` repositories and assert a merge, an octopus, an orphan branch and lane reuse
  directly — the leverage ADR-0009 credits `git2` with for the status matrix, and worth twice as
  much for a layout. Paging is an offset with a full re-walk and lanes recomputed over the whole
  prefix, with a test that splices two pages and asserts they equal one walk; the alternative,
  threading the open-lane frontier through a cursor, trades microseconds of libgit2 for lane
  instability that is visible and permanent.

  Edges are split by **geometry** — through / incoming / outgoing — not by git meaning. Naming them
  for merges and branches inverts in a newest-first walk: a lane converging on a commit from below
  is where a branch *forked*, and a renderer told "merge" would draw it upside down.

  Three chip foldings mostly dissolve the crowding a 288px row has: `HEAD` merges into its branch,
  `origin/HEAD` is dropped in the service (a symbolic ref duplicating one we already return, and
  the commonest cause of overflow), and a branch in sync with its upstream absorbs it as
  `main ≡origin`. That third one works *because* the pair only crowds a row when they agree —
  diverged, they are on different rows with nothing to crowd.

  **Two things only the running app found**, and both are in the spec now rather than in a
  bug list. A commit body pushed the author line, the parents and a 22-file list below the fold of
  the default 200px pane, so clicking a commit appeared to show only prose — the body is capped and
  scrolls itself, because it is context and the files are what you clicked for. And F18's claim
  that `HEAD→main ≡origin` and `v0.3.0` both fit was **wrong**: refs get half the text column,
  ~17 characters, and the first chip is 17 alone, so `+N` is the *common* case at 288px and both
  chips appear from ~400px. That is exactly the width constraint Q22 deferred rather than answered.

  ADR-0012 came out of it: every colour in the app was semantic — `primary`, `destructive` — and a
  lane needs categorical colour, which that palette cannot express. Eight `--lane-N` tokens named
  for the role rather than the caller, both themes, chosen against the background at a 6px pitch
  and for adjacent-pair contrast including the wrap from lane 7 back to lane 0.

  Three smaller things it left behind: `GitStatus.head` closes the detached-vs-unborn gap the
  branch badge flagged when it shipped; `PanelResizer` does both axes (`width` renamed to `size`,
  because a prop called width controlling a height is a lie); and F13's change row is extracted as
  `FileChangeRow`, taking fields rather than a `GitChange` — reusing that type would have meant
  labelling a commit's diff "staged".

  Two gotchas for whoever is next. **git2 0.21 returns `Result` from `Reference::name`/`shorthand`
  and `Result<Option<_>>` from `Commit::summary`**, which is a change from earlier versions and why
  the existing code was already littered with `.ok()`. And **`Branch::set_upstream` needs the
  remote to exist in `.git/config`** — creating `refs/remotes/origin/x` alone fails with "could not
  determine remote" — so the test helper writes a config remote, no network involved.

  **A second test pass, on the user's prompt that there were blind spots, found two real bugs in
  code already called done.** Both are worth keeping because they share a shape: *state derived from
  a stored copy of its own scope.*

  The selection was held as `{ project, sha }` and compared against the active project on render,
  which reads as "clears on switch" and isn't: the entry survived while you were elsewhere, so
  returning to a project brought its selection back — but **only if you hadn't selected anything in
  the other project meanwhile**, since that overwrote the one slot. Arbitrary, and the opposite of
  the comment sitting beside it. The fix is to key the subtree on the project so React remounts it,
  which makes the reset unconditional, removes the tagging from both the selection *and* the page
  count, and keeps working for state added later. **The lesson: "reset when X changes" is a remount,
  not a comparison** — a comparison leaves the old value alive and reachable.

  Page joining used `pages.filter(p => p.data)`, which *drops* a pending page instead of stopping at
  it — so while page 1 refetched, page 2's commits were promoted to the top of the list. In order,
  and the wrong rows, which for a history viewer is the worst available kind of wrong. Now
  `stitchPages`, pure and tested, taking the contiguous prefix.

  Also: **"Load more" had never executed once**, in a test or in the app, because `GRAPH_PAGE` is 300
  and this repo has fewer commits than that. A whole path was dead code as far as any evidence went,
  and it took a 430-commit fixture to find out it worked. Worth remembering when a cap is set above
  what the dev repo can reach — the fixture is the only thing that will ever exercise it.

  Deferred, deliberately: the wide modal (Q22), worktrees, session↔commit linking (the payload
  already carries full 40-character SHAs and both timestamps for it), and a merge's parent
  *picker*. Interaction-level coverage beyond two `@smoke` tests is recorded against item 10.

- **JSON is highlighted in the file viewer** — 2026-08-17, user ask, shipped in v0.9.0. It rendered as unhighlighted
  plain text with `Plain Text` in the footer, and the cause is worth keeping because the obvious
  fix is a trap. `basic-languages` carries ~80 Monarch grammars and **JSON is the one common
  language missing from it** — css, html, javascript and typescript are all there, but JSON ships
  solely as a language *service*. So `.json` was absent from Monaco's registry entirely and
  `languageForFile` fell through to `plaintext`.

  Importing the feature's `register` fixes detection and **breaks the viewer**: it installs the
  full mode, whose `jsonMode` statically imports the code-action, hover and completion providers,
  which pull editor contributions `editor.api` carries no services for. The viewer then dies on
  open with `[createInstance] CodeActionController depends on UNKNOWN service actionWidgetService`.
  `setModeConfiguration` does **not** save you — ESM imports are static, so the modules load
  whether or not their providers are used.

  The fix is to register the language by hand and attach only `createTokenizationSupport`, the one
  piece free of the editor's DI graph: it imports nothing but `jsonc-parser` and returns a plain
  `TokensProvider`. No worker, no IntelliSense, no squiggles on a read-only file. Registered with
  `supportComments: true` and with `.jsonc` / `.json5` added to Monaco's extension list, so
  `knip.jsonc` and a commented `tsconfig` tokenise their comments as comments.

  **`tsc` and all 103 smoke tests were green with the broken version** — the DI failure only
  happens when Monaco actually instantiates an editor for that language, in the real app. Found by
  opening a `.json` file under `scripts/qa/launch.sh`, which is the entire argument for that loop
  existing. There is a smoke test now. Two smaller things: the untyped internal path needs an
  ambient `declare module` (upstream ships a `.d.ts` only for `register`, the one thing we must not
  import), and it goes in `optimizeDeps.include` like its two siblings or Vite reloads the page the
  first time a `.json` is opened.

- **A git branch badge in the session header** — 2026-08-17, user ask, shipped in v0.9.0. `GitBranch` glyph plus the
  branch name, muted, no border, no background, between the project name and the session title.
  `git_status` already returned `branch`, so the data was free — the fetch was not.

  `useGitStatus` is gated on the right panel being open, deliberately: its only consumers were the
  Changes tab and the tree's decorations, and closing the panel should stop its 3s working-tree
  walk dead. A header badge is visible whether or not the panel is, so widening that gate would
  have run a 3s walk for every open session forever. It gets its own observer on the **same query
  key** instead — one cache entry, one request, two cadences — polling at 30s and on focus, since a
  branch changes on `git checkout`, not on every keystroke the agent makes. There is a smoke test
  asserting the badge survives the panel being closed, which is the assertion that would have
  caught the lazy version.

  Absent, never empty, in all three non-branch states: no repository, not yet loaded, and no branch
  to name. That last one covers **both** a detached `HEAD` and an unborn branch and `GitStatus`
  carries no head SHA to tell them apart, so it stays quiet rather than guessing "detached" — a
  short SHA would need a new field.

- **A root error boundary, and a crash screen you can act on** — 2026-08-17, user ask, shipped
  in v0.9.0. There was no
  `ErrorBoundary` and no `componentDidCatch` anywhere in the repo, and no `errorComponent` on the
  root route: a throw during render unmounted the tree and left an **empty window** — no message,
  and in a desktop app no address bar to reload from.

  One boundary, at the root, mounted **outside** the query client and the router, since a crash
  while constructing either is exactly what it has to catch. Root-only is a deliberate first cut
  (decided with the user); per-surface boundaries are the next step and are in `TODO.md` rather
  than half-built. The screen shows name, message and component stack rather than a redacted
  "something went wrong", with Reload, Report an issue, and Copy details.

  Two things worth keeping. **Reload is cheaper than it looks and costs more than it says**: the
  webview reloads but not the process, so PTYs survive and `terminalStore` re-syncs from
  `terminal_list()` — but nothing snapshots xterm's scrollback, so the panes come back empty. The
  screen says so rather than letting it be discovered. And **`encodeURIComponent` on the issue URL
  is load-bearing**: the shell open scope is `https?://\w[^\s]*`, so a URL carrying a raw space or
  newline — which every stack trace has — fails regex validation and the button silently does
  nothing. Guarded on both sides, `lib/crashReport.test.ts` and `tests/shell_open_scope.rs`.

  The report is a prefilled GitHub link, not a reporting service: nothing is sent, the user reads
  and edits the body first, and § 8's "no telemetry" is untouched. Version comes from a Vite
  `define` rather than `getVersion()`, so the crash path doesn't depend on the Tauri bridge still
  working.

- **`Button`'s size scale is a desktop scale now** — 2026-08-17, TODO item 23, user ask, shipped
  in v0.9.0. `default`
  `h-10 → h-8`, `sm` `h-9 → h-7`, `lg` `h-11 → h-9`, `icon` `10 → 8`, and the base `[&_svg]:size-4
  → size-3.5`. The numbers are not invented: they are what the app's dense surfaces were already
  overriding to by hand, which was the diagnosis — six inline overrides fighting one default.

  **`Input` and `Select` moved with it** (`h-10 → h-8`, and `Input`'s `text-base`/`md:text-sm` →
  `text-sm`), because they pair with buttons in a row and shrinking one alone misaligns both. Both
  `Input` call sites were already hand-setting exactly `h-8 text-sm`, so the trio decision made
  itself.

  Four overrides deleted (`session.tsx`'s `h-7`, `project.tsx`'s and `SubAgentTranscript`'s
  `size-3.5`, both `Input`s' `h-8 text-sm`). The viewer's `h-6 text-xs` toolbar buttons stay: they
  are a step below `sm` and re-cutting the scale to reach them would have dragged everything else
  down with them. Verified in the running app — the `+ New session` button measures 33px at 120%
  zoom, i.e. `h-7`.

- **Sub-agents fold under the session that spawned them** — 2026-08-16, user ask, shipped in
  v0.8.0. A session that ran six agents put seven rows on the project page, so its real sessions
  were buried under runs you open once, if ever. Groups collapse by default behind a disclosure
  chevron, with a count badge that carries the number — while the group is shut that badge is the
  only thing saying the agents are there.

  Three details that are the difference between nesting and the look of nesting:

  - The gutter is **reserved on rows with nothing to disclose**, so titles line up in one column
    whether or not a session spawned agents.
  - An expanded agent indents **past** the parent's title, not level with it. The first attempt
    indented to exactly where the parent's title starts and rendered as no nesting at all — caught
    in the running app, not in a test.
  - The `sub-agent` badge and `read-only` are **right-aligned**. They sat inline after the title,
    which truncates, so the badge landed at a different x on every row.

  `groupSessions` does the fold and is unit-tested apart from the rendering. Two passes rather than
  one deliberately: `list_sessions` returns a parent before its children *today*, and a single-pass
  version silently drops an agent the day that stops being true. An orphan — parent transcript
  deleted — leads its own group rather than vanishing under a parent that isn't in the list.

  The toggle is a **sibling** of the row's `Link`, never a child: a button inside an anchor is
  invalid and the two fight over the click, the same constraint `SidebarProject` already carries.

- **Formatting is clean repo-wide, and gated** — 2026-08-16, user ask, shipped in v0.8.0. The repo
  was not format-clean in **32 JS/TS/CSS files and 16 Rust ones**, and nothing said so.
  `pnpm format:check` and `cargo fmt --check` are in the § 2c gate and in CI now.

  `pnpm format` ran `biome format --write src` in each of three packages, so `tests/`, `knip.js`
  and every root config file were never formatted at all — while running it rewrote all of
  `packages/ui` and buried whatever you were actually changing. It is one root command over the
  whole tree now, and the vendored shadcn files are in house style once and for all, which retires
  the "don't reformat `button.tsx`" caution in item 23.

  **Rust's config was written to match the code, not to change it.** `hard_tabs` and
  `max_width = 100` are the repo's own conventions; `use_small_heuristics = "Max"` is the
  load-bearing one — on the default setting rustfmt breaks a struct literal past 18 columns and a
  call past 60, which accounted for 111 of the 235 diffs on its own and would have exploded a few
  hundred hand-written one-liners into five-line blocks.

  Two things found on the way: `biome format` caps output at **20 diagnostics** by default, so the
  first count read 20 files when it was 32. And a `format:rust` pnpm script makes knip report
  `cargo` as a binary it can't find — cargo commands belong in `src-tauri`, which is where the gate
  runs them, and that beats adding a knip ignore.

- **The file tree's rows have a right-click menu** — 2026-08-16, TODO item 3, shipped in v0.8.0.
  Open · Open in default app · Copy contents · Copy absolute path · Copy relative path, on
  `@radix-ui/react-context-menu` through the `ContextMenu` primitive item 25 left behind. F12 keeps
  its "no hover actions" rule and gains the actions anyway. `Select for the agent` stayed deferred
  to item 19, as the entry said it should.

  **The native menu needed the check the entry demanded, and it was not a formality.** Measured on
  WebKitGTK 2.52.3, right-clicking anywhere the app doesn't draw its own menu produces the
  *browser's*: `Back · Forward · Stop · Reload · Inspect Element`. `Reload` in a Tauri window
  drops every pooled xterm. So `useNativeContextMenu` suppresses it — but **not everywhere**,
  because the same check found the terminal's menu is a live `Cut · Copy · Paste` that pastes into
  the prompt, and F5's copy/search toolbar was never built, so that is the only mouse-driven paste
  a session has. Suppressing globally would have removed a capability under cover of a cosmetic
  fix. Chrome loses its menu; the terminal and text fields keep theirs.

  **`isBinary` / `truncated` decide whether the row is offered, not what it does.** The read
  happens when the menu opens, through the viewer's own cache entry (same key, same cap), so
  right-clicking a file you already opened costs nothing — and a disabled row carries its reason
  in its label (`Copy contents (binary)`), since there is no toast to explain it in.

  **The two image-copy paths converge.** `copyImageElement` took the canvas dance out of
  `ImageView`; the viewer feeds it the `<img>` already on screen, the tree feeds it one decoded
  from `read_image`.

  A copy is acknowledged by a transient tick on the row — the menu has closed by then, so it
  cannot say so itself. Verified in the real app: the menu draws, the row selects, and
  `Copy relative path` put `AGENTS.md` on the X clipboard.

  **One test-shaped finding worth remembering:** an open Radix menu is modal and `aria-hidden`s
  the rest of the page, so `getByRole` cannot see the row underneath it. Assert selection after
  the menu closes.

- **The session header asks before it kills** — 2026-08-16, TODO item 22's unblocked half, shipped
  in v0.8.0. The header's labelled `Stop` (a `Square` icon, `outline` Button) was the one place in
  the app where one click ended a running agent with no undo and no question — against
  `00-overview.md` §
  "The operating model", which says every irreversible action keeps its confirmation. It is now an
  `IconButton` + `X`, and `Square` was the wrong metaphor anyway: the handler kills the PTY,
  disposes the pooled xterm and navigates back to the project, which is closing a session, not
  halting a process you stay parked on.

  The dialog was lifted out of `SessionTabs` into `components/dialog/CloseSessionConfirm` and both
  call sites drive it. Controlled rather than self-managing, because what happens *after* differs:
  the strip navigates only if you were looking at the session it closed.

  **The drift was worse than the missing confirm, and the smoke test is what found it.** The tab
  strip drops a closed session from `terminalStore` immediately — "a tab that lingers until an
  event arrives is a tab that lingers forever if the event is missed" — and the header never did,
  leaving its own tab behind until `terminal:exit` arrived. Two call sites for one act had already
  grown two behaviours. The header now detaches too, but only on a **successful** kill: a failed
  one keeps the entry so the project page's status dot goes on telling the truth about a PTY that
  may still be running.

  Verified in the running app, not only in Chromium: resumed a real session, header `×` → the
  dialog, confirm → PTY dead, back on the project page, strip empty, sidebar dot gone.

  Left alone deliberately: the `Restart` swap for a dead session (nothing to confirm) and the
  kill-failure path. The preference to turn the confirm off stays blocked on item 4 — it has
  nowhere to live until the settings surface is decided.

- **`get_session` deleted; `get_session_tail` kept** — 2026-08-16, TODO item 9, shipped in v0.8.0.
  The item asked for one decision about two commands, and the two had already parted company: the
  sub-agent
  transcript view wired `get_session_tail` while it sat unread, so only the offset-paged
  `get_session` was still dead — registered, wrapped in `lib/tauri.ts`, mocked, and called by
  nothing.

  Deleted rather than kept available. "Available for future use" is what it had been for months,
  and the named use — a search-hit context preview — needs a hit position in its signature, so it
  would be a new command rather than this one restored. F3 says that out loud, because a command
  that reads a transcript by offset is the shape of the JSONL viewer removed in `c6374d6` and the
  reflex to re-add it is exactly what the note is for.

- **The indexer reaps sessions whose transcript is gone** — 2026-08-16, TODO item 26, shipped in
  v0.8.0. The index was upsert-only, so a deleted `.jsonl` stayed in it forever: **147 rows against
  80 files** on the
  machine this was found on. The stale count was the harmless half — the row kept its title, so a
  search hit opened it, found no transcript, and spawned `claude --session-id` rather than
  `--resume` (ADR-0008, working as specified), landing you in an empty session wearing a 1721-turn
  conversation's name.

  `index_dir` already holds the directory listing, so the reap is a set difference rather than a
  `stat` per row. Three guards, each a test: an unreadable directory reaps nothing (the early
  return on `read_dir` failure was already there and now carries the reason), the delete is scoped
  to one `discovered_id`, and a session with a live PTY keeps its row.

  **Sub-agent rows are the trap.** They carry the *parent directory's* `discovered_id`, so a reap
  built from top-level ids alone deletes every agent transcript on its first run. The on-disk set
  is assembled from both walks, and the test asserts survival across two scans before it asserts
  deletion.

  **The live-session exemption is narrower than it looks.** The ADR-0008 window — a session
  spawned but not yet messaged — needs no exemption at all, because rows only ever come from
  transcripts and there is no row yet. What it actually guards is a transcript deleted out from
  under a running session. `TerminalManager::live_session_ids()` reaches the indexer as an
  injected callback, the same way its emit callbacks do, so the tests still build one without a
  Tauri runtime.

- **Two window fixes, and a corner that stays square on Linux** — 2026-08-16, shipped in v0.7.0.
  A long filename in the Changes tab used to set a min-content width the 288px panel couldn't
  meet, so the whole list scrolled sideways and every row's name went off the left edge; both
  halves of the path shrink now, the directory first. And the shell's bottom corners round on
  macOS only — Linux clips nothing, so a rounded corner there is a wedge of background sitting
  over the WM's own arc. Transparency fixes the geometry and exposes the compositor's shadow
  instead; the measurements and the rejected alternative are [Q21](../07-open-questions.md), and
  what's left of the artifact is TODO item 27.

- **Sub-agent sessions and the workspace split, merged** — 2026-08-16. The two landed in parallel
  and collided: PR #2 shipped `0004_session_subagent` while item 25 shipped
  `0004_workspace_projects`, and migrations are keyed by name. The sub-agent one was renumbered
  to `0005` (safe only because it had never been applied anywhere real) and rewritten against the
  schema the split leaves behind — the manufactured `subagents` project is a *discovery* now, and
  its FTS rows have to go by hand since nothing cascades. Sub-agents index against their parent's
  discovery, and "sub-agents don't count" moved from a stored `session_count` column to the
  `PROJECT_SELECT` aggregate.

- **A project is a folder you added, not a directory Claude has** — 2026-08-16, TODO item 25.
  Recorded as [ADR-0011](../../docs/adr/0011-a-project-is-a-folder-in-the-workspace.md); F1 was
  rewritten rather than patched, since it was written from the premise this deletes.

  The workspace was a **mirror of `~/.claude/projects/`** — `full_scan()` upserted a row per
  directory, and `projects.id` was Claude's own path encoding. Three things followed. Projects
  arrived uninvited. Closing one was impossible, and not by oversight: a `DELETE` was undone by
  the next scan, so any close button built first would have lied within a second. And a second
  agent had nowhere to go, since identity *was* one agent's naming scheme.

  Now two tables with two owners: `projects` is what you added, `discovered_projects` is what a
  store holds, linked by canonical path with `ON DELETE SET NULL`. Sessions hang off the
  discovery, so adding or removing a project moves a handful of rows rather than every session in
  it. `encode_path` moved to `agents::claude` and stopped being identity.

  **Landed in four commits**, schema first, with the full gate between each: (a) schema, migration
  and commands, invisible to the UI; (b) the store migration and the empty state; (c) the import
  dialog; (d) remove, and the `ContextMenu` primitive TODO item 3 will reuse.

  **Findings worth keeping.**

  - **The migration was verified against a copy of the real database**, not only against
    fixtures, and that is where the interesting case turned up: two encoded directories that had
    resolved to the *same* folder. `INSERT OR IGNORE` on `real_path UNIQUE` collapsed them into
    one project with both discoveries attached — 12 rows became 11 projects with all 146 sessions
    and 7072 FTS rows intact. A fixtures-only test would not have produced that shape.
  - **The FTS table was rebuilt from its own columns**, not by re-parsing. An FTS5 table reads
    back as an ordinary one, so dropping its `project_id` cost nobody a reindex on first launch.
    It had to go: it held a stable encoded name, and a workspace id is not stable across a remove
    and a re-add.
  - **A `<label>` around a Radix checkbox associates nothing** — the control renders a `<button>`,
    which is not a labelable element, so the click never lands. Biome's `noLabelWithoutControl`
    caught it and was right; the fix is `Label htmlFor`, not an ignore comment.
  - **`liveSessionsIn` as a zustand selector re-renders forever**, since it builds a new array per
    call. Subscribe to `bySession` and derive with `useMemo`.
  - **One rule covers both doors onto `add_project`.** A missing path is a mistake from the
    picker (you can only browse to what exists) and legitimate from the import list (the folder
    was deleted, the transcripts survived). Rather than a caller-supplied flag: a missing folder
    is admissible **only if an agent already has history for it** — which is exactly the import
    list's set, and excludes a typo.

  **What this cost, stated because it is a real loss.** Search no longer reaches outside the
  workspace. Indexing is gated the same way, so it is coherent — there is nothing to find because
  nothing was parsed — but F4 used to cover every folder Claude had ever touched, and the moment
  you want that is the moment you cannot remember which folder it was. Un-gating is two lines and
  a reindex if it proves wrong in use; F4 says where.
- **Sub-agent sessions are real, marked, and read-only** — 2026-08-15. Claude Code writes each
  agent a session spawns to `<session>/subagents/agent-*.jsonl`. The watcher was treating that
  file's direct parent as a project directory, which manufactured a project literally named
  `subagents` (its `real_path` even resolved to factorai, via the agent's own `cwd` — a second
  "factorai" in the sidebar) and indexed the agent transcripts as ordinary sessions. Opening one
  probed for a top-level transcript that doesn't exist and spawned a fresh `claude` under the
  agent's id.

  The fix, per the rule the user set: they *are* explorable, so keep them — marked and read-only.
  The watcher now maps a changed `.jsonl` up to the directory that is actually a direct child of
  `~/.claude/projects/` (anything else is logged and ignored — no more manufactured projects from
  stray files). The indexer indexes `agent-*.jsonl` under the real project with `sessions.subagent_of`
  set (the migration that deletes the bogus rows landed as `0005` — see below). `list_sessions` nests sub-agent rows directly
  under their parent, and the project page renders them indented with a `sub-agent` badge;
  `session_count` excludes them, and the sidebar's inline ten-session list leaves them out. The
  session view swaps the terminal for a paged read-only transcript (`get_session_tail`, widened by
  "show earlier") — no Stop/Restart, since `claude --resume` can never open one. Verified against a
  copy of the real DB: bogus rows gone, every agent transcript across all projects re-indexed
  marked under its true parent.

- **A quality gate that runs, and a dead-code gate that works** — 2026-08-15, shipped in v0.6.0.
  `.github/workflows/quality.yml` runs § 2c minus `e2e` on every PR and every push to main, in two
  parallel jobs. No Playwright: it wants a browser download and a dev server for a ~70s suite, so
  `vite:build` stands in for the one thing e2e checked incidentally — that the renderer still
  bundles, which `tsc` doesn't prove.

  `pnpm deps:unused` joined it only after being made honest. It was reporting 76 findings, **68 of
  them false**, from a config whose ignores had outlived their reasons — which is why nobody ran
  it. `knip.jsonc` now states the why beside every ignore; colocated tests became entry points
  (with tests invisible, anything exported solely for a test reads as dead, and taking that advice
  breaks the test); `unresolved` is off because `tsc` and `vite:build` already resolve imports for
  real and knip is the only one blind to Vite's virtual modules. The eight real findings were
  fixed, and the gate was checked by planting an unused export, an orphan file and an unused
  dependency to confirm it still catches all three.

- **18 of the 22 logged inconsistencies resolved** — 2026-08-15, shipped in v0.6.0. Seventeen were
  stale prose against correct code; one was false. Two of them read as instructions and so were
  worse than stale: a roadmap entry describing the release action as a *prerelease* — which
  `/releases/latest` skips, and the updater resolves through it — and a QA note asserting that
  WebKitGTK filters synthetic input, which had been steering QA away from an approach that works.
  The accurate version of that second one had been sitting in TODO item 10 the whole time, where
  nobody reads. Four remain, each needing a decision rather than an edit.

- **The file viewer renders images, with zoom, pan and copy** — 2026-08-15, shipped in v0.6.0.
  `read_image` returns base64 plus a mime **sniffed from the magic bytes**, so a `.png` that is
  really a PDF is refused and falls back to the binary card rather than drawing a broken image.
  Routing is by extension (reusing the file tree's own classifier, so icon and viewer cannot
  disagree); the verdict is the backend's. Oversized images are refused rather than truncated —
  half a PNG is a decode error, not a smaller PNG.

  Zoom steps multiplicatively (×1.25, 0.25–8), because an additive step is a quarter of the image
  at 1× and three percent of it at 8×. Pan is a pointer drag above fit, on a transform rather than
  a scroll container so native scrollbars can't fight the gesture.

  **Copy needed two attempts and the first one is the finding.** `navigator.clipboard.writeText`
  works in this webview, so `clipboard.write()` with a `ClipboardItem` looks obvious — WebKitGTK
  doesn't implement it, the promise rejects, and nothing reaches the clipboard. Caught by clicking
  copy in the running app and seeing `xclip -t TARGETS` still offer text only. It now goes through
  `tauri-plugin-clipboard-manager` as raw RGBA via `Image.new`, which needs no decoding and so
  works for every format. Verified pixel-identical against the file on disk.

- **Middle-click closes a tab, and SVGs render** — 2026-08-15, shipped in v0.6.0. The close still
  asks first: a shortcut to the action, not a way around the question. SVG gets markdown's
  Preview / View source toggle, rendered through an `<img>` and a data URL rather than inlined —
  SVG loaded as an image runs no scripts, and these files come from whatever repository is open.

- **A project whose folder is gone says so before you click** — 2026-08-15, shipped in v0.6.0.
  Closes TODO item 3. `list_projects` reported the `cwd` recorded in a transcript and never stat'd
  it, so F1's dimmed row was unimplemented and F6's `+` couldn't pre-disable. A `missing` column
  on `projects`, set by the indexer's scan rather than per `list_projects` call — that query polls
  every 2s and stat-ing every project on every poll would put the filesystem in a hot path to
  answer a question that changes when someone deletes a directory. Deliberately distinct from
  `real_path: null`: unknown and gone are different states and only one is worth reporting. It
  clears on a later scan and on `add_project`, so a restored folder needs no wiped database. The
  spawn guard stays — the flag is the affordance, the guard is the invariant.

- **The AppImage env scrub actually applies now** — 2026-08-15, shipped in v0.6.0. The v0.5.0 fix
  below computed the right environment and then changed nothing, because `CommandBuilder::new()`
  pre-seeds the child from `std::env::vars_os()`: `env()` overrides a key, and the variables we
  wanted gone were exactly the ones our clean list *omitted*, so they stayed inherited. Caught by
  starting `pnpm dev` from a session under the freshly-updated release and hitting the identical
  `WebKitNetworkProcess` error. The scrub is now an `EnvChanges { remove, set }` diff applied via
  `env_remove`. The regression test drives a real `CommandBuilder`; with the fault reintroduced it
  is the only one of the ten that fails, which is the whole lesson — nine tests of a rule proved
  nothing about whether the rule was ever applied.

- **A session no longer inherits the AppImage's private environment** — 2026-08-15, shipped in
  v0.5.0 (and **broken there** — see above). `spawn_with_argv` copied `std::env::vars_os()`
  wholesale into every PTY, so a release
  build handed `linuxdeploy`'s runtime to every Claude session and everything it ran: `PYTHONHOME`
  pointing into the squashfs mount killed any `python3` with `No module named 'encodings'`, and
  `LD_LIBRARY_PATH` made other GTK binaries load *our* WebKitGTK. `services/child_env` strips
  it — drop path-list entries under `$APPDIR`, unset what that empties, pass anything with no
  `$APPDIR` entry through byte for byte so a `GTK_THEME=Adwaita:dark` isn't rewritten. Matched
  on path rather than on a list of names, since AppRun's set has grown before. No-op outside an
  AppImage. Verified against this machine's real environment: 17 poisoned vars → 0, `PATH` and
  `XDG_DATA_DIRS` restored to the user's own values (which is separately the `xdg-open`
  default-browser fix).

- **Add a project by picking its folder** — 2026-08-15, shipped in v0.5.0. `add_project(path)`
  plus a `FolderPlus` in the sidebar header. Until now a project could only arrive by the indexer
  finding it under `~/.claude/projects/`, so the folder you had never run Claude in — the one you
  most want to start in — was unreachable from the app. Picking one adds the row and opens it;
  the existing `+` starts the first session.

  The row is keyed by **Claude Code's own directory encoding of the path**, which is the whole
  design: when a session eventually runs there, the indexer's upsert lands on this row instead of
  making a second one for the same folder. So the path is canonicalized first (a symlink or a `..`
  would encode to an id the indexer never produces), re-adding is a no-op that keeps the pin, and
  an integration test runs a real scan over a synthetic `~/.claude` to prove the two meet.

- **A dragged tab travels to where it will land** — 2026-08-15, shipped in v0.5.0. Reordering
  happened on drop, so the gesture was blind. The strip now reorders on `dragover`. Two things had
  to be right: the ghost was a near-invisible sliver, because the browser snapshots the source
  *after* `dragstart` returns and so caught the dimming meant to mark the tab as in flight
  (fixed with a solid clone
  passed to `setDragImage`, parked off-screen — not `display: none`, which snapshots blank); and
  the swap has to wait for the midpoint, or the tab you swapped with lands under the cursor and
  the pair flickers forever. `dropIndex` is that arithmetic, unit-tested in both directions.

- **A dev build says so** — 2026-08-15, shipped in v0.5.0. A violet `DEV` pill next to the
  wordmark (`import.meta.env.DEV`, so a `vite:build` bundle never has it) and `factorai DEV` as
  the window title (`#[cfg(debug_assertions)]` in `setup()`). Both because the release factorai
  runs beside the dev one all day with live Claude sessions in it, and the two were
  indistinguishable in the window switcher.

  **The real hazard was `scripts/qa/kill.sh`.** It swept `pgrep -x factorai` and every
  `claude --resume` by name — and the release build shares that process name, its PTYs that argv.
  Verified on this machine: the agent's own session runs under the release AppImage, so the QA
  teardown could kill the app hosting the agent running it. Both sweeps are now qualified by
  ownership — a factorai counts only if its executable is under this repo's `target/` (`/proc/PID/exe`,
  macOS `ps -o comm=`), and a claude only through such a parent's subtree. `_resolve_wid.sh` and
  `launch.sh` match `factorai DEV` rather than `factorai`, which also fixes screenshots landing on
  the wrong window.

- **Sidebar rebuilt around projects you actually use** — 2026-08-14, shipped in v0.3.0. Sort by
  Recent or Name with Expand/Collapse all; projects expand to their 10 most relevant sessions
  (running first, then most-recently-active); pinning lifts a project into a block above a divider,
  stored in the `projects.pinned` column that had been built in M1 and never wired up. The sidebar
  resizes like the file panel — one `PanelResizer` told which edge it's on — and its header stays
  put while the list scrolls, by living outside the scroll container rather than by
  `position: sticky` inside it.

  **Affordances got a house style.** Icon-only controls became an `IconButton` primitive that never
  paints a background: the hover state is the icon taking colour, because a filled block behind a
  14px glyph is bigger than the thing it highlights. Every clickable element gets `cursor: pointer`
  from **one base rule** — Tailwind v4's Preflight sets `cursor: default` on buttons, so nothing had
  one — and the vendored shadcn menus had to give up their hard-coded `cursor-default`, since a
  class on the element always beats a bare-selector rule. Both rules are in `AGENTS.md § Design
  rules`, and `affordances.spec.ts` asserts the *computed* styles rather than the source.

  **The avatar badge took three goes, and the last one found the real bug.** The status dot moved
  onto the project avatar, but nudging it never quite landed: the wrapper was `inline-block` around
  an inline-level tile, so the tile sat on a line box inside its own wrapper and the inherited
  `line-height` pushed it down a couple of pixels — while the badge, positioned against the wrapper,
  stayed put. Avatar and badge were answering to different rectangles. Fixed by making the wrapper
  `inline-flex` with a block-level child, and the geometry is now asserted in pixels (tile fills
  wrapper, badge centre on the right edge, 40–50% above the top, badged and plain rows the same
  height) because the failure is two pixels — invisible at 1x, obvious at 6x.

  **Two defaults that were quietly wrong.** `WebLinksAddon` calls `window.open`, which a Tauri
  webview ignores, so Ctrl/Cmd-clicking a URL in the terminal did nothing; it now goes through the
  shell plugin, on modifier-click only, since Claude Code is a TUI where a bare click would ambush
  you with a browser. And the updater was running under `pnpm dev`, where the binary's version
  trails every release — so it downloaded ~80MB on each launch and offered to restart the developer
  into a release build of the code they were editing. Its guard sits *after* the browser-only
  branch, because the Playwright lane is a dev build too.

  Zoom controls landed in the sidebar footer (webview zoom, so the terminal reflows and the PTY
  learns its new size, rather than a CSS transform that would blur it and lie).

- **OTA updates, and the repo went public to make them possible** — 2026-08-14. The header shows
  `v0.2.0 ready · Restart` once a new release is downloaded and staged; checking and downloading
  are silent, and nothing ever restarts itself. F14, ADR-0010.

  **The restart needed more care than the update.** `relaunch()` tears the process down and takes
  every live PTY with it, but it never fires `CloseRequested` — so the quit guard (ADR-0005) never
  sees it, and a running Claude session would die without a word. The badge runs the same
  confirmation on the same terms; with nothing live it restarts immediately.

  **Four constraints fell out of the endpoint** (`releases/latest/download/latest.json`), each
  forcing a decision: release assets on a *private* repo 404 for unauthenticated clients, so the
  repository is now **public** (history scanned for secrets — clean; screenshots had their project
  list blurred first). GitHub's `/releases/latest` **skips prereleases**, so releases stopped
  being marked as such — they stay drafts until published by hand, which is the real gate. Linux
  **ships AppImage only**, because the updater can replace an AppImage in place but never a `.deb`
  (apt owns those files). And macOS ships `.app.tar.gz` beside the dmg, reversing the earlier
  `--bundles dmg` that was right only while there was no updater to feed.

  Signing is a minisign keypair in the `TAURI_SIGNING_PRIVATE_KEY` secret, nowhere in the tree.
  Losing it means installed copies stop accepting updates — a new key would need a
  manually-installed build to bridge the gap. Note this is **not** Apple code-signing: a first
  macOS install still needs the Gatekeeper dance; in-place updates don't re-quarantine.

  Gotcha worth keeping: `gh secret set NAME --body ""` hangs forever waiting on stdin, so the
  empty passphrase is an empty literal in the workflow rather than a secret.

  **Verified end to end, not just unit-tested.** Cut and published v0.2.0, installed that
  AppImage, published v0.2.1, then launched the v0.2.0 install: it found the release on startup,
  downloaded and staged it, and showed `v0.2.1 ready · Restart`. The installed file's md5 went
  from `72814c03…` to `69365c39…` — byte-identical to the published v0.2.1 AppImage, so the swap
  is real and not a UI state. Clicking Restart replaced the process (pid 473460 → 474787) and the
  badge was gone afterwards, because the check now finds nothing.

- **Changes tab, git decorations and the diff viewer** — 2026-08-14. The right panel gained a
  `Files | Changes` strip; the tree gained git paint and nothing else. Four slices: specs +
  ADR-0009, the Rust (`git_status` / `git_blob` / `ignored` on `list_dir`), the tab and the Monaco
  diff mode, then the tree decorations. Closes TODO items 1 and 11, which turned out to be one
  piece of work — the Changes list is the only thing that opens a diff now that the JSONL viewer
  is gone (F3), and the diff is what makes the list more than filenames.

  **Decisions worth not relitigating** (Q18–Q20): the index is modelled, so a partly-staged file
  shows in both Staged Changes and Changes with its own counts and the `+N −M` badges add up;
  changes are repo-wide with paths relative to the project, so a monorepo sibling reads
  `../packages/types/index.ts`; freshness is a 3s poll while the **panel** is open, either tab,
  because the tree's dots read the same query; the tab strip is two hardcoded tabs, not a
  registry, which sent F9's Memory tab to the cheaper "it's just a file the tree opens" route.

  **libgit2, not `git` on PATH** (ADR-0009). Shelling out would mean owning a second copy of the
  discovery problem `find_claude_binary()` exists to solve, for a read that runs every 3s. VS Code
  shells out because it also *writes* and already ships a `git.path` setting; we write nothing.
  The payoff is testing: 18 Rust tests build real repositories in tempdirs — staged, partly
  staged, untracked, renamed, deleted, binary, a real merge conflict, an empty repo, no repo — with
  no `git` binary and no network.

  **Shaped by reading VS Code's implementation** rather than guessing: untracked directories
  recurse (`-uall`), so three new files in a new folder are three rows; rows are capped *before*
  line stats are computed, because `Patch::line_stats()` reads both sides of every changed file
  and pricing rows you're about to discard is the one way to make the poll hurt; folder dots come
  from an ancestor map built once per status result instead of a per-row `startsWith` scan (their
  `TernarySearchTree` + `findSuperstr`, minus the tree we don't need). The cap is **500 rows**,
  not their 10 000 — they virtualize, we would mount 10 000 buttons into WebKitGTK, which is
  exactly how the JSONL viewer froze the session view.

  **Three gotchas.** (1) `file_diff` and the `similar` crate were dropped: Monaco's
  `createDiffEditor` diffs two strings itself (ADR-0007), so a Rust hunk list had no consumer.
  (2) libgit2 decides binary-ness *lazily, while producing the patch* — the delta from
  `diff.deltas()` is still unflagged, so the check has to ask `patch.delta()`, or a binary file
  reports a misleading `+0 −0`. Found by probing, not by reading docs. (3) Wiring Monaco's
  `editor.worker` with `monaco-editor/esm/vs/editor/editor.worker?worker` double-resolves against
  the package's `"./*": "./esm/vs/*.js"` exports map and takes the whole lazy viewer chunk down —
  all nine existing file-viewer e2e tests went red. The correct specifier drops the `esm/vs/`.

  Verified in the real window against this repo mid-edit: 16 rows matching `git` exactly, counts
  equal to `git diff --numstat`, `mcp-session-view.png` showing `bin` and no counts, staging two
  files moving them into Staged Changes within one poll, and the tree dotting `apps` while dimming
  `node_modules` / `target`. 80 Rust tests, 61 TS, 26 e2e, clippy clean.

- **Shell chrome: the project page scrolls, and the window's rounded corners are real** —
  2026-08-13. Three small fixes found by using the app rather than by type checking. A project
  with many sessions overflowed instead of scrolling; the shell's bottom corners were square
  against a rounded window; and the rounded corners were invisible until the shell got a border to
  draw them with. Cosmetic, so no ADR (`CLAUDE.md` § 5) — but this is the class of thing the
  "launch it and use the feature" step in § 2c exists to catch.

- **factorai names its own sessions — `start_session` + `--session-id` (ADR-0008)** — 2026-08-13.
  Resume and "new session" collapsed into one act: point a PTY at a session id (F6). The backend
  picks `--resume` vs `--session-id` by probing for a transcript, so a brand-new id is real from
  t=0 — the route is linkable and the status dot works before `claude` prints a byte. Entry
  points: a hover-revealed `+` on each sidebar project row (a **sibling** of the row's `<Link>`,
  never nested inside it) and a `New session` button on the project page, which doubles as the
  empty state. The project view unions `list_sessions` with live terminals that have no index row
  yet, otherwise a session you navigate away from is unreachable until you type in it. This is
  also what finally met M2's "New session button launches `claude`" exit criterion, late.

  **Gotcha, found in QA:** `portable_pty`'s `CommandBuilder::cwd` does **not** fail on a missing
  directory — it silently starts the child in `$HOME`, filing the session under a *different*
  project than the row that was clicked. `spawn_with_argv` now refuses that spawn and says why.
  Pre-disabling the button for that case needs a `missing` flag on `Project` — **TODO item 3**.

- **Persistent xterm pool, session Stop/Restart, live status everywhere** — 2026-08-13. Terminals
  survive navigation: they live in `terminalStore`, not in a component's lifetime, so leaving a
  session and coming back reattaches instead of respawning. Status (running / idle /
  waiting-input / stopped) flows from `TerminalManager` up to the session row and aggregates onto
  the project row (F10).

- **Monaco file viewer, opened from the tree (ADR-0007) + `read_file` + markdown preview** —
  2026-08-13. M4's viewer half, landed early on the back of the file tree. ADR-0007 supersedes the
  CodeMirror 6 plan. `read_file(path, max_bytes?) -> FileContents` carries the binary and
  truncated flags; the viewer is a ~90vw modal but `FileView` itself is written self-contained and
  modal-agnostic, because the end state is a per-project tab system. `.md` opens **rendered**
  (`react-markdown` + `remark-gfm`); raw HTML deliberately stays inert text — no `rehype-raw`.
  Open state lives in the URL as `?file=`, validated on `__root` so it survives reload and HMR and
  browser-back closes it.

  Gotchas: `DialogContent`'s built-in close button is absolutely positioned at `right-4 top-4` and
  can never share a baseline with a dialog's own toolbar, so it took a `hideClose` prop;
  `automaticLayout: true` is mandatory because Monaco measures its container on create and inside
  a mid-open dialog that measures zero; and single-click-to-open cannot coexist with the tree's
  double-click-to-open-externally (the first click opens the modal, the second lands on its
  overlay), so that action moved into the viewer header. **`editor.worker` is still not wired** —
  the viewer ships worker-less on purpose; the diff editor is what forces it (**TODO item 1**).

- **Project file tree in a right panel, app top bar, and a file-type icon pipeline** — 2026-08-13.
  `list_dir(path, root?)` (sorted, `.git`-excluded, entry-capped, symlink-aware) behind
  `FileTreePanel` (F12). Three decisions came out of it, recorded as Q14–Q17: the panel lives in
  the **app shell**, not a route, because a tree that vanishes when you open a session disappears
  exactly when it's most useful — beside a running terminal; that needed somewhere to hang a
  toggle, which is what introduced the full-window `TopBar` (built at that geometry now so the M5
  custom titlebar doesn't mean restructuring the shell later); icons are **vscode-icons via
  unplugin-icons** with static per-type imports (ADR-0006 — Material Icon Theme's 1250 loose SVGs
  globbed out of a pnpm-symlinked `node_modules` is too fragile); and freshness is `staleTime` +
  focus refetch + a refresh button, **no watcher** — a recursive watcher on arbitrary project
  directories needs ignore rules, per-project lifecycle and inotify limit handling, which is its
  own feature.

  Also noted: `Ctrl+B` is unavailable as the toggle shortcut — readline's back-a-char and tmux's
  prefix — so the panel ships mouse-only pending a real binding scheme (**TODO item 5**).

- **M3 — FTS5 search** — 2026-05-29. `search_sessions(query, project_id?, limit)` over
  `messages_fts` with `snippet()` + `bm25()`, a debounced sidebar input and a `/search` route
  grouping hits by session. Queries are passed as a quoted FTS string so a stray `"` or `*` can
  never error the match. **Fork was cut** in the same pass: its only sensible entry point was a
  right-click on an event in the JSONL viewer, and that viewer no longer exists (see the
  terminal-only entry below). Not on the deferred list either — it comes back only if a concrete
  need does.

- **The window close button stopped silently doing nothing** — 2026-05-29. The quit guard (Q10)
  was correct and unreachable, behind **two** unrelated bugs. (1) In `on_window_event` you hold a
  `&Window`, and Tauri v2's `Window::emit` targets *window-level* listeners while the frontend's
  `listen()` is registered on the **webview** — so `app:quit-requested` never arrived. Rule that
  came out of it: always emit Rust→JS via the **`AppHandle`**. (`terminal:data` worked all along
  precisely because it already did.) (2) Tailwind v4's auto source detection roots at
  `apps/desktop`, so utility classes used *only* inside `@factorai/ui` primitives were never
  generated and the confirm Dialog rendered as an invisible, uncentred overlay. Fixed with
  `@source "../**/*.{ts,tsx}"` in the UI package's `globals.css`.

- **Terminal-open freeze fixed — lock-free `ChildKiller`** — 2026-05-29. Opening a terminal froze
  the whole app ("not responding"). It was a **Rust deadlock, not a WebKitGTK GPU bug**: the
  waiter thread held `child.lock()` across the blocking `child.wait()` — i.e. for the child's
  whole life — so any `kill()` needing that lock blocked forever, and because `terminal_kill` is a
  synchronous Tauri command it parked the **GTK main thread** on a futex. Fix: store a lock-free
  `portable_pty::ChildKiller` (`child.clone_killer()`) and move the `Child` into the waiter
  thread; plus `Terminal.tsx` now shares one in-flight spawn and **never kills on effect cleanup**
  (StrictMode's dev double-mount was the trigger).

  **Do not chase these again:** `WEBKIT_DISABLE_DMABUF_RENDERER=1` and
  `WEBKIT_DISABLE_COMPOSITING_MODE=1` made no difference — the freeze sits at 0% CPU on both the
  UI thread and the WebKitWebProcess. Diagnosis shortcut:
  `/proc/<pid>/task/<main-tid>/wchan` → `futex_do_wait` means blocked on a lock,
  `poll_schedule_timeout` means a healthy GTK event loop.

- **QA tooling: `scripts/qa/` + Playwright smoke lane** — 2026-05-28. `launch.sh` /
  `screenshot.sh` / `kill.sh` (plus click / key / type / geometry helpers and a
  `FACTORAI_DEVTOOLS=1` opt-in) give an agent a boot-time verification loop: does the app start,
  does the first paint render, do projects appear, did the indexer finish. Alongside it,
  `tests/smoke/` runs Playwright against `pnpm vite:dev` with the renderer in browser-only mode —
  `isTauri()` falls back to `mockInvoke()`, and fixtures are injected via `installMockBridge()`
  before `page.goto`. `.mcp.json` ships `@playwright/mcp`, pinned to chromium.

  What it does **not** catch is anything past first paint that needs synthetic input, which is why
  the Playwright lane exists at all (**TODO item 10** — note `scripts/qa/README.md`'s blanket
  "XTest input is filtered" is too strong: clicks do land, `--window`-targeted key events are what
  get dropped).

- **Session view became terminal-only; the JSONL viewer was removed** — 2026-05-28 (`c6374d6`).
  M1's `EventLog` / `EventCard` mounted 100+ stateful React components in a single paint and froze
  the WebKitGTK webview on Linux — tail-first loading with show-earlier paging bought time but not
  a fix. The session view is now terminal-first: the terminal fills the pane under a thin header.
  The only surface that renders session *content* is search results, whose `snippet()` excerpts are
  cheap and bounded. In the same performance pass the **WebGL addon was dropped** and PTY output
  batched into ~16ms windows. `get_session` / `get_session_tail` survived the removal and are now
  called by nothing (**TODO item 9**).

- **M2 — embedded PTY terminal and the kill-on-quit guard** — 2026-05-28. `TerminalManager` over
  `portable-pty`, the five `terminal_*` commands, `terminal:data` / `:status` / `:exit` events,
  and xterm.js with the fit / search / web-links / unicode-graphemes addons. PTY output is
  base64-encoded **bytes**, never UTF-8 strings — Claude's ANSI breaks at UTF-8 chunk boundaries.
  Kill-on-quit is non-optional (Q10, ADR-0005): confirm dialog on `CloseRequested`, then
  `kill_all()` (SIGTERM → 500ms → SIGKILL), also wired to `Drop` as a crash backstop. Follow-ups
  in the same window: tolerant JSONL parsing, AI-derived titles, a StrictMode guard, Tauri bump.

- **M1 — read-only session browser** — 2026-05-28. SQLite + migrations, the indexer's full scan
  and `~/.claude/projects` watcher, `list_projects` / `list_sessions` / `get_session` /
  `resolve_project_path`, `indexer:progress` + `sessions:changed`, and the sidebar / project view
  / session viewer on top. Encoded project directory names are resolved **authoritatively** from
  the first event's `cwd` field (Q4) — character-substitution decoding is only a last resort for a
  project with no sessions yet. Shipped with tests: 17 Rust (6 of them integration) + 20
  TypeScript.

- **M0 — scaffold** — 2026-05-28. pnpm monorepo, Turborepo, Biome, `mise`, Tauri 2 + Vite +
  React 19 + TanStack Router (hash history — desktop app, no server routes), `packages/types` and
  `packages/ui`. ADR-0001 through ADR-0005 landed with it: the stack, the embedded PTY, SQLite
  FTS5 for the index, `~/.claude/` is read-only, kill-on-quit is non-optional. Q13 decided this
  went straight onto `main`; branch-based work starts at M1.
