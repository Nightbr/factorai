# ADR-0061 — A project runs one profile, and that profile names its agent

**Date.** 2026-09-22
**Status.** Accepted. Amends the assignment half of
[F25](../05-features.md) slice 3 and narrows what
[ADR-0036](0036-a-profile-is-a-config-directory-passed-per-spawn.md) left
open: `project_profiles` goes from "one row per (project, agent)" to "one row
per project". The contract is `specs/05-features.md` F30 § "Which agent a
project runs" and F25 § "The assignment, from either side".

## Context

F25 gave a profile an `agent` column and let a project hold **one profile per
agent** — `UNIQUE (project_id, agent)` — so that, when a second agent landed, a
project could sit on a Claude profile *and* a Codex profile at once. That was
written before a second agent existed, and it answers a question nobody asks
("which of my Codex identities does this project use?") while leaving the
question everybody asks unanswered: **which agent does `+` start?**

With two rows a project would need a *third* fact — a default agent — to pick
between them, and that fact would live somewhere other than the profile menu
that already says where the project runs. Two knobs (`Agent ▸` then `Profile ▸`)
for what a person experiences as one choice ("this project is Codex at work") is
the shape F25 warned about in its own text: a copy of a fact kept in two places
has nothing but discipline holding it together.

The alternative considered was keeping the per-agent rows and adding
`projects.default_agent`. It preserves the existing index and adds one column,
but every launch then resolves *two* tables to find one binary, the project menu
grows a second submenu, and a project assigned a Codex profile while defaulting
to Claude is a legal state that means nothing.

## Decision

1. **A project has at most one assigned profile.** `project_profiles` keeps its
   columns; the unique index moves from `(project_id, agent)` to `(project_id)`.
   Assigning a profile to a project that already has one is a *move*, as it
   already was within one agent.
2. **The assigned profile's `agent` is the project's agent.** `+` on that
   project, its footer shell where the agent has one, and its routines by default
   all spawn that agent under that profile. There is no separate "default agent"
   column on `projects`.
3. **No assignment means the app-wide default agent's default profile.** The
   app-wide default is the `agent.default` setting (F30); the default *profile*
   for that agent is the `is_default = 1` row, as before. A fresh install writes
   nothing and runs Claude.
4. **Launching the other agent on a project is an override, not an assignment.**
   The new-session control's menu lists installed agents; picking one that is
   not the project's spawns it under *that agent's default profile*, once. The
   project's assignment is untouched, and the session records which profile it
   ran under through its `discovered_projects` row, so it resumes correctly
   (F25's second resolution rule is unchanged).
5. **A profile is created for one agent, chosen in the form.** The Profiles
   section's new-profile form gains an agent picker; `profiles.agent` is written
   by the user instead of being a constant. The picker is absent while one agent
   is installed.

## Consequences

- Migration: drop `idx_project_profile_per_agent`, create
  `UNIQUE (project_id)`. An install with two rows for one project cannot exist
  today (only `'claude'` was ever written), so the migration has no conflict to
  resolve and asserts that in a test rather than handling it.
- The `agent` column on `project_profiles` stays: the two `BEFORE` triggers that
  check it against the profile's still catch a caller assigning under a false
  belief, and the resolution query reads it without a join.
- F25's text "a project can later be on a Claude profile and a Codex profile at
  once" is withdrawn in the same commit as this ADR.
- `Profile ▸` in the project menu now lists profiles of **every** installed
  agent, grouped by agent when more than one is installed, and the tick moves
  the project across agents as easily as across identities. The label of a
  profile in that menu carries its agent when two are installed.
- A project whose assigned profile's agent is *not installed* (F30 § "An agent
  that is not installed") cannot start a session from `+`; the button's tooltip
  says which agent is missing, and the override menu still offers the installed
  ones.
