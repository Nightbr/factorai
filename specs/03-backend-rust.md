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
  files.rs            # read_file, list_dir, file_diff
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
terminal_spawn(opts: SpawnOpts) -> TerminalId          // resume_session_id?, cwd, cols, rows
terminal_write(id: TerminalId, data: String) -> ()
terminal_resize(id: TerminalId, cols: u16, rows: u16) -> ()
terminal_kill(id: TerminalId) -> ()
terminal_list() -> Vec<TerminalStatusDto>

// files
read_file(path: String, max_bytes: Option<usize>) -> FileContents     // includes mime + size
list_dir(path: String, root: Option<String>) -> DirListing            // one level, capped
file_diff(path: String, original: String, modified: String) -> DiffPayload

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
2. Build argv: `[claude]` or `[claude, --resume, <id>]`, with cwd from
   options or session's last known cwd.
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
recursion in the backend at all. The file tree (F11) expands lazily, one call
per opened node, which is what keeps `node_modules` / `.venv` / symlink cycles
from ever being walked.

Rules, all enforced in Rust so the renderer stays dumb:

- `.git` is skipped. Every other dotfile and cache directory is listed —
  `.claude/` is one of the more interesting directories in this app.
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

Read-only, like the rest of our disk access (ADR-0004).

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
