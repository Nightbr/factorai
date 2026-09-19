---
id: graph
title: Graph
---

# Graph

The **Graph** tab shows the history around what just happened: a lane rail of commits with
their branches, tags and authors, and the working tree as the top row. Select a commit to see the
files it changed and open any of them as a diff.

A **checkout picker** at the top switches which checkout the panel describes: a branch, a tag, a
detached commit or a worktree. Switching the picker changes what you look at, not what git has
checked out.

Like Changes, the graph is a viewer. Nothing here commits, rebases, merges, pushes or fetches;
the git library is compiled without network transport, so it cannot.
