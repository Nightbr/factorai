# ADR-0017 — The IDE bridge writes one lockfile into `~/.claude/ide/`, over a `tokio-tungstenite` socket

**Status.** Accepted (2026-08-19), **taking effect with the F20 implementation**
— written ahead of the code deliberately, because the decisions below are what
the code is allowed to do and two of them constrain a security boundary. Amends
[ADR-0004](./0004-claude-dir-is-read-only.md): see § "What this does to
ADR-0004". Arises from [F20](../../specs/05-features.md) and roadmap item 19.

## Context

Under `00-overview.md` § "The operating model", everything factorai does today
is **pull** — the human goes and looks at the Changes tab, the tree, the diff.
IDE emulation is the **push** half: the agent asks, and the human decides in
place. Nothing else on the roadmap closes that gap.

The `claude` CLI treats an editor as an MCP server it connects *out* to. The
protocol was read out of the shipped binary (**2.1.235**), not inferred:

- The CLI enumerates a fixed set of `.claude/ide` directories and reads every
  `<port>.lock` in them. The port comes from the **filename**; the file's JSON
  carries `workspaceFolders`, `pid`, `ideName`, `useWebSocket`,
  `runningInWindows` and `authToken`.
- It TCP-probes the port before trusting an entry, then connects by WebSocket
  with the token in an `X-Claude-Code-Ide-Authorization` header.
- `CLAUDE_CODE_SSE_PORT` in the child's environment **selects among the
  lockfiles it found**. It does not add a search location, and it is not a
  substitute for the file — the token only exists there.
- Autodetect polls for up to 30 seconds and connects only when **exactly one**
  entry matches. A developer with VS Code open is therefore a coin toss unless
  the port is pinned.
- The tool names present in the binary are `openFile`, `openDiff`, `close_tab`,
  `closeAllDiffTabs` and `getDiagnostics`, plus the `ide_connected`,
  `selection_changed` and `at_mentioned` notifications.

Three decisions follow from that, and all three are load-bearing enough to
record before anything is built.

## Decision

### 1. A lockfile in `~/.claude/ide/`, and it is the only thing we write there

There is no way to be an IDE without it. The file is ours: we create it, we own
it, we delete it. We do not read or write anything else under that directory,
and nothing about the rest of `~/.claude/` changes.

### 2. One WebSocket server per session, not one per app

The port *is* the session identity. Each PTY gets its own listener, its own
lockfile, its own token, and `CLAUDE_CODE_SSE_PORT` set to its port.

This is the only mechanism that answers "which tab does this `openFile` belong
to". factorai runs many PTYs at once against the same project, so neither the
client pid nor `workspaceFolders` distinguishes them. Pinning the port also
removes the exactly-one-match coin toss above.

Rejected: **one app-wide server**, because every request then arrives anonymous.
Rejected: **one server with per-session tokens**, because the token is
discovered *through* the lockfile and the lockfile is keyed by port in its own
filename — many tokens means many lockfiles means many ports regardless. The
protocol does not have that shape.

### 3. Three independent layers, and the third is the real boundary

Any process on the machine can reach a loopback port, so:

- **Token.** Per-session, random, compared in constant time against
  `X-Claude-Code-Ide-Authorization`. Lockfile mode `0600`.
- **Loopback.** Bind `127.0.0.1` explicitly, never `0.0.0.0`.
- **Path scope.** Every path argument is canonicalised — symlinks resolved, `..`
  collapsed — and rejected if it escapes the session's project root.

The third is the one that matters, and saying so is the point of writing this
down. The token is readable by anything running as the user, so it authenticates
*a process on this machine*, which is a weaker claim than it looks. What keeps a
connected client from being a general-purpose file oracle is the scope check.
Guarded by `tests/ide_ws_scope.rs`, the sibling of the existing
`tests/shell_open_scope.rs`.

### 4. `tokio-tungstenite`, and hand-rolled JSON-RPC on top

`tokio` is already a dependency. `tokio-tungstenite` adds a WebSocket handshake
we can inspect before accepting, and nothing else.

Rejected: **axum**, which drags hyper and tower in for one endpoint that serves
no HTTP — a lot of surface for a component whose whole value is being small
enough to reason about. Rejected: **hand-rolling the handshake**, which means
owning frame masking, continuation frames and close semantics in the one place
where a bug is a security bug.

The MCP layer itself is hand-written: `initialize`, `tools/list`, `tools/call`
and two outbound notifications. § 4 of `AGENTS.md` already says this project
hand-mirrors types across the IPC boundary and takes no code generation, and an
MCP SDK is the same bet in a different coat. It also keeps the entire protocol
readable in one file.

### 5. We report `ideName: "factorai"`

Discovery matches on port and `workspaceFolders`; the CLI's `ideKind` table
(`cursor`/`windsurf`/`vscode` → `vscode`, `intellij`/`pycharm` → `jetbrains`)
drives **process detection and terminal sniffing**, neither of which applies to
us. Masquerading as `vscode` would unlock any vscode-gated path unconditionally
while inviting VS Code semantics we cannot honour — preview tabs, a dirty
document model, `executeCode` — and would be a lie in a file the user can read.
If something real turns out to be gated behind `ideKind`, that is evidence for a
superseding ADR, not a reason to guess now.

### 6. No writes to the working tree in this decision

`openDiff` and the accept/reject-hunk surface are **out of scope here**. They are
the first time factorai would write to a repository, which contradicts
[ADR-0009](./0009-git2-for-repository-state.md)'s *"everything is read-only. No
staging, no discard, no commit"* — and they need the concurrent-modification
failure case designed, which is the one a demo never hits. That gets its own ADR
alongside its own code. ADR-0009 stands untouched by this one.

## Consequences

**Positive.**

- The push half of the operating model becomes possible at all.
- Attribution is free: a request's port names its session.
- ADR-0004's intent survives intact — no user data is ever written.
- The read-only tool set ships without touching ADR-0009, so the valuable-but-
  dangerous half can be designed on its own timeline.

**Negative.**

- N listeners and N lockfiles for N sessions, and a `SIGKILL` leaves a lockfile
  behind. Reaped in the same `kill_all()` / `Drop` path ADR-0005 already
  guarantees, plus a sweep at startup of our own entries whose pid is dead. The
  CLI's TCP probe means a stale entry degrades rather than breaks.
- We now track someone else's protocol out of a shipped binary. Nothing in CI
  can prove we still match it, so the conformance pass is manual and records the
  CLI version it was made against.
- A port per session is a larger attack surface than a port per app. That is the
  price of attribution, and it is why the path scope is a test rather than a
  comment.

## Related

- [ADR-0004](./0004-claude-dir-is-read-only.md) — amended, see below
- [ADR-0005](./0005-kill-on-quit-non-optional.md) — the teardown this reuses
- [ADR-0009](./0009-git2-for-repository-state.md) — untouched, deliberately
- `specs/05-features.md` F20, `specs/roadmap/TODO.md` item 19

## What this does to ADR-0004

ADR-0004 says `~/.claude/` is read-only ground truth and lists what we do not
do: mutate session JSONLs, move or delete session files, inject events. **All of
that still holds.** Its one existing exception is fork, which writes a new
`.jsonl` rather than editing one.

This adds a second exception, and it is narrower than the first: **one file, at
`~/.claude/ide/<port>.lock`, describing this application to a client that is
looking for it.** It is not session data, not a transcript, not configuration
Claude Code reads for its own behaviour, and it is deleted when the session that
owns it ends.

The rule to carry forward is the rule ADR-0004 was really about: *we never write
anything that Claude Code or the user would mistake for their own data.* A
handle we create and destroy is not that. Anything beyond it needs a new ADR.
