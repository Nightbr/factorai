# ADR-0041 — The worktree side of a diff is editable; every git object is not

**Status.** Accepted (F26 — editing a diff, 2026-09-09).

## Context

F26 made every text file the viewer opens editable, and listed a diff among the
four cases that stay read-only: *"a diff is two revisions, one of which does not
exist as a file"*. That sentence is true of one of the four diff modes and false
of the other three.

The Changes tab (F13) opens three of them, and two put the **working tree** on
the right-hand side:

| Mode | Left | Right |
| --- | --- | --- |
| `unstaged` | index | **working tree** |
| `head` (conflicted rows) | HEAD | **working tree** |
| `staged` | HEAD | index |
| `<parent>..<sha>` (F18) | commit blob | commit blob |

So for the two most-used rows in the Changes list, the right-hand pane is
`read_file` of a path on disk — the same read, of the same file, that `FileView`
edits. Refusing to edit it is not a technical limit, it is a missing feature
dressed as one.

And it is the feature with the strongest case. Reviewing your own uncommitted
work is *where you notice the thing you want to change*: the debug print left
in, the comment that no longer matches, the name you now dislike. Having to
leave the diff, find the file, and locate the line again is the same "leave the
app to change a file" that F26 exists to end, one surface further in.

The other half of the same question arrives from the graph (F18), which opens
`<parent>..<sha>`. A commit's contents are not editable in any editor worth the
name, and the reader has to be able to tell the two apart at a glance rather
than by clicking and seeing whether a keystroke lands.

## Decision

**The side of a diff that *is* a file on disk is editable. Every side that is a
git object is read-only, and the footer says which kind.**

- `unstaged` and `head`: the modified (right) pane is a live editor over the
  working-tree file, with the whole of F26 behind it — Save, `Cmd/Ctrl+S` bound
  inside the host only, the file's own line endings, the draft, the
  changed-on-disk banner, and the overwrite confirm.
- `staged`: `index — read-only`.
- `<parent>..<sha>`: `commit — read-only`.
- A worktree side that is not there: `deleted — read-only`. A deleted file is
  recreated from the file view, which has a buffer to recreate it *from*; a diff
  opened on a deletion has none.
- The **original (left) pane is never editable**, in any mode. Monaco's
  `originalEditable` stays off.

**The machinery is shared, not copied.** `FileView`'s buffer, draft, conflict
detection and write moved to `hooks/useEditBuffer.ts` unchanged, and both
surfaces call it. The draft is keyed by absolute path, so a buffer typed into
the diff *is* the buffer the file view shows — switching between them is
switching windows onto one edit, not choosing between two.

**Editing the index is out of scope, and that is the one place this stops short
of VS Code.** VS Code lets you edit the staged version of a file and writes it
back through `git hash-object` + `update-index`. Doing the same here means a new
Rust command that mutates the index, its failure modes, and a second write
boundary beside `write_file` — which
[ADR-0039](./0039-factorai-writes-project-files-never-an-agents-store.md) drew
deliberately narrowly. It is a coherent later feature and not a gap in this one:
the staged pane already says *why* it is read-only, so nothing about it reads as
broken.

## Consequences

**Positive.**

- The Changes list becomes a place to fix things and not only to read them,
  which is what a review surface in an agent-centric app is for: the human
  reviews, and reviewing without a way to act is half the verb.
- One implementation of "an unsaved buffer over a file", so the two surfaces
  cannot drift into disagreeing about what dirty means, when a draft is kept, or
  whether a conflict asks before overwriting. A second copy is how one of them
  ends up silently discarding an edit the other would have kept.
- Read-only now names its reason everywhere — `index`, `commit`, `deleted`,
  `truncated`, `not valid UTF-8`, `plan` — so the state reads as a rule rather
  than as something failing.

**Negative.**

- The diff editor is no longer a pure reading surface, and one more place can
  now write to disk. Everything that guards the file editor had to be brought
  along rather than reasoned about again.
- `FileView` is now assembled from a hook rather than being readable top to
  bottom, which costs a jump for anyone tracing what a keystroke does.
- Saving a worktree side until it matches the other one leaves a diff with
  nothing in it, so the editor is replaced by "No changes." mid-session. Honest,
  and briefly surprising.
- Editing the index remains a thing VS Code does and factorai does not.

## Alternatives rejected

- **Keep the whole diff read-only** — what F26 said. It is one sentence to keep
  and it gives up the most valuable edit in the app.
- **Make every side editable and write it back to wherever it came from.**
  Requires index writes and history rewriting; the second of those is not a
  thing an editor should offer at all.
- **An "Edit" button on the diff that opens the file view instead.** Honest, and
  it throws away the reason to be in the diff: the other side, beside the line
  you are changing.
- **A separate `EditableDiffView` component.** Avoids touching `FileView`, and
  buys a second copy of the save, draft and conflict rules — the exact thing the
  shared hook exists to prevent.

## Related

- `specs/05-features.md` F26 § "Editing a diff", F8, F13
- ADR-0039 (factorai writes project files, never an agent's store), ADR-0040 (an
  unsaved draft is content), ADR-0007 (Monaco for the file viewer), ADR-0037
  (the viewer is a column)
