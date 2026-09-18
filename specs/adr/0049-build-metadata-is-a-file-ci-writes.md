# ADR-0049 — build metadata is a file CI writes, not a build-time define

**Date.** 2026-09-16
**Status.** Accepted. The contract is `specs/05-features.md` F29.

## Context

The About pane (F29) names the build it is running in: a version, the commit it
was built from, the day it was built, and the people with a commit in it. Only
the first of those exists today, as `__APP_VERSION__` — a Vite `define` read off
`package.json`, which `release.yml` rewrites from the tag before the frontend
build runs.

The obvious move is to add three more defines beside it. It does not survive
contact with what each value actually is:

- **A define is baked at config time and is invisible afterwards.** Nobody can
  look at a bundle and see what it claims; the values are spliced into minified
  JavaScript. A wrong build date is then a code change to fix.
- **Two of the four values are not the build machine's to know.** The
  contributor list comes from the GitHub API, which means a network call — in
  `vite.config.ts` that is a network call inside every `pnpm vite:dev`, every
  `pnpm build`, every Playwright run, and a flaky one at that.
- **The dev build has no answer for any of them**, and must not invent one. The
  version define already has this exactly right: `0.1.0` untouched means nobody
  tagged this, so it says `(untagged dev build)` rather than claiming a release.
  A `__BUILD_DATE__` of "whenever the dev server started" is not the same kind
  of honest — it is a real-looking date for a build that was never released.

The crash screen's reason for a define — the crash path must not depend on the
Tauri bridge still working — is about *that* surface, not about build metadata
generally. About is a settings section; if the app is broken enough that it
cannot fetch a static file from its own bundle, the About pane is not what the
user is looking at.

## Decision

**Release metadata is a JSON file that CI writes, ships in the bundle, and the
renderer fetches at runtime. Its absence is a supported state and means "this is
not a release build".**

- **`apps/desktop/public/build-info.json`**, written by
  `scripts/write-build-info.mjs` in `release.yml` after "Set version from tag"
  and before the frontend build. Vite copies `public/` into `dist/`, which Tauri
  serves from inside the bundle, so it needs no bundler plumbing and no
  `bundle.resources` entry.
- **Gitignored.** It is a build artifact, like `public/pdfjs/` (ADR-0018).
  Committing it would put a file in the tree that is wrong for every local
  build, and dirty the working copy on every release run.
- **Four fields**: `version`, `builtAt` (an ISO-8601 UTC instant), `commit` (the
  short SHA) and `contributors` (logins, commits descending, `type: Bot` and the
  repository author removed). Written by one script, so the shape has one
  author.
- **Absent is the dev state.** The renderer fetches once, tolerates a 404 or a
  parse failure, and falls back to `__APP_VERSION__` plus "built locally". Every
  local build, the browser-only dev loop and the Playwright lane take that path
  by default, which means the fallback is the branch that gets exercised
  constantly rather than the one nobody sees until a release.
- **`__APP_VERSION__` stays** and keeps its single job: the crash screen. About
  prefers the file's `version` when it has one, and the two cannot disagree in a
  release because the same tag rewrite feeds both.

## Consequences

- The shipped metadata is a readable file. `unzip -p factorai.app … build-info.json`
  answers "what is this build" without a debugger, and the release job can be
  checked by looking at its own output.
- A contributor list is generated once per release, from CI's own
  `GITHUB_TOKEN`, rather than on every developer's machine or on every launch.
  The app makes no request to github.com at runtime for it.
- About has a loading state, briefly, which a define would not have had. It is a
  fetch of a few hundred bytes from the bundle; the pane renders its header
  immediately and fills the rows when it lands.
- A release built by any path other than `release.yml` ships no file and reads
  as a dev build. That is the intended failure: the file is evidence of the
  release pipeline, and a hand-rolled bundle claiming a build date would be
  worse than one admitting it has none.
- One more thing to keep in step when a field is added: the script writes it,
  `lib/buildInfo.ts` parses it, and the parser rejects a file it cannot read
  rather than rendering half a pane.
