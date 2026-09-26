---
id: worktrees
title: Worktrees
---

# Worktrees

An agent asked to work on two things at once reaches for `git worktree add`. factorai follows it
there: a worktree is a checkout of the project's repository, not a second project, and a session
working in one stays a session of the project it belongs to.

## What follows the agent

When a session moves into a worktree, the file tree and its decorations, the Changes tab, the
graph's *Working changes* row and the footer's new shells describe that checkout. Sessions started
in a worktree resume in it.

When the repository has more than one checkout, the session header shows the one it is working
in beside the branch. That mark is also a picker: it lists the repository's **Checkouts** —
flagging one that is *missing* or *locked* — and choosing one roots the panel there. When the
panel is on a worktree rather than the session's own directory, the same menu has **Back to this
session's own checkout**. Picking changes what you look at, not what git has checked out.

## What factorai does not do

It does not create worktrees, and it does not remove them. That is one command in the terminal,
and the agent runs it. What factorai owes is to keep describing the right directory once the
agent has moved.
