# ADR-0024 — A dev build runs under its own app identifier

**Status.** Accepted (2026-08-27).

## Context

`tauri dev` and the installed release resolved the same
`app_data_dir()`, because that path is derived from one field —
`identifier`, `dev.factorai` — and both builds read it out of the same
`tauri.conf.json`. Everything the app persists therefore lived in one
place for both: `factorai.db`, and the WebKit storage directory that
holds the renderer's `localStorage`.

That is a shared *database*, not a shared folder, and a database is
migrated forward on open. On 2026-08-26 migration 0011 (ADR-0023)
dropped `projects.pinned` from it. The release build installed at the
time still ran the previous `PROJECT_SELECT`, which names that column,
so `list_projects` began returning `db: no such column: p.pinned` and
the sidebar sat on `Loading…` — a working install broken by a dev run
that never touched it, on a machine where the release is the one with
the day's real sessions in it.

**The general shape matters more than that instance.** Migrations are
forward-only by design, so any dev run is free to make the release
unrunnable, and it does so silently and at the moment `pnpm dev` starts
rather than at the moment the migration is written. `localStorage` has
the same hazard with none of the mechanism: `sidebarStore`'s `Manual`
sort mode was written into a store the older renderer would read back.

The environment variable this could have been — `FACTORAI_DATA_DIR`,
read in `setup()` — was rejected: it moves the database and leaves the
webview storage behind, and it is a flag that has to be remembered
rather than a property of the build.

## Decision

**The dev build is a different application, and says so in the one
field the data directory is derived from.**

`apps/desktop/src-tauri/tauri.dev.conf.json` overrides `identifier` to
`dev.factorai-dev`, and `pnpm dev` passes it with `tauri dev --config`.
Tauri merges it over `tauri.conf.json`, so the file holds that field and
nothing else — anything duplicated into it is a second copy to keep in
step, and the CLI's merge replaces arrays wholesale rather than merging
them, which makes `app.windows` in particular a trap.

Consequences, all of them the point:

- Dev's database is `~/.local/share/dev.factorai-dev/factorai.db`. A
  migration written in dev reaches the release when the release is
  rebuilt, which is when its code knows about it.
- Dev's `localStorage` moves with it, so layout and preference state no
  longer crosses between the two.
- `tauri build` is untouched. It reads `tauri.conf.json` alone, keeps
  `dev.factorai`, and ships to the same data directory it always has.

**A dev database starts empty**, which is a fresh workspace rather than
a broken one: the indexer rebuilds `sessions` from `~/.claude/projects`
on first scan, and only the `projects` rows and the `settings` table are
decisions it cannot re-derive. Seed those by copying the release's file
across once — SQLite's backup API, or a `.backup`, rather than `cp`,
since the release's WAL will not be checkpointed.

## Alternatives

- **`FACTORAI_DATA_DIR` in `setup()`.** Rejected above: half the state,
  and opt-in.
- **A `-dev` suffix under `#[cfg(debug_assertions)]`.** Same half — the
  webview storage directory is resolved by Tauri from the identifier
  before our code runs, so nothing we compute in `setup()` moves it.
- **One database, and make the release tolerate a newer schema.** That
  is a compatibility contract across every future migration, bought to
  solve a problem that only exists because two builds share a file.

## Consequences

The window switcher already distinguishes the two (`factorai DEV`, set
in `setup()` under `#[cfg(debug_assertions)]`, and `DevBadge` in the
header). Those markers now also mean "different data", which they did
not before.

What is still shared is `~/.claude/` itself — the transcripts both index
and the `ide` lockfiles both write. That is deliberate: it is the
agent's store, not ours, and the point of running dev is to see it.
