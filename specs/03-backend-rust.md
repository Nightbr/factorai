# Backend (Rust / Tauri)

## Module layout (`apps/desktop/src-tauri/src/`)

```
lib.rs                # tauri::Builder, plugins, command registry, state init
main.rs               # calls lib::run()
commands/
  mod.rs
  projects.rs         # list_projects, resolve_project_path, pin_project
  sessions.rs         # list_sessions, get_session, get_session_tail, search_sessions
  terminal.rs         # terminal_spawn, terminal_write, terminal_resize, terminal_kill
  files.rs            # read_file, list_dir
  git.rs              # git_status, git_blob
  memory.rs           # read_claude_md, write_claude_md, list_plans, read_plan
  settings.rs         # get_setting, set_setting
services/
  mod.rs
  indexer.rs          # IndexerService — scan + watch + FTS upsert
  watcher.rs          # notify-rs wrapper, debounced channel
  terminal.rs         # TerminalManager — owns PTYs
  jsonl.rs            # streaming parser for session events
  search.rs           # FTS query builder + result hydration
  files.rs            # list_dir — one level of a project directory
  git.rs              # repository status + blob reads (ADR-0009)
db/
  mod.rs              # open(), migrate(), Pool wrapper
  migrations/
    0001_init.sql
    0002_fts.sql
models/
  mod.rs
  project.rs
  session.rs
  event.rs
  terminal.rs
```

## Tauri commands (the full surface for MVP)

All commands return `Result<T, AppError>`. `AppError` is a `thiserror` enum
with `serde::Serialize` so it crosses the bridge cleanly.

```rust
// projects
list_projects() -> Vec<Project>
resolve_project_path(id: String) -> Option<String>
pin_project(id: String, pinned: bool) -> ()

// sessions
list_sessions(project_id: String) -> Vec<SessionSummary>
get_session(session_id: String, offset: usize, limit: usize) -> SessionPage
get_session_tail(session_id: String, limit: usize) -> SessionPage
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
// TerminalStatusDto = { id, sessionId, projectId, status, lastActivity }.
// sessionId is never null: every PTY runs a named session (ADR-0008).

// files
read_file(path: String, max_bytes: Option<usize>) -> FileContents     // size, binary + truncated flags
list_dir(path: String, root: Option<String>) -> DirListing            // one level, capped, git-ignored flagged
// NOTE: file_diff(path, original, modified) -> DiffPayload was specced and
// never built. Monaco's createDiffEditor (ADR-0007) diffs two strings itself,
// so a Rust hunk list has no consumer. Dropped in ADR-0009; the diff viewer is
// fed by git_blob + read_file.

// git (ADR-0009)
git_status(project_path: String) -> GitStatus                         // whole repo, grouped, capped
git_blob(path: String, rev: GitRev) -> Option<FileContents>           // rev = head | index

// memory / plans
read_claude_md(project_path: String) -> Option<String>
write_claude_md(project_path: String, contents: String) -> ()
list_plans(project_path: String) -> Vec<PlanRef>
read_plan(path: String) -> String

// settings
get_setting(key: String) -> Option<JsonValue>
set_setting(key: String, value: JsonValue) -> ()
```

## Tauri events (Rust → JS only)

| Event                  | Payload                              | Source              |
| ---------------------- | ------------------------------------ | ------------------- |
| `indexer:progress`     | `{ processed, total, phase }`        | IndexerService      |
| `sessions:changed`     | `{ projectId, sessionIds: [...] }`   | watcher             |
| `terminal:data`        | `{ id, bytes: base64 }`              | TerminalManager     |
| `terminal:status`      | `{ id, status, lastActivity }`       | TerminalManager     |
| `terminal:exit`        | `{ id, code }`                       | TerminalManager     |

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
5. Status heuristics run on a separate tokio task (200ms tick).

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
messaged. `project_id` is already the encoded directory name, so locating the
transcript is a join — never a re-encode of `cwd`, which is ambiguous when a
path contains a literal `-`.

**`start_session(project_id)` returns the id to route to.** A fresh v4 UUID,
unless the project already has a live session with no transcript — one that
has never been messaged, and so is indistinguishable from the one being asked
for. That reuse keeps an impatient double-click from starting two `claude`
processes. It lives here rather than in the renderer because the sidebar's
per-project button fires on projects whose session list was never fetched, and
because the filesystem can't lag the way the index can.

### `find_claude_binary()` — three-tier discovery

Lifted from
[the reference app's claude_cli.rs](https://github.com/example/repo).
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
the reference app list):

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
timeout. Cache the resolved path + version in `settings` table:

| key                | value                        |
| ------------------ | ---------------------------- |
| `claude.binary`    | `/opt/homebrew/bin/claude`   |
| `claude.version`   | `0.2.34`                     |
| `claude.resolved`  | `1730000000` (unix ms)       |

Re-validate on app launch (cheap: `stat` + version check). The user can
override `claude.binary` via the settings DB key; expose this as a
runtime override only (no settings UI for MVP).

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
