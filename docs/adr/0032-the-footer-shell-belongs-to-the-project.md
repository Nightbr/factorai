# ADR-0032 — The footer shell belongs to the project, not the session

**Status.** Accepted (2026-09-03). Narrows
[ADR-0031](0031-a-footer-shell-is-a-pty-without-a-session.md) — which id a
footer shell carries, not its decision that `kind` is what keeps a shell from
being read as a session. Arises from
[F23](../../specs/05-features.md) and [F24](../../specs/05-features.md).

## Context

ADR-0031 gave a footer shell a session id and said what it was for: a shell is
drawn under a session, it dies with that session, and it is not that session.
The kill was the field's only job, and `TerminalKind` was what stopped anything
else reading it as a session.

Two days of use said the kill was the wrong rule. A session and a shell have
different lifetimes:

- A **session** is a unit of conversation, and closing one is routine — the
  header's `×`, the tab strip's `×`, `Delete session`. Each of those is a
  gesture about the agent.
- A **shell** is a unit of workspace: a `cargo test` loop, a dev server, a
  `git log` you keep coming back to. Nothing about it is finished when the
  conversation above it is.

Session scoping therefore killed the terminals a user keeps whenever they closed
the conversation those terminals happened to be opened under. It also left them
unreachable: the footer drew on live session views only, so a project page had
no way to a running build, and walking the sidebar made the strip appear and
vanish.

F24 raised the cost. A chip is now a group of up to five panes the user
deliberately built, and a session close destroyed the whole group.

The session id was never load-bearing for anything else. F21's checkout is a
*cwd*, decided once at spawn and held on the pane; it is not an identity. So
what the rescope removes is a field, not a mechanism.

## Decision

**A footer shell carries a project id and no session id.**
`TerminalHandle.session_id` becomes `Option<String>`, `None` for
`TerminalKind::Shell`, and `ShellSpawnOpts` drops the field.

**The kill list is the project's.** A shell dies with the app quitting
(ADR-0005), with `Remove project`, with `exit`, with a `×`, and when its own
cwd goes missing. No session gesture kills one. `shell_kill_for_session`
becomes `shell_kill_for_project`.

**The footer is project chrome.** It draws on every view that has a project —
the project page, a session view, and a sub-agent transcript — and lives in the
app shell rather than in the session route, so a pane's host does not leave the
document when you move between sessions. Which chip is open is held per project,
so the row follows you across the project.

**A shell whose own cwd has gone is reaped; a shell whose project root has gone
is not.** `missing` on a project is one `is_dir()` per indexer scan and it flips
back when the folder returns, which is too cheap a signal for an irreversible
kill — an unmounted volume would take a running build with it. The question is
asked of each pane's own directory instead.

**The renderer's pane key round-trips as an opaque `clientKey`**, stored on the
handle and returned by `terminal_list`. This closes a leak rather than adding a
feature: `terminalStore.adoptLive` skips shells by design, so a renderer reload
left every live shell's PTY running and unreachable until the app quit.

**ADR-0031's decisions all stand**, and one gets stronger. `kind` still exists
and still means what it meant. `Option<String>` means the passes that mean "the
session" — `next_session_id`, `live_session_ids`, `working_count`,
`resync_ide_status` — are asked by the compiler which kind they mean instead of
remembering to filter. **The quit confirm is unchanged**: shells stay outside
`working_count()`, re-decided under the new scope and kept.

## Alternatives considered

**Keep session scoping and add a per-chip pin that survives the session.** Two
kinds of chip told apart by a hidden glyph, and what a click does depends on
which kind it is — the reason F24 rejected pinning panes, applied one level up.

**Kill when the project's last session closes.** Bounds stray processes, and
reintroduces exactly the defect: a build dies on a gesture about an agent.

**A workspace-global footer, terminals belonging to the app.** A shell's cwd is
some project's checkout, so a global strip shows chips pointed into projects you
are not looking at, and `+ Terminal` has no directory to start in on the routes
that have no project.

**`String::new()` for a shell's session id** rather than `Option`. One-line
diff, and a field that lies: every future reader has to know that the empty
string means "not applicable" instead of being asked.

**Match a live shell to its chip by cwd and shell name** instead of a
`clientKey`. No new field, and ambiguous the moment two panes share a directory
— which `Split` makes the ordinary case.

**Drop the persisted footer at v3** instead of re-keying it. Simpler migration,
and it throws away the multi-pane groups F24 shipped two days earlier. Re-keying
is mechanical because every chip already carried a `projectId`.

## Consequences

- A shell can outlive every session of its project, and the strip is the only
  surface that says it exists. `Remove project` is the one gesture that kills
  them, and it already confirms.
- **Quitting still `SIGKILL`s a running build without asking**, and the window
  in which that can happen is now longer, since no session gesture ends it
  early. The trade is ADR-0031's and was re-decided rather than inherited;
  `MasterPty::process_group_leader()` remains the thing to reach for if it is
  revisited a third time.
- A project whose sessions each had a chip restores them all into one strip
  after the v2→v3 migration — dead, and closable.
- `resync_ide_status` was emitting `IdeStatusEvent { connected: false }` under a
  session id a shell had borrowed, clearing that session's real bridge error
  depending on iteration order. `None` removes the class rather than the
  instance.
- Every chip in a project reads the same static `zsh` (F24), so the chip's
  tooltip is now load-bearing: it names each pane's directory relative to the
  project root.
- The footer moving into the app shell means a session route no longer owns the
  split's height or its resizer. `panelStore.shellHeight` was already global
  (ADR-0013), so nothing about the height changes.
