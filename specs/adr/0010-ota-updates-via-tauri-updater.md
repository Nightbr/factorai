# ADR-0010 — OTA updates via `tauri-plugin-updater`, served from GitHub releases

Status: accepted · 2026-08-14
Supersedes the "Auto-updates" entry in `06-milestones.md` § Deferred (#7).

## Context

The release pipeline (ADR-0009 era, `.github/workflows/release.yml`) builds
bundles and attaches them to a GitHub release. Getting a new version onto a
machine still meant noticing the release, downloading a file and installing it
by hand — which, for a tool its author uses daily and ships from the same
machine, means running stale builds indefinitely.

Deferred #7 said auto-updates needed "a signed release flow", which we now have
in the sense that matters here: the release job can sign artifacts with a
minisign key held as a repository secret.

## Decision

Adopt **`tauri-plugin-updater`**, with the manifest served from the GitHub
release itself:

```
https://github.com/Nightbr/factorai/releases/latest/download/latest.json
```

`tauri-action` generates `latest.json` and the per-artifact `.sig` files during
the release build; the app polls that URL, verifies signatures against a public
key compiled into `tauri.conf.json`, downloads, installs, and waits.

Four consequences of that choice, each of which forced something else:

1. **The repository is now public.** Release assets on a private repo return
   404 to unauthenticated clients, so an updater pointed at them can never
   work. The alternatives were a separate public releases repo, third-party
   hosting, or embedding a token in the binary (a leaked credential by
   construction). Going public was chosen deliberately, not as a side effect.
2. **Releases are no longer marked pre-release.** GitHub's `/releases/latest`
   skips prereleases, so the endpoint would resolve to nothing. They stay
   **drafts** until published by hand, which is what actually gates a rollout.
   → **Amended 2026-08-18 by
   [ADR-0014](0014-alpha-releases-publish-themselves.md)**: while factorai is
   alpha the workflow publishes the draft itself, once a check confirms both
   platforms' artefacts are present. The draft and the not-a-prerelease rule
   both stand; only the hand does not.
3. **Linux ships AppImage only.** The updater can replace an AppImage in place;
   it cannot replace a `.deb`, because apt owns those files. Shipping a `.deb`
   that silently never self-updates is worse than not shipping one.
4. **macOS ships `.app.tar.gz` alongside the dmg.** The dmg is what a human
   downloads; the tarball is what the updater consumes. This reverses an
   earlier `--bundles dmg` decision that was correct only while no updater
   existed.

**The signing key is a minisign keypair** generated with `tauri signer
generate`, held as the `TAURI_SIGNING_PRIVATE_KEY` repository secret with an
empty passphrase. Losing it means every installed copy stops accepting updates
— a new key requires a manually-installed build to bridge the gap.

## Consequences

**Good.**

- One command still ships a release (`git tag`, then publish the draft), and
  installs converge on their own. (Since ADR-0014 the second half is automatic,
  so it really is one command.)
- Signature verification means a compromised release host can't push arbitrary
  code to installs — the private key never leaves the secret store.
- Update checks cost one static JSON fetch; no server to run.

**Bad.**

- The repository's contents, specs and history are now public. That is a real
  cost paid for a convenience feature, and it is the part of this decision most
  worth revisiting if the project's status changes.
- The updater is **not** Apple code-signing. macOS bundles remain unsigned, so
  a *first* install still needs the Gatekeeper dance (README). Updates applied
  by the running app skip that, since nothing re-quarantines them.
- `.deb` users lose their install path entirely, rather than merely losing
  auto-updates.

**Rejected: shipping an update without a restart.** The plugin can only swap
files on disk; the running process keeps its old code either way. Restarting is
the user's call because factorai holds live PTYs — see F14, where the restart
goes through the same confirmation as a quit (ADR-0005), since `relaunch()`
kills children without firing `CloseRequested`.
