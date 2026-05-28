# ADR-0005 — Kill-on-quit is non-optional, confirm dialog mandatory

**Status.** Accepted (M0, 2026-05-28).

## Context

When the factorai window is closed with one or more live `claude` PTYs,
what happens to those child processes?

Options:

1. Detach them — keep running in the background.
2. Kill them silently.
3. Kill them with a confirm dialog.
4. User-configurable preference (default kill).

## Decision

**Always kill, with a mandatory confirm dialog.** Not configurable.

Flow:

1. Tauri intercepts `WindowEvent::CloseRequested` if any PTY is live.
2. Frontend opens a confirm dialog:
   > Quit factorai? N running Claude session(s) will be terminated.
3. On confirm → `TerminalManager::kill_all()` (SIGTERM → 500ms grace →
   SIGKILL) → `app.exit(0)`.
4. On cancel → dismiss, do nothing.

`kill_all()` is also wired to `Drop` on `TerminalManager` as a
last-ditch backstop for crashes.

## Consequences

**Positive.**

- **Zero orphan zombies, ever.** This is the load-bearing benefit.
  Stray `claude` agents are real money — both API costs and the
  occasional unintended commit / push / write.
- The confirm dialog gives the user a sanity check before destructive
  action. Cheap insurance.
- No "I forgot I had a session running for 8 hours" stories.

**Negative.**

- Users can't "park" a long-running session in the background. If
  someone wants this in the future, the right answer is a deferred
  session-detach mode that hands the PTY off to a persistent helper
  process — not a "leave it running and hope" config flag.

## Why this is an ADR

This is the kind of decision that, every six months, someone will ask
"why don't we just have a setting for this?" The answer is in this
ADR so we don't relitigate it.

## Related

- `specs/05-features.md` § "Quit guard"
- `specs/07-open-questions.md` Q10
