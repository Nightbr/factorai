# Performance

The budgets the app is held to, how they are measured, and the audit that
found where it misses them. This is a contract like every other spec: a fix
that lands without a before-and-after number against the budget it serves is a
story, not a fix, and a surface that is inside its budget gets one line here
saying so, which is worth as much as a fix because it stops the next person
re-deriving it.

It exists because of roadmap item 59, which made one measured audit a
release-blocking workstream for M6 after two unmeasured reports (items 54 and
55) arrived in the same week. The analysis those two items carried lives here
now; their roadmap entries are pointers.

---

## P1 — Scope and the one rule

**In scope.** The desktop app: the renderer (`apps/desktop/src`), the Rust
backend (`apps/desktop/src-tauri`), and the build and packaging that produce
what ships (`Cargo.toml`, `tauri.conf.json`, `vite.config.ts`,
`.github/workflows/release.yml`). Both engines, WebKitGTK and WKWebView, are
the target; the numbers in P7 are Linux only, and P8 says what that leaves.

**Out of scope.** The site (`apps/docs`, item 39), Windows under WSL 2
(ADR-0044, its own runtime branch), and anything that is a rewrite, a
virtualization project or a dependency swap done on a hunch (item 59's own
exclusion).

**The rule that bounds every fix**, restated from item 59 because it is the
one that a profile will tempt someone to break: **nothing here may be paid for
by disposing, detaching or re-creating a pooled xterm.** `Terminal.tsx`
§ "Persistent xterm pool" keeps one terminal per session alive for the app's
life, a switch toggles `visibility` in `showOnly`, and it does not reparent
because of a macOS wheel bug the comment there records. That is the change
that looks like a win in a profile and is a regression in the window. Every
finding in P5 that touches a terminal says how it stays inside this rule.

---

## P2 — How findings are scored

Each finding carries an **impact** and a **cost**, each H, M or L, and the pair
puts it in a tier. The scale is deliberately coarse; a 1 to 5 score would
claim a precision the evidence does not have.

**Impact** is what the user sees, weighted by how often: H is a stall, a
freeze or a visible lag on a surface used every session; M is visible under
load or on a large workspace, or costs idle CPU and battery all day; L is
measurable but not felt.

**Cost** is hours plus risk: L is a contained change in one or two files with
no contract change; M touches a spec, a migration or a cross-boundary type, or
needs a profile before the fix is known; H is a redesign or supersedes an ADR.

| Tier | Pairs | Meaning |
|---|---|---|
| **P1** | H impact with L or M cost; M impact with L cost | **Before the M6 tag.** Item 59's checklist in `TODO.md` lists exactly these. |
| **P2** | H impact with H cost; M with M | After the tag, in this order, each with its own measurement first. |
| **P3** | L impact at any cost; M with H | Worth a line here so nobody re-derives it; done when adjacent code is touched. |

Every finding also says whether it is **confirmed by reading**, meaning the
shape of the cost is certain from the code, or **needs a profile**, meaning
the magnitude is not. A P1 that needs a profile is measured first, and if the
number is inside the budget the finding is closed with that number rather than
fixed.

---

## P3 — Budgets (proposed)

**Every number in this table is proposed, not agreed.** They are drawn from
what a VS Code or Zed class desktop tool is held to, scaled to a webview
shell, and from the one Linux run in P7. Accepting them is a decision, and it
lands as an ADR when it is taken; until then a fix that quotes one of these
quotes a proposal. Each budget names the surface, the machine class it is for,
and the load it assumes, because a budget with no load is not a budget.

Machine class: a 2020 or later laptop, integrated graphics, SSD, warm disk
cache unless the row says cold. Workspace class: 20 projects, 300 sessions,
one 30 MB transcript among them, one repository with 10 000 commits.

| Surface | Budget | Load |
|---|---|---|
| Cold launch: exec to the window mapped | ≤ 300 ms | warm cache |
| Cold launch: exec to the sidebar populated (first paint with data) | ≤ 1.5 s warm, ≤ 3 s cold cache | workspace class; the indexer's initial scan must not gate this |
| Session switch, both terminals pooled, same checkout | header and terminal in the frame after the click: ≤ 33 ms, no `Loading…` in the panel | 10 pooled sessions |
| Session opened for the first time this run | chrome ≤ 100 ms; the body waits on the PTY replay, which is not ours | as above |
| Keystroke to glyph in the active terminal | ≤ 33 ms idle; ≤ 50 ms while 9 other sessions stream output | 10 live sessions |
| Busy output (`seq 1 1000000` in one pane) | ≤ 3 s to completion; no main-thread stall over 100 ms anywhere in the app | 10 live sessions |
| Search (F12) | ≤ 200 ms to results | 1 000 sessions indexed |
| File tree: expand a 2 000-entry directory | ≤ 100 ms to rows on screen | repository class |
| File tree: the 3 s `git_status` tick while the panel is open | ≤ 16 ms of renderer main thread per tick; ≤ 50 ms of backend per call | repository class |
| Sidebar polls (`list_sidebar` 2 s, `list_sessions` 5 s) | ≤ 5 ms and ≤ 10 ms per call; the main thread never waits more than 10 ms on the database | workspace class |
| Indexer: one live transcript changing | cost proportional to the bytes appended; ≤ 50 ms per debounced event for the 30 MB transcript; the renderer's polls never wait on it | workspace class |
| Memory: all processes, after one hour | ≤ 1.5 GB RSS across the app and its WebKit helpers | 10 live sessions, panel open |
| Shipped size | AppImage ≤ 70 MB; `.dmg` ≤ 20 MB | today 88 MB and 26 MB |
| Renderer entry chunk | ≤ 800 KB minified; Monaco, pdf.js and mermaid stay lazy | today 1.42 MB |

**What a budget is not.** A target to optimise past. A surface that is inside
its budget is done, and the entry in `DONE.md` for it is one line.

---

## P4 — How things are measured

**In the real window, never only in Playwright.** The smoke suite runs the
renderer in Chromium against a mock bridge; it cannot see an engine, a PTY,
the database or the main thread. A number for this spec comes from the
`manual-qa` lane on a release build, or from the dev build with the React
profiler when the question is renderer-side.

**By signals, not screenshots.** Launch timing uses `wmctrl -lp` for the
window-mapped instant, the app's own `RUST_LOG=info` timestamps for what the
backend did and when, and `/proc/<pid>/status` for RSS. First paint with data
needs a signal the app emits itself, a log line on the first `list_sidebar`
answer, and that signal does not exist yet; it is the first thing P5 asks
for. Capture tooling is for a single confirming screenshot at the end of a
verification, never a polling probe: on 2026-09-20 a 50 ms loop of window
activation plus capture took down the desktop session it ran in.

**Backend numbers come from `tracing` spans and SQLite's own tools.** A span
around `setup()`, around each indexer transaction and around the two polled
commands gives the backend column of P3 for free; `EXPLAIN QUERY PLAN` is the
proof for anything that claims a scan became a lookup.

**Renderer numbers come from the React profiler and the engine's timeline.**
Commits per second on a surface while idle, and the longest task on the main
thread during a switch, a drag and a busy-output run.

**Both engines.** WebKitGTK and WKWebView have already diverged on zoom,
clipboard and scrolling; a renderer fix measured on one is half measured. P7's
numbers are Linux; the macOS column is empty and P8 says who fills it.

**A fix records both numbers.** The `DONE.md` entry for a finding quotes the
number before, the number after, the machine, the workspace and the commit.

---

## P5 — Findings

Ordered by tier, then by impact. Ids are permanent, like roadmap numbers, so
`DONE.md` and code comments can cite them. Paths are relative to
`apps/desktop/`; `src-tauri/src/` is shortened to `rs/` and `src/` to `ts/`.
Line numbers are as of `main` at `9c1faf9`, 2026-09-20.

### P1 — before the M6 tag

**PERF-01 — Deleting a session's rows from `messages_fts` is a full-table scan.**
Impact H, cost M, confirmed by reading. **Landed 2026-09-20** (ADR-0053,
migration 0020); the numbers are at the end of this entry.
`session_id` is declared `UNINDEXED` in the live FTS5 table
(`rs/db/migrations/0004_workspace_projects.sql:144-149`). FTS5 keeps an
`UNINDEXED` column only in its content table with no index, so
`DELETE FROM messages_fts WHERE session_id = ?1` scans every row of every
session. It runs on every re-index (`rs/services/indexer.rs:634`), on reap
(`:425`, `:441`), on delete (`rs/services/sessions.rs:315`) and on project
removal (`rs/commands/projects.rs:198`), always inside a write transaction
that holds the one database lock (PERF-02). At hundreds of sessions this is
the length of every main-thread stall the sidebar polls feel.
*Fixed by* an external-content FTS5 index over a real
`messages(id, session_id, role, body)` table with a b-tree on `session_id` and
the standard triggers, which also gives PERF-03 a rowid to append after. The
alternative, dropping `UNINDEXED` and matching on the id, was rejected for the
reason ADR-0053 gives: it puts UUIDs through the porter tokenizer and makes
every unqualified `MATCH` search the identity column.

*Measured*, on copies of the live 232-session index and on the same data grown
ten and fifty times. `EXPLAIN QUERY PLAN` went from `SCAN messages_fts` to
`SEARCH messages USING COVERING INDEX idx_messages_session`.

| Index size | Delete a 363-row session, before | after |
| --- | --- | --- |
| 232 sessions, 6 014 rows | 8.0 ms | 4.8 ms |
| 2 320 sessions, 60 140 rows | 29.7 ms | 5.6 ms |
| 11 600 sessions, 300 700 rows | 121.2 ms | 8.9 ms |

Deleting a **one-row** session went from 2.5 ms to 0.0 ms, which is the shape
of the win: the cost is the session's own rows now, not the table's. Search is
unchanged in what it returns (the same 112 hits in the same order with the same
snippets) and costs 8.7 ms through the app's own `search()` at the live size,
inside the 200 ms budget. The migration itself is 123 ms on the live index,
once, and does not re-parse a transcript.

**PERF-02 — One SQLite connection behind one mutex, and the indexer writes through it.**
Impact H, cost M. **Landed 2026-09-20**; the numbers are at the end of this
entry, and the remaining half is named there too.
`Db` is `Arc<parking_lot::Mutex<Connection>>` (`rs/db/mod.rs:103-112`; its
own comment says to pool "if it ever becomes the bottleneck"). Every
synchronous database command, which is every one but the six git commands,
takes that lock on the main thread, and the indexer holds it for the whole of
each session's write transaction (`rs/services/indexer.rs:602-645`), which
contains PERF-01's scan. WAL is on (`rs/db/mod.rs:121`) and its
concurrent-reader property is unused. At launch the renderer's first
`list_sidebar` and `list_sessions` arrive while `full_scan` commits one
transaction per session (G2 in the audit), so first paint with data waits on
the scan; after a `PARSE_VERSION` bump it waits on all of it.
*Spec drift to fix first.* `specs/03-backend-rust.md` § "State management"
already describes an "r2d2-style pool, 4 connections" and a `tokio::spawn`ed
scan; the code is one connection and named threads. Correct the spec to what
is there, then land the pool it wanted.
*Fixed by* a third accessor rather than by changing what the existing two
mean. `Db::with` and `Db::with_mut` still take the writer and still serialise
everything they serialised; `Db::read` takes one of at most four pooled
connections opened **read-only**, so a caller that turns out to write fails
loudly instead of quietly stepping outside the single-writer discipline. That
is what makes moving a caller across provable rather than a judgement, and it
is why the move is being done a few callers at a time instead of all at once.

Moved so far: `list_sidebar`, `list_sessions`, `list_projects` and
`search_sessions` — the two polls, the flat project list every other surface
reads, and search.

*Measured* against a copy of the live index, with a writer holding a
transaction the way an indexer commit does:

| While the writer holds for | `Db::read` (now) | `Db::with` (before) |
| --- | --- | --- |
| 100 ms | 0.42 ms | 105.7 ms |
| 400 ms | 0.33 ms | 400.1 ms |

Uncontended, the two polled commands are inside their P3 budgets:
`list_sidebar` 0.22–0.36 ms against 5 ms, `list_sessions` 1.8–1.9 ms for a
90-session project against 10 ms.

*What is left, and it is PERF-07's commit.* These commands are still
synchronous, so they still run on the thread that paints — they simply no
longer wait there. The `spawn_blocking` half is tracked as part of PERF-07.

**PERF-03 — A changed transcript is re-read, re-parsed and re-tokenised in full.**
Impact H, cost M. **Landed 2026-09-20** (migration 0021); the numbers are at the
end of this entry.
`index_session_if_changed` (`rs/services/indexer.rs:459-648`) compares
`(mtime, size)` and then parses every line of the file
(`:529-583`, `serde_json` per line with a `Value` body and a flattened
`extra` map) and re-inserts every message (`:634-642`). Transcripts are
append-only; the indexed prefix is never reused. A live session with a 30 MB
transcript pays a 30 MB parse per one-second debounce window, then PERF-01
under PERF-02's lock. The whole text is also held in memory for the parse
(`:522`, `:580`), which the spec's "streams" claim at
`03-backend-rust.md:408-411` does not describe.
*Fixed by* a resume offset of its own rather than by reusing `file_size`, which
turned out to be the one thing it must not be. A read lands inside the line
Claude is writing often enough to matter, that line is skipped as malformed, and
resuming from the file's size would skip the rest of it forever — one event
lost, silently, on exactly the sessions someone is watching. `indexed_bytes`
instead records what the parser finished with: every line whose event it took,
and every whole line it permanently skipped. A line that parsed without its
newline counts; a truncated one does not.

The second thing the tail could not do on its own is the title. A full parse
settled `/rename` over Claude's own title over the derived one by reading the
whole file; a tail parse sees only what was appended, so `title_kind` records
which of the three the stored title is and the tail is ranked against it.

Four conditions send it back to a full parse, each a way the prefix could have
stopped being what was read: `parse_version` behind, no `title_kind` (a row
from before the migration, which costs one full parse and is resumable after),
a file smaller than `indexed_bytes`, and — the one a cheap check misses — a
transcript rewritten to the same size or larger, caught by reading one line at
the offset and seeing whether it is a line at all.

*Measured* on synthetic transcripts of the shape the budget names, timing one
appended turn:

| Transcript | Re-index before | after |
| --- | --- | --- |
| 5 MB, 3 989 events | 288 ms | 14.5 ms |
| 31 MB, 23 903 events | 4.71 s | 32.2 ms |

The 31 MB figure is inside the P3 budget of 50 ms per debounced event, which it
missed by about ninety times before. First indexing a transcript is unchanged
and still proportional to its size: 1.0 s for the 31 MB file, once.

*Still open.* PERF-16, the other half — one watcher event still re-checks every
transcript in the directory rather than the one that changed.

**PERF-04 — Hidden pooled terminals are still rendered, not only laid out.**
Impact H at ten live sessions, L at two; cost L to M. **Landed 2026-09-20**,
with a measured gain and one open question, both at the end of this entry.
**Still owed: the macOS run.**
Item 54 said a background session's rows are "laid out, never painted". xterm
pauses its renderer through an `IntersectionObserver`; `showOnly` hides with
`visibility: hidden` (`ts/components/terminal/Terminal.tsx:258`) on hosts
stacked `absolute inset-0` (`:275`), and a visibility-hidden box with layout
still intersects, so every hidden terminal's DOM rows are rewritten on every
write for as many sessions as have ever been opened this run. The routine
pane at `left: -10000px` (`:535-536`) is non-intersecting and so is paused,
which is the proof the mechanism works.
*Fixed by* `translateX(-200vw)` on every pooled host that is not the visible
one, alongside the `visibility: hidden` that was already there. The transform
does not affect layout, so `clientWidth` and `clientHeight` are unchanged and
`fitToHost` still measures the pane; the host never leaves the document, so the
wheel-region bug the pool exists to avoid cannot return. Leftwards on purpose:
overflow past the left edge is clipped, past the right it is scrollable and
would give the pane a horizontal scrollbar for a terminal nobody can see.

The mechanism is confirmed in xterm's own source: `RenderService` registers an
`IntersectionObserver` at `threshold: 0` on the screen element and sets
`_isPaused` from it, `refreshRows` becomes a flag while paused, and becoming
visible flushes a full refresh. A `@smoke` test in `tests/smoke/terminal-pool.spec.ts`
holds the contract.

*Measured* in the browser lane (ten pooled sessions, one visible, the same
output emitted to all of them), counting DOM writes under each background
terminal's `.xterm-rows`:

| Output burst | Writes per background terminal, before | after |
| --- | --- | --- |
| 40 chunks | 41 | 0 |
| 400 chunks | 180 | 90 |

All nine hidden screens report `isIntersecting: false` after the change, so
xterm's pause flag is set on every one of them.

*Open, and it is why this entry does not claim more than it measured.* At the
larger burst half the writes survive the pause, and the hidden rows still end
up holding the latest output. Something writes rows on a path `_isPaused` does
not gate; at moderate volume nothing does. Worth one real-window profile before
anything further is built on it.

*Still owed: macOS.* This is the one P1 fix Linux cannot prove. The wheel
region that the pool's design is built around exists only on WKWebView, and a
transform on the host is exactly the kind of change it would notice. Verify in
the real window before the tag.

**PERF-05 — `list_sessions` runs up to ten `realpath()` per row, every 5 s, on the main thread, under the database lock.**
Impact M to H on session-heavy workspaces, cost L to M. **Landed 2026-09-20**;
the numbers are at the end, and they are smaller than the entry expected.
`rs/commands/sessions.rs:100-104` canonicalises `cwd`, `last_cwd` and up to
eight `touched_paths` per row through `std::fs::canonicalize` (`:142-144`)
inside `state.db.with` (`:18`), and the renderer asks for it every 5 s per
expanded project (`ts/components/layout/SidebarProject.tsx:561-565`). At 300
sessions that is about 3 000 `realpath()` calls, each stat-ing every path
component, per poll per expanded project.
*Fixed by* resolving each distinct path once per call. The rows come out of
SQLite with their stored paths and one pass over the list resolves them through
a map that lives and dies with the call — deliberately not a longer-lived
cache, because these are answers about a filesystem that moves and a cache
nobody invalidates is a worse bug than the syscalls. The lock half of the
finding was already gone: PERF-02 moved this command onto a pooled reader.

*Measured* on the live workspace's busiest project, 90 sessions:

| | |
|---|---|
| Paths resolved per call | 593 before, 305 after |
| Resolution step | 1.26 ms, 0.63 ms |
| Whole command | 1.9 ms, 1.3 ms |

**Smaller than this entry predicted, and worth saying so.** It assumed ten
paths a row and three hundred sessions; the real shape is about six and a half
paths a row, and the busiest project here has ninety. The command was already
inside its 10 ms budget before the change and is further inside it now. The
saving grows with how much a project's sessions share directories, which is
total for `cwd` and partial for the touched paths.

Resolving at index time into their own columns was the other candidate and is
not being built: the numbers do not ask for it.

**PERF-06 — No `[profile.release]`.**
Impact M, cost L. **Landed 2026-09-20**; numbers at the end.
`Cargo.toml` has no release profile, and there is no workspace-level or
`.cargo/config.toml` one, so the shipped binary is built with sixteen codegen
units, no link-time optimisation, `panic = "unwind"` and full symbols. The
universal macOS build carries two such binaries. Tauri's own guidance is
`lto = true`, `codegen-units = 1`, `strip = true`, `panic = "abort"`, with
`opt-level` left at 3 for speed.
*Fixed with* `opt-level = 3`, `lto = "thin"`, `codegen-units = 1`,
`panic = "abort"` and `strip = true`. `opt-level` stays at 3 rather than
Tauri's `"s"`: the hot paths here are a JSONL parser, an FTS5 index and a PTY
pump, and trading their speed for megabytes is the wrong way round when
`strip` and `lto` do most of the shrinking anyway.

**`panic = "abort"` is the one with a consequence.** A panic inside
`spawn_blocking` surfaced as `AppError::Process` through `commands::off_main`
and the renderer toasted it; the process now ends instead. That is the honest
behaviour for a panic in a background task holding a database lock or a PTY,
and it is what makes the unwinding tables removable.

**It has to be in the workspace root, and it was written in the member first.**
Cargo reads `[profile.*]` from the root only and *silently ignores* a member's
— the warning is one line in a build that otherwise succeeds. The member copy
changed the binary by one kilobyte and looked like it had worked.

*Measured*, Linux x86-64:

| | before | after |
|---|---|---|
| Binary | 28.2 MB | 16.4 MB |
| Release build from clean | 57 s | 4 m 43 s |

42% off the binary, and the macOS universal build carries two of them. The
build time is the price, and it is paid by CI and by whoever cuts a release
rather than by anyone developing — `cargo build` without `--release` is
untouched.

**PERF-07 — Synchronous commands that spawn a process, walk the store or wait on I/O run on the thread that paints.**
Impact M, cost L each. **Landed 2026-09-20**; what was done, what was measured
and what was deliberately not done are at the end of this entry.
Thirty-nine commands are synchronous and six are async; a synchronous Tauri
command runs on the GTK or AppKit main thread, which is the class of bug
`DONE.md`'s terminal freeze was. Most are microseconds. These are not:
- `terminal_spawn` (`rs/services/terminal.rs:1134-1383`): a `which claude`
  process and possibly a login shell per spawn unless the F11 override is
  set (`rs/services/claude_cli.rs:47-67`, `:96-144`), two TCP binds, a
  lockfile write, `openpty` and fork; and a spawn in the first seconds, or
  the routine runner's immediate first tick, blocks on the login-shell PATH
  `OnceLock` for up to its 5 s timeout (`rs/services/shell_path.rs:72`, `:85-87`).
- `sops_decrypt` and `sops_encrypt` wait for `sops`, which can mean a KMS
  round trip (`rs/services/sops.rs:132-143`, `:176-214`).
- `reveal_in_file_manager` waits up to 3 s on D-Bus (`rs/services/reveal.rs:74-78`, `:118`).
- `list_import_candidates` walks every store directory twice
  (`rs/commands/projects.rs:221-260`, `rs/agents/claude.rs:93-168`).
- `get_session_tail` parses every event before `offset` to skip it
  (`rs/commands/sessions.rs:161`).
- `check_claude_cli` and `validate_claude_binary` run `claude --version` with
  a 2 s timeout (`rs/services/claude_cli.rs:82-94`, `:193-215`).
- `delete_session` calls `trash::delete_all` (`rs/services/sessions.rs:290-297`);
  `set_session_worktree` and `ide_mention` open a repository
  (`rs/commands/sessions.rs:275`, `rs/services/terminal.rs:690`, the latter
  under a `DashMap` read guard).
- `read_image` and `read_pdf` read up to 16 MB and 32 MB and base64 them into
  a JSON response on the same thread (`rs/services/files.rs:198-206`,
  `:262-287`); a large PDF is a visible freeze. This one is PERF-18's shape
  and its fix is different.
*Fixed by* promoting `commands/git.rs`'s `off_main` to `commands::off_main`
and putting all thirteen behind it: `terminal_spawn`, `shell_spawn`,
`sops_decrypt`, `sops_encrypt`, `check_claude_cli`, `validate_claude_binary`,
`reveal_in_file_manager`, `list_import_candidates`, `get_session_tail`,
`read_image`, `read_pdf`, `delete_session` and `ide_mention`. Each clones what
it needs out of `State` first, because `State` cannot cross the boundary.

`get_session_tail` also stopped deserialising the events it skips.
`Iterator::skip` built a `SessionEvent` for every event before the hundred it
wanted, only to drop it; `EventIter::skip_events` counts lines instead. The
bytes are still read — a JSONL file has no index — so this is the part that
was avoidable, not all of it:

| Reading the last 100 events of a 33 MB transcript | |
|---|---|
| `Iterator::skip` | 37–58 ms |
| `skip_events` | 30–32 ms |

**Caching the discovered `claude` binary was dropped, and not for cost.**
`03-backend-rust.md` § "`find_claude_binary()`" already decided against a
resolution cache, and the reason still holds: `claude.binary` is the *user's
override* since F11, a cache sharing that key could not tell a probe's guess
from somebody's choice, and a cache is what goes stale the day `claude` moves.
Moving the spawn off the main thread removes the harm the cache was being
proposed against.

*What is not measured.* The rest of this is structural: a synchronous command
runs on the main thread and an `async` one does not, which is a fact about
where the code runs rather than a number. What a number would show — the window
still painting during a decrypt, a reveal, an import — is a real-window
observation, and it is owed on both engines with the rest of P8.

**PERF-08 — `link_worktrees` opens libgit2 inside the database write transaction.**
Impact M, cost L. **Landed 2026-09-20**; numbers at the end.
`rs/commands/projects.rs:314-354` runs `git::worktree_paths` per workspace
project (a discover, a `.git/worktrees` walk and a `canonicalize`,
`rs/services/git.rs:1097-1107`) from `reconcile` (`:278-294`), which runs
inside `discover()`'s transaction (`rs/services/indexer.rs:235`, every full
scan and every scan of an unknown directory) and inside `add_project_in`'s
(`:172`, main thread). The comment at `:311-313` knows.
*Fixed by* `checkout_owners`, which builds the checkout-to-project map before
the transaction opens — and on a pooled reader (PERF-02), so it does not wait
for the writer either. `reconcile` takes the map and does SQL only.

`add_project_in` is the one caller for which a stale map would matter, because
the project it is adding is not in the table yet; it claims that project's own
checkouts in the map before starting. Claiming leaves alone anything another
project already owns, so an idempotent re-add finds the existing entry rather
than overwriting it — the same first-wins rule the map always had.

*Measured* on the live workspace, 9 projects and 23 discovered directories:

| | |
|---|---|
| Write transaction held | 1.46–1.82 ms before, 0.14–0.19 ms after |
| The libgit2 walks, now outside it | 1.34–4.04 ms |

A tenth of the time in the lock, on local SSD. The walks themselves have not
got cheaper and are not meant to have; they are simply no longer somewhere
every reader is waiting. On a filesystem where a `.git/worktrees` listing is
slow — WSL's 9p, which `services/wsl.rs` exists for — the gap is the one that
grows.

**PERF-09 — Switching session (item 54).**
Impact M, cost L; the `projectCwd` half is confirmed by reading, the rest
needs the profile item 54 asks for. The analysis moved here from the roadmap.
- `SessionView` reads `list_projects`, `list_sessions` and `list_profiles`;
  `projectCwd` is `null` until `list_projects` answers
  (`ts/routes/session.tsx:51-56`) and is in the dependency list of
  `Terminal`'s mount effect (`ts/components/terminal/Terminal.tsx:697`), so
  a cold switch runs that effect twice, the first run reaches `attachPty`
  with a null cwd, and the cleanup sets `visibility = 'hidden'` (`:695`)
  before the second run's `showOnly` re-shows it, which is a flicker. Fix on
  its own merits whatever the profile says.
- The first frame is deliberately the old grid: `fitToHost`, `scrollToBottom`
  and `focus` are deferred into a `setTimeout(…, 0)`, and an adopted host gets
  a second `fitToHost` and a full `refresh` in a `requestAnimationFrame`.
  Both are correct, and both are where a switch is seen to settle rather than
  appear.
- The panel re-roots on the switch: confirmed free by reading.
  `useActiveCheckout`'s memo inputs change per session but `root` stays the
  same string for one checkout, `PanelBody` only seeds it, no query key
  changes. What does happen is PERF-10's re-render of every row through
  `useParams` and `useSearch` on the navigation itself.
- Every hidden terminal still has layout: understated, see PERF-04.
*Measure.* Click-to-first-paint for the three cases item 54 names: pooled,
first open this run, and a cross-project switch.

**PERF-10 — Every file-tree row mounts five query observers, three router subscriptions and its own decoration index.**
Impact H on a large repository with the panel open, cost M. **Landed
2026-09-20**, and the profile it asked for says the surface is still outside
its budget afterwards — see the end of this entry and PERF-29.
`FileTreeNode` (`ts/components/files/FileTreeNode.tsx:77`) calls
`useGitDecorations`, which calls `useGitStatus`, which calls
`useActiveCheckout`, which is `useActiveProject` plus `useWorktrees` plus a
sessions query plus the status query (`ts/hooks/useGitDecorations.ts:83`,
`ts/hooks/useGitStatus.ts:34-37`, `ts/hooks/useActiveCheckout.ts:73-86`);
plus the row's own directory query (`FileTreeNode.tsx:94`, disabled for files
but still an observer), `useFileViewer` with `useSearch` and `useNavigate`,
and two `useParams`. Per visible row that is five observers notified on every
3 s `git_status`, 5 s `list_sessions` and 30 s `git_worktrees` result;
`buildDecorations` (`useGitDecorations.ts:87-91`) is a `useMemo` per row
instance, so the "once per status result" its comment promises is once per
row per result; and every navigation re-renders every row. `list_dir` caps a
directory at 2 000 entries (`rs/services/files.rs:25`), so one expanded
`node_modules` is 2 000 rows times all of the above. `FileTreeNode` is not
memoised and nothing is virtualised.
*Fixed by* `FileTreeProvider`: `PanelBody` resolves the checkout root, the
project, the active session, the viewer and the decorations once and puts them
in a context, and `FileTreeNode` is `memo` with `entry`, `depth` and `siblings`
as its props — all three come out of a TanStack cache entry or are a number, so
a poll that changed nothing does not re-render the tree. The per-row directory
query stays, because it is the row's own data.

*Measured* in the browser lane, expanding a 2 000-entry directory and then
firing one event at the settled tree:

| | before | after |
|---|---|---|
| Click to 2 000 rows on screen | 3 804 ms | 1 911 ms |
| Long tasks on the next event | 7, totalling 9 171 ms | 2, totalling 1 918 ms |
| A 1 500 ms timer set after that event actually fired at | 55.6 s | 15.3 s |

That last row is the one to read twice: the main thread was so far behind that
a timer set for a second and a half took the better part of a minute. It is
five times better and still not acceptable.

**The budget is 100 ms and this is 1 911 ms, so the conditional in the original
fix has resolved: the profile does ask for virtualization.** That is its own
piece of work and its own finding — PERF-29 — because item 59's scope
explicitly excludes starting a virtualization project on a hunch, and this is
no longer a hunch.

**PERF-11 — Idle polling: the sidebar every 2 s, every expanded project every 5 s, the working tree every 3 s, and all of it while the window is merely unfocused.**
Impact M, cost L. **Landed 2026-09-20**; numbers and what is left at the end.
- `list_sidebar` every 2 s (`ts/components/layout/Sidebar.tsx:183-187`) runs
  two correlated aggregate subqueries per project
  (`rs/commands/projects.rs:24-38`) and re-diffs the tree; under the `recent`
  sort a changed `last_session_at` moves a row under the pointer.
- `list_sessions` every 5 s per expanded project
  (`SidebarProject.tsx:561-565`), the full summary list with `touchedPaths`,
  re-sorted by recency each time (`:567`); the tab strip holds a second
  observer set on the same key for titles alone
  (`ts/components/session/SessionTabs.tsx:493-507`).
- `git_status` every 3 s while the panel is open
  (`ts/hooks/useGitStatus.ts:37-45`) is a fresh `Repository::discover`, a
  full `statuses()` with untracked recursion and renames, and two diffs with
  per-row patches (`rs/services/git.rs:56-129`, `:873-882`, `:992-1070`);
  ADR-0035 measured 100 to 120 ms per call on a 8 900-commit repository. Off
  the main thread, but a few percent of a core forever, more on a monorepo.
- `sessions:changed` (`ts/hooks/useSessionsSync.ts:53-62`) already
  invalidates sessions, projects and worktrees, so the 2 s and 5 s polls are,
  per their own comments, "the net under a missed event".
- TanStack pauses intervals only when `document.visibilityState` is
  `hidden`; a window behind another app keeps every poll running on both
  engines. `useGitStatus`'s comment assumes a backgrounded app is silent; it
  is silent only when minimised or on another workspace.
*Fixed by* two changes, and the first is the one that matters.

**`focusManager` now knows what a window is.** TanStack's default listener is
`visibilitychange`, which a desktop window reaches only when it is minimised or
on another workspace — sitting behind a browser it is `visible`, so every
interval in the app kept running for a window nobody was looking at.
`lib/queryFocus` listens to Tauri's own `tauri://focus` and `tauri://blur` as
well, which makes `refetchIntervalInBackground: false` mean what it says.

**And the two sidebar polls went from 2 s and 5 s to 15 s**, with
`refetchOnWindowFocus` on. `sessions:changed` is the mechanism and always was;
the polls are the net under a missed event, and their own comments said so.

*Measured* in the browser lane, two projects, one expanded, panel open,
counting backend calls over a 30-second idle window:

| | before | after |
|---|---|---|
| Window focused | 21 | 4 |
| Window behind another application | 21 | 0 |

The second row is the whole finding: before, blurring changed nothing, because
the event the focus manager was listening for never fired.

**And it found a bug the poll was hiding.** Three mutations that change which
projects exist — remove, import and add-by-picker — invalidated
`queryKeys.projects()` and not `queryKeys.sidebar()`. Those are different keys
on purpose (ADR-0025: one is the flat membership list, the other is the
arrangement), and the sidebar draws from the second. At a two-second poll the
row went on the next tick and looked like the invalidation working; at fifteen
it took fifteen seconds. Three smoke tests caught it. All three sites now
invalidate the tree as well, which is what the finding's other option — "emit a
`sidebar:changed` from the writes that reorder it" — was reaching for.

*Still open.* `git_status` still re-diffs the whole worktree every three
seconds while the panel is open and the window is in front — it is the most
expensive poll in the app, 100–120 ms per call on an 8 900-commit repository
per ADR-0035. Gating the diff on `.git/index`'s mtime and size plus the HEAD
oid is backend work of its own and is not done here.

**PERF-12 — Persisted Zustand stores write `localStorage` on every `set`, including per-frame drag and resize sets.**
Impact M during a drag, cost L. **Landed 2026-09-20**; numbers at the end.
Zustand's `persist` runs `partialize`, `JSON.stringify` and `setItem` on
every state change whether or not the persisted slice moved.
`viewerStore.setShellWidth` runs from `AppShell`'s `ResizeObserver`
(`ts/components/layout/AppShell.tsx:84`), one write of the tabs JSON per
resize frame although `shellWidth` is excluded from `partialize`
(`ts/store/viewerStore.ts:294-297`); `sidebarStore.setWidth` and the six
`panelStore` size setters (`ts/store/panelStore.ts:254-259`) run per
`pointermove` from `PanelResizer` (`ts/components/layout/PanelResizer.tsx:73`),
and those are persisted, so every drag frame is a synchronous serialise and a
SQLite-backed write on WebKitGTK.
*Fixed by* the third option, which covers all seven persisted stores with one
change instead of auditing every setter: `lib/persistStorage` holds the value
as an object and writes it after 150 ms of quiet, so a burst becomes one
`JSON.stringify` and one write. A pending write is flushed when the page is
hidden or unloaded, and a read sees a pending value, so a rehydrate inside the
window cannot read a state the store has already left.

*Measured* in the browser lane, a 60-step drag of the sidebar's resizer,
counting writes to `factorai.*` keys:

| | before | after |
|---|---|---|
| Writes | 60 | 13 |
| Bytes serialised | 4 980 | 1 002 |

Six unit tests in `persistStorage.test.ts` cover the coalescing, the read of a
pending value, the flush on the way out, the removal of a queued write, corrupt
JSON and a storage that refuses.

**PERF-13 — The markdown preview re-parses on every host render, and mermaid multiplies it (item 55).**
Impact M, cost L, confirmed by reading. The analysis moved here from the
roadmap; nothing in this audit contradicts it.
- `MarkdownView` is not memoised and react-markdown 10 has no incremental
  parse; its host `FileView` holds the edit buffer's state machine, the SOPS
  plaintext and its four states, a `sops` status query, the footer's
  selection and the preview toggle, and every one of those re-parses the
  document. `remarkPlugins={[remarkGfm]}` and the `components` object are
  fresh literals per render, so no `memo` could bail out today.
  `previewSource` reads a ref during render (`ts/components/viewer/FileView.tsx:304`,
  passed at `:404-406`); it works because the editor is unmounted while the
  preview is up, and whatever shape the memo takes has to make that explicit.
- `loadMermaid` reads the palette off the document on every call, nine
  `getComputedStyle` reads and a forced style recalculation per diagram, to
  compute a key that is almost always the last one; the configuration is
  cached behind `configuredFor`, the reads are not. A palette moves on a
  theme switch, which is an event.
- Every diagram renders independently and concurrently against the one
  global mermaid instance, each `render` hands back an SVG string that is
  parsed a second time with `DOMParser`; twenty diagrams do that twenty times
  on the first frame the preview is up. A `code` change empties the host
  before the new SVG lands, so each diagram collapses to zero height and the
  page reflows through it; keeping the old SVG until the new one is ready
  costs nothing.
- The 2.5 MB dynamic `import()` (ADR-0021) is paid once, only by documents
  with a fence, and stays.
*Fix.* `remarkPlugins` a module constant; `components` a `useMemo` on
`[path, onOpenPath]`; `memo(MarkdownView)`; cache the palette reads behind
the theme event; queue diagram renders; keep the old SVG during a re-render.
*Measure.* With the profiler: a keystroke in the footer's search, a save and
a `sops` query settling each stop re-parsing; then a genuinely large document
before deciding chunked rendering is needed at all.

**PERF-14 — Background PTYs are flushed at the active session's cadence.**
Impact M at ten live sessions, cost L. **Landed 2026-09-20**; what it does and
what it deliberately does not are at the end.
Each PTY has a reader thread, a flusher thread that wakes every 16 ms
unconditionally and emits up to 32 KiB pieces (`rs/services/terminal.rs:1519-1522`,
`:1575-1598`), and a waiter thread; ten PTYs are thirty threads and six
hundred wake-ups a second at idle, and a hidden session's output crosses IPC
at full rate although `UiState::is_active` exists and the manager holds it
(`rs/services/ide/ui_state.rs:54-56`, `terminal.rs:485`). There is no
backpressure: the reader-to-flusher buffer is unbounded, and if the main
thread stalls (PERF-02) events pile up and burst.
*Fixed by* a flush window that is 16 ms for the session in front and 100 ms
for one that is not: ten events a second instead of sixty, for each terminal
nobody can see. It changes how many pieces the bytes arrive in and nothing
else — no xterm is touched, which is what keeps it inside P1's rule.

**The condition is `is_backgrounded`, which is not the negation of
`is_active`.** `is_active` answers "may this bridge take the window", where no
answer means no; a PTY needs "is some *other* session definitely the one being
watched", because before the renderer's first `ide_report_ui` nothing is named
and the session may well be the one you are looking at. Writing it as
`!is_active` slowed every terminal for the first moments of a run, and the
existing PTY streaming test caught it.

**Status is untouched, and that is the property that makes this safe.** The
title scanner runs in the reader thread, not the flusher, so a background
session's dot still changes the moment its title does.

*Not measured as a number.* What this changes is events per second, which is
arithmetic — sixty to ten per background terminal — and its effect on the
renderer is PERF-04's measurement, taken with the terminals already paused.
The shared ticker the entry also suggested is not built: thirty threads for ten
PTYs is a shape worth revisiting, and it is not what this finding was about.

### P2 — after the tag, each measured first

**PERF-15 — `terminal:data` is base64 inside JSON inside a JavaScript string, evaluated on the main thread, then decoded again.**
Impact M to H under load, cost M (supersedes ADR-0002's event choice),
needs a profile.
One emit is one `webview.eval()` per webview carrying the payload once
(verified in tauri 2.11.2); a busy session is up to 60 evaluations a second
of up to 43 KB of source, then `JSON.parse`, then `atob` and a char-code loop
(`ts/lib/base64.ts:5-10`) before `term.write`. Each pooled terminal also holds
its own `terminal:data` and `terminal:exit` listener for the app's life
(`Terminal.tsx:453-472`), so every chunk from any terminal invokes N callbacks
that compare `ev.id` and return. Tauri 2's `ipc::Channel` with
`InvokeResponseBody::Raw` delivers bytes over the custom protocol with no
base64, no JSON and no script evaluation.
*Fix.* `terminal_subscribe(id, Channel)` per pooled terminal, one listener
each; keep the event for the mock lane; a spec change in `03-backend-rust.md`
§ "Tauri events", the `packages/types` mirror, and an ADR superseding
ADR-0002's transport.
*Measure.* Main-thread time per chunk on WebKitGTK with `cat` of a large
file, and the keystroke-to-glyph budget under load, before and after.

**PERF-29 — The file tree is not virtualized, and at 2 000 rows it is nineteen times its budget.**
Impact H on a large repository, cost M to H, measured 2026-09-20.
`list_dir` caps a directory at 2 000 entries (`rs/services/files.rs:25`) and
`FileTreeNode` renders every one of them (`ts/components/files/FileTreeNode.tsx:245-254`).
After PERF-10 removed the per-row query observers and memoised the row,
expanding such a directory still takes **1 911 ms** against a 100 ms budget,
and the main thread stays busy long enough afterwards that a 1 500 ms timer
fires at 15 s.
*Fix.* A windowed list over the rows. The tree is recursive and each node
fetches its own listing, so there is no flat list of what is visible — which is
the same thing that limits shift-click to one directory today. Building one is
the work.
*Measure.* The same two numbers as PERF-10, against the 100 ms budget.

**PERF-16 — One watcher event re-checks every transcript in the directory.**
Impact M, cost L to M, confirmed by reading. Lands with PERF-03.
`scan_dir_path` (`rs/services/indexer.rs:279-300`) lists the directory, stats
every transcript, runs a `SELECT` under the lock per session, lists each
session's `subagents` directory and runs `reap_deleted`'s query, although the
event named the file (`rs/services/watcher.rs:553-573` collapses it to the
directory on purpose). Five hundred sessions is about a thousand syscalls
and five hundred lock takes per second of live output.
*Fix.* Carry the changed paths into `index_dir`; full listing and reap only
when a path is new or gone; batch the mtime `SELECT` per directory.

**PERF-17 — The entry chunk is 1.42 MB and carries every route, the settings modal, routines, the graph and the browser-lane mock bridge.**
Impact M on cold launch, cost L to M, needs a profile.
`App.tsx:4-8` imports all four routes statically; `routes/__root.tsx:3-6`
imports `SettingsModal`, `FileViewerModal` and `QuitConfirm`; `project.tsx`
pulls the routines editor and `lib/cron`; `FileTreePanel.tsx` pulls
`GraphView`. `ts/lib/tauri.ts:578-1468`, about 890 lines of mock bridge and
fixtures, ships in production because the switch is a runtime `isTauri()`
(`:56-68`), not `import.meta.env.DEV`, so Rollup cannot drop it; `AGENTS.md`
says no mock data baked into the renderer, and the mock bridge is.
`FileIcon.tsx:12-76` puts 65 SVG icon components in the entry. A Tauri app
loads from disk, so chunk caching is irrelevant and only deferral helps;
`manualChunks` for vendor splitting would buy nothing.
*Fix.* `lazy()` the project and search routes, the settings modal, import,
routines and the graph, each already behind a click; move the mock bridge to
its own module loaded behind `import.meta.env.DEV`. *Measure.* Exec to
sidebar populated (P3) and the entry chunk size, before and after.

**PERF-18 — `read_image` and `read_pdf` hand 16 MB and 32 MB through base64 and JSON on the main thread.**
Impact M, cost M, confirmed by reading.
`rs/services/files.rs:198-206`, `:262-287`: the bytes become a 21 MB or
43 MB string, then a JSON response, then a `JSON.parse` in the renderer.
Opening a large PDF is a visible freeze on both sides.
*Fix.* `tauri::ipc::Response` with raw bytes, or the `asset:` protocol for
the viewer's own reads, which also drops the base64 from the wire.

**PERF-19 — xterm's DOM renderer everywhere, because WebGL once crashed one Linux setup.**
Impact H for keystroke-to-glyph and busy output on macOS, unknown on Linux;
cost M; needs a profile on both engines.
`Terminal.tsx:360-363` loads no renderer addon, so every terminal uses the
slowest xterm backend, the one PERF-04 multiplies. Loading
`@xterm/addon-webgl` is `term.loadAddon(...)` on an open terminal and needs
no pool change; an addon can be disposed and re-added per show without
touching the xterm instance. Two engine facts bound the fix: WebKit caps live
WebGL contexts at about sixteen, so only the visible terminal should hold
one; and WebKitGTK's non-DMABUF path presents a WebGL canvas one draw behind
when the addon is created with `preserveDrawingBuffer: false`, which another
Tauri terminal measured as 528 to 652 ms of echo lag that dropped to 14 to
37 ms with `preserveDrawingBuffer: true` on Linux.
*Fix.* Gate on `isMacOS()` first, where WKWebView has no such history; on
Linux behind a try with an `onContextLoss` fallback to the DOM renderer and
the flag above. *Measure.* Keystroke-to-glyph and `seq 1 1000000` on both
engines, DOM and WebGL.

**PERF-20 — The graph body re-renders every loaded page on the 3 s status tick and on every panel-width frame.**
Impact M with several pages on a large repository, cost L to memoise, M to
window; needs a profile.
`GraphView.tsx:36-42`, `:70` subscribes to `useGitStatus` and the panel
width; `stitchPages` (`ts/hooks/useGitGraph.ts:78`, `ts/lib/gitGraph.ts:177-182`)
builds a fresh `commits` array per render. `CommitRow` is `memo` with stable
callbacks and cached page objects, so rows bail out on the tick; on a width
drag every `GraphRail` SVG re-renders. Nothing is windowed
(`GraphView.tsx:96-110`). *Fix.* `useMemo` the stitch; a fixed-row-height
window (`ROW_HEIGHT = 26`) only if the profile asks.

### P3 — worth a line

**PERF-21 — Sidebar rows and session tabs are not memoised.**
`Sidebar.tsx:176-233` re-renders the whole tree on any of six subscriptions
with fresh `indicator` objects per row per render (`:99`); `SessionTabs.tsx:100-111`
rebuilds `tabs` on every `bySession` replacement. Rows are tens. Impact L
to M, cost L. `memo(SidebarProject)` with stable indicator objects; select
`status` per tab.

**PERF-22 — Release build ships the inspector, debug-level logging and a window that is visible before first paint.**
`tauri = { features = ["devtools"] }` is unconditional (`Cargo.toml:15`),
which compiles the inspector into release and uses private API on macOS; the
default filter is `info,factorai_lib=debug` in release (`rs/lib.rs:50`), a
`debug!` per indexed session, per graph call and per spawn; `tauri.conf.json`
sets no `visible: false`, so the first frame is a blank window. Impact L,
cost L each: a crate feature `devtools = ["tauri/devtools"]` enabled by
`pnpm dev`, `info` by default, and a show-on-ready.

**PERF-23 — Bridge and tool-server handlers run inline on a tokio worker.**
`rs/services/ide/server.rs:280`, `rs/services/agent_tools/server.rs:150` call
the handler without `spawn_blocking`; it opens repositories, canonicalises
and takes the database mutex, so a PERF-01 scan can park a worker. Impact L
to M, cost L: `spawn_blocking` at both sites.

**PERF-24 — `terminal_write` blocks on a full PTY buffer.**
`rs/services/terminal.rs:1385-1392` does `write_all` under the writer mutex
from a synchronous command; a large paste into a child that is not reading
parks the main thread. Impact L to M, cost L: a bounded per-terminal queue
and a writer thread, or `spawn_blocking`.

**PERF-25 — Boot-time fan-out.**
`RootLayout` registers eight listeners, each an IPC round trip, and fires four
commands in one commit (`ts/routes/__root.tsx:56-211`); `useUpdaterRuntime`
runs `check()` on launch, a dynamic import and a network request, before the
first session has spawned (`ts/hooks/useUpdater.ts:118`); `setup()` sweeps
lockfiles on the main thread (`rs/lib.rs:114-119`) and the routine runner's
first tick reads the database as the scan starts (`rs/services/routines.rs:915`).
Impact L, cost L: defer the updater check a few seconds, move the sweep onto
the warm thread.

**PERF-26 — Six root listeners have no cancellation guard for the in-flight `listen()`.**
`__root.tsx:56-64`, `:130-140`, `:145-153`, `:159-169`, `:185-211` use the
`then(fn => unlisten = fn)` shape the four newer hooks already guard with a
`cancelled` flag. `RootLayout` never unmounts in production; this doubles
handlers only under StrictMode's dev double-mount. Impact L, cost L.

**PERF-27 — Monaco is recreated if `onSelection` or `onDirtyChange` change identity.**
`FileView.tsx:789-916` creates the editor in an effect keyed on both, and
disposes it on change; `onSave` is routed through a ref for exactly this
reason (`:786-787`), these two are not. No model leak was found. Impact M if
unstable, L otherwise; cost L: route both through refs.

**PERF-28 — The universal macOS build carries two binaries.**
`.github/workflows/release.yml:114` targets `universal-apple-darwin`; every
byte PERF-06 saves is saved twice, and the `.dmg` budget in P3 assumes it.
Impact L, cost L; no change proposed until PERF-06 is measured.

---

## P6 — Checked and inside its budget

One line each, so the next audit starts from here rather than from zero.

- Monaco, pdf.js and its worker, mermaid, react-markdown, remark-gfm and
  `yaml` are only reachable through `lazy()` or `import()`; the built `dist/`
  has them in separate chunks (2.6 MB, 428 KB plus 1.19 MB, 663 KB plus katex
  and thirty diagram chunks, 320 KB) and the entry preloads seven small ones.
  Item 59's "prove still lazy" is closed by this line.
- No source maps ship; `withGlobalTauri` is off; `StrictMode` costs nothing
  in production; `optimizeDeps.include` is dev-only prebundling.
- PTY data never touches React state; Rust coalesces at 16 ms and 32 KiB and
  splits larger buffers; `terminal:status` is emitted only on change; xterm's
  write buffer batches parsing across frames.
- The `DONE.md` freeze fix holds: `ChildKiller` is cloned before the `Child`
  moves to the waiter thread, no lock is held across `wait()`, and `kill`
  takes only the killer.
- `FileWatch` swaps under the lock and drops the old debouncer outside it;
  one non-recursive watch on the parent directory.
- The six git commands are async and each is one `spawn_blocking`; graph
  pages are cached per refs digest with timings at `debug` (ADR-0035
  verified); `worktrees_of` and `commit_files` are capped.
- WAL, `synchronous=NORMAL` and `foreign_keys=ON` are set; one transaction
  per migration and per indexed session with a reused prepared statement;
  the parse runs outside the lock; every hot predicate has an index; the
  three list commands read the database, not the filesystem.
- `search_sessions` quotes its tokens and clamps `LIMIT` to 200.
- `list_dir` caps at 2 000 entries with `truncated`, sorts then truncates,
  and opens the ignore checker's repository once per listing; `read_file`
  caps at 5 MB with an 8 KiB sniff; images at 16 MB and PDFs at 32 MB.
- Store discovery reads each directory's newest transcript only until the
  first `cwd`.
- All `ResizeObserver`s and the updater interval are cleaned up; no Zustand
  store is read without a selector; stable `EMPTY` sentinels exist where a
  selector would otherwise churn; `CommitRow` is `memo` with stable
  callbacks; `useGitGraph` pages independently so a poll never refetches
  every page.
- Monaco editor and diff models are disposed on cleanup; pdf.js loading
  tasks are destroyed and off-screen canvases released; the PDF renders at
  `devicePixelRatio` times zoom.
- CSS: no `backdrop-filter`, `will-change`, `filter` or `:has()`; the only
  keyframe runs while a session is working; shadows sit on floating surfaces
  only. The universal `border-border` rule reaches xterm's row spans and is
  style-resolution only.
- The bridge checks its token in the handshake, bounds its outbound queue,
  aborts its accept task on drop and removes the lockfile first.
- `git2`, `tokio-tungstenite`, `futures-util` and `trash` are built without
  default features; `tokio`'s `full` is compile-time only.
- The `WebKitCache` under the release data directory is dev-server residue
  from before ADR-0024 split the identifiers (17 000 files from
  `localhost:1420`, two touched since); a release build does not fill it.

---

## P7 — Measured, 2026-09-20, Linux

Commit `9c1faf9`; this machine: 16 cores, 31 GB, X11, WebKitGTK 2.52;
release binary built with the tree's own profile (none) under the dev
identifier so it never touched the live app's data; data directory with 14
workspace projects; warm disk cache. Three runs, killed after eight seconds.

| Measure | Value | Budget | Method |
|---|---|---|---|
| Exec to window mapped | 115 ms, 114 ms, 176 ms | ≤ 300 ms | `wmctrl -lp` polled at 50 ms |
| Backend `setup()` to `scan complete` | 500 ms first run (reaped 23 rows), 5 to 15 ms after | not budgeted; must not gate first paint | `RUST_LOG=info` timestamps |
| Exec to sidebar populated | **not measured** | ≤ 1.5 s | needs the in-app signal P4 names |
| RSS at +8 s, idle, no session | 197 MB app + 172 MB `WebKitWebProcess` + 58 MB `WebKitNetworkProcess` = 427 MB | ≤ 1.5 GB after 1 h with 10 sessions | `/proc/<pid>/status` |
| Release binary, Linux, x86-64 | 27.5 MB unstripped | see PERF-06 | `ls -l` |
| Shipped v0.45.0 | AppImage 88 MB; `.dmg` 26 MB; `.app.tar.gz` 27 MB | ≤ 70 MB; ≤ 20 MB | GitHub release assets |
| `pnpm vite:build` | entry 1.42 MB (390 KB gzip); Monaco 2.62 MB; pdf.js 428 KB + worker 1.19 MB; mermaid core 663 KB + katex 259 KB + cytoscape 436 KB; `FileView` 320 KB; total `dist/` 15 MB of which `pdfjs/` fonts, CMaps and WASM are 4 MB | entry ≤ 800 KB | build log, `du` |
| `cargo build --release` from clean | 57 s incremental, about 5 min from an empty target, 16 cores | not budgeted | wall clock |

Everything else in P3 is unmeasured today. The macOS column does not exist
yet.

---

## P8 — What this spec leaves open

- **macOS numbers.** Every budget in P3 applies to WKWebView too and none is
  measured there. PERF-04 and PERF-19 must be verified on a Mac before they
  land, and the `manual-qa` lane on that platform is what does it. This is a
  roadmap item, not a footnote, and it is item 59's remaining checklist line.
- **The first-paint signal.** One log line on the first `list_sidebar`
  answer, so exec-to-populated becomes a number without a screenshot.
- **The budgets themselves.** Proposed until an ADR accepts them.
- **Spec drift named above.** `03-backend-rust.md` describes a connection
  pool and a streaming parser the code does not have; both are corrected
  when PERF-02 and PERF-03 land, and until then this spec is the one that is
  right about them.
