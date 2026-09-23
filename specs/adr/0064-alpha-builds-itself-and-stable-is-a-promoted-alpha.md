# 64. Alpha builds itself from green `main`, and stable is a promoted alpha

Date: 2026-09-23

Status: Accepted. **Amends [ADR-0010](0010-ota-updates-via-tauri-updater.md)**
(the updater now has two endpoints, chosen at runtime) and **supersedes
[ADR-0014](0014-alpha-releases-publish-themselves.md)**'s trigger (a human
pushing a tag) while keeping its gate (the asset and manifest check before
anything is published). Roadmap item 31.

## Context

Until now there was one stream. A human pushed `vX.Y.Z`, `release.yml` built
it and published it as a normal release, and every installed copy resolved
updates through `/releases/latest/download/latest.json`. That stream behaved
like an alpha — five releases landed on 2026-09-22 alone — while M6 is about to
put strangers on it. Three problems came with it:

1. **Nothing enforced "tag a commit Quality has passed".** Both workflows said
   so in their headers and neither checked.
2. **The version fields were a placeholder** (`0.1.0`), rewritten from the tag
   at build time, so everything that read a version in a dev build had to
   special-case the placeholder.
3. **Release notes were written twice or not at all.** `generate_release_notes`
   produced a compare link and nothing else.

The constraint that decides the channel design: GitHub's `/releases/latest`
**skips prereleases**, and the updater resolves through it. An alpha marked as a
prerelease is invisible there; an alpha not marked as one *is* stable.

Tauri's updater has no channel concept, but its endpoints can be set at runtime
(`updater_builder().endpoints(...)`), so one build can serve either channel with
the channel as a preference rather than a separate artefact.

## Decision

**Two channels, one build per version, no human tag.**

- **Alpha builds itself.** `alpha.yml` runs when Quality succeeds on a push to
  `main` (`workflow_run`). One alpha build at a time; Quality's own
  `cancel-in-progress` and alpha's concurrency group collapse a burst of pushes
  into one build of the newest green commit. It skips when nothing
  app-affecting changed since the last alpha (only `specs/`, `apps/docs/`,
  `*.md`). An alpha is a real **prerelease** tagged `vX.Y.Z-alpha.N`, built for
  macOS and Linux only — the Windows bootstrapper is a stable artefact.
- **The alpha channel is a pointer release.** A fixed release tagged
  `alpha-channel` holds exactly one asset, `latest.json`, copied from the newest
  alpha. Its URLs point into that alpha's own release, so alpha history is kept
  and a pointer update is one file replaced.
- **Stable is a promoted alpha.** `promote.yml` (`workflow_dispatch`, defaulting
  to the newest alpha) checks the alpha's commit passed Quality, tags `vX.Y.Z` on
  that same commit, rebuilds it — the version is compiled into the binary, so the
  alpha's bytes cannot be reused — runs the ADR-0014 check and publishes it as
  Latest. **Stable stays at `/releases/latest`**, so every install that predates
  this ADR keeps working with no change.
- **A hand-pushed `v*` tag fails loudly and publishes nothing.** Promote creates
  its tag with `GITHUB_TOKEN`, which triggers no workflow, so any tag push that
  reaches `release-guard.yml` came from a person.
- **The repo holds the next stable version.** The three version fields say
  `0.49.0`; an alpha is `0.49.0-alpha.N`, N counted from the alpha tags that
  already exist; a dev build calls itself `0.49.0-dev`. Promote commits
  `chore: bump to <next minor>` on `main`.
- **Release notes come from commit subjects.** `feat:` and `fix:` since the
  previous release on the same channel, grouped, with an optional headline
  passed to promote. Stable notes are also prepended to `CHANGELOG.md` in the
  bump commit; alphas stay out of the file.
- **The channel is a Rust-read setting** (`updates.channel`, `stable` when
  unset), because the updater check now runs in Rust: `check_update` reads it,
  picks the endpoint and hands the plugin's own `Update` resource back to the
  renderer, which downloads and installs it exactly as before.

## Consequences

1. **Switching from alpha to stable never downgrades.** The default comparator
   (`update > current`) keeps a `0.50.0-alpha.2` install where it is until
   `0.50.0` ships. Migrations only go forward, so a downgrade would meet a schema
   it does not know; the setting's description says "you move at the next
   stable release" instead.
2. **Hotfixes go forward only.** There are no release branches: a fix lands on
   `main`, an alpha builds, and it is promoted — stable picks up whatever else is
   on `main` with it. Patch versions are unused until a hotfix needs one; that is
   when this gets revisited.
3. **Alphas are pruned on promote.** The alphas of the cycle being promoted and
   of the one before it are kept, for bisecting; older alpha releases and their
   tags are deleted. This deletion is automatic and permanent.
4. **The bump commit is pushed by `GITHUB_TOKEN`**, so it does not run Quality
   or start an alpha by itself. The next real push does both.
5. **New installs start on stable, and so do existing ones.** Everyone who
   installed before this ADR is on stable cadence after `0.49.0` and opts into
   alpha from Settings › Advanced.
6. **The app shows the channel in About and in the crash report, not in the top
   bar.** The version string already carries `-alpha.N`.
7. **No soak time is enforced.** Promote reports the alpha's age and the commits
   it adds in the job summary; the person dispatching it is the gate.
