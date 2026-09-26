---
id: index
title: Files
---

# Files

The right-hand panel of a session or project has three tabs: **Files**, **Changes** and
**Graph**. The strip never switches on its own because a file changed; it sits beside a terminal
you are typing into. `Mod+Shift+E`, or the panel button at the right of the top bar, toggles the
panel, which is resizable between 256 and 600px.

## The tree

The project's files, with git decorations: changed files coloured, folders holding changes
dotted, ignored files dimmed. Files the agent mentions in the terminal are links, and an agent
that asks for a file to be opened lands it here rather than in an external editor. With a session
open, a file's right-click menu has **Add to agent context**, which hands the path to the agent.

## The viewer

A file opens in a Monaco editor with syntax highlighting, in a column of its own when the window
is wide enough and under the tree when it is not. Markdown opens rendered, with its relative
links and images resolved against the file, its frontmatter in a panel and Mermaid diagrams
drawn; **View source** in the footer switches to the text and **Preview** back. SVG has the same
toggle. Images, PDFs, audio and video display. Several files open as a strip of tabs above the
viewer, closed with `Mod+W` while the viewer has focus.

With a session open, the viewer's footer offers **Add file to agent context** — or **Add lines
N–M to agent context** when you have selected some — to hand the agent exactly what you are
looking at.

## Editing

A text file is editable in place, with an explicit **Save** in the footer (or `Mod+S` in the
editor). A draft you have not saved survives switching files and is marked on the tab. If
something else writes the file you are editing, the viewer says *Changed on disk* and lets you
**Reload** it, compare with **Show diff**, or keep your draft — saving it then asks before it
overwrites what is on disk. Nothing is merged silently. Binary, truncated and invalid-UTF-8 files, and
the agent's plan files, stay read-only, and the footer says which reason applies; a file too
large to load whole has **Show anyway**.

## Encrypted files

A file encrypted with [SOPS](https://github.com/getsops/sops) opens as it is on disk, encrypted
and read-only. **Decrypt** in the footer shows the plaintext, using the `sops` on your machine
and your own keys; the button is disabled, with the reason on it, when `sops` is not usable.
The plaintext is editable, and **Encrypt & save** encrypts it again with the file's own
recipients; **Re-lock** discards it. Plaintext never touches the disk, the search index or the
database, and *Add to agent context* is not offered on an encrypted file.
