---
id: changes
title: Changes
---

# Changes

The **Changes** tab lists the repository's changes as git groups them: **Merge Changes**
(conflicts), **Staged Changes**, then **Changes**, with line counts per file. It updates live, and
in a [worktree](../advanced/worktrees.md) shows that checkout.

Click a row for its diff. Switch with the **Inline** / **Split** toggle, or set **Settings → Editor
→ Show diffs inline**.

| Group | Compares |
| --- | --- |
| Changes | index vs working tree |
| Staged Changes | `HEAD` vs index (read-only) |
| Merge Changes | `HEAD` vs working tree |

When the right side is the working tree it is editable; **Save** writes the file.

factorai does not stage, discard or commit. Use the terminal or the agent.
