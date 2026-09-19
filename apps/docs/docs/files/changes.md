---
id: changes
title: Changes
---

# Changes

The **Changes** tab lists what has changed in the project's repository, grouped as git groups
them: merge conflicts first, then staged, then unstaged, each with a count and the added and
removed line counts per file. It polls, so it keeps up with an agent mid-edit.

Click a row for a side-by-side diff of that file: the index on one side, the working tree on
the other. The working-tree side is editable, and **Save** writes the file.

factorai is read-only about git. It shows you what the agent did; it does not stage, discard or
commit. The terminal beside it does that better, and so does the agent.
