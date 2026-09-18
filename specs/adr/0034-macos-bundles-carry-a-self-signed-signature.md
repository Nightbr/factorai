# ADR-0034 — macOS bundles carry a self-signed signature, so TCC grants survive a release

Status: accepted · 2026-09-03
Amends the "two dead ends" paragraph of `specs/roadmap/TODO.md` item 36.

## Context

A user reported, 2026-09-03, that macOS asks for the same folder permissions on
every launch — grant them, get sent to System Settings, restart, and the ask is
back — plus a *"factorai was prevented from modifying apps on your Mac"*
notification, with factorai's **App Management** toggle showing as off after
they had turned it on.

Both symptoms are the same cause, and it is signing. Two mechanisms are in play
and they are separate:

1. **TCC keys every grant to the app's designated requirement.** The macOS
   build is unsigned (item 36); the linker ad-hoc signs on Apple Silicon, and an
   ad-hoc signature has no identity, so the requirement falls back to the exact
   cdhash. Every release — and every self-update, since F14 replaces the bundle
   in place — produces a new cdhash, which orphans every grant the user has
   made. The toggle reading off after being switched on is that: a stale row
   pointing at a cdhash no longer on disk.
2. **App Management (`kTCCServiceSystemPolicyAppBundles`) is what the notification
   is.** `tauri-plugin-updater` writes inside `/Applications/factorai.app`, which
   is a modification of an app bundle. Apple's rule, from WWDC22's *What's new in
   privacy*: an app modified by something "that isn't signed by the same
   development team and isn't allowed by an `NSUpdateSecurityPolicy`" is blocked.
   Both escapes key on a **Team ID** — `NSUpdateSecurityPolicy`'s `AllowProcesses`
   is literally a dictionary mapping team identifiers to signing identifiers —
   and only Apple issues one, with a paid Developer Program membership.

So the two halves of the problem separate cleanly: (1) needs *a stable* identity
and does not care whether anyone trusts it, (2) needs *an Apple-issued* identity.
A free self-signed certificate fixes the first and cannot fix the second.

Item 36 closed self-signed certificates as a dead end on the grounds that
"Gatekeeper treats it exactly as unsigned". That is true and remains true. It is
also only about Gatekeeper, and Gatekeeper trust and TCC persistence are
different mechanisms — which is the gap this ADR fills.

## Decision

**Sign the macOS release bundles with a self-signed code signing certificate**,
held as a repository secret, and keep shipping without notarization.

The certificate is generated once, off any Apple programme:

```bash
openssl req -x509 -newkey rsa:2048 -days 3650 \
  -keyout factorai-signing.key -out factorai-signing.crt -nodes \
  -subj "/CN=factorai Signing" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=codeSigning"

# -legacy is not optional: the macOS keychain wants the older PKCS#12 format,
# and without it `security import` fails silently.
openssl pkcs12 -export -legacy \
  -in factorai-signing.crt -inkey factorai-signing.key \
  -out factorai-signing.p12 -password pass:<passphrase>

# Redirected, not `base64 -i`: that flag means "ignore garbage" to GNU base64
# and "input file" to Apple's, so the obvious spelling is wrong on one of them.
base64 < factorai-signing.p12 | tr -d '\n'   # -> the APPLE_CERTIFICATE secret
```

The common name is free — nothing reads it. The workflow reads the identity back
out of the keychain it just built rather than carrying a copy of the name, so the
certificate's name is a property of the secret and not of a file in this repo.

Two repository secrets carry it: `APPLE_CERTIFICATE` (that base64, one line) and
`APPLE_CERTIFICATE_PASSWORD` (the passphrase).

**The workflow builds the keychain itself, and hands Tauri only
`APPLE_SIGNING_IDENTITY`.** Handing it `APPLE_CERTIFICATE` instead is the
shorter path — `tauri-bundler` reads that variable and imports the `.p12` for you
— and it cannot work here. That branch resolves the identity through
`tauri_macos_sign`'s `identity::list()`, which looks only for certificates whose
common name begins with one of seven Apple prefixes (`Developer ID Application:`,
`Apple Development:`, and five more) and additionally requires an organizational
unit to read as a team id. A self-signed certificate matches none of them, the
list comes back empty, and the build fails on `ResolveSigningIdentity`. Naming
our certificate as though Apple had issued it would satisfy the parser and put a
false authority in every signature, which is not a trade worth making. Setting
`APPLE_SIGNING_IDENTITY` with `APPLE_CERTIFICATE` absent takes the
`with_signing_identity` path instead, which passes the name to `codesign` and
asks the certificate no questions.

So the workflow does the `security` dance — temporary keychain, import,
`set-key-partition-list` so codesign's use of the key does not raise a GUI prompt
that hangs the job, and *joining* the user keychain search list rather than
replacing it, since `with_signing_identity` passes no `--keychain`.

**The certificate must also be trusted for code signing on the build machine**
(`security add-trusted-cert -d -r trustRoot -p codeSign`). An untrusted
self-signed certificate is not *valid for code signing*: it does not even appear
in `security find-identity -v -p codesigning`, and codesign refuses an identity
it cannot validate. This is trust on the builder and nowhere else — no user's
machine trusts this certificate and none is meant to, which is why Gatekeeper is
unaffected while grant persistence is not: the designated requirement keys off
the certificate's hash, not off anyone trusting it.

Neither variable is exported to the build step. The bundler reads
`APPLE_CERTIFICATE` with `var_os`, so the empty string a missing secret expands to
counts as present and would fail the build; keeping both step-scoped means a fork
without the secrets builds ad-hoc exactly as before.

**Notarization stays off** — `notarize_auth()` needs `APPLE_ID` /
`APPLE_PASSWORD` / `APPLE_TEAM_ID` or an App Store Connect key, all deliberately
absent. Notarization does not grant App Management either way; the Team ID does.

**`bundle.macOS.hardenedRuntime` is declared explicitly as `true`.** It is
Tauri's default, and this only takes effect once signing does, so the value was
previously moot. Writing it down makes it a decision: hardened runtime is what
the eventual Developer ID step needs, and declaring it now means any breakage it
causes surfaces on this release rather than that one. No entitlements file
accompanies it — WKWebView's JIT lives in Apple's own WebContent process, and
factorai's children (the PTY, `claude`) are evaluated on their own signatures,
not ours.

**The `.p12` is now as load-bearing as the minisign key** of ADR-0010, and for
the same kind of reason: losing it, or rotating it, resets every permission every
user has granted. It does not break updates the way losing the minisign key
would, so it is one notch less fatal — but it is the second secret whose loss is
felt by users rather than by the build.

## Consequences

**Good.**

- A user grants folder access once and it survives the next release and the next
  self-update, which is the reported bug.
- App Management is still asked for, but **asked once**: with the requirement
  anchored to the certificate rather than a cdhash, the grant stops being
  orphaned by every release. Most of the complaint was the repetition.
- It costs two secrets and a guarded workflow step, and composes with item 36's
  cask and with a later Developer ID move rather than competing with either.

**Bad.**

- **Gatekeeper is untouched.** First launch still needs the right-click → Open
  dance or `xattr -dr com.apple.quarantine`, and the README section saying so
  stands. Nothing about the download experience improves.
- The App Management prompt does not go away. Only a Developer ID certificate
  removes it, because only a Team ID satisfies the same-team rule.
- One more secret to hold, and a rotation that is invisible in CI and visible to
  every user as a permission reset.

**Unverified, and to be confirmed on a real Mac before the first signed tag is
pushed.** Neither could be tested from the Linux machine this was written on:

1. That TCC accepts a self-signed leaf on a machine that does not trust the
   certificate. The requirement should be `certificate leaf = H"..."` and need no
   anchor trust — but the whole decision rests on it. The test is two consecutive
   builds and `codesign -d -r- factorai.app` on each: an identical designated
   requirement, naming the certificate rather than a cdhash, is the pass.
2. That the import sequence works on a GitHub macOS runner at all — it leans on
   passwordless `sudo` for `add-trusted-cert`, and the whole step is untestable
   from Linux. It runs for the first time on the first signed tag, which is
   re-runnable per platform (see this workflow's header) but is still a release.
3. That the app still runs correctly signed and hardened — launch it, open a
   session, drive a PTY, open a file dialog, apply an update. Type checking does
   not validate this and neither does CI.

**Rejected: an explicit ad-hoc `codesign` step.** Unchanged from item 36 — the
linker already ad-hoc signs, so it buys nothing. The problem was never that the
signature was missing; it was that an ad-hoc one has no identity to key a grant
to.

**Rejected: `NSUpdateSecurityPolicy` in our own `Info.plist`.** Its
`AllowProcesses` maps team identifiers, and we have no team identifier to name.
It becomes available with a Developer ID certificate and is redundant then, since
the same-team rule already covers an app updating itself.

**Deferred, not rejected: paying for the Developer Program.** $99/yr buys a Team
ID, which removes the App Management prompt entirely, and notarization, which
removes the Gatekeeper step and lets item 36's cask drop `--no-quarantine`. This
ADR is the free half of that ladder, not an argument against climbing it —
`specs/roadmap/TODO.md` item 51 holds the decision.
