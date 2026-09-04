# ADR-0035 — Git reads leave the main thread, and graph pages are cached on their refs digest

**Status.** Accepted (2026-09-04). Arises from
[F13](../../specs/05-features.md) and [F18](../../specs/05-features.md); refines
[ADR-0009](0009-git2-for-repository-state.md)'s read-only libgit2 layer without
changing what it reads.

## Context

Opening the Graph tab froze the whole application for around ten seconds on a
user's macOS machine — not the panel, the application: the terminal stopped
scrolling and the window stopped repainting until the page arrived. The same
click on the 8 900-commit, 1 100-ref repository this was reproduced against costs
350ms in a release build, so the number is the repository's, but the shape of the
failure is ours, and it has two parts.

**Every command in `commands/git.rs` was synchronous, and a synchronous Tauri
command runs on the main thread.** That thread is also the one painting the
window and pumping every other event, so for the duration of a libgit2 walk
nothing in the app moved. It was not only the graph: `git_status` runs every
three seconds while the panel is open, at 100–120ms on the same repository, and
each of those was a hitch nobody had named.

**Every call to `git_graph` re-walked the whole reachable history.** The walk is
sorted `TOPOLOGICAL | TIME`, and with `TOPOLOGICAL` in the sort libgit2 traverses
everything reachable from the pushed refs before yielding the first row — so the
first page costs the entire history, however many rows it returns. The spec
priced that as "microseconds of libgit2" for a 1 200-commit repository, which is
true and is not the repository people bring. Then the 30s poll paid it again,
switching tabs and back paid it again, and "Load more" paid it once per page.

## Decision

1. **Every command in `commands/git.rs` is `async` and runs its libgit2 read on
   the blocking pool** through one `off_main` helper wrapping
   `tauri::async_runtime::spawn_blocking`. `spawn_blocking` rather than a plain
   `async fn`, because libgit2 is synchronous C and would otherwise block a
   runtime worker exactly as it blocked the main thread. A task that panics
   surfaces as `AppError::Process`, which the renderer already toasts.

2. **`git_graph` serves a page from a cache while the refs digest it was walked
   against still holds.** The cache is a process-wide map keyed on the gitdir,
   holding one digest and up to sixteen `(offset, limit)` pages; a digest that
   stops matching drops the whole entry. What a call always pays is
   `collect_refs`, which is also what tells it whether the cache is still true.

3. **The digest names everything a page depends on.** It already covered every
   ref's oid. It now also covers which branch `HEAD` is on and which upstream each
   local branch tracks — two moves that leave every oid in place and change a
   chip. `remote_host` is a config read and is recomputed on a hit rather than
   folded in.

4. **The walk logs its own timings at `debug`**, which the default filter
   (`factorai_lib=debug`) prints: refs enumeration, the walk, the total, and
   whether the page came from the cache. A user on a machine we cannot see can
   run the binary from a terminal and read where the time went.

## Consequences

- A slow repository now shows `Loading…` in the Graph tab for as long as its
  first walk takes, with the rest of the app live. The second click, the poll and
  the next page are a refs enumeration — tens of milliseconds on the repository
  above — until a ref moves.
- The renderer is unchanged. `invoke` already returned a promise; an async
  command answers the same promise later.
- The cache is per process and unbounded in repositories, bounded in pages. A
  closed project's entry stays until the digest for that gitdir is next checked
  — at one digest and sixteen pages of at most a thousand rows each, that is a
  few megabytes per repository ever opened, accepted rather than adding an
  eviction policy to a cache whose entries are this small.
- The spec's claim that a re-walk is cheap is corrected rather than deleted: it is
  cheap **per set of refs**, and the cache is what makes that the unit.
- Other synchronous commands that read disk still run on the main thread. This
  ADR converts the module whose cost scales with a repository's history; the
  helper is the pattern for any other command found doing seconds of work there.
