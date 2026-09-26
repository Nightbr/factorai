---
id: graph
title: Graph
---

import Shot from '@site/src/components/Shot';

# Graph

The **Graph** tab shows commits newest first, with branches, tags and authors, and **Load more** at
the foot.

<Shot
  src={require('../../../../assets/images/guide/graph-commit@2x.png').default}
  alt="The Graph tab: a Working changes row above HEAD on fix/duplicate-invoices, main and the v2.8.0 tag on a merge, a feature branch on a second lane, and the selected commit open below with its author, parent and four changed files"
/>

- A *Working changes* row above `HEAD` counts uncommitted work; click it for the Changes tab.
- Select a commit for author, date, parents, message and changed files (each opens a diff). Click
  the hash to copy it.
- The graph covers every branch and tag, so a
  [worktree](../advanced/worktrees.md)'s branch is there too. The
  *Working changes* row follows the session's checkout.

The graph is read-only: no commit, rebase, merge, push or fetch.
