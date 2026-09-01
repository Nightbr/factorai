# ADR-0031 — A footer shell is a PTY without a session, and outside the work count

**Status.** Accepted (2026-09-01). Narrows
[ADR-0008](0008-factorai-assigns-new-session-ids.md) and
[ADR-0020](0020-the-quit-confirm-asks-about-work-not-processes.md) — the scope
of each, not their decisions. Arises from
[F23](../../specs/05-features.md).

## Context

Every PTY in factorai had been a `claude` process. ADR-0008 built the app's
identity chain on that: a session id exists before any process does, and the
route, the pooled xterm, `terminalStore.bySession`, the status dots and the
SQLite `sessions` row are all keyed by it.

F23 puts a second kind of PTY on screen — the user's own shell, in a strip
under the session — and it has no session id of its own. It is drawn under a
session, it dies with that session, and it is not that session.

Three passes over `TerminalManager`'s handle map say "terminal" and mean
"session", and each is wrong for a shell in a different way:

- `next_session_id` reuses a live session with no transcript on disk, so a
  shell would be offered to a "new session" click and `claude --resume` would
  be pointed at an id no transcript will ever exist for.
- `live_session_ids` is what the indexer's reap pass must not drop, so a shell
  would pin a phantom row in the sidebar for a session that does not exist.
- The reader derives status from `OSC 0` titles (ADR-0015). Shells set titles
  too — most prompts set one on every command — so a shell would report the
  user's prompt as Claude working, or as Claude waiting.

And a fourth question, on the way out: ADR-0020 made the quit confirm fire on
work in progress rather than on live processes. A shell running a build is work
in progress by any honest reading, and a shell sitting at its prompt is exactly
the case ADR-0020 stopped asking about.

## Decision

**A PTY carries a `kind` — `Agent` or `Shell` — and the three session passes
filter on it.** Not a name check, not a nullable session id: a shell keeps a
session id because that is what makes closing a session kill its shells, and
the kind is what stops anything else reading it as a session.

`TerminalId` was already a fresh `Uuid::new_v4()` with the session id as a
*field* on the handle, so no new id space was needed. What was missing was the
statement that the field means something different in the two cases.

**A shell is outside the quit guard entirely.** `working_count()` filters to
agents, and `needsCloseConfirm` on the session header is unchanged. So quitting
the app, or closing a session, `SIGKILL`s a running build without asking.

**Kill-on-quit is untouched** (ADR-0005). Every shell still dies with the app.

## Alternatives considered

**Detecting real work in a shell.** `MasterPty::process_group_leader()` —
`tcgetpgrp` on the master fd, available in portable-pty 0.8 — compared against
the shell's own pid answers "is a foreground command running" exactly. It would
have let the quit confirm cover a running build without ever firing for an idle
shell. Declined on the product call: the dialog is the cost, and a second reason
for it to appear is a step back towards the dialog nobody reads. The mechanism
is recorded here because it is the thing to reach for if that call is revisited.

**Any live shell triggers the confirm.** This is ADR-0005's original "is any PTY
alive", reintroduced for the shell half. It is what ADR-0020 exists to have
removed: an idle shell left open in the morning would make every quit a dialog.

**A separate manager for shells.** A second map, a second reader, a second
kill-on-quit path. It removes the filters at the cost of duplicating the part of
this file that must never be got twice — the killer/waiter split that keeps
`kill()` from deadlocking the GUI, and the teardown ADR-0005 depends on.

## Consequences

- A running command in a shell can be killed with no warning, by quitting or by
  closing the session. This is the known cost and it is the reason the
  alternative above is written down rather than dismissed.
- Any *new* pass over the handle map has to decide which kind it means. Three
  exist today and all three are covered by
  `a_shell_is_never_mistaken_for_a_session`; a fourth added without a `kind`
  filter will pass its own tests and be wrong.
- `TerminalStatusDto` gained `kind`, so the renderer's boot adoption can keep a
  shell out of `bySession` — which is keyed by session id and would otherwise
  file a shell's PTY over the agent it is drawn under.
- A shell gets no IDE bridge and no agent tool server, which also keeps
  `CLAUDE_CODE_SSE_PORT` out of its environment: a `claude` started by hand in
  a footer shell is a normal terminal session, not one bound to the footer it
  was typed in.
