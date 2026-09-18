# ADR-0039 — factorai writes project files, never an agent's store

**Status.** Accepted (F26 — editing and saving a file, 2026-09-09).

## Context

Until now the app has written nothing a human typed into a file. Every disk
operation is a read: `read_file`, `list_dir`, `read_image`, `read_pdf`,
`git_blob`, the indexer's transcript parse. The only writes anywhere are our own
database and the IDE bridge's lockfile.

[ADR-0004](./0004-claude-dir-is-read-only.md) is why, and it is narrower than it
gets quoted as. It says `~/.claude/` — an *agent's* transcript store, generalised
to every agent store by [ADR-0011](./0011-a-project-is-a-folder-in-the-workspace.md)
— is read-only ground truth: we do not mutate session JSONLs, move or delete
session files, or inject events. It has one exception (fork writes a new file)
and one amendment ([ADR-0027](./0027-deleting-a-session-trashes-its-transcript.md):
a delete the human asked for by name moves the transcript to the trash).

It says nothing about a project's own files, and it has been read as though it
did. `specs/03-backend-rust.md` § `files` closed with "Read-only, like the rest of
our disk access (ADR-0004)", which quietly widened an ADR about transcripts into a
rule about all of disk.

F26 makes every text file in the tree editable with an explicit Save.
`PRODUCT.md` and `00-overview.md` § "The operating model" make the human four
things — supervisor, decider, reviewer, and the one who sets the rules agents run
under. The fourth verb is `CLAUDE.md`, `.claude/settings.json`, `.mcp.json`,
hooks, a `.env`. Every one is a file, and without a write path the answer is
"leave the app to set the rules the agents here run under".

So the boundary has to be stated rather than inferred, before the first write
lands. Roadmap item 2 said as much: "the boundary is worth stating in the ADR
trail".

## Decision

**factorai writes files in the user's project, and never inside an agent's own
store.**

Concretely:

- **Yes.** Any path under a project the user added to the workspace, through one
  command, `write_file(path, contents)`, driven by a human pressing Save in the
  viewer. `CLAUDE.md`, `.claude/settings.json`, `.mcp.json`, `.env`, source
  files — a project's `.claude/` directory is a project file, not an agent store.
- **No.** `~/.claude/projects/**` and the equivalent for any other agent:
  transcripts, and everything else the agent keeps for itself. ADR-0004 is
  unchanged and this ADR does not touch its exceptions.
- **No.** `write_file` is not exposed to agents over the MCP tool server
  ([ADR-0029](./0029-model-facing-tools-need-a-server-that-is-not-the-ide.md)).
  Claude has `Write` and `Edit`; a second write path through us would route
  around its own permission prompts and hooks, and would let an agent overwrite a
  file a human holds a draft on.
- **One command.** Not `write_claude_md` plus `write_settings` plus whatever came
  next. One path means one place for the atomic write, the permission
  preservation and the symlink resolution to be correct.

**A write is always something a human pressed.** No autosave, no write on blur,
no write as a side effect of another command. That is not a UX preference here —
it is what makes this rule auditable: every byte we write to a project traces to
one Save.

## Consequences

**Positive.**

- The fourth verb gets a surface. Setting the rules agents run under happens in
  the app the agents run in.
- The line ADR-0004 actually drew stays drawn, and stops being over-quoted into
  "factorai never writes anything", which was never a decision anyone made.
- One command is one audit point. "What can this app write, and who asked?" has a
  one-file answer.

**Negative.**

- The app can now damage a user's repository. The mitigations are in F26 and are
  not optional: atomic temp-and-rename, explicit Save only, a conflict banner
  when the file moved under the buffer, and never discarding either side of a
  conflict without a click.
- "Read-only ground truth" stops being a one-line description of the whole app,
  and anyone reasoning about our disk access now has to hold two rules.

## Alternatives rejected

- **An allowlist of writable config paths** (`CLAUDE.md`, `.claude/settings.json`,
  `.mcp.json`, `.env`, …). Safest, and the list grows forever — the need that
  prompted this was stated as "config files, secrets, ..." with an open tail.
  An allowlist also has to be explained to the user at the moment their file is
  not on it.
- **Write only through the agent** — hand the edit to Claude and let it apply.
  Makes the human's own lever depend on an agent being alive and willing, which
  is precisely backwards for the file that tells the agent what to do.
- **Amend ADR-0004.** ADRs here are immutable (§ "Commits"); the boundary is a new
  decision, not a correction to that one.

## Related

- `specs/05-features.md` F26 (editing and saving a file), F9, F7
- `specs/03-backend-rust.md` § `files`
- ADR-0004 (an agent's store is read-only), ADR-0011, ADR-0027, ADR-0029
- ADR-0040 (unsaved drafts)
