# Annex A — Tauri + CLI-agent patterns

Plumbing patterns for driving a CLI agent from a Tauri 2 + React app:
binary discovery, streaming events across the IPC boundary, file
watching, and a renderer that runs without the shell. Each entry states
what the pattern is, why it matters, and how factorai uses it.

This annex is reference material, not a contract — the contracts are the
numbered specs. Where a pattern is already implemented, the spec that
owns it is named.

---

## A.1 — `find_claude_binary` (three-tier discovery)

**What it does.**

1. `which claude` in the inherited process PATH.
2. User login shell: `$SHELL -lc 'command -v claude'`, fallback to
   `/bin/zsh`, then `/bin/bash`. Required because macOS GUI apps don't
   inherit a terminal PATH — your homebrew / mise / asdf shims aren't
   visible to a Tauri-launched process.
3. Probe a known candidate list — `~/.local/bin/claude`,
   `~/.claude/local/claude`, `~/.local/share/mise/shims/claude`,
   `~/.asdf/shims/claude`, `~/.npm-global/bin/claude`, `~/.npm/bin/claude`,
   `~/.linuxbrew/bin/claude`, `/opt/homebrew/bin/claude`,
   `/usr/local/bin/claude`, plus globbed `~/.nvm/versions/node/*/bin/claude`.

**Why it matters.** Without (2), users who installed `claude` via
homebrew on macOS hit "command not found" 100% of the time when launching
factorai from the dock. This is the single most important pattern here.

**In factorai.** Wired into `03-backend-rust.md`
§ `find_claude_binary()`, no Windows entries (Q1).

---

## A.2 — Streaming event enum + emit/listen

```rust
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "kind")]
pub enum ClaudeStreamEvent {
    Init { session_id: String },
    TextDelta { text: String },
    ThinkingDelta { text: String },
    ToolStart { tool_name: String, tool_id: String, input: Option<String> },
    ToolDone { tool_id: String, output: Option<String> },
    Result { text: String, session_id: String },
    Error { message: String },
    Done,
}
```

```ts
type ClaudeStreamEvent =
  | { kind: 'Init'; session_id: string }
  | { kind: 'TextDelta'; text: string }
  | ...;

const unlisten = await listen<ClaudeStreamEvent>('claude-stream', ...);
```

**Why it matters.** `#[serde(tag = "kind")]` produces a TypeScript-friendly
discriminated union, no codegen needed. Mirror it by hand on the TS side.

**Reuse for factorai.** Our PTY data is bytes, not text deltas, so the
analogous enum is smaller:

```rust
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "kind")]
pub enum TerminalEvent {
    Data { id: TerminalId, bytes_b64: String },
    Status { id: TerminalId, status: TerminalStatus },
    Exit { id: TerminalId, code: Option<i32> },
}
```

---

## A.3 — Tagged streaming command macro

```rust
macro_rules! define_desktop_stream_command {
    ($name:ident, $request:ty, $event_name:literal, $runner:path) => {
        #[tauri::command]
        pub async fn $name(
            app_handle: tauri::AppHandle,
            request: $request,
        ) -> Result<String, String> {
            run_desktop_stream(app_handle, $event_name, request, $runner).await
        }
    };
}

async fn run_desktop_stream<R, F>(
    app: tauri::AppHandle,
    event_name: &'static str,
    request: R,
    runner: F,
) -> Result<String, String>
where
    R: Send + 'static,
    F: FnOnce(R, Box<dyn FnMut(Event) + Send>) -> Result<String, String> + Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        runner(request, Box::new(move |e| {
            let _ = app.emit(event_name, &e);
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}
```

**Why it matters.** Eliminates ~20 lines of boilerplate per streaming
command, and centralises the `spawn_blocking` + emit wiring so emit
errors can never silently break a stream.

**In factorai.** Streaming commands register via this macro:
`terminal_spawn`, etc.

---

## A.4 — Multi-agent dispatch with parallel availability probing

```rust
pub async fn get_ai_agents_status() -> AiAgentsStatus {
    let claude = tokio::task::spawn_blocking(claude_cli::check_cli);
    let codex  = tokio::task::spawn_blocking(codex_cli::check_cli);
    let (c, x) = tokio::join!(claude, codex);
    AiAgentsStatus { claude: c.unwrap(), codex: x.unwrap() }
}
```

**Why it matters.** Probing several CLIs in serial costs seconds on cold
launches. `spawn_blocking` + `tokio::join!` parallelizes binary lookup.

**In factorai.** MVP only ships Claude Code, so this is not wired in —
but keep the shape in mind so adding Codex later is a small
diff (rename `check_cli` to `check_claude_cli`; later add
`check_codex_cli` next to it; expose as `get_agents_status()`).

---

## A.5 — JSONL session parsing — **the one with no prior art**

The patterns above all concern Claude's **streaming** stdout (`-p` mode
with `--output-format stream-json`). factorai reads something else: the
persisted `~/.claude/projects/**/*.jsonl` history files, which nothing
else parses and Anthropic does not document.

So there is no reference parser for the surface that matters most here.
Our `02-data-model.md` schema is the closest thing to documented truth,
and parsing has to be **defensive-first**:

- `serde_json::Value` at the boundary.
- Narrow into typed structs that `#[serde(flatten)]` unknown fields.
- Never panic on unknown event types; render as collapsed JSON in the
  UI.
- Snapshot a real corpus into `apps/desktop/src-tauri/tests/fixtures/`
  before tagging a release so we catch upstream schema drift.

---

## A.6 — File-watching pattern

Uses `notify = "6"` with a `tokio::sync::mpsc` channel. Watcher runs in
a dedicated thread; events get coalesced over a short window before
firing.

**In factorai.** Same crate. Our debounce window is 1s (per `Q5` in
`07-open-questions.md`). The coalescing detail that matters: keep a
`HashSet<PathBuf>` of dirty paths, flush on timer.

---

## A.7 — Frontend invoke wrapper with mock fallback

```ts
function tauriCall<T>(command: string, args?: object): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args);
}
```

**Why it matters.** Lets you run the renderer in plain `vite dev`
(without `tauri dev`) for fast UI iteration, with the Rust calls
stubbed. Also useful for Playwright-style tests.

**In factorai.** Worth having from the start: a pure-renderer dev loop is
much faster than full Tauri rebuilds, and the mock layer naturally
documents what each command is supposed to return.

---

## A.8 — ADR-driven docs

Numbered ADRs under `docs/adr/`, one per architectural decision
(storage strategy, dependency choice, platform-level pattern), created
in the **same commit** as the code that implements it. Existing ADRs are
never edited — superseding ones are created.

**In factorai.** `docs/adr/` from day one. Seed:

| #     | Title                                                       |
| ----- | ----------------------------------------------------------- |
| 0001  | Tauri 2 + React 19 + Biome + pnpm monorepo (this stack)     |
| 0002  | Embedded PTY for `claude` (vs. launching external terminal) |
| 0003  | SQLite + FTS5 for session index (vs. JSON files)            |
| 0004  | `~/.claude/projects/` is read-only ground truth             |
| 0005  | Kill-on-quit, non-optional confirm dialog (Q10)             |

We enforce ADRs for the categories above, and no third-party quality
gates (AGENTS.md § "What this project does not do").

---

## A.9 — AGENTS.md as the source-of-truth, CLAUDE.md as shim

`AGENTS.md` is the entry point for agent guidance, with `CLAUDE.md` a real
symlink to it (`CLAUDE.md -> AGENTS.md`) rather than a one-line `@AGENTS.md`
include, so the two files literally cannot drift.

It is deliberately thin — identity, the non-negotiables, and a routing table.
The detail lives beside it and is loaded only when a task needs it:
`.claude/skills/<name>/SKILL.md` per task (the gate, the spec/ADR workflow,
frontend and backend conventions, the two test lanes, doc screenshots) and
`.claude/rules/*.md` for the constraints the one-liners compress. A rule that
must never be missed stays *in* `AGENTS.md` as a line, because a rule nobody
loads is a rule that does not exist; the rules files carry its reasoning.

---

## The five that matter most

1. **`find_claude_binary` three-tier discovery** — no Windows entries
   (Annex A.1).
2. **`#[serde(tag = "kind")]` event enum shape** — for our
   `TerminalEvent` (A.2).
3. **`define_desktop_stream_command!` macro + `run_desktop_stream`** —
   the highest-leverage of them (A.3).
4. **`tauriCall` + `isTauri()` mock shim** on the renderer — enables
   browser-only dev loop (A.7).
5. **`docs/adr/` discipline** — start it from M0 (A.8).
