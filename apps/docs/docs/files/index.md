---
id: index
title: Files
---

import Shot from '@site/src/components/Shot';

# Files

The right-hand panel has three tabs: **Files**, **Changes** and **Graph**. Toggle it with
`Mod+Shift+E` or the panel button at the right of the top bar. It resizes between 256 and 600px.

## The tree

<Shot
  src={require('../../../../assets/images/guide/files-tree@2x.png').default}
  alt="The Files tab on billing-api: changed files in orange, folders with changes dotted, node_modules and .env.local dimmed, and the right-click menu of README.md with Add to agent context at the top"
/>

Project files with git decorations: changed files coloured, folders with changes dotted, ignored
files dimmed. With a session open,
right-click a file for **Add to agent context**.

## The viewer

<Shot
  src={require('../../../../assets/images/guide/files-markdown-preview@2x.png').default}
  alt="README.md open in the viewer beside the Files tab, rendered with its frontmatter panel, a code block, a Mermaid diagram and a table, with View source in the footer"
/>

- Files open in a Monaco editor.
- Markdown opens rendered (relative links and images, frontmatter panel, Mermaid). **View source**
  / **Preview** in the footer switch; SVG has the same toggle.
- Images, PDFs, audio and video display.
- Several files open as tabs; `Mod+W` closes one while the viewer has focus.
- With a session open, the footer has **Add file to agent context**, or **Add lines N–M to agent
  context** for a selection.

## Editing

<Shot
  src={require('../../../../assets/images/guide/files-editing@2x.png').default}
  alt="retry.ts open in the viewer with an unsaved edit on line 6 and lines 21 to 23 selected; the footer offers Save and Add lines 21–23 to agent context"
/>

- Text files are editable; **Save** in the footer or `Mod+S`. Unsaved drafts are kept and marked
  on the tab.
- If the file changes on disk, the viewer says *Changed on disk*: **Reload**, **Show diff**, or
  keep your draft (saving then asks before overwriting).
- Read-only: binary, truncated and invalid-UTF-8 files, and the agent's plan files; the footer says
  why. Large files offer **Show anyway**.

## Encrypted files

[SOPS](https://github.com/getsops/sops) files open encrypted and read-only.

- **Decrypt** shows the plaintext using your `sops` and keys (disabled, with the reason, if `sops`
  is unusable).
- **Encrypt & save** re-encrypts with the file's recipients; **Re-lock** discards the plaintext.
- Plaintext never touches disk, the search index or the database. *Add to agent context* is not
  offered.
