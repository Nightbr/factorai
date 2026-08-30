# ADR-0029 — Model-facing tools need a server that is not the IDE bridge

**Date:** 2026-08-30
**Status:** Accepted

Supersedes, in part,
[ADR-0028 § 3](0028-an-agent-schedules-work-but-does-not-unschedule-it.md) — its
decisions all stand; only the transport they were delivered over is replaced.

Related:
[ADR-0017 — the IDE bridge writes one lockfile into `~/.claude/ide/`](0017-ide-bridge-writes-one-lockfile-into-claude-ide.md) ·
[ADR-0004 — the `.claude` directory is read-only](0004-claude-dir-is-read-only.md)

Behaviour in [F22](../../specs/05-features.md) § "Routines over MCP" and
[F20](../../specs/05-features.md).

## Context

F22 slice 3 put four routine tools on the IDE bridge, on the assumption that the
bridge is how factorai gives an agent new tools. It shipped, every unit test
passed, a hand-written WebSocket client drove the live bridge and got correct
answers from all four — and a real session asked to create a routine replied
that it did not know what a factorai routine was.

**The bridge is not a channel for model-facing tools, and never was.** Read out
of the shipped CLI (2.1.251), in the path that discovers a lockfile:

```js
let b = { type: S.url.startsWith("ws:") ? "ws-ide" : "sse-ide",
          url: S.url, ideName: S.name, authToken: S.authToken, scope: "dynamic" };
…
let I = await connectToServer("ide", b);
```

and in the path that turns a server's `tools/list` into the model's tool set:

```js
var Lr = ["mcp__ide__executeCode", "mcp__ide__getDiagnostics"];
function nn(e){ return !e.startsWith("mcp__ide__") || Lr.includes(e) }
…  .filter(Nr)
```

Two facts follow, and both are outside our control:

1. **The server key is a hardcoded literal.** Whatever the CLI finds under
   `~/.claude/ide/` is registered as `ide`. The `ideName` we write into the
   lockfile (`"factorai"`, ADR-0017 § 5) is the label in the `/ide` picker, not
   the key.
2. **That server's tools are allowlisted down to two**, neither of them ours,
   before the model is offered anything.

So F20's tools work for a reason that does not generalise: `openFile`,
`getWorkspaceFolders`, `getOpenEditors` and `setWorktree` are called by **the
CLI itself**. None of them was ever model-facing. Adding a fifth tool intended
for the model produces a tool that is served correctly, passes every test, and
is never offered to anyone.

The irony is worth recording: `getDiagnostics` is one of the two that *would*
reach the model, and F20 declines to register it on purpose.

**Why no test caught it.** Every test we had — unit tests against the protocol
object, and a conformance probe that spoke the CLI's own wire protocol at a live
bridge — tested factorai's half. The client's half was assumed. A transport test
can only ever prove the transport.

## Decision

**Tools meant for the model live on a second MCP server, registered under a name
of our own, over plain HTTP, and handed to each session through `--mcp-config`
at spawn. The IDE bridge keeps the CLI-facing tools and nothing else.**

### 1. Two registrations, one component

`services/agent_tools/` is a per-session listener started beside the bridge in
`TerminalManager::spawn`, held on the same `TerminalHandle`, and stopped by the
same `Drop`. One lifetime, one token generator, one teardown.

What doubles is the *registration*, because the CLI needs one connection for the
IDE role and another for tools:

| | IDE bridge | Agent tool server |
| --- | --- | --- |
| Discovered by | `~/.claude/ide/<port>.lock` | `--mcp-config` at spawn |
| Registered as | `ide` (the CLI's literal) | `factorai` |
| Transport | `ws-ide` | `http` |
| Tools called by | the CLI | the model |
| Buys | `openFile`, `at_mentioned`, `/ide` | `mcp__factorai__*` |

Rejected: **dropping the lockfile and serving everything from one plain
server.** It would trade F20's whole push half — the CLI calling `openFile`,
right-click → *Add to agent context* arriving as `at_mentioned` — for the
routine tools. A plain MCP server has no way to push a notification into the
prompt box, and nothing would ever call `openFile`.

### 2. HTTP, because `ws-ide` is not offered to us

`ws-ide` is in the CLI's config schema, so the obvious economy is to register
the *existing* WebSocket a second time under a different name. It does not work:
handed that config through `--mcp-config`, the CLI never dials the socket at all
— observed against a listener that logged every connection and saw none.
`http` is the transport a plain MCP server is registered with, and a plain
server is the only kind whose tools reach the model.

### 3. Hand-rolled HTTP, on the same terms ADR-0017 § 4 set

One route, one method, one content type, one client, on loopback. The parser is
smaller than the dependency it replaces, and — like the bridge — its correctness
is a security property, so being readable in one file is worth more than being
general. `Content-Length` framing is pinned by a test that pipelines two
requests, because desynchronising the connection is the mistake a hand-rolled
parser is most likely to make.

Rejected again: **axum**, for ADR-0017 § 4's reason, which has not changed.

### 4. Inline JSON in argv, and never `--strict-mcp-config`

The config is per session and dies with it, so a file would have to be written
somewhere and cleaned up after a `SIGKILL` for no gain — the token is readable
either way by anything running as this user.

**`--strict-mcp-config` is never passed, and that is load-bearing.** It would
make ours the only MCP servers a session has, silently dropping every server the
user configured for themselves. Asserted in a test rather than left to memory.

The cost is that every session's argv now carries a JSON blob visible in `ps`.
That is the same exposure the lockfile already has and the same reason it does
not matter: the token is not the boundary — see § 5.

### 5. The boundary is unchanged, and it is still scope

ADR-0017 § 3's three layers apply here verbatim: a per-session token compared in
constant time, a loopback bind, and — the one that actually holds — scope. For
these tools that is the project, baked into the closure at spawn, with no
`projectId` on any tool for a client to address. ADR-0028 §§ 1–6 are untouched:
no `deleteRoutine`, provenance on every write, partial updates, the cap, the
validation, enabled-by-default.

### 6. The acceptance test runs the real binary

`tests/agent_tools_conformance.rs` gives a real `claude` the real
`--mcp-config`, asks it in English to schedule something, and asserts the row
landed in the database with the right author and project. `#[ignore]`, because
it costs a model turn.

This is the test whose absence caused all of the above, and it is the only kind
that could have caught it. Record the CLI version with any pass, as ADR-0017
asks for the bridge. First green against **2.1.251**.

## Consequences

- **`mcp__ide__*` is a dead end for anything an agent should call**, and both
  modules now say so where someone would otherwise repeat the mistake — the
  bridge's own `tools_list` test asserts the four routine tools are *absent*.
- **We now track two of someone else's behaviours out of a shipped binary**: the
  IDE protocol, and the fact that a differently-named server is treated
  normally. Nothing in CI can prove either still holds, which is what § 6 is for.
- **The tool namespace is `mcp__factorai__*`**, which is user-visible in
  `/mcp`, in permission prompts and in `--allowedTools`. Renaming the server
  later would break anyone's saved allow rules.
- **A session that cannot bind the tool server still starts**, without factorai's
  own tools — the same rule the bridge follows, for the same reason.
- **ADR-0017 § 5's `ideName: "factorai"` is now demonstrably cosmetic.** It was
  reasoned about as though it carried weight; it names a row in a picker.
