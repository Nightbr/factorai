# ADR-0036 — A profile is a config directory passed per spawn

**Status.** Accepted (2026-09-04). Arises from
[F25](../../specs/05-features.md). Supersedes the mechanism half of
[Q3](../../specs/07-open-questions.md) — `CLAUDE_HOME` becomes a seed rather
than the way the config directory is chosen — and leaves that question's
conclusion intact: we still hold no credential.

## Context

One machine, several Claude identities: a personal account and a work one, or a
throwaway config for testing hooks. Until this decision factorai had exactly
one. `claude_dir()` read `CLAUDE_HOME` once at boot and everything downstream —
the indexer, the transcript reader, the IDE lockfile, every spawned session —
assumed that single directory for the life of the process.

Two ways to give a user several identities were available, and only one of them
is ours to build.

**Hold the credentials.** Log in on the user's behalf, store tokens, and hand
the right one to each session. This is what "multi-account support" means in most
applications, and it is the thing
[§ "What this project does not do"](../../CLAUDE.md) refuses: no Claude OAuth
helper. It would also make factorai a place a secret lives, which is a different
security posture from the one this project has — and a strictly worse one, since
the CLI already has a working login.

**Point each session at a different config directory.** `CLAUDE_CONFIG_DIR` is
the CLI's own isolation boundary: credentials, `settings.json`, `projects/`,
`ide/`, hooks and MCP config all resolve under it. Setting it on one child
process gives that session a complete, separate identity — and factorai never
sees a token, because the token is a file in a directory the CLI wrote and reads.

The second is not a workaround for the first. It is the mechanism the CLI
publishes for exactly this, and it means the interesting work is bookkeeping —
which directory, decided where — rather than authentication.

## Decision

**A profile is a row: an agent, a name, and a config directory. Switching
profile is `CLAUDE_CONFIG_DIR` on one spawned child, resolved per spawn.**

Five consequences follow, and each of them is the decision rather than a detail
of it:

1. **One profile per directory**, enforced by `config_dir UNIQUE`. Two profiles
   over one directory would discover the same transcripts twice while
   `sessions.id` — a primary key — can only belong to one `discovered_projects`
   row, so the two would fight over every session on every scan. It is also what
   gives "delete this profile" and "is this directory missing" one answer each.
2. **Exactly one default per agent**, enforced by a partial unique index. A
   project with no assignment resolves through the default, so two defaults is
   not an inconsistency to tidy up later — it is a spawn with no deterministic
   identity.
3. **`CLAUDE_HOME` seeds the default profile at first boot and is then not read
   again.** The alternative — the variable outranking the table for the life of
   the install — is two sources of truth for one fact, where Settings can show a
   directory sessions do not use.
4. **Everything a spawn does with a config directory uses the resolved one**, not
   just the environment variable: the transcript probe that chooses `--resume`
   over `--session-id`, the IDE lockfile we advertise at, and the id
   `next_session_id` hands out. A session spawned under one directory and probed
   under another is the silent failure this feature has — the probe misses, we
   claim an id Claude already knows, and the conversation is replaced by an empty
   one.
5. **The default profile is spelled "no variable at all".** Setting
   `CLAUDE_CONFIG_DIR` to the ambient directory is not the same as leaving it
   unset: with the variable absent the CLI reads `$HOME/.claude.json`, a file
   beside `~/.claude` rather than inside it, and with the variable set it reads
   `<dir>/.claude.json` and asks for a login it does not need. A spawn therefore
   compares against the ambient directory and `env_remove`s the variable when
   they match — removes, not skips, because an inherited value would otherwise
   hand the session a foreign identity in silence. `claude_dir()` reads
   `CLAUDE_CONFIG_DIR` before `CLAUDE_HOME`, since the CLI's own variable is the
   better evidence of where this machine's configuration lives.
6. **Creating a profile stops at an empty directory.** The CLI populates it on
   first run and asks the user to log in, which is the only place authentication
   happens. Credentials are never copied between profile directories.

**The footer shell gets the variable too**, which is a deliberate departure from
the rule one line above it in `spawn_inner`: a shell is withheld
`CLAUDE_CODE_SSE_PORT` so that a `claude` started by hand in it is not silently
bound to a bridge. The config directory is given for the mirror-image reason — a
`claude` started by hand in a project's own shell writing its transcript into
another identity's store is the accident this feature exists to prevent.

**Deleting a profile removes the row and nothing on disk**, and is refused while
the profile is its agent's default. The directory holds a login we deliberately
never held; deleting it is not ours to do, and re-adding a profile on the same
path brings its sessions back on the next scan.

**A missing config directory is skipped by the scan, never reaped.**
`reap_deleted` removes the session rows of any transcript it cannot find, so an
unmounted volume would otherwise cost that profile its whole index and its FTS
rows. Skipping makes a remount free. The directory is recreated at the next
spawn, where the CLI asking for a login is the correct and visible outcome.

## Consequences

`claude_dir()` survives as the seed for the default profile and as the fallback
in `TerminalManager` when no resolver is wired — which is every unit test, and
which resolves to what a single-profile install has anyway.

The boot sweep of stale IDE lockfiles now iterates every profile, because a
session's lockfile is written into the directory that session runs under.

`services::profiles::config_dir_for_spawn` takes a project id it does not yet
consult: until the per-project assignment lands, every project resolves to the
default. The parameter is in the signature so the spawn path already asks the
question a project will answer.

Two things this decision makes possible and does not yet do, both of which need
a schema change of their own rather than a change of mind here: the scan becoming
per-profile (`discovered_projects` gains `profile_id`, and its unique key becomes
`(profile_id, key)`), and the per-project assignment (`project_profiles`, keyed
`(project_id, agent)`, where no row means the default). F25 has both, sliced.

Because the identity is read at spawn, **a running session cannot change
profile**. Every control that assigns one says so, which is a UI obligation this
decision creates rather than a limitation it accepts quietly.
