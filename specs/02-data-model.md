# Data model

## Source of truth: `~/.claude/projects/`

Claude Code persists session state on disk in a fixed layout. We **read** this
directory as the ground truth for session *content* and cache derived data in
our own SQLite.

It is not the source of truth for what your **workspace** contains — that is a
record of folders you added, kept in `projects` and written by nothing else
(ADR-0011). This directory is where we go to find out what Claude has done, not
what you are working on.

```
~/.claude/
├── projects/
│   └── <encoded-project-path>/
│       ├── <session-id>.jsonl       # one event per line
│       ├── <session-id>/            # created lazily, per session that spawned agents
│       │   └── subagents/
│       │       ├── agent-<id>.jsonl # one sub-agent's transcript, same event shape
│       │       └── agent-<id>.meta.json
│       └── ...
├── settings.json                    # global settings
└── ...
```

Sub-agent transcripts carry `isSidechain: true` and an `agentId` on their
events. They are **sessions of a kind** — same JSONL event format, indexed
into `sessions` with `subagent_of` set — but they are never resumable:
`claude --resume` looks for a top-level `<id>.jsonl` under the project, and
an agent id has none. They surface nested under their parent in the session
list (F2), open read-only (F3), and don't count toward `session_count`.

### Project-path encoding

**This is one agent's naming scheme, not an identity.** It lives in
`agents::claude` and nothing outside that module encodes or decodes a path. A
project is a folder you added, keyed by a uuid (ADR-0011); the encoding is how
we find *Claude's* directory for a folder, and how a second agent's adapter
would differ.

`the prior app's encode-project-path.js` and `derive-project-path.js` perform an
invertible mapping from a filesystem path → directory name. We need both
directions.

Encoding rule observed from existing claude folders:

- Replace path separators (`/`, `\`) with `-`.
- Drop the leading separator before encoding.
- Result: `/Users/alice/code/foo` → `-Users-alice-code-foo`.

Decoding is ambiguous (a real `-` in the path collides with the separator).
Strategy: prefer the `cwd` Claude itself recorded in the transcript (Q4), and
fall back to walking decoded candidates and probing with `Path::exists()`. A
candidate we cannot confirm is discarded rather than guessed at — filing
sessions under a folder nobody worked in is worse than admitting we don't know.
The answer is cached in `discovered_projects.real_path`, which is also the
column the workspace links against.

### Session JSONL format

Each `.jsonl` file is a sequence of newline-delimited JSON objects. Each
object is a single "turn" — user message, assistant message, tool call,
tool result, or meta event (rename, summary).

> **Important caveat.** Anthropic does **not** publish a stable schema for
> these files. Everything below is reverse-engineered from a corpus of
> real sessions and from how the prior app reads them. Treat fields as
> additive: tolerate new ones, never refuse a record because it has
> extra keys, and render unknown event types as collapsed JSON.

#### Top-level event envelope

Every event we've seen has at least the following fields. Field presence
varies by event type; only `type`, `uuid`, and `timestamp` are reliable.

| Field          | Type           | Required | Notes                                                       |
| -------------- | -------------- | -------- | ----------------------------------------------------------- |
| `type`         | string         | yes      | discriminator (see table below)                             |
| `uuid`         | string (uuid)  | yes      | unique per event within the session                         |
| `parentUuid`   | string (uuid)  | no       | nullable on the first event of a session                    |
| `timestamp`    | string (ISO 8601) | yes   | UTC                                                         |
| `sessionId`    | string         | sometimes| equals the filename minus `.jsonl` on most events           |
| `cwd`          | string         | sometimes| Claude's working directory when the event was recorded     |
| `version`      | string         | sometimes| Claude CLI version that wrote the event                     |
| `gitBranch`    | string         | sometimes| recorded on some user/assistant events                      |
| `message`      | object         | sometimes| present on `user` and `assistant` events                    |
| `toolUseResult`| object/string  | sometimes| only on `tool_result`-style events                          |

#### Known `type` values

| `type`         | Meaning                                              | Renderer behaviour                |
| -------------- | ---------------------------------------------------- | --------------------------------- |
| `user`         | A user message (typed prompt or tool result wrapper) | Markdown body via `marked`        |
| `assistant`    | An assistant response chunk                          | Markdown body                     |
| `summary`      | Session-level summary written by Claude              | Rendered as a chip / pinned card  |
| `system`       | Internal CLI message (rare)                          | Collapsed by default              |
| _anything else_| Unknown — defensive fallback                         | Collapsed JSON viewer             |

We **do not** assume `tool_use` / `tool_result` are top-level event
types. In current Claude Code, tool use is encoded as content blocks
**inside** a `user` or `assistant` `message.content` array (see below).
Older the prior app code mentions a `rename` event; we have not observed
it in current corpora, but we still check `message.content[0].text` and
the top-level `title` field for a `/rename` payload as a fallback.

#### `message.content` shape

For `user` and `assistant` events:

```ts
type Message = {
  role: 'user' | 'assistant';
  // Either a plain string (legacy / simple messages) ...
  content: string | ContentBlock[];
  // ... or an array of typed blocks. Common block types observed:
};

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | ContentBlock[]; is_error?: boolean }
  | { type: 'thinking'; thinking: string }                                     // extended thinking
  | { type: string; [k: string]: unknown };                                   // unknown — show as JSON
```

Tool use we care about for file panel wiring:

| Tool name | What we do                                                       |
| --------- | ---------------------------------------------------------------- |
| `Read`    | Show "Open file" link → opens path in side panel                 |
| `Write`   | Show "Open file" link; if a follow-up event has the old content, offer diff |
| `Edit`    | Show diff (old → new) in side panel                              |
| `MultiEdit` | Show diff for each hunk                                        |
| `TodoWrite` | Render the todo list inline                                    |
| _other_   | Collapsed JSON                                                   |

#### Rust representation

Parse defensively: outer `serde_json::Value` first, then narrow.

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct SessionEvent {
    pub r#type: String,
    pub uuid: String,
    #[serde(rename = "parentUuid")]
    pub parent_uuid: Option<String>,
    pub timestamp: String,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    pub version: Option<String>,
    pub message: Option<Message>,
    // Anything we don't recognise — preserved for rendering, never panics.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: MessageContent,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Blocks(Vec<serde_json::Value>),
}
```

We deliberately keep `content` blocks as `serde_json::Value` — the
renderer is the only place that cares about block shape, and TS handles
"unknown variant → fallback" more naturally than Rust enums do.

#### Persistence implications

- **`updated_at`** comes from the last event's `timestamp`.
- **`title`** is derived in priority order:
  1. last event whose `message.content` is `[{type:'text', text:"#rename: ..."}]`
     (legacy fallback from the prior app)
  2. last event with a top-level `title` field
  3. first user-text content, trimmed to 60 chars
  4. session UUID's first 8 chars (last-resort)
- **`cwd`** is the first non-null `cwd` we see. Used to resolve the
  encoded project path to a real path authoritatively (see Q4 below).

We parse incrementally (newline scan), never load the whole file into
memory, and stream summary metadata to the UI.

## SQLite schema

`~/.local/share/dev.factorai/factorai.db` (per platform via `app_data_dir`).
Tables created on first launch and migrated forward by ordered SQL files in
`apps/desktop/src-tauri/src/db/migrations/`.

Two tables carry the project model, and **which one owns which fact is the
design** (ADR-0011). `projects` records decisions you made; `discovered_projects`
records what an agent's store contains. The scan never writes the first; user
actions never write the second.

### `projects` — the workspace

| col              | type      | notes                                                   |
| ---------------- | --------- | ------------------------------------------------------- |
| id               | TEXT PK   | uuid v4. Not derived from the path                      |
| real_path        | TEXT      | canonical absolute path, **NOT NULL UNIQUE**            |
| display_name     | TEXT      | last path component                                     |
| pinned           | INTEGER   | 0/1                                                     |
| missing          | INTEGER   | 0/1 — the folder is gone from disk                      |
| opened_at        | INTEGER   | unix ms                                                 |

`session_count` and `last_session_at` are **not columns**. They are aggregated
per query from the sessions of every discovered directory linked to the folder:
they change whenever the indexer runs, and a stale count is worse than a join.

### `discovered_projects` — what the agents' stores hold

| col        | type      | notes                                                            |
| ---------- | --------- | ---------------------------------------------------------------- |
| id         | INTEGER PK|                                                                   |
| agent      | TEXT      | `'claude'`. Exists so a second agent is an INSERT, not a migration |
| key        | TEXT      | the agent's own directory name — a foreign key into *their* store |
| real_path  | TEXT      | the folder it describes; NULL when unresolvable                   |
| project_id | TEXT FK   | `projects(id) ON DELETE SET NULL`; NULL = not in the workspace    |

`UNIQUE (agent, key)`. The `ON DELETE SET NULL` is what makes removing a project
cheap: the discovery survives, only the membership goes.

### `sessions`

| col            | type       | notes                                                            |
| -------------- | ---------- | ---------------------------------------------------------------- |
| id             | TEXT PK    | session UUID (= filename minus `.jsonl`)                         |
| discovered_id  | INTEGER FK | `discovered_projects(id) ON DELETE CASCADE`                      |
| title          | TEXT       | from `/rename` event, else first user message excerpt            |
| created_at     | INTEGER    | from first event timestamp                                       |
| updated_at     | INTEGER    | from last event timestamp                                        |
| turn_count     | INTEGER    |                                                                  |
| file_mtime     | INTEGER    | filesystem mtime when last indexed (for change detection)        |
| file_size      | INTEGER    | bytes at last index (cheap "did this change?" probe)             |
| cwd            | TEXT       | last observed `cwd` from events                                  |
| subagent_of    | TEXT       | parent session id for a sub-agent transcript; NULL for a real one. No FK: read_dir order can index an agent before its parent, and an enforced reference would turn that into an error. |

A session hangs off the **discovery**, not the workspace: it belongs to a
directory in an agent's store, and whether that directory is in your workspace
is a separate, changeable fact. Putting the link one level up means adding or
removing a project updates a handful of rows instead of every session in it.

A **sub-agent** transcript hangs off the same discovery as the session that
spawned it. Claude Code writes it to `<session-id>/subagents/agent-*.jsonl`
inside the store directory, and that nested folder is part of a session rather
than a directory of the store — reading it as one is what used to manufacture a
project called `subagents`.

Live status is in-memory only and has no column here.

### `messages_fts` (FTS5 virtual table)

```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
  session_id UNINDEXED,
  role,        -- 'user' | 'assistant'
  body,        -- flattened text content
  tokenize = 'porter unicode61'
);
```

Populated by the indexer; not the source of truth (rebuildable). No
`project_id`: a workspace id is not stable across a remove and a re-add, so
storing one would leave rows pointing at projects that no longer exist. The
project is resolved through `sessions` → `discovered_projects` at query time.

### `_meta`

Migration bookkeeping: one row per applied migration, keyed `migration:<name>`
with the applied-at timestamp as the value. Written by `db::open`, read by
nothing else — it exists so a migration runs once.

| Column | Type    | Notes                    |
| ------ | ------- | ------------------------ |
| key    | TEXT PK | e.g. `migration:0004_workspace_projects` |
| value  | TEXT    | RFC3339 applied-at       |

### `settings`

| col   | type    | notes                       |
| ----- | ------- | --------------------------- |
| key   | TEXT PK |                             |
| value | TEXT    | JSON-encoded scalar / blob  |

For things that need ACID and queries. UI prefs go in `tauri-plugin-store`
instead (file-backed JSON, simpler).

### Indexes

```sql
CREATE INDEX idx_sessions_discovered ON sessions(discovered_id, updated_at DESC);
CREATE INDEX idx_sessions_updated    ON sessions(updated_at DESC);
CREATE INDEX idx_discovered_project  ON discovered_projects(project_id);
CREATE INDEX idx_discovered_real_path ON discovered_projects(real_path);
```

## Indexer lifecycle

**Discovery is global; parsing is gated on the workspace** (ADR-0011). Finding
out what a store holds is cheap and worth doing unconditionally — it is what
fills the import dialog. Reading transcripts is not, and search is scoped the
same way, so parsing a folder you never added would be work no query can read.

```
[app start]
  └── discover()          -- cheap, every agent, every directory
        read_dir ~/.claude/projects/
        + one partial file read per directory to recover `cwd`
        → upsert discovered_projects(agent, key, real_path)
        → reconcile(): link to projects by canonical path, exact match
  └── refresh_missing()   -- stat each workspace folder, once per scan
  └── for each LINKED directory:
        for each .jsonl:
          if (mtime, size) unchanged from sessions.{file_mtime,file_size}: skip
          else: parse incrementally → upsert sessions row
                re-tokenize → DELETE messages_fts WHERE session_id = ?
                              INSERT new rows
        reap: rows for this directory whose .jsonl is no longer in the
              listing → DELETE sessions + messages_fts, one transaction

[add a project]
  └── scan_project(id) — the same, for one folder. Nothing was parsed before.

[runtime]
  notify watcher on ~/.claude/projects/**/*.jsonl   (recursive)
      → debounce 1s → scan_dir_path(dir)
      → not linked to a workspace folder? drop it, silently
      → otherwise re-index changed files and emit `sessions:changed`
```

`sessions:changed` carries the **workspace** project id, since that is what the
renderer keys its caches by.

**The reap is a set difference, not a probe per row.** The scan already holds
the directory listing, so the rows to drop are the ones that aren't in it —
sub-agent transcripts included, since their rows carry the parent directory's
`discovered_id` and a listing of top-level ids alone would read every one of
them as deleted. Three things it must not do, each of which is a test:

- **Reap from a listing it never read.** A directory whose `read_dir` failed,
  or a store that has vanished entirely (Claude uninstalled, `CLAUDE_HOME`
  moved), leaves the index alone. Unreadable and empty are different answers.
- **Reap outside the directory it scanned.** The delete is scoped to that
  `discovered_id`.
- **Reap a live session.** A session with a PTY behind it keeps its row even if
  the transcript goes, so a tab you are watching does not lose its title. The
  ADR-0008 window — spawned but never messaged — needs no exemption: rows only
  ever come from transcripts, so there is nothing there to reap.

Without it the index was upsert-only and a deleted transcript stayed forever.
The visible symptom was worse than a stale count: the row still had a title, so
a search hit opened it, found no transcript, and spawned `claude --session-id`
rather than `--resume` — exactly as ADR-0008 specifies, but landing you in an
empty session wearing a long conversation's name.

We do not block UI on the initial scan. The indexer streams progress events
(`indexer:progress { processed, total }`) and the UI shows a small spinner
until the first pass completes. Search works against whatever is indexed so
far.

## Live session state (in-memory, not persisted)

Process state for sessions launched from inside factorai lives only in Rust
memory, in a `DashMap<SessionId, TerminalHandle>`:

```rust
struct TerminalHandle {
  pid: u32,
  pty_pair: PtyPair,         // portable-pty
  writer: Box<dyn Write + Send>,
  status: TerminalStatus,    // Running | Idle | Stopped | WaitingInput
  child: Box<dyn Child + Send + Sync>,
  last_activity: Instant,
}
```

Status transitions are heuristic, ported from `the prior app's session-transitions.js`:

- **Running** → bytes flowing in last 200ms.
- **WaitingInput** → output settled and last frame contains a known prompt
  marker (`? `, "Continue?", etc.).
- **Idle** → no output for >2s, no prompt detected.
- **Stopped** → child exited.

Persisting this would be wrong: a session "running" only exists while the
process is alive. On app restart everything resets to whatever JSONL says.
