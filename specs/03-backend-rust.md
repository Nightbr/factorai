# Backend (Rust / Tauri)

## Module layout (`apps/desktop/src-tauri/src/`)

```
lib.rs                # tauri::Builder, plugins, command registry, state init
main.rs               # calls lib::run()
state.rs              # AppState — the long-lived handles commands share
error.rs              # AppError (thiserror + Serialize), the command boundary
commands/
  mod.rs
  projects.rs         # list_projects, add_project, remove_project,
                      #   list_import_candidates, resolve_project_path, pin_project
  sessions.rs         # list_sessions, get_session_tail, search_sessions
  terminal.rs         # terminal_spawn, terminal_write, terminal_resize, terminal_kill
  files.rs            # read_file, read_image, read_pdf, list_dir, path_kinds
  git.rs              # git_status, git_blob, git_graph, git_commit, git_blob_at
                      #   (+ git_worktrees — F21, planned)
  ide.rs              # the IDE bridge's command surface (F20)
  memory.rs           # read_claude_md, write_claude_md, list_plans, read_plan
                      #   — PLANNED, roadmap item 2
  settings.rs         # get_setting, set_setting, check_claude_cli, validate_claude_binary
agents/
  mod.rs              # Discovered, display_name_for_path — the store-agnostic bits
  claude.rs           # Claude's directory encoding, transcript paths, discovery
services/
  mod.rs
  indexer.rs          # IndexerService — scan + watch + FTS upsert
  watcher.rs          # notify-rs wrapper, debounced channel
  terminal.rs         # TerminalManager — owns PTYs
  osc_title.rs        # session status out of the terminal title (ADR-0015)
  jsonl.rs            # streaming parser for session events
  search.rs           # FTS query builder + result hydration
  sessions.rs         # the small `sessions` reads something outside the
                      #   command layer needs — today, a recorded cwd
  files.rs            # list_dir, read_file, read_image, read_pdf, path_kinds
  child_env.rs        # the env diff a spawned child gets — PATH, the AppImage
                      #   strip, and CLAUDE_CODE_CHILD_SESSION
  shell_path.rs       # ask the login shell what the user's PATH really is
  claude_cli.rs       # find_claude_binary + the version probe
  settings.rs         # the settings table, behind the commands
  git.rs              # repository status, blobs, graph (ADR-0009)
  ide/                # the bridge (F20, ADR-0017)
    mod.rs
    lockfile.rs       # ~/.claude/ide/<port>.lock — the one thing we write there
    protocol.rs       # initialize, tools/list, tools/call, two notifications
    scope.rs          # resolve_within — the boundary that matters (ADR-0017 § 3)
db/
  mod.rs              # open(), migrate(), Pool wrapper
  migrations/
    0001_init.sql
    0002_fts.sql
    0003_project_missing.sql
    0004_workspace_projects.sql
    0005_session_subagent.sql
    0006_session_worktrees.sql   # F21, planned
models/
  mod.rs              # every cross-boundary struct, one file
```

**Corrected 2026-08-21.** This block had drifted: it was missing `state.rs`,
`error.rs`, `commands/ide.rs` and all four `services/ide/` files, three services,
and two migrations, and it split `models/` into five files that have never
existed. It is the map somebody reads to decide where a new command goes, so a
stale one sends the work to the wrong file.

## Tauri commands (the full surface for MVP)

All commands return `Result<T, AppError>`. `AppError` is a `thiserror` enum
with `serde::Serialize` so it crosses the bridge cleanly.

```rust
// projects
// The workspace: folders you added (F1, ADR-0011). Never anything the scan
// merely found. Aggregates session_count / last_session_at per query.
list_projects() -> Vec<Project>
// Adds a folder Claude may never have run in. Canonicalizes, keys it by that
// canonical path (UNIQUE), mints a uuid, and kicks off an index of the folder —
// nothing outside the workspace is parsed. Idempotent by path.
add_project(path: String) -> Project
// Drops the folder from the workspace and purges its rows from the index.
// Touches nothing under ~/.claude; re-adding rebuilds from the transcripts.
remove_project(id: String) -> ()
// Folders an agent has worked in, read straight from the store — the index only
// covers the workspace, and the point is to show what isn't in it.
list_import_candidates() -> Vec<ImportCandidate>
resolve_project_path(id: String) -> Option<String>
pin_project(id: String, pinned: bool) -> ()

// sessions
// Joins through discovered_projects: a project's sessions are those of every
// agent directory linked to its folder.
// SessionSummary carries `subagentOf` — set for a sub-agent transcript
// (`<session>/subagents/agent-*.jsonl`, see 02-data-model.md). list_sessions
// nests those rows directly under their parent (groups ordered by the
// parent's recency); get_session_tail resolves a sub-agent's transcript
// through its parent's directory inside the same store directory.
list_sessions(project_id: String) -> Vec<SessionSummary>
get_session_tail(session_id: String, limit: usize) -> SessionPage
// An offset-paged `get_session` sat here until 2026-08-16. It outlived the
// JSONL viewer it was written for and was never called again — deleted rather
// than kept "available", see 05-features.md F3.
// Scoped to the workspace — see F4. Nothing outside it was ever indexed.
search_sessions(query: String, project_id: Option<String>, limit: usize) -> Vec<SearchHit>
// NOTE: fork_session was specced but cut from the MVP (see 05-features.md F6).
// SearchHit = { sessionId, projectId, title, role, snippet } — no event_index,
// the FTS index stores no per-event position. `title` is JOINed from sessions
// for a human-readable result label.

// terminal
start_session(project_id: String) -> SessionId          // see "Session ids" below
terminal_spawn(opts: SpawnOpts) -> TerminalId           // session_id, project_id, cwd?, cols, rows
terminal_write(id: TerminalId, data: String) -> ()
terminal_resize(id: TerminalId, cols: u16, rows: u16) -> ()
terminal_kill(id: TerminalId) -> ()
terminal_list() -> Vec<TerminalStatusDto>
// Probes for the claude binary so the UI can explain a missing CLI rather than
// failing at spawn time. Honours the F11 override, so this and the spawn path
// can never name different binaries — which is why it lives in `settings.rs`
// rather than beside the terminal commands.
check_claude_cli() -> ClaudeCliStatus
// The renderer's answer to `app:quit-requested`: kill every PTY, then let the
// window close (ADR-0005).
app_quit_confirmed() -> ()
// TerminalStatusDto = { id, sessionId, projectId, status, lastActivity }.
// sessionId is never null: every PTY runs a named session (ADR-0008).
// status is `working | waiting_input | stopped` (F10). There is no `idle`, and
// `running` was renamed `working` when its meaning narrowed — a live PTY at the
// prompt is `waiting_input`, not `working`.

// files
read_file(path: String, max_bytes: Option<usize>) -> FileContents     // size, binary + truncated flags
// Images for the viewer (F7): base64 + a mime sniffed from the magic bytes,
// never from the extension. Refuses a non-image or an oversized file rather
// than truncating — half a PNG is a decode error, not a smaller PNG.
read_image(path: String, max_bytes: Option<usize>) -> ImageContents
// PDFs for the viewer (F7): the whole file as base64 for pdf.js to parse in the
// renderer. Refuses anything not starting `%PDF-`, and anything over its own
// 32MB cap — larger than an image's because a scan legitimately is. No mime (it
// can only be one thing) and no page count (pdf.js reads it from these bytes).
read_pdf(path: String, max_bytes: Option<usize>) -> PdfContents
list_dir(path: String, root: Option<String>) -> DirListing            // one level, capped, git-ignored flagged
// Batch stat for the terminal's link provider (F19): is each of these a file,
// a directory, or nothing? One call per hovered line, so it takes a list.
path_kinds(paths: Vec<String>) -> Vec<PathKind>                       // file | directory | missing
// NOTE: file_diff(path, original, modified) -> DiffPayload was specced and
// never built. Monaco's createDiffEditor (ADR-0007) diffs two strings itself,
// so a Rust hunk list has no consumer. Dropped in ADR-0009; the diff viewer is
// fed by git_blob + read_file.

// git (ADR-0009)
git_status(project_path: String) -> GitStatus                         // whole repo, grouped, capped
git_blob(path: String, rev: GitRev) -> Option<FileContents>           // rev = head | index
// graph (F18). All three registered 2026-08-17 with the rail; this block said
// "PLANNED, none of these three are registered yet" until 2026-08-21.
git_graph(project_path: String, offset: usize, limit: usize) -> GitGraph   // lanes assigned in Rust
git_commit(project_path: String, sha: String) -> Option<GitCommitDetail>   // body + changed files
git_blob_at(path: String, commit: String, max_bytes: Option<usize>) -> Option<FileContents>
// worktrees (F21, ADR-0019). Every checkout git knows, main and linked.
// Read-only like the rest, and it doubles as the IDE bridge's path scope.
git_worktrees(project_path: String) -> Vec<GitWorktree>

// memory / plans — PLANNED. None of these are registered yet (roadmap item 2).
read_claude_md(project_path: String) -> Option<String>
write_claude_md(project_path: String, contents: String) -> ()
list_plans(project_path: String) -> Vec<PlanRef>
read_plan(path: String) -> String

// settings (F11). The key is a mirrored union, not a free string; the value is
// a String, and `None` means unset.
get_setting(key: SettingKey) -> Option<String>
set_setting(key: SettingKey, value: Option<String>) -> ()
// Probe one path as if it were the binary override, without saving it — what
// the settings page's override field validates with on blur.
validate_claude_binary(path: String) -> ClaudeCliStatus
```

## Tauri events (Rust → JS only)

| Event                  | Payload                              | Source              |
| ---------------------- | ------------------------------------ | ------------------- |
| `indexer:progress`     | `{ processed, total, phase }`        | IndexerService      |
| `sessions:changed`     | `{ projectId, sessionIds: [...] }`   | watcher             |
| `terminal:data`        | `{ id, bytes: base64 }`              | TerminalManager     |
| `terminal:status`      | `{ id, status, lastActivity }`       | TerminalManager     |
| `terminal:exit`        | `{ id, code }`                       | TerminalManager     |
| `session:worktree`     | `{ sessionId, path, branch }`        | IDE bridge (F21)    |

`session:worktree` is the one event whose source is the IDE bridge rather than a
service, and it fires **after** the write to `session_worktrees`, never before:
the renderer's job is to render a fact, and an event that arrives ahead of its
row is a fact the next reload disagrees with (F21).

PTY output is base64-encoded bytes, not UTF-8 strings — Claude prints ANSI
that contains invalid UTF-8 boundaries when chunked. The renderer decodes
into a Uint8Array and writes straight to xterm.

## Services

### `IndexerService`

Single struct, owns a tokio task and a handle for the watcher. Public API:

```rust
impl IndexerService {
  pub fn spawn(db: DbHandle, claude_dir: PathBuf, app: AppHandle) -> Self;
  pub async fn full_scan(&self) -> Result<()>;
  pub fn shutdown(self);
}
```

Scan algorithm: walk projects dir, for each `.jsonl` compare `(mtime, size)`
to row, parse only if changed. Parser uses `tokio::io::BufReader::lines()`
so a multi-MB session doesn't blow memory.

### `WatcherService`

Wraps `notify::RecommendedWatcher` with a debounced channel (500ms,
implemented with `tokio::sync::mpsc` + a coalescing buffer). Emits batched
change events. Watches `~/.claude/projects` recursively but ignores
non-`.jsonl` files.

### `TerminalManager`

Owns the `DashMap<TerminalId, Terminal>`. On `terminal_spawn`:

1. Resolve binary via `find_claude_binary()` (see below).
2. Build argv: `[claude, <flag>, <session_id>]`, where the flag comes from the
   transcript probe under "Session ids" — with cwd from options or the
   session's last known cwd.
3. Open PTY via `portable_pty::native_pty_system().openpty(size)`.
4. Spawn child, attach reader on a blocking thread, forward chunks into a
   tokio mpsc, fan out as `terminal:data` events.
5. **Status is parsed out of that same byte stream, not polled.** The reader
   scans each chunk for `OSC 0` titles and derives `working` / `waiting_input`
   from the title's first character — see [`05-features.md` § F10](./05-features.md)
   for the rule and [ADR-0015](../docs/adr/0015-session-status-from-the-terminal-title.md)
   for why the title. This step used to say "status heuristics run on a separate
   tokio task (200ms tick)"; there was never such a task, and a tick is the wrong
   shape for a signal that arrives as an event.

**The child's environment is ours, as a diff** (`services/child_env`). A session
inherits our env, because `HOME`, `USER`, `SHELL`, `SSH_AUTH_SOCK`, `LANG`, the
proxy variables and `NODE_EXTRA_CA_CERTS` are exactly what a shell in a project
needs. A minimal environment built by hand is a long tail of subtler bugs — git
over SSH stops working, output stops being UTF-8, a corporate CA bundle goes
missing — so `changes_for_current_env()` never constructs one; there is no
`env_clear` and no hardcoded environment anywhere on this path. Three things about
"ours" are nonetheless wrong for a child, and all three are fixed in that one
helper, at the one place a child is spawned.

#### `PATH` comes from the login shell, not from us

A GUI application does not have the user's `PATH`. Launched from Finder, the
Dock, LaunchServices or a `.desktop` file it inherits launchd's / the session
manager's environment, and no rc file has ever run in the process — so Homebrew
(`/opt/homebrew/bin` on Apple Silicon, `/usr/local/bin` on Intel) is absent, and
so is every version-manager shim (nvm, mise, asdf, fnm, volta). A session handed
that `PATH` breaks in everything that resolves a program by name, and none of
the breakage names the cause:

- A hook runs as `/bin/sh -c "<command>"`. `/bin/sh` is found because it is
  invoked absolutely; the bare `bash` *inside* the command goes through `PATH`
  and isn't — `SessionStart:startup hook error … /bin/sh: bash: command not
  found`. The plugin invoking `bash` by name is correct and is the messenger,
  not the bug; rewriting hook commands to use absolute paths is not the fix.
- A stdio MCP server is launched as `npx` / `node` / `uvx` / `docker` and fails
  its JSON-RPC handshake — `Failed to reconnect to <server>: -32000`. (A server
  listed as "needs authentication" is unrelated: that is OAuth awaiting login.)
- A `statusLine` command fails silently, with no banner at all.
- `git`, `gh`, `pnpm`, `uv` and everything else the agent runs from `Bash`.

The tell is that the same config works when `claude` is started from a terminal.
That difference *is* the diagnosis.

So `services/shell_path` **asks a shell** — the `fix-path-for-mac` pattern VS
Code and most Electron developer tools use, treated as prior art rather than
reinvented. `$SHELL -ilc 'printf "%s" "<START>${PATH}<END>"'`, once, on a thread
spawned from `setup()` so the window never waits on `~/.zshrc`, cached in a
`OnceLock` for the app's lifetime. Five details are what make it work on real
machines rather than in principle:

- **Both flags.** `-l` sources `~/.zprofile`, where Homebrew's `shellenv`
  usually lands; `-i` sources `~/.zshrc`, where nvm / mise / asdf usually land.
  Either alone misses half of them.
- **Sentinels, not raw stdout.** An interactive shell talks — MOTD,
  powerlevel10k's instant prompt, `direnv`, version-manager banners.
- **Stdin from `/dev/null`, and a 5s timeout**, because an interactive shell may
  block waiting to be typed at. Stdout is drained on its own thread (reading on
  the waiting thread would be the hang the timeout exists to prevent) and the
  child is killed unconditionally afterwards, which reaps it on the happy path
  and is the only thing that stops a stuck shell outliving the app on the other.
- **`$SHELL`, not an assumption of zsh.** `/bin/zsh` is only the guess for when
  `$SHELL` is unset, and no further shells are tried after it: a `$SHELL` that
  cannot be run is pathological, and the fallback floor is a better answer than
  a cascade that quietly consults rc files the user does not use.
- **A floor when that fails**, exercised whenever resolution errors or times
  out: `/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`.
  Both Homebrew prefixes, because one of them is wrong on half of macOS.

Empty entries are dropped from whatever comes back, and a `PATH` with nothing
left in it is refused: an empty entry means the current directory, and a
session's cwd is a project checkout someone else may have written to. The value
is handled as bytes throughout, since a `PATH` is not required to be UTF-8 and
lossy conversion corrupts an entry rather than failing.

At startup, `warm()` also checks that `bash` and `node` resolve against the
`PATH` it settled on, and warns with both if not. A clear "could not resolve
your shell environment" line in the log beats `/bin/sh: bash: command not found`
surfacing three layers down as a hook error.

Note what is *not* the fix: patching `env.PATH` in `~/.claude/settings.json`.
That is a per-machine workaround which fixes nothing for anyone else and masks
this during testing.

#### And the AppImage runtime comes back out

Under an AppImage "ours" is the user's environment with `linuxdeploy`'s private
runtime pushed in front of it, and handing that on means every session, and
everything it runs, resolves libraries and data files out of a squashfs mount
belonging to a different program. Observed: `PYTHONHOME=$APPDIR/usr/` kills any
`python3` with
`ModuleNotFoundError: No module named 'encodings'`, and
`LD_LIBRARY_PATH=$APPDIR/usr/lib/…` makes another GTK binary load *our*
WebKitGTK, which then can't find its own helper processes.

The rule is one sentence — **drop the path-list entries that live inside an
AppImage runtime mount**, and unset anything left empty — because AppRun builds
each of them as `$APPDIR/…:$ORIGINAL`, so removing our entries leaves exactly
what the user had. No list of variable names is hardcoded: AppRun's set has
grown before, and a name list would silently stop covering it. A value with no
such entry is passed through byte for byte rather than split and rejoined, so the
rewrite can't touch a `GTK_THEME=Adwaita:dark` or an `LS_COLORS`. `APPDIR` /
`APPIMAGE` / `ARGV0` / `OWD` go too — leaving one behind while the paths it names
are gone is worse than either.

**"A runtime mount" is wider than `$APPDIR`, and it had to be — corrected
2026-08-20.** `$APPDIR` is the mount *this process* runs from, so matching only
it strips only the newest layer of a nested launch. Found on the machine this app
is developed on: an agent session under a release build had `APPDIR` correctly
unset and that build's mount correctly gone from every path, and still carried
**two older mounts** in `LD_LIBRARY_PATH`, `PATH`, `XDG_DATA_DIRS`, `PYTHONPATH`,
`PERLLIB`, `QT_PLUGIN_PATH` and the `GST_*` pair — the app had been launched from
inside an older copy of itself and inherited them. So `pnpm dev` in that session
still died on `WebKitNetworkProcess`, from a build that already had this module.

So an entry is also ours to drop when any of its path components is a `.mount_*`
directory, which is what the AppImage runtime names its squashfuse mountpoint.
Both halves earn their place: `$APPDIR` is authoritative and covers a mountpoint
not named like one (`--appimage-extract-and-run` gives a `squashfs-root`), and
the shape covers every mount `$APPDIR` cannot know about. It is matched on the
path component, not on `/tmp/.mount_`, because `TMPDIR` is the user's to set.

Two consequences worth stating, because both reverse something this spec used to
say:

- **A mount that is not ours goes too.** The old reasoning was that "two
  AppImages running at once is ordinary", so a sibling mount was not ours to
  touch. The premise was wrong — two AppImages side by side never appear in each
  *other's* environment, since the runtime only prepends to its own process tree.
  A sibling mount can only be in ours if we were launched from inside it, and
  then its squashfs is as wrong for our child as our own.
- **It is no longer a no-op outside an AppImage.** A dev build has no `$APPDIR`,
  so under the old rule a `pnpm dev` spawning a session stripped nothing at all —
  while inheriting a mount from the agent shell that started it. That is the
  daily case here: the app being developed from inside a session of the released
  app. With no `$APPDIR` *and* no mount anywhere, it is still a no-op.

**It is expressed as a diff, and that is load-bearing.**
`CommandBuilder::new()` seeds itself from `std::env::vars_os()`, so the child
already holds everything we have and `env()` only ever *overrides* a key.
Handing it a freshly-computed clean environment therefore changes nothing about
the variables that matter, because the ones to drop are exactly the ones such a
list omits — and an omitted key keeps its inherited value. `EnvChanges` splits
`remove` from `set` and `apply_to` issues `env_remove` for the former; removals
have to be spoken aloud.

v0.5.0 shipped that bug: the rule was right, unit-tested nine ways, and applied
nothing. The regression test drives a real `CommandBuilder` and asserts
`get_env("APPDIR")` is `None` — reintroduce the fault and it is the only test
that fails, which is precisely why the others weren't enough.

**The two rules meet on `PATH`, and the order matters.** `with_path` has the last
word on that key, so it first takes `PATH` out of whatever the strip decided
about it — a stale `remove` left behind would have `apply_to` unset the
variable we are there to set. The value then goes through the strip anyway,
because the shell we asked inherited *our* `PATH` and both zsh and bash extend
the one they are given rather than build a fresh one: on a machine running the
AppImage, `$SHELL -ilc` demonstrably answers with `$APPDIR/usr/bin` still on the
front. If the strip empties it, the floor is used.

**And the same lesson applies one level out**, which is why
`terminal::tests::a_child_runs_with_the_login_shell_path` spawns a real PTY
running `printf '%s' "$PATH"` and compares it to `shell_path::child_path()`.
Every test at the `EnvChanges` layer still passes with the
`changes_for_current_env()` call deleted from the spawn site; that one does not.
A right rule that never reaches the process is the failure mode this module has
already shipped once.

Note this is a *second*, independent source of the `XDG_DATA_DIRS` breakage
described in `AGENTS.md § Tauri gotchas` — that one is Turborepo stripping the
variable, this one is the AppImage prepending to it.

#### And `CLAUDE_CODE_CHILD_SESSION` goes, or transcripts stop existing

Found 2026-08-18 while probing the CLI for F10's title sequences: a `claude` that
inherits `CLAUDE_CODE_CHILD_SESSION` starts with **transcript saving off** and
says so in its banner — `Transcript saving is off — inherited
CLAUDE_CODE_CHILD_SESSION marker`. The variable is how Claude Code marks a
process it spawned itself, so any session factorai launches while running under
one inherits the marker and writes no `.jsonl` at all.

That is not a cosmetic loss. No transcript means no row for the indexer, nothing
to search, and `session_flag`'s probe (ADR-0008) sees no file — so the *next*
launch of the same id picks `--session-id` on an id Claude already knows and
fails with "already in use". The symptom appears one step removed from the cause,
exactly like the `PATH` class of bug above.

It is stripped for the same reason `$APPDIR` is: it describes our process, not the
child's. Same rule shape, same helper, and it is why that helper strips rather
than constructs — a hand-built environment would never have contained this
variable, but it also would not have contained `SSH_AUTH_SOCK`.

On `terminal_kill`: signal child (`child.kill()`), drop the PTY pair.

On window close (`tauri::WindowEvent::CloseRequested`):

1. If any terminal is live, prevent close and emit `app:quit-requested`
   to the frontend. The renderer shows a confirm dialog ("Quitting will
   kill N running session(s). Continue?").
2. If confirmed (`app:quit-confirmed` command), call `kill_all()` on the
   manager (SIGTERM, then SIGKILL after 500ms grace), then allow close.
3. If cancelled, dismiss.

`kill_all()` is also wired to `Drop` on `TerminalManager` as a last-ditch
backstop so we never leak children on crashes. **No orphan zombies, ever.**

### Session ids

factorai names its own sessions — see ADR-0008 for why. Two consequences for
this module.

**`SpawnOpts` carries `{ session_id, project_id, cwd?, cols, rows }`.** There
is no `resume_session_id` and no mode flag: the caller supplies the id, and
`session_flag()` decides how it reaches the CLI by probing for
`<claude_dir>/projects/<project_id>/<session_id>.jsonl`.

| transcript | argv                          |
| ---------- | ----------------------------- |
| exists     | `claude --resume <id>`        |
| missing    | `claude --session-id <id>`    |

Probing per spawn (rather than remembering how a session started) is what
makes Restart correct for a session that was created new and has since been
messaged.

The transcript is located from the **folder**, via
`agents::claude::transcript_path(claude_dir, cwd, session_id)`. It used to be a
join on `project_id`, back when that was the encoded directory name; a project
id is a uuid now and says nothing about where Claude writes. The folder is
exactly what Claude encodes, and it is the only thing we have for a project
Claude has never run in — which is precisely the case that needs
`--session-id`.

**And so the folder is not simply `opts.cwd`. Corrected 2026-08-21** —
`resume_cwd()` asks the index where this session was recorded as running and uses
that instead when it finds a transcript there. Without it, a session whose
transcript lives anywhere other than the folder the caller named — started in a
subdirectory, or in another worktree (F21) — misses the probe, claims
`--session-id` for an id Claude already knows, and loses the conversation.

Two things about its shape are deliberate. It reads the index through a
`session_cwd` **callback**, the same shape as `user_binary` below and for the
identical reason: the manager needs an answer from a database it should not hold.
And it requires the transcript to *actually be there* rather than trusting the
row — the recorded folder is worth preferring precisely because the transcript is
in it, so a stale row falls through to `opts.cwd` rather than relocating the
session.

This cannot live in the renderer, which is where it was first specified.
`Terminal.tsx` learns a session's recorded cwd from a query that resolves after
the component has mounted and spawned, so a renderer-side fix is correct only
when that query happened to be cached.

**`start_session(project_id)` returns the id to route to.** A fresh v4 UUID,
unless the project already has a live session with no transcript — one that
has never been messaged, and so is indistinguishable from the one being asked
for. That reuse keeps an impatient double-click from starting two `claude`
processes. It lives here rather than in the renderer because the sidebar's
per-project button fires on projects whose session list was never fetched, and
because the filesystem can't lag the way the index can.

### `find_claude_binary()` — three-tier discovery

Lifted from
[refactoringhq/tolaria/src-tauri/src/claude_cli.rs](https://github.com/refactoringhq/tolaria/blob/main/src-tauri/src/claude_cli.rs).
The same pattern is proven in production for the same problem.

```rust
pub fn find_claude_binary() -> Result<PathBuf, AppError> {
    // 1. `which claude` in the inherited PATH (Tauri-launched process).
    if let Some(p) = which_claude() { return Ok(p); }

    // 2. User's login shell — handles macOS GUI launches that don't
    //    inherit a terminal PATH (homebrew, mise, asdf shims).
    //    Try $SHELL first, then /bin/zsh, /bin/bash.
    //    Invocation: `$SHELL -lc 'command -v claude'`
    if let Some(p) = which_claude_via_user_shell() { return Ok(p); }

    // 3. Probe a known list of common install locations.
    if let Some(p) = probe_known_candidates() { return Ok(p); }

    Err(AppError::NotFound("claude CLI not found".into()))
}
```

Known candidates (Linux + macOS only — Windows entries dropped from the
tolaria list):

```
$HOME/.local/bin/claude
$HOME/.claude/local/claude
$HOME/.local/share/mise/shims/claude
$HOME/.asdf/shims/claude
$HOME/.npm-global/bin/claude
$HOME/.npm/bin/claude
$HOME/.linuxbrew/bin/claude
$HOME/.nvm/versions/node/*/bin/claude   # glob, sorted, deepest version first
/opt/homebrew/bin/claude
/usr/local/bin/claude
/home/linuxbrew/.linuxbrew/bin/claude
```

After resolution, validate by running `claude --version` with a 2s
timeout.

**Nothing is cached, and that plan is dropped.** This section used to describe
writing `claude.binary`, `claude.version` and `claude.resolved` back to the
`settings` table as a resolution cache, re-validated at launch. It was never
built, and F11 is why it should not be: `claude.binary` now holds the **user's
override** — a value nobody but a human writes — and a cache sharing that key
could not tell a probe's guess from somebody's choice. The probe is a `which`
plus a `--version` and runs at spawn time; that is cheap enough not to need a
cache, and a cache is what would go stale the day `claude` moves.

The override *is* exposed in the UI as of F11 (§ F11 in `05-features.md`), which
supersedes this section's "runtime override only, no settings UI for MVP".

### `CLAUDE_HOME` and projects dir

```rust
fn claude_dir() -> PathBuf {
    if let Some(env) = std::env::var_os("CLAUDE_HOME") {
        return PathBuf::from(env);
    }
    dirs::home_dir().expect("no home dir").join(".claude")
}
```

No settings override for the projects dir in MVP. Adding it later is a
one-line change once the path is read in one place.

### `Search`

Query FTS5 with the user's input, expand using `MATCH 'token*'` for
prefixes. Hydrate hits by joining back to `sessions`. Return snippets via
`snippet()` SQL function.

### `files`

`list_dir(path, root?) -> DirListing` lists **one** directory — there is no
recursion in the backend at all. The file tree (F12) expands lazily, one call
per opened node, which is what keeps `node_modules` / `.venv` / symlink cycles
from ever being walked.

Rules, all enforced in Rust so the renderer stays dumb:

- `.git` is skipped. Every other dotfile and cache directory is listed —
  `.claude/` is one of the more interesting directories in this app.
- `ignored` is set on entries git would ignore, so the tree can dim
  `node_modules` / `target` / `dist` without a second round trip. The repo is
  discovered and opened **once per call** and reused for every entry; outside a
  repo the flag is simply `false` everywhere. A failure to open the repo is not
  an error — the listing is still a valid listing, just undecorated.
- Sort is directories first, then case-insensitive by name (ties broken
  case-sensitively so the order is total).
- Capped at `MAX_ENTRIES` (2000) **after** sorting, so the prefix is
  deterministic. `total` reports what was found and `truncated` says whether
  anything was cut.
- A symlink is flagged (`isSymlink`), and `symlinkOutsideRoot` is set when its
  target resolves outside `root` or can't be resolved at all. The tree shows
  those rows but won't expand them.
- Missing path → `NotFound`. A file rather than a directory →
  `InvalidInput`. An unreadable directory → `Io("permission denied: …")`,
  which the tree renders as an inline row instead of a toast.
- Individual entries that fail mid-iteration (a racing delete) are skipped
  rather than failing the whole listing.

`read_file(path, max_bytes?) -> FileContents` backs the viewer (F7):

- Binary is decided by a null byte in the first 8KB. Binary files return
  **empty** `contents` with `isBinary` set — no point shipping bytes the UI
  won't render — but `size` is still reported so the card can say how big the
  thing it's refusing to show is.
- `max_bytes` defaults to 5MB. We read one byte past the cap to detect
  overflow without re-stat'ing a file that may have changed underneath us,
  then cut to the cap and set `truncated`. `size` is always the true size on
  disk. The UI offers "Show anyway", which refetches with `max_bytes: None`.
- Invalid UTF-8 without null bytes is read **lossily** rather than rejected: a
  latin-1 source file is still worth reading, and real binaries were already
  ruled out.
- No `mime` field. It existed in the original spec to pick a viewer, but the
  renderer resolves a language from the extension through Monaco's own
  language registry (ADR-0007), so a `mime_guess` dependency would be a
  second and worse source of the same answer.

`path_kinds(paths) -> Vec<PathKind>` is what lets F19's link provider be
generous about what looks like a path and still not produce false links. It
`symlink_metadata`s each entry and answers `file` / `directory` / `missing`,
in the order given so the caller can zip it against its own candidate list.

- **Batched because the caller is batched**: xterm hands the provider one
  hovered line, which may hold several candidates, and one round trip per line
  beats one per token.
- **Never an error.** An unreadable path, a broken symlink, a path that is
  neither — all `missing`. A stat failing is an answer here, not a fault: the
  question is only ever "can I usefully open this", and the renderer has nothing
  it would do differently with a reason.
- Symlinks are followed for the *kind* (a link to a file is a file), which is
  what a reader means by clicking one. `list_dir`'s escape-flagging exists to
  stop the tree *browsing* out of a project; opening one file the agent just
  named is not that.

Read-only, like the rest of our disk access (ADR-0004).

### `git`

Backs the Changes tab and the tree's status decorations (F13). All of it is
**read**: nothing here stages, discards, checks out or commits. See ADR-0009 for
why this is libgit2 and not `git` on PATH.

`git_status(project_path) -> GitStatus`:

- The repository is found with `Repository::discover()` **from the project
  root**, so a project that is a subdirectory of a monorepo reports that repo's
  changes — including changes above itself. Not a repo → `GitStatus { repo:
  None, .. }`, which is a success, not an error: "this project isn't versioned"
  is an answer the UI renders, not a failure it toasts.
- `head` is the full SHA that `HEAD` resolves to, or `None` on an unborn branch.
  **Added by F18**, and not because the graph needs it — the graph walks `HEAD`
  itself. It exists because `branch: None` conflated two states the session
  header's badge has to tell apart: a detached `HEAD`, where there is a commit to
  name, and an unborn branch, where there isn't. The badge went quiet in both
  rather than guessing "detached"; with `head` it shows the short SHA in the
  first case and stays quiet in the second.
- Each changed path produces one **row per group**: `staged` (HEAD ↔ index),
  `unstaged` (index ↔ worktree), `conflicted`. A partly-staged file legitimately
  appears twice, once in each group, with its own line counts — that is the only
  version in which the numbers add up.
- `status` per row is one of `modified | added | deleted | renamed | typechange
  | untracked | conflicted`. Renames carry `oldRelPath`.
- `relPath` is relative **to the project root**, not the repo root, so a change
  one directory up reads `../packages/types/index.ts` and is visibly not yours.
  `path` is absolute, and is what the viewer and `git_blob` take.
- Untracked files are included **and recursed into**
  (`recurse_untracked_dirs(true)`, VS Code's `-uall`), so three new files in a
  new directory are three rows. An earlier draft collapsed a new directory to a
  single row; that hides the most common thing an agent does. The cap below is
  the guard against a stray `npm install` in an unignored tree — not the
  recursion setting.
- **Cap first, compute stats second.** Rows are truncated to `MAX_CHANGES`
  before any patch is generated. This ordering is the whole performance story:
  a status walk is cheap, but `Patch::line_stats()` reads *both sides of every
  changed file*, so generating patches for a change set you're about to throw
  away is the one way to make a 3s poll hurt. VS Code splits this differently —
  its `git status` never computes line counts at all, and `--numstat` is a
  separate command — which is the same insight expressed as two calls instead
  of one ordering rule. We keep one call (one IPC beat per poll) and pay for it
  with the ordering.
- `additions` / `deletions` then come from `Patch::line_stats()` on the
  surviving rows, with `context_lines(0)` since we want counts and not context.
  Binary deltas set `isBinary` and report no counts; deltas over
  `MAX_STAT_BYTES` report none either.
- `MAX_CHANGES` is **500**, with `total` and `truncated` reported exactly like
  `list_dir`. VS Code's equivalent limit is 10 000 — it renders a virtualized
  list and can afford them. We would mount 10 000 buttons into WebKitGTK, which
  is how the JSONL viewer froze the session view (F3, `c6374d6`). 500 is chosen
  against *our* renderer, not against git.

`git_blob(path, rev) -> Option<FileContents>` reads one file at `head` (the
commit's tree) or `index` (the staging area), reusing `FileContents` so the
viewer treats it exactly like a `read_file` result — same binary and truncation
semantics, same caps.

**`None` is a real answer, not an error.** A file that was added has no HEAD
side; a deleted file has no worktree side. The diff viewer renders the missing
side as empty, which is what "added" and "deleted" look like. Returning
`NotFound` here would turn the two most ordinary rows in the list into error
toasts.

The worktree side of a diff is not served here — it's `read_file`, which already
exists and already handles binaries, caps and lossy UTF-8.

#### The graph (F18)

Three commands, **all registered 2026-08-17 with the rail**; this said "planned,
none registered yet" until 2026-08-21. All read-only, all in `services/git.rs`
behind `commands/git.rs`, and the renderer still never learns libgit2 exists.

`git_graph(project_path, offset, limit) -> GitGraph` walks the DAG and **assigns
lanes in Rust**. The payload is per-commit: full SHA, short SHA, subject, body,
author name, author and committer timestamps, parent SHAs, the refs pointing at
it, **its lane index**, and per row the set of lanes passing through plus where
forks and joins land. The renderer draws SVG from that; it does not hold a
parent-adjacency graph and does not compute layout. See Q23.

- Refs are enumerated with `repo.references()`: local branches, remote-tracking
  branches, tags, and `HEAD`. All of them are pushed into one revwalk, sorted
  `TOPOLOGICAL | TIME`. `refs/remotes/*/HEAD` is dropped at this layer rather
  than in the UI — it is a symbolic ref duplicating another ref we already
  return, so returning it means every consumer has to know to ignore it.
- **Paging is an offset with a full re-walk**, not a resumable cursor. Each call
  walks from the same pushed refs, skips `offset`, and returns the next `limit`
  with lanes recomputed over the whole prefix. That is deterministic for a given
  set of refs, so page 4's lanes cannot disagree with page 1's — which is the
  failure the alternative invites: threading the open-lane frontier through an
  opaque cursor means either a server-side cache to invalidate when refs move, or
  a client that reflows every append. Re-walking 1 200 commits to serve the
  fourth page is microseconds of libgit2; lane instability is visible and
  permanent.
- The payload reports the refs it walked against (a cheap digest is enough). If
  that changes between pages, the renderer invalidates back to page 1 rather than
  splicing a page walked against different refs onto one that wasn't.
- `limit` is **300** by default. `total` is not reported: counting a 200 000-commit
  repository to render "300 of N" costs a full walk on every poll, which is the
  one thing paging exists to avoid. The absence of a further page is signalled by
  a short return, the same way a shallow clone signals its own floor.
- An unborn `HEAD` returns an empty commit list, not an error. So does a project
  with no repository, alongside `repoRoot: None` — the same shape `git_status`
  established, for the same reason.

`git_commit(project_path, sha) -> Option<GitCommitDetail>` is the detail pane's
one call: full message, author and committer, parents, and the commit's changed
files **as `GitChange` rows** so the renderer reuses F13's row component rather
than growing a second file-row type. A merge diffs against its **first parent**;
the response names which parent it used, so the label in the UI is not a
convention the renderer has to remember. `None` when the SHA doesn't resolve —
a stale row clicked after a force-push is not an error.

`git_blob_at(path, commit, max_bytes) -> Option<FileContents>` is the left side of
a commit's diff. **A third command rather than widening `GitRev`**: `GitRev` is a
two-value string union that F13's viewer plumbing already depends on, and turning
it into a string-or-object union to carry a SHA churns every existing call site
and both sides of a hand-mirrored type (§ IPC) to serve one new caller. `None`
follows `git_blob`'s rule — a file absent at that commit is an answer.

#### Worktrees (F21)

`git_worktrees(project_path) -> Vec<GitWorktree>` returns **every checkout the
repository knows**, main and linked, each with `path`, `branch`, `head`,
`isMain`, `locked`, `prunable` and `exists`. Shipped 2026-08-21;
[ADR-0019](../docs/adr/0019-a-worktree-is-a-checkout-not-a-project.md) is what it
is allowed to do.

- **Keyed by the repository, not by the project.** Discovery is
  `Repository::discover()` from the project root exactly as `git_status` does,
  and the set is then read off that repository — so a project that *is* a linked
  worktree returns the same set as one that is the main checkout. Symmetry is
  the point: it is the same repository whichever door you came in by.
- **The main checkout is found from `commondir`, not from the worktree list.**
  libgit2's `worktrees()` lists only the *linked* ones, so the main tree has no
  entry to read; for a linked worktree the repository's `commondir` is the main
  repository's `.git`, whose parent is the main checkout. That is what makes the
  symmetry above one `parent()` rather than a second `Repository::open`.
- A sibling `worktree_paths()` returns just the paths, for the bridge — which
  asks per resolve and has no use for branches, locks or SHAs, each of which
  costs a `Repository::open` of the checkout.
- **Nothing is filtered.** `locked` and `prunable` are reported rather than
  hidden, and a checkout whose directory is gone comes back with `exists:
  false`. Filtering the unusable ones means a session whose cwd is inside one
  resolves to the project instead, with nothing on screen saying why.
- A **bare** repository contributes no main-checkout row; its linked worktrees
  list normally. Not a repository at all returns an empty vector, matching
  `git_status`'s "this project isn't versioned is an answer, not a failure".
- Read-only, like everything else in this module. `git2` stays
  `default-features = false`; ADR-0009 is untouched and there is no
  `worktree add` here.

**It is also the bridge's scope, and that is the load-bearing use.**
`services/ide/scope.rs` resolves against the **union** of these paths, recomputed
per resolve rather than cached at connect — a worktree the agent created a second
ago is the case the feature exists for. The set is derived here, from git, and
never from anything the client sent: ADR-0019 § 2 is why the agent's
`setWorktree` moves what the panel shows and cannot move what the bridge allows.

### `settings`

**Shipped 2026-08-20 with F11.** Three commands over the `settings` table
migration `0001` created, backing F11's Rust-readable half — the two below plus
`validate_claude_binary`, and `check_claude_cli` moved into the same module
because it is the one command whose answer the table changes. Preferences the renderer alone reads do **not** come through
here — they live in `prefsStore` on localStorage (ADR-0013).

`get_setting(key) -> Option<String>` and `set_setting(key, value)`.

**The key is a mirrored union, not a `String`.** `SettingKey` is a Rust enum with
`#[serde(rename_all = "camelCase")]` and a hand-written TS union beside it, the same
pattern `GitRev`, `GitGroup` and `GitRefKind` follow (§ IPC). A free-form string key
is `any` wearing a different hat: nothing catches a typo, a misspelled key silently
reads as "unset", and "what settings exist?" becomes a grep instead of a type. Two
commands still scale to any number of keys — which is the reason not to write one
typed command per setting.

**The value is a `String`, and `None` means unset.** Not a JSON value: every key so
far is a scalar, and the one thing a JSON column would buy — a structured
preference — is exactly what should live in `prefsStore` instead. `set_setting(key,
None)` deletes the row, which is how the F11 Claude section clears an override and
returns to auto-detection. That distinction matters: an empty string is a *set*
value that happens to be empty, and would break the probe.

Keys, as of F11:

| `SettingKey` | Row key | Read by | Notes |
| --- | --- | --- | --- |
| `claudeBinaryPath` | `claude.binary` | `find_claude_binary` | Absolute path. Unset → the three-tier probe |

**The serde name and the row key differ on purpose.** The dotted namespace is
what this table was created with and what an operator sees in `sqlite3`; the
mapping lives in `SettingKey::column()` alone. Adding a key means adding a
variant *and* a match arm, which is the point — neither can be forgotten
silently.

Roadmap item 31's release channel is the second key and the reason this half ships
now rather than waiting for a second caller.

**`find_claude_binary` takes the override as a parameter.** Its signature becomes
`find_claude_binary(override: Option<&Path>) -> AppResult<PathBuf>`, checked before
the three tiers, and `check_cli(override)` takes it too. Two things follow, and both
are the point:

- **Every** caller honours the override, so the F11 Claude section cannot report
  "not installed" while spawning works. Reusing `TerminalManager`'s existing
  `binary_override` field would have done exactly that, since `check_cli` calls the
  finder directly.
- `claude_cli.rs` gains **no** database dependency — the caller resolves the setting
  and passes a path, so the module stays a pure function of its input and its tests
  stay as they are.

`TerminalManager::binary_override` keeps its current meaning (a test seam) and is
not overloaded to carry a user setting. The user's path reaches the spawn through
a **callback** — `with_user_binary(Arc<dyn Fn() -> Option<PathBuf>>)`, wired to
the table in `lib.rs`, the same shape as the indexer's `live_ids`. Read per
spawn, which is what makes "running sessions are unaffected, the next one uses
the new path" true without anything having to invalidate a cache.

**`installed` means the binary resolved, not that `--version` answered.** A
resolved path with `version: None` is a real state — a wrapper script, a
half-finished install, a `--version` that hangs — and the settings page presents
it as such. Folding it into `installed: false` would let a version probe veto a
binary that spawns sessions perfectly well, which is the same class of mistake as
`check_cli` ignoring the override.

## State management

`tauri::State<AppState>` exposes:

```rust
struct AppState {
  db: DbHandle,                          // r2d2-style pool, 4 connections
  indexer: Arc<IndexerService>,
  terminals: Arc<TerminalManager>,
  claude_dir: PathBuf,
  data_dir: PathBuf,
}
```

Constructed in `setup()` after `app.path().app_data_dir()` resolves. The
indexer kicks off its first scan from `setup()` (`tokio::spawn`).

## Errors

```rust
#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
  #[error("io: {0}")]            Io(String),
  #[error("db: {0}")]            Db(String),
  #[error("not found: {0}")]     NotFound(String),
  #[error("invalid input: {0}")] InvalidInput(String),
  #[error("process: {0}")]       Process(String),
}
```

Conversion from `anyhow::Error`, `rusqlite::Error`, `std::io::Error` via
`From` impls. The frontend receives a tagged union it can `switch` on.

## Permissions (`capabilities/default.json`)

```json
{
  "permissions": [
    "core:default",
    "shell:allow-open",
    "dialog:default",
    "fs:default",
    "process:default",
    "store:default"
  ]
}
```

`fs` is configured to allow `$HOME/.claude/**` (read) and the project's own
`$APPDATA/**` (read+write). We do **not** grant blanket FS access. Project
file reads inside the user's repo go through a typed command that checks
the path is under a known project cwd.

`shell:allow-open` needs a **custom validation regex** in
`tauri.conf.json > plugins > shell > open`:

```json
"open": "((mailto:|tel:)[\\w+][^\\s]*|https?://\\w[^\\s]*|/[\\w.][^\\n]*)"
```

The plugin's default regex is URL-only
(`^((mailto:\w+)|(tel:\w+)|(https?://\w+)).+`), so "open in default app" on a
*file path* fails validation — the symptom is an unhandled rejection reading
"Scoped command argument at position 0 was found, but failed regex
validation". The last branch permits absolute POSIX paths (we're macOS +
Linux only, so a path always starts with `/`), requiring a word character or
dot after the slash so flag-like arguments (`-i`, `--enable-debugging`) can't
pass as paths — the plugin's docs warn about exactly that.

**The outer parentheses are load-bearing.** The plugin wraps the pattern in
`^...$`, and with top-level alternation that reads as "starts with A" OR
"ends with B" — a path scope written as `^A|B$` would accept anything merely
*ending* in a path, e.g. `relative/path.md`. `tests/shell_open_scope.rs`
pins this: it parses the real `tauri.conf.json` and asserts what the scope
accepts and rejects, because this is a config value with no compile-time
check whose only failure signal is a rejected promise in the webview.
