# ADR-0008 — factorai assigns new-session ids

**Status.** Accepted (M2 catch-up, 2026-08-13).

## Context

Every identity in factorai is a session id: the route
(`/projects/$projectId/sessions/$sessionId`), the persistent xterm pool,
`terminalStore.bySession`, the status dots, the SQLite `sessions` row. All of
them assume the id exists before the UI does anything.

Starting a *new* session breaks that assumption. Until now the only way in
was opening a session that already existed, so Claude had always named it
first. `terminal_spawn` reflected that with a single `resume_session_id`
field, and the new-session button specced in `specs/06-milestones.md` M2 was
never built — there was nowhere to route to.

Two ways to get an id for a session that doesn't exist yet:

1. **Let Claude name it.** Spawn bare `claude`, then discover the id by
   watching `~/.claude/projects/<encoded>/` for a new `.jsonl`.
2. **Name it ourselves.** `claude --session-id <uuid>` takes the id as input.

Option 1 is inherently racy. The transcript doesn't appear until the first
message, so between the click and the user typing there is nothing to watch;
with two sessions starting in the same project there is no way to tell which
`.jsonl` is which; and the UI would need a placeholder identity that gets
rewritten mid-session — invalidating the pool key, the store entry and the
URL the user may already have navigated.

## Decision

**factorai names its own sessions.** `start_session(project_id)` returns the
id to route to, and `terminal_spawn` carries `{ sessionId, projectId }` for
both cases. `SpawnOpts.resume_session_id` is gone.

The spawn decides for itself which flag carries the id, by probing for the
transcript at `<claude_dir>/projects/<project_id>/<session_id>.jsonl`:

| transcript on disk | flag           |
| ------------------ | -------------- |
| exists             | `--resume`     |
| missing            | `--session-id` |

Callers never state their intent, because intent is not what the CLI cares
about. Both flags fail loudly when handed the wrong kind of id — `--resume`
finds no conversation, and `--session-id` exits with "Session ID … is already
in use" (both verified against the installed CLI). The filesystem is the only
authority on which kind an id is, and unlike the SQLite index it cannot lag
behind the 1s watcher debounce.

Probing per spawn rather than remembering how a session started is what makes
**Restart** correct in all four cases:

| case                                   | transcript | flag           |
| -------------------------------------- | ---------- | -------------- |
| open an existing session               | yes        | `--resume`     |
| start a new session                    | no         | `--session-id` |
| restart one messaged at least once      | yes        | `--resume`     |
| restart one abandoned before its first message | no  | `--session-id` |

`start_session` also owns the "don't pile up empty sessions" rule: a live
session in this project whose transcript doesn't exist has never been
messaged, so it is indistinguishable from the one being asked for and is
returned instead of minting a new id. That decision lives in Rust because the
sidebar's per-project button fires on projects whose session list was never
fetched — TypeScript can't answer "has this been messaged" without a round
trip anyway, and answering from the index would race the debounce.

## Consequences

**Positive.**

- A new session is a normal session from t=0. No placeholder identity, no
  id rewriting, no special-casing in the pool, the store or the router. The
  route is live and linkable before `claude` has printed a byte.
- Restart, resume and start-new are one code path.
- A session id that is neither indexed nor live — a stale URL after a
  restart, say — self-heals: the probe finds no transcript and claims the id,
  so the route boots a working session instead of erroring.
- The reuse rule makes an impatient double-click harmless.

**Negative.**

- We depend on `--session-id` existing and accepting a v4 UUID. If a future
  CLI drops it, new sessions break while resume keeps working; the failure is
  visible (claude's usage error lands in the terminal pane), and the fallback
  would be option 1's discovery-by-watching.
- `TerminalStatusDto.sessionId` is no longer nullable and gains `projectId`.
  Cheap now — `terminal_list` has no callers in the renderer yet.
- Two round trips per click (`start_session`, then `terminal_spawn` from the
  mounted terminal) rather than one.

## Relationship to ADR-0004

ADR-0004 makes `~/.claude/` read-only ground truth, and that still holds:
factorai does not create, mutate or delete a transcript here. It supplies an
id on `claude`'s command line and `claude` does its own writing, exactly as
it would have with an id of its own choosing. ADR-0004's stated exception for
fork is moot — fork was cut from the MVP (`specs/05-features.md` F6).

What is new is the direction of the naming: ADR-0004 assumed we only ever
*read* identities out of `~/.claude/`, and we now also put one in. Hence this
ADR rather than a footnote. ADR-0004 is **not** superseded.

## Related

- `docs/adr/0004-claude-dir-is-read-only.md`
- `docs/adr/0002-embedded-pty-for-claude.md`
- `specs/03-backend-rust.md` § "Terminal"
- `specs/05-features.md` F6 (Resume & new session)
- `specs/06-milestones.md` M2
