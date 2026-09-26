---
id: changes
title: Changes
---

import Shot from '@site/src/components/Shot';

# Changes

The **Changes** tab lists the repository's changes as git groups them: **Merge Changes**
(conflicts), **Staged Changes**, then **Changes**, with line counts per file. It updates live, and
in a [worktree](../advanced/worktrees.md) shows that checkout.

<Shot
  src={require('../../../../assets/images/guide/changes-diff@2x.png').default}
  alt="The Changes tab listing one file under Merge Changes, two under Staged Changes and four under Changes with their line counts, and the diff of src/invoices/retry.ts open inline beside it, index against working tree"
/>

Click a row for its diff. Switch with the **Inline** / **Split** toggle, or set **Settings → Editor
→ Show diffs inline**.

| Group | Compares |
| --- | --- |
| Changes | index vs working tree |
| Staged Changes | `HEAD` vs index (read-only) |
| Merge Changes | `HEAD` vs working tree |

When the right side is the working tree it is editable; **Save** writes the file.

factorai does not stage, discard or commit. Use the terminal or the agent.
