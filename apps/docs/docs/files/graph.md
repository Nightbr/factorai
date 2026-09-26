---
id: graph
title: Graph
---

# Graph

The **Graph** tab shows the history around what just happened: a lane rail of commits with
their branches, tags and authors, newest first, with **Load more** at the foot. While there is
uncommitted work, a *Working changes* row sits above `HEAD` with a count; clicking it opens the
Changes tab. Select a commit for its detail — author, date, parents, message — and the files it
changed, any of which opens as a diff. The commit's hash copies with a click.

The rail is the whole repository's — every branch and tag, whichever checkout they are in — so a
[worktree](../advanced/worktrees.md)'s branch is on it too. What follows the checkout a session is
working in is the *Working changes* row, like the tree and the Changes tab.

Like Changes, the graph is a viewer. Nothing here commits, rebases, merges, pushes or fetches;
the git library is compiled without network transport, so it cannot.
