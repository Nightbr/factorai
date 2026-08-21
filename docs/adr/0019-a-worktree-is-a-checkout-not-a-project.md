# ADR-0019 — A worktree is a checkout of a project, and the bridge's scope is the repository's checkouts

**Status.** Accepted (2026-08-21), **taking effect with the F21
implementation** — written ahead of the code, as
[ADR-0017](./0017-ide-bridge-writes-one-lockfile-into-claude-ide.md) was and for
the same reason: § 2 below moves a security boundary, and a boundary is easier
to argue about before there is code sitting on it. Extends
[ADR-0011](./0011-a-project-is-a-folder-in-the-workspace.md) (§ 1) and ADR-0017
§ 3 (§ 2). Arises from [F21](../../specs/05-features.md) and roadmap item 37.

## Context

An agent asked to do two things at once reaches for `git worktree add`. From
that moment factorai describes the wrong directory, in two distinct ways.

**The panel is wrong.** `useGitStatus`, `useGitDecorations`, `GraphView` and
`FileTreePanel` all key off one string, `projects.real_path`, so the tree and
the Changes tab report a clean checkout while the agent edits a tree the app
cannot see.

**The session is missing.** `claude` keys its store by cwd, so a session started
in `~/wt/feature-x` writes its transcript under a *different*
`~/.claude/projects/` directory. Under ADR-0011 — *"sessions attach by canonical
path, exact match only"* — that becomes a discovered project you never added,
not a session of the project you did. The worktree is invisible to the feature
that would have followed it.

**And the bridge refuses it.** `services/ide/scope.rs` rejects any path outside
the session's project root. That is ADR-0017 § 3's *"the one that matters"* — the
layer that keeps a connected client from being a general-purpose file oracle. It
is also, today, why an agent working in a worktree cannot open a single file in
factorai: F20's session header shows the `Bridge` warning and every `openFile`
is refused. This is not a consequence of worktree support; it is a live bug that
worktree support has to resolve rather than inherit.

Two questions have to be answered before any of that can be built, and they pull
in opposite directions. What is a worktree in the workspace model? And how much
does the bridge get to reach, given that the agent will now be telling factorai
where to look?

## Decision

### 1. A worktree is a checkout of a project's repository, never a project

`projects` gains nothing. The set of checkouts is read from git — the main one
and every linked one — and it is keyed by **the repository**, not by which
checkout is in the workspace. A project that is itself a linked worktree sees
the same set as one that is the main checkout: it is the same repository
whichever door you came in by.

**Sessions roll up by repository, with ADR-0011's rule tried first.** A session
recorded in a checkout attaches to the project owning that repository — unless
some project claims its path exactly, in which case ADR-0011 wins unchanged.

That ordering is the whole of the compatibility story. Adding `~/wt/feature-x`
as its own project is the workaround people have today; someone who has built a
workflow on it keeps it, and nothing moves under them.

**This is not the prefix scan ADR-0011 rejected.** That decision turned down
rolling a session up to *the nearest added ancestor*, because it makes every
lookup a prefix scan and needs a tie-break as soon as a folder and its parent
are both added. A checkout is neither an ancestor nor a descendant of the
project — it is a sibling directory somewhere else entirely — so this is set
membership in a set git enumerates, with an exact-match rule ahead of it. The
cost is one `git worktree list`-equivalent per repository, not a scan over
`projects`.

Rejected: **a worktree is its own project, linked to its siblings.** Cheapest —
no attach rule changes at all — and it fills the sidebar with one row per
checkout that you did not add, which is the precise complaint ADR-0011 exists to
answer (*"projects arrived uninvited"*). It also makes "which project am I in"
stop matching "which repository am I in", which is the question the sidebar is
for.

Rejected: **a project is the repository, `real_path` is merely its preferred
checkout.** Cleanest conceptually and it supersedes ADR-0011 rather than
extending it — for a migration of what `real_path` *means* and an audit of every
site that treats it as "the folder". A worse trade than adding one derived set.

### 2. The bridge's scope is the repository's checkouts, and the agent cannot widen it

`resolve_within` takes the **union of the session repository's registered
worktrees**, derived in Rust from git on each resolve — so a worktree the agent
created a second ago is inside the scope, and a path the agent merely *names* is
never inside it by virtue of being named.

**The agent's `setWorktree` call moves what the panel shows and nothing else.**
This is the load-bearing sentence of this ADR. The obvious design — scope
follows the selection — hands the agent a lever on its own file access: it says
where to look, and the boundary follows. The validator would then be a security
boundary rather than a UX check, and a validator that is a security boundary is
one bug away from being neither. Decoupling display from scope means there is no
escalation path to reason about, because the two are not connected.

**Recomputed per resolve, not cached at connect.** A worktree created mid-session
is the exact case the feature exists for, and a scope fixed at handshake time
would refuse it. The cost is reading `.git/worktrees` — the same directory
`Repository::discover()` is already walking.

**This widens ADR-0017 § 3, and the widening is stated rather than implied.**
The scope goes from one directory to N, and all N are checkouts of a repository
the user added, enumerated by git rather than supplied by the client. What the
boundary protects has not changed: an arbitrary path is still refused, `..` and
symlinks are still resolved before comparison, and `/etc/passwd` is still not a
worktree of anything. Guarded by tests in the same file as the existing scope
tests, with the widening's own case — a sibling checkout accepted, a sibling
*directory* that is not a checkout refused.

Rejected: **leave the scope at the project root.** Smallest diff, and it ships
the feature with the agent unable to open the files it is editing — the F20 bug
above, preserved on purpose. A panel that follows the agent while the bridge
refuses its every request is worse than either half alone.

### 3. What the agent sets is persisted, in a table the scan does not own

`session_worktrees(session_id PK, path, updated_at)`, FK to `sessions`
`ON DELETE CASCADE`, written only by the bridge's signal path. Migration 0006.

Persisted rather than in-memory because a session resumed tomorrow should come
back in the tree it was working in. In SQLite rather than localStorage because
Rust validates and writes it, which is the line
[ADR-0013](./0013-preferences-storage-split.md) already draws.

**Its own table, because `sessions` is derived state.** The scan upserts that
table from transcripts. Recording a decision in a table another owner rewrites
is the mistake ADR-0011 was written to fix, and the fact that the upsert already
has to `COALESCE` one column it does not own (`cwd`) is an argument against
adding a second, not for it. Two tables, two owners — the same shape as
`projects` / `discovered_projects`.

### 4. Nothing here writes to git

No `worktree add`, no `remove`, no `prune`.
[ADR-0009](./0009-git2-for-repository-state.md)'s read-only clause stands
untouched, and `git2` stays `default-features = false`. The agent creates a
worktree in one line, in the terminal below the panel, and it does that better
than a dialog would.

## Consequences

**Positive.**

- A live bug closes: an agent working in a worktree can open files in factorai,
  instead of showing F20's `Bridge` warning on every attempt.
- A second bug closes on the way past, independently correct: the PTY spawns
  with `sessionCwd ?? projectCwd`, so a session started in *any* subdirectory
  resumes instead of claiming an id `claude` already knows (F21 § "resume cwd").
- Worktree sessions become visible in the project they belong to without anyone
  adding a folder.
- The sidebar stays what you chose. ADR-0011's central property survives a
  feature that could easily have eaten it.
- The graph gains a use it did not have: one repository, several checkouts, all
  visible on the commits they sit on.

**Negative, and accepted.**

- **The bridge reaches more of the disk than it did.** N checkouts instead of
  one. Mitigated by the set being git-derived and by § 2's decoupling, but the
  honest statement is that the boundary moved, and it moved in a component whose
  correctness is a security property.
- **Session attachment is no longer one exact-match rule.** It is an exact match
  *then* a repository lookup, and a reader of `indexer.rs` now has to know both.
  ADR-0011's single sentence was a real asset.
- **A repository lookup joins the indexing path.** Cheap per session, and it is
  work that did not exist before.
- **Two live sessions in one project trade the panel** between their checkouts,
  because the route owns the project and the latest live signal owns the
  checkout. The deferred picker is the answer, and until it ships this is the
  behaviour.
- **The whole mechanism depends on agent uptake we have not observed.** F20
  records that a tool call from the real CLI is still unobserved. The
  `openFile` inference and the `sessions.cwd` default both work with zero
  uptake, so the floor is "correct but passive" rather than "broken" — but the
  headline behaviour is unproven until slice 3 runs against the real binary.

## Related

- [ADR-0011](./0011-a-project-is-a-folder-in-the-workspace.md) — extended by § 1
- [ADR-0017](./0017-ide-bridge-writes-one-lockfile-into-claude-ide.md) — § 3
  widened by § 2
- [ADR-0013](./0013-preferences-storage-split.md) — why § 3 is SQLite
- [ADR-0009](./0009-git2-for-repository-state.md) — untouched, see § 4
- [ADR-0008](./0008-factorai-assigns-new-session-ids.md) — the resume/claim
  probe the spawn-cwd fix depends on
- `specs/05-features.md` F21, `specs/roadmap/TODO.md` item 37
