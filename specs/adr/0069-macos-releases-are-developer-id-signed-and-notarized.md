# ADR-0069 — macOS releases are Developer ID signed and notarized

Status: accepted · 2026-09-27
Supersedes the decision of ADR-0034 (self-signed signing). ADR-0034's diagnosis
of TCC and App Management stands and is the reason for this one.

## Context

ADR-0034 signed the macOS bundles with a self-signed certificate so TCC grants
would stop being orphaned by every release. It said then that this was the free
half: Gatekeeper still treats the bundle as unsigned, and App Management's
same-team rule needs an Apple **Team ID**, which only Apple issues. The
decision to pay for the Apple Developer Program was taken 2026-09-17
(`specs/roadmap/TODO.md` item 51). Enrolment completed 2026-09-27, and Apple
issued a **Developer ID Application** certificate:
`Developer ID Application: Titouan BENOIT (TBPB6GW2JQ)`, G2 intermediate,
valid to 2031-09-17.

## Decision

**Sign every macOS release with that Developer ID certificate, and notarize and
staple it.**

- **Secrets.** `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD` now hold the
  Developer ID `.p12` (leaf, key, and Apple's Developer ID G2 intermediate,
  exported with `-legacy`). Three new ones hold the notarization credential:
  `APPLE_API_KEY` (the key ID), `APPLE_API_ISSUER`, and `APPLE_API_PRIVATE_KEY`
  (the `.p8` contents).
- **An App Store Connect API key, not an Apple ID.** The roadmap item assumed
  `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`. An API key does the same job,
  can be revoked without touching anyone's Apple ID, and is not a password to a
  personal account sitting in CI. `tauri-bundler`'s `notarize_auth()` accepts
  either, and takes `APPLE_API_KEY_PATH` for the file.
- **The workflow still builds the keychain itself** and hands Tauri
  `APPLE_SIGNING_IDENTITY` plus the notarization variables through
  `GITHUB_ENV`, only after each has proved real. ADR-0034's reason for
  bypassing `APPLE_CERTIFICATE` (the `identity::list()` prefix check) no longer
  applies, since a Developer ID certificate passes it. Its other reason does:
  the bundler reads these variables with `var_os`, so the empty string a missing
  secret expands to counts as present and fails a fork's build.
- **The self-signed trust step comes out.** `add-trusted-cert` and the
  passwordless `sudo` it relied on were there only because a self-signed leaf is
  not valid for code signing until trusted. A Developer ID chain resolves to the
  system's Apple Root CA.
- **The identity is checked, not just read.** The step fails unless the
  imported identity is `Developer ID Application: … (TBPB6GW2JQ)`. Signing with
  any other identity resets every user's grants, so restoring the retired
  self-signed secret by mistake has to fail the build instead of shipping.
- **A certificate without notarization credentials fails the build.** A signed
  bundle Gatekeeper still rejects would reset grants and buy nothing. The two
  valid states are: all secrets present (signed and notarized), or no
  certificate (a fork's ad-hoc build).
- **No entitlements file.** ADR-0034's reasoning holds: WKWebView's JIT runs in
  Apple's WebContent process, and child processes are judged on their own
  signatures. `hardenedRuntime: true` is required for notarization and is
  already declared.
- **The `.dmg` is signed, not separately notarized.** Tauri signs the `.dmg`
  with the same identity and notarizes and staples the `.app` inside it. What
  Gatekeeper evaluates at first launch is the `.app`, and the updater tarball
  carries the same stapled `.app`.

## Consequences

**Good.**

- First launch needs no right-click → Open and no `xattr`. Once a notarized
  release is verified, the README and the site's installation page can drop
  that section.
- The in-place updater is signed by the same team as the app it replaces, so
  the App Management prompt goes away instead of just staying answered.
- TCC grants are anchored to a Developer ID designated requirement: `anchor
  apple generic` and the team ID in the leaf's organizational unit, not a hash
  of one certificate. Renewing the certificate under the same team keeps every
  grant, which the self-signed leaf's hash never could.

**Bad.**

- **The first Developer ID release orphans every grant one last time.** The
  designated requirement changes from the self-signed leaf's hash to the Team
  ID. The release notes must say so, because it looks exactly like the bug this
  fixes.
- **Notarization is a network dependency of every macOS build.** `notarytool
  --wait` usually takes minutes but can take much longer, and Apple being down
  fails the macOS job. The job can be re-run per platform.
- **Two more secrets whose loss users would feel.** The `.p12` now also carries
  Gatekeeper trust, so losing it means no notarized release until Apple issues
  a new one. A new certificate under the same team keeps grants; a new team
  does not. The API key is less critical: revoke and reissue it at will.
- **It expires 2031-09-17**, and the Developer Program must stay paid for the
  notary service to keep accepting submissions. Already-stapled builds keep
  launching after a lapse.

**Unverified until a real Mac runs the first signed tag**, and none of it can
be tested from Linux:

1. The import, the identity check and notarization on a GitHub macOS runner.
2. `codesign -d -r- factorai.app` naming the Developer ID and team, stable
   across two releases; `spctl -a -vv -t exec factorai.app` saying
   `source=Notarized Developer ID`; `stapler validate` passing on the
   downloaded `.app`.
3. The App Management prompt gone after an in-place update from one Developer
   ID release to the next. The update *into* the first one is still from the
   self-signed build, so it can still be asked once.
4. The app working signed, hardened and notarized: launch, a session, a PTY, a
   file dialog, an update.

**Rejected: the Apple ID and app-specific password.** They work, but they put a
personal account's credential in CI for no gain over the API key.

**Rejected: notarizing the `.dmg` as a separate step.** tauri-action uploads
the assets itself, so doing this would mean taking over the upload, for a
container Gatekeeper does not evaluate at first launch.
