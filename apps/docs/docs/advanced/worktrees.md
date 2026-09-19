---
id: worktrees
title: Worktrees
---

# Worktrees

An agent asked to work on two things at once reaches for `git worktree add`. factorai follows it
there: a worktree is a checkout of the project's repository, not a second project, and a session
working in one stays a session of the project it belongs to.

## What follows the agent

When a session moves into a worktree, the file tree, the Changes tab, the graph's working row
and the tree's decorations describe that checkout. Sessions started in a worktree resume in it.
The project page shows which sessions are on which checkout, and the graph's checkout picker
lists worktrees beside branches and tags.

## What factorai does not do

It does not create worktrees, and it does not remove them. That is one command in the terminal,
and the agent runs it. What factorai owes is to keep describing the right directory once the
agent has moved.
