---
id: changes
title: Changes
---

# Changes

The **Changes** tab lists what has changed in the project's repository, grouped as git groups
them: **Merge Changes** (conflicts) first, then **Staged Changes**, then **Changes**, each with a
count and the added and removed line counts per file. It polls, so it keeps up with an agent
mid-edit, and in a [worktree](../advanced/worktrees.md) it describes that checkout.

Click a row for a diff of that file, side by side or inline — the diff's own **Inline** /
**Split** toggle, or **Settings → Editor → Show diffs inline**. Which two sides it compares
follows the group: an unstaged change is the index against the working tree, a staged one is
`HEAD` against the index, and a conflict is `HEAD` against the working tree. When the right-hand
side is the working tree it is editable, and **Save** writes the file; a staged diff is
read-only, because its right-hand side is the index, not a file.

factorai is read-only about git. It shows you what the agent did; it does not stage, discard or
commit. The terminal beside it does that better, and so does the agent.
