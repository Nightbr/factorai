---
id: worktrees
title: Worktrees
---

import Shot from '@site/src/components/Shot';

# Worktrees

A git worktree is a checkout of the project's repository, not a new project. A session working in
one stays in its project.

## What follows the agent

<Shot
  src={require('../../../../assets/images/guide/worktrees-checkout-menu@2x.png').default}
  alt="The session header showing the branch fix/duplicate-invoices and the checkout duplicate-invoices, its menu open on Checkouts: billing-api on main, duplicate-invoices (current), proration-preview marked locked, checkout-e2e marked missing, and Back to this session's own checkout"
/>

- When a session moves into a worktree, the file tree, the Changes tab, the graph's *Working
  changes* row and new footer shells follow it. Sessions started in a worktree resume there.
- With several checkouts, the session header shows the current one beside the branch. Click it to
  pick from **Checkouts** (marked *missing* or *locked* when so); the panel follows your pick.
  **Back to this session's own checkout** returns. Picking does not change what git has checked
  out.

## What factorai does not do

It does not create or remove worktrees. Use the terminal, or the agent.
