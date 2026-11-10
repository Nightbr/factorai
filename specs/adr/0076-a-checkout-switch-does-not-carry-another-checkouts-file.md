# ADR-0076 — A checkout switch does not carry another checkout's file

**Date.** 2026-11-10
**Status.** Accepted. Supersedes the "keep on a change of checkout inside one
project" rule of ADR-0043. The project-switch rule of ADR-0043 is unchanged.

## Context

The viewer's strip is per checkout (F21). A project with two worktrees has two
strips, because the paths are absolute.

ADR-0043 kept a carried `?file=` across every change of checkout inside one
project. The reason was the two-step resolve: a session in a worktree resolves
`root` to the project's folder first, then to the worktree once `gitWorktrees`
answers, and closing on the second step would shut a deep link. ADR-0043 named
the cost in its consequences: a file from the main checkout stays on screen over
a linked worktree's tree.

That cost turned out to be a bug a user hit. With a file open in session A
(main checkout), switching to session B (a worktree) carried the file across.
The adopt rule in `AppShell` then wrote it into B's strip as a preview tab. From
then on the two strips held separate copies, so closing the file in A left it
open in B.

## Decision

**On a change of checkout inside one project, a carried file is kept only if it
belongs to the checkout coming to the front.** Otherwise the viewer closes, the
same way it does for a change of project.

"Belongs" is the **deepest** known checkout whose folder holds the path —
`checkoutContaining`'s answer, falling back to the project's folder before
`gitWorktrees` has answered. Deepest, because a worktree can be nested in the
project's folder (for example `.claude/worktrees/x`), and a prefix test against
the folder would claim its files.

`viewerHandoff` takes this as an `owner` function beside `within`, so the rule
stays pure and its cases stay a table in `viewerStore.test.ts`.

The deep link survives: on the second step of the resolve, a deep link into a
worktree names a file that worktree owns, so it is kept. ADR-0043 expected the
fix to need a "resolve has settled" signal; tracing every step showed the owner
test is enough on its own.

A file outside every checkout (a terminal link to `/etc/hosts`) has no owner
and is kept, because no strip it could leak between owns it.

## Consequences

- A file opened in one worktree never appears in another worktree's strip, so
  closing it in one session of a project cannot leave it open in another.
- Each checkout still comes back to its own last file (restore is unchanged and
  still first).
- A strip that already holds a leaked copy from before this change keeps it
  until it is closed there. Nothing migrates it, because a leaked tab and one
  the reader opened on purpose look the same in storage.
