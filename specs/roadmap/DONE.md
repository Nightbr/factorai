# Done

Shipped work, newest first. Items move here from [`TODO.md`](./TODO.md) when they land; see
[`README.md`](./README.md) for the workflow.

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
  a fix. The session view is now switchboard-style: terminal filling the pane under a thin header.
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
