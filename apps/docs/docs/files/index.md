---
id: index
title: Files
---

# Files

The right-hand panel of a session or project has three tabs: **Files**, **Changes** and
**Graph**. The strip never switches on its own because a file changed; it sits beside a terminal
you are typing into. `Mod+Shift+E` toggles the panel, which is resizable between 200 and 600px.

## The tree

The project's files, with git decorations: changed files coloured, folders holding changes
dotted, ignored files dimmed. Files the agent mentions in the terminal are links, and an agent
that asks for a file to be opened lands it here rather than in an external editor.

## The viewer

A file opens in a Monaco editor with syntax highlighting, in a column of its own when the window
is wide enough and under the tree when it is not. Markdown is rendered, with its relative links
and images resolved against the file. Images and PDFs display. Several files open as a strip of
tabs above the viewer, closed with `Mod+W` while the viewer has focus.

## Editing

A text file is editable in place, with an explicit **Save**. A draft you have not saved survives
switching files and is marked on the tab. If the agent writes the file you are editing, the
viewer says so and lets you choose between your draft and the file on disk rather than merging
them silently. Binary, truncated and invalid-UTF-8 files stay read-only.

## Encrypted files

A file encrypted with [SOPS](https://github.com/getsops/sops) opens decrypted in the viewer,
using the `sops` on your machine and your own keys. Saving encrypts again with the file's own
recipients. Plaintext never touches the disk, the search index or the database.
