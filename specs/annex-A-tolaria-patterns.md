# Annex A — Patterns lifted from tolaria

Curated findings from a deep dive into
[refactoringhq/tolaria](https://github.com/refactoringhq/tolaria), a
production Tauri 2 + React 19 app that integrates with Claude Code CLI
(among other AI agents). Tolaria solves a different product problem
(markdown knowledge bases) but its **plumbing** for CLI-based AI agents
is directly applicable to factorai.

Tolaria is dual-licensed and public. Reuse is OK; attribution in code
comments is a courtesy and a useful breadcrumb for ourselves.

---

## A.1 — `find_claude_binary` (three-tier discovery)

**Source.** `src-tauri/src/claude_cli.rs` (lines ~57–150).

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
factorai from the dock. This is the most important pattern to lift.

**Reuse for factorai.** Already wired into `03-backend-rust.md`
§ `find_claude_binary()`. Strip Windows entries; keep the rest.

---

## A.2 — Streaming event enum + emit/listen

**Source.** `src-tauri/src/claude_cli.rs` ll. 14–43, JS side
`src/utils/ai-chat.ts`.

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

**Source.** `src-tauri/src/commands/ai.rs` — `define_desktop_stream_command!`
macro.

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

**Reuse for factorai.** Drop in directly. Our streaming commands will
register via this macro: `terminal_spawn`, etc.

---

## A.4 — Multi-agent dispatch with parallel availability probing

**Source.** `src-tauri/src/ai_agents.rs`.

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

**Reuse for factorai.** MVP only ships Claude Code. Don't pull this in
yet — but keep the shape in mind so adding Codex later is a small
diff (rename `check_cli` to `check_claude_cli`; later add
`check_codex_cli` next to it; expose as `get_agents_status()`).

---

## A.5 — JSONL session parsing — **what tolaria does NOT do**

Tolaria parses Claude's **streaming** stdout (`-p` mode with
`--output-format stream-json`), not the persisted
`~/.claude/projects/**/*.jsonl` history files. That's the novel surface
for factorai.

Implication: there is no upstream reference parser for what we want to
build. Our `02-data-model.md` schema is the closest thing to documented
truth, and we should treat parsing as **defensive-first**:

- `serde_json::Value` at the boundary.
- Narrow into typed structs that `#[serde(flatten)]` unknown fields.
- Never panic on unknown event types; render as collapsed JSON in the
  UI.
- Snapshot a real corpus into `apps/desktop/src-tauri/tests/fixtures/`
  before tagging a release so we catch upstream schema drift.

---

## A.6 — File-watching pattern

**Source.** `src-tauri/src/vault_watcher.rs`.

Uses `notify = "6"` with a `tokio::sync::mpsc` channel. Watcher runs in
a dedicated thread; events get coalesced over a short window before
firing.

**Reuse for factorai.** Same crate, same pattern. Our debounce window is
1s (per `Q5` in `07-open-questions.md`). The coalescing detail worth
copying: keep a `HashSet<PathBuf>` of dirty paths, flush on timer.

---

## A.7 — Frontend invoke wrapper with mock fallback

**Source.** `src/utils/ai-chat.ts` and a `mock-tauri.ts` shim.

```ts
function tauriCall<T>(command: string, args?: object): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args);
}
```

**Why it matters.** Lets you run the renderer in plain `vite dev`
(without `tauri dev`) for fast UI iteration, with the Rust calls
stubbed. Also useful for Playwright-style tests.

**Reuse for factorai.** Add early. Pure-renderer dev loop is much
faster than full Tauri rebuilds, and the mock layer naturally
documents what each command is supposed to return.

---

## A.8 — ADR-driven docs

Tolaria has `docs/adr/` numbered ADRs (`0001-…`, `0058-…`). One ADR per
architectural decision (storage strategy, dependency choice,
platform-level pattern). Created in the **same commit** as the code
that implements the decision. Existing ADRs are never edited —
superseding ones are created.

**Reuse for factorai.** Start `docs/adr/` from day one. Seed:

| #     | Title                                                       |
| ----- | ----------------------------------------------------------- |
| 0001  | Tauri 2 + React 19 + Biome + pnpm monorepo (this stack)     |
| 0002  | Embedded PTY for `claude` (vs. launching external terminal) |
| 0003  | SQLite + FTS5 for session index (vs. JSON files)            |
| 0004  | `~/.claude/projects/` is read-only ground truth             |
| 0005  | Kill-on-quit, non-optional confirm dialog (Q10)             |

We don't enforce CodeScene / Codacy / coverage gates like tolaria does.
We do enforce ADRs for the categories above.

---

## A.9 — AGENTS.md as the source-of-truth, CLAUDE.md as shim

Tolaria's `CLAUDE.md` is one line: `@AGENTS.md`. All the actual
guidance lives in `AGENTS.md`. We do the same, but with a real symlink
(`CLAUDE.md -> AGENTS.md`) so the two files literally cannot drift.

---

## Top 5 to lift verbatim into factorai

1. **`find_claude_binary` three-tier discovery** — copy with Windows
   entries stripped (Annex A.1).
2. **`#[serde(tag = "kind")]` event enum shape** — for our
   `TerminalEvent` (A.2).
3. **`define_desktop_stream_command!` macro + `run_desktop_stream`** —
   one of the highest-leverage patterns in the repo (A.3).
4. **`tauriCall` + `isTauri()` mock shim** on the renderer — enables
   browser-only dev loop (A.7).
5. **`docs/adr/` discipline** — start it from M0 (A.8).

## Anti-patterns from tolaria — do NOT copy

- **CodeScene / Codacy hard gates.** Useful at tolaria's scale; over the
  top for a solo dev tool. We use Biome + `tsc --noEmit` + `cargo
  clippy` as the floor, no third-party gating.
- **PostHog instrumentation.** No telemetry for MVP.
- **Localization via `lara.yaml`.** Single-locale (EN) for MVP.
- **Vault-specific code paths.** Tolaria's whole domain is markdown
  knowledge bases. None of `vault/`, frontmatter, wikilinks, or git
  sync is relevant.
- **MCP vault bridge.** Their `mcp/` module wires an MCP server for
  Claude to call vault tools. We're deferring our own MCP IDE emulator;
  do not blindly copy theirs.
- **Six-agent fan-out (Gemini, Pi, Kiro…)** — over-engineering for our
  scope. Claude Code only for v1; Codex *maybe* in v2.
