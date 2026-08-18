# 14. Alpha releases publish themselves, gated by a check rather than a person

Date: 2026-08-18

Status: Accepted. **Amends [ADR-0010](0010-ota-updates-via-tauri-updater.md)
consequence 2**, which is otherwise unchanged and still in force.

## Context

ADR-0010 chose Tauri's updater and, as its second consequence, recorded that
releases "stay **drafts** until published by hand, which is what actually gates a
rollout." That sentence is doing real work: because the app resolves updates
through GitHub's `/releases/latest`, publishing *is* the rollout. There is no
staged percentage and no channel — the moment a release stops being a draft,
every installed copy is one poll away from it.

Two things have changed since.

**factorai is alpha and releasing several times a day.** v0.10.0 through v0.12.1
landed inside 48 hours. A human gate that is crossed every few hours is not a
gate; it is a queue, and its main effect is that a fix sits built-and-unshipped
until someone notices. `specs/roadmap/TODO.md` item 31a anticipated exactly this
— "alpha is exactly the case where you do *not* want a human in the loop" —
while insisting the missing-platform protection be kept.

**We know precisely what the human was catching, because it happened.** On
v0.10.1 both matrix jobs raced to create a release, so Linux's assets landed in
one draft and macOS's in another, each carrying a `latest.json` that listed only
its own platform. Publishing either would have told every other platform there
was nothing to update to. **Both jobs reported success.** The failure was found
by counting assets by hand.

That is the whole of the human's contribution to this gate: counting assets and
reading one JSON file. It is not judgement, and it is not review — nobody has
ever declined to publish a release because they didn't like it. It is a
checklist, executed by a person, at the one moment they are least likely to be
paying attention.

## Decision

**The release workflow publishes the release itself, once the matrix is green
and a check confirms the artefacts are complete.**

The draft does not go away — it is still created before the matrix, and the
builds still upload into it by id, which is what stops the v0.10.1 race. What
changes is who un-drafts it. A `publish` job runs after `build` and:

1. **Inherits the matrix result.** `needs: build` means a failed or cancelled
   platform skips publication entirely and the release stays a draft, exactly as
   before.
2. **Counts the assets** — a `.dmg`, a `.app.tar.gz`, an `.AppImage`, and
   `latest.json`. Matched by suffix, because the version is in most of those
   names and the tag is not that job's business.
3. **Reads `latest.json` and requires both a `darwin-*` and a `linux-*` key.**
   This is the v0.10.1 check specifically, and it is the one a green matrix
   cannot give you: both jobs succeeded that day and the manifest was still
   wrong. The file is fetched through the API rather than its browser URL,
   because a draft's assets are not public yet.

Any failure calls `core.setFailed` and returns without touching the release, so
the outcome of a bad build is the status quo ante: a draft, and a red job saying
which half is missing.

**Releases are still not marked `prerelease`.** This is the part most likely to
be "fixed" by someone reading the word alpha, so it is restated here: GitHub's
`/releases/latest` skips prereleases, and that endpoint is what the updater
resolves through. Marking an alpha as a prerelease leaves every installed copy
polling a 404 forever. "Alpha" changes *who publishes*, not how the release is
labelled. A real channel scheme has to solve the endpoint problem first — see
roadmap item 31b, which is where that belongs.

## Consequences

**Good.**

- `git tag && git push origin <tag>` is now the entire release. ADR-0010's
  "one command still ships a release" is finally true without a footnote.
- The check runs every time and cannot get bored, which the human demonstrably
  could — four releases before v0.10.1 won the same race by luck and nobody
  noticed.
- A partial release now fails loudly, where before it was a draft that looked
  complete on its own terms. `gh release view` shows whichever draft it picks,
  so the old failure was invisible without knowing to count.

**Bad.**

- **There is no longer a moment where a person looks at the release before the
  world does.** Nothing stops a tag on a broken commit from shipping to every
  install; the only remaining defence is CLAUDE.md § 2c and `quality.yml`,
  neither of which the release workflow enforces. Roadmap item 31a already
  carries "nothing enforces *tag a commit Quality has passed*" as an open item,
  and this decision raises its priority from tidy-up to the next real gap.
- The check knows what a *complete* release looks like, not a *correct* one. A
  bundle that builds, uploads and installs but crashes on launch passes every
  assertion here. The macOS smoke pass (roadmap item 8) has still never happened.
- Rolling back means deleting a published release rather than declining to
  publish a draft, and installs that polled in between already have it.

**Revisit when factorai stops being alpha.** The trade taken here is explicitly
priced on releasing several times a day to a handful of users. At the point
where a bad release reaches people who did not sign up to test it, the human gate
earns its cost again — and the machine check should stay regardless, since it was
never the part a person was good at.
