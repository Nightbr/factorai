# ADR-0062 — A session id the agent mints is adopted from its title

**Date.** 2026-09-22
**Status.** Accepted. Amends
[ADR-0008](0008-factorai-assigns-new-session-ids.md), which stays in force for
Claude Code and for every agent that accepts an id at launch; this ADR is the
rule for the ones that do not. The contract is `specs/05-features.md` F30 §
"A new Codex session, and the id it gets".

## Context

ADR-0008 made factorai the namer of its own sessions because every identity in
the app — the route, the xterm pool key, `terminalStore.bySession`, the status
dot, the `sessions` row — needs an id before the PTY exists. It rejected
"spawn bare and watch the store for the new file" for three reasons: the file
appears at the first message, not at spawn; two sessions starting in one
project cannot be told apart by watching a directory; and a placeholder
identity rewritten mid-session invalidates the pool key, the store entry and a
URL the user may already hold.

Codex CLI offers no way in. Read at source tag `rust-v0.155.1`: the interactive
`codex` takes no thread id (`tui/src/cli.rs` marks `resume_session_id` as
`#[clap(skip)]`), the thread uuid is minted in-process, and the rollout file is
materialised on the first flush with pending items — in practice the first user
turn (`rollout/src/recorder.rs`, `deferred_creation: true`). ADR-0008's first
two objections apply unchanged. So the question is not whether to adopt an id,
but **from where**, and **how to keep the rewrite from being the mess ADR-0008
feared**.

Three channels were weighed:

| channel | when the id is known | tells sessions apart | cost |
|---|---|---|---|
| watch `sessions/YYYY/MM/DD/` for a new rollout with `cwd` = project | first user turn | no — two spawns in one folder are indistinguishable until their prompts differ | watcher already exists |
| `notify` hook (`agent-turn-complete` carries `thread-id`) | end of the first turn | yes, by `cwd` only | overrides the user's own `notify`; a subprocess per turn |
| the TUI's title, `tui.terminal_title = ["thread-id", …]` | TUI start, before any message | **yes — it arrives on the session's own PTY** | one `-c` flag at spawn |

The third is the only one that answers on the session's own file descriptor,
which is what makes the two-sessions problem vanish: the title parser
(ADR-0015) is already per-PTY.

## Decision

1. **`Spawn::id_source()` says which rule applies.** `IdSource::Ours` is
   ADR-0008 unchanged. `IdSource::Agent` is the rest of this ADR.
2. **A new session under `IdSource::Agent` starts under a provisional id**, a
   v4 uuid factorai mints exactly as `start_session` does today. The route, the
   pool key, the tab and the status dot all key on it from t=0, so nothing in
   the renderer is special-cased for "no id yet". No `sessions` row is written
   for it: a row is written when a transcript exists, and none does.
3. **The agent's id is read from the terminal title.** For Codex the spawn
   passes `-c 'tui.terminal_title=["run-state","thread-id"]'`; the TUI writes
   `ESC ] 0 ; <state> | <uuid> BEL` from startup, and the same OSC-0 parser that
   feeds status (ADR-0015) yields the uuid. The first title carrying a uuid is
   the adoption event.
4. **Adoption is one atomic rebind, emitted once.** `TerminalManager` records
   `provisional → adopted` on the handle, emits `session:adopted { provisional,
   adopted, projectId }`, and from then on answers to both ids for the life of
   the PTY. The renderer re-keys the pool entry, the tab, the store entry and
   `history.replace`s the route in one store transaction. The provisional id
   is remembered for the session's lifetime so a stale URL still lands on the
   tab.
5. **The store watcher is the fallback, not the source.** If no title carrying
   a uuid has arrived within a bound (F30 says 10 s) and a rollout appears with
   `cwd` = the spawn folder and a `timestamp` after the spawn, it is adopted
   the same way. If the process exits before either, the tab closes and nothing
   is written — an unnamed Codex session that never spoke never existed.
6. **Resume never adopts.** A resume passes the adopted id to `codex resume
   <id>`; the title's uuid is checked against it, and a mismatch is logged and
   ignored rather than rebinding a session the user opened by id.

## Consequences

- The route for a provisional session is live and linkable at t=0 as
  ADR-0008 wanted; it changes once, within a second of spawn on a normal
  machine, and the old link keeps working. The rewrite ADR-0008 feared is
  confined to one event and one store action.
- `--strict` title parsing: the Codex `Status` capability and the id source
  read the same title, so factorai owns the title items for Codex sessions it
  runs. A user's own `tui.terminal_title` is not honoured inside factorai; F30
  states this and why (the tab strip, not their terminal, is where the title
  would have gone).
- The empty-session guard (`start_session` reusing a live, never-messaged
  session) applies to provisional sessions too: a provisional session with no
  adopted id is by definition unmessaged.
- ADR-0008's Restart table gains a row per id source. For `IdSource::Agent`:
  a session with an adopted id restarts as `resume <id>`; one without cannot be
  restarted, only started again, which is what closing the tab and pressing `+`
  already does.
- Any future agent that mints its own id and writes it into the title, or
  into any per-PTY channel, takes this path. One that mints an id and exposes
  it nowhere per-PTY gets the fallback only, and F30 says its sessions are
  *not resumable* until it is first indexed.
