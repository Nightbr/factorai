# ADR-0070 — The roadmap is GitHub issues, and every change is a PR

Status: accepted · 2026-10-01 · amended 2026-10-01 twice (a deploy key bypasses the rulesets, not the GitHub Actions app; Review requires no approval, and media only when the app changes)
Replaces the protocol in `specs/roadmap/README.md` and the "Work on `main`. No
PR ceremony for solo work" rule in `AGENTS.md` § "Commits" and the
`spec-and-adr-workflow` skill. No earlier ADR decided either, so none is
superseded.

## Context

The roadmap is two markdown files that one person and their agents edit in
place. `TODO.md` is the queue, where position is priority, and `DONE.md` is the
log, with 5,000 lines between them. Item numbers are permanent ids, cited from
the specs, the ADRs, `DONE.md`, `alpha.yml` and code comments. Every change
lands on `main` directly, and Quality runs after the fact.

That works while every change comes from one machine. It does not survive other
people, and they have started to arrive:

- PRs #4, #5 and #6 came from outside contributors who had nowhere to file what
  they had fixed first.
- PR #3 (a native Windows build) was closed for a scope reason the repository
  never states where a stranger would look.
- An outside contributor cannot claim, discuss or be assigned an item that is a
  heading in a markdown file.

The public first release (M6) is what brings more of them. `TODO.md` was
re-checked against the code on 2026-10-01, before this decision, so that only
live work moves.

## Decision

**Work is tracked as GitHub issues on one Project. Every change reaches `main`
through a pull request, the owner's and their agents' included.**

### Issues and the Project

- **One issue per live `TODO.md` item.** The body is the entry as it stands,
  with relative links made absolute, and open checkboxes become a task list.
  Items made of slices get sub-issues.
- **One public Project, "factorai roadmap"**, run as a kanban. Its Status field
  is the board:
  - *Incoming*: filed, unread. Every new issue lands here.
  - *Needs triage*: read, but waiting on a repro, more information or a scope
    call.
  - *Qualified*: accepted and scoped, not scheduled.
  - *Todo*: next. The order is set by hand.
  - *In progress*
  - *In review*
  - *Done*

  The hand order in *Todo* replaces "position is priority". There is no
  priority field.
- **No milestones** to start with. The Project carries the order. A milestone
  is added when a release needs a fixed set of work.
- **Labels** cover the kind (`bug`, `feature`, `perf`, `chore`, `docs`), the
  area (`area:*`), `needs-adr` and `blocked`, plus `good first issue` and
  `help wanted`. There is no triage label, because the column is the state.
- **Questions go to GitHub Discussions.** Issues are for work.

### The old numbers

- **Item numbers do not become issue numbers.** Issues and PRs share one
  counter and #1 to #6 are taken, so item 7 cannot be #7.
- Each issue keeps its item number in an *Item* number field on the Project.
- `specs/roadmap/README.md` holds one table mapping item to issue.
- Citations in mutable files are rewritten to the issue URL. Immutable ADRs keep
  "item N" and resolve it through the table.

### `TODO.md` and `DONE.md`

- **`TODO.md` is deleted** once every live item has an issue.
- **`DONE.md` is frozen, not deleted.** Immutable ADRs link into it, so
  deleting it would leave dangling links in files that cannot be edited. It gets a one-line header saying it is
  an archive, and closed issues and merged PRs are the log from then on.
- The gotchas a `DONE.md` entry used to record go in the PR's "Notes for the
  reviewer".
- `06-milestones.md` stays: it is the arc, not the queue.

### Pull requests

- **A branch per task, and a PR per slice**, citing its issue (`Closes #N`).
  Several sessions share one tree, so each task works in its own worktree.
- **The same-commit rule becomes same-PR.** A contract change and its spec
  update, or a decision and its ADR, land in the same PR.
- **The template** (`.github/pull_request_template.md`) asks for:
  - what changed and why;
  - the spec or ADR it touches;
  - whether `pnpm e2e` ran, since CI does not run it;
  - whether the real window was used;
  - **screenshots or a video of the app on every PR**, from a fabricated
    workspace. A change with nothing visible shows the surface it touches
    still working.
- **Squash merge only.** The PR title is the commit subject, so it carries the
  `feat:` / `fix:` prefix the release notes are generated from. Branches are
  deleted on merge.
- **Issue forms** for a bug and a feature. Blank issues are off.
- **`CODEOWNERS`** names the maintainers, so every review request goes to
  someone.

### Who may merge: two rulesets on `main`

1. **Quality.** It requires the two Quality jobs (`JS — format, lint, types,
   unit tests` and `Rust — format, clippy, cargo test`) and forbids force
   pushes. The only bypass is the GitHub Actions app.
2. **Review.** It requires one approving review from someone with write
   access, and dismisses a stale approval on push. The bypass list holds:
   - the repository admin (the owner), **for pull requests only**, so the
     owner's PRs merge on green and nobody pushes straight to `main`;
   - the GitHub Actions app.

**The owner's PRs auto-merge.** A session opens the PR and runs
`gh pr merge --auto --squash`, and GitHub merges it once Quality is green.
**An outside contributor's PR needs a maintainer's approval** as well as green
checks. A fork's first workflow run waits for "approve and run". `quality.yml`
uses no secrets.

**The GitHub Actions app is on both bypass lists for `promote.yml`.** After a
stable promotion, it commits `chore: bump to X.Y.Z` and pushes it to `main`
with `GITHUB_TOKEN`. That push starts no Quality run and no alpha, which
ADR-0064 consequence 4 depends on. Both rulesets would refuse the push, leaving
`main` on the shipped version. The bypass lets it through unchanged.

## Consequences

**Good.**

- A contributor can find work (an "Up for grabs" view of `good first issue` and
  `help wanted`), claim it, discuss it, and see where it stands on the board.
- Nothing reaches `main` without the gate passing first. Today Quality runs
  after the push and a red `main` is fixed forward. `AGENTS.md` § "Testing"
  records the cost: every check in the gate was added after the thing it
  catches had already broken `main`.
- The alpha pipeline (ADR-0064) is unchanged: one squash merge is one push to
  `main`, and alpha builds from it as before.
- "What shipped" is a closed issue with a merged PR attached, linked both ways,
  instead of an entry someone has to remember to move.

**Bad.**

- **Every change pays a PR round trip**, the owner's too. Auto-merge keeps it to
  waiting for CI, but a one-line docs fix now waits for the Rust job.
- **Any workflow in the repo with `contents: write` can push to `main`.** That
  is `release`, `alpha` and `promote` today, and it is the cost of the Actions
  bypass. A workflow that gains write access is a change to review with that in
  mind. A fork PR's token is read-only, so this is not an outside path.
- **Item numbers become a lookup.** "Item 7" in an ADR now needs the mapping
  table to find its issue, and that table must never lose a row.
- **The roadmap lives outside git.** Issues and the Project are GitHub's, not
  the repository's. A clone no longer carries the queue, and an agent reads it
  through `gh` rather than a file.
- **This is alpha-era policy.** Auto-merge on green is right while alpha builds
  itself from every green `main` and stable is a promotion a person makes,
  because the promotion is the review point for what reaches stable users. If a
  second maintainer joins, or stable starts shipping from `main` directly, the
  owner's bypass on rule 2 is the thing to revisit.

**Unverified until it runs:**

1. That a ruleset accepts the GitHub Actions app as a bypass actor, and that
   the next promote's bump push goes through.
2. That a fork PR's first Quality run waits for approval.
3. That `gh pr merge --auto --squash` merges an owner PR with no review once
   both checks are green.

**Rejected: a bump PR from `promote.yml`.** A PR opened with `GITHUB_TOKEN`
starts no workflows, so its required checks would never report. Fixing that
needs an app token or a personal access token as a new secret. The bot is not
the owner, so every bump would also need an approval by hand. And merging it
would build an alpha on every promote, which changes ADR-0064 consequence 4.

**Rejected: milestones and a priority field from day one.** M6 was a label for
one release push, and a priority field is a second ordering to keep in sync
with the board's. Either can be added when it is missed.

**Rejected: `roadmap:N` labels or `[#N]` title prefixes.** Thirty labels of
pure identity is noise, and a `#N` in a title reads as a link to the wrong
issue. The *Item* field and the mapping table carry the number.

**Rejected: deleting `DONE.md`.** It breaks links from immutable ADRs. Freezing
it costs one header line.

**Rejected: keeping `TODO.md` beside the issues.** Two sources of truth for the
queue disagree within a week. That is the failure `TODO.md` itself was cleaned
of three times.

## Amendment, 2026-10-01: a deploy key, not the GitHub Actions app

Creating the first ruleset failed: *"Actor GitHub Actions integration must be
part of the ruleset source or owner organization"*. The GitHub Actions app can
bypass rulesets only on a repository owned by an organization, and this one is
owned by a user. So the bypass actor on both rulesets is a **deploy key**
instead:

- An ed25519 key with write access, titled "promote.yml: bump push to main
  (ADR-0070)". Its private half lives only in the `PROMOTE_DEPLOY_KEY` secret.
  Nothing else keeps a copy: a lost key is replaced, not recovered.
- `promote.yml`'s `finish` job checks `main` out with that key, so its bump
  push and its tag pruning go over SSH as the key.
- **A deploy key's push starts workflows, where `GITHUB_TOKEN`'s does not.**
  The bump commit therefore carries `[skip ci]`. It still starts no Quality run
  and no alpha, and ADR-0064 consequence 4 holds as written.
- **The cost is narrower than the one stated above.** Only a workflow that
  reads `PROMOTE_DEPLOY_KEY` can push to `main`, not every workflow with
  `contents: write`. The rulesets' deploy-key bypass covers every deploy key on
  the repository, so a second key with write access would inherit it: keep this
  the only one.
- Unverified item 1 becomes: the next promote's bump push goes through, and
  starts no Quality run.

Rejected: **a GitHub App owned by the user**, which a ruleset would accept as a
bypass actor. It does the same job, at the cost of an app, its installation and
two secrets instead of one key.

## Amendment, 2026-10-01: no required approval, and media only when the app changes

**"main: Review" requires a pull request with 0 approvals**, not 1. PR #7, the
first PR under the rulesets, was green but stayed `BLOCKED`. Auto-merge waits
for every requirement and never uses a bypass, and the owner's "pull requests
only" bypass applies only to an explicit admin merge. With an approval
required, every owner PR would need a session to wait out CI (about eight
minutes, the Rust job) and run `gh pr merge --admin`.

Dropping the count costs nothing while the owner is the only one with write
access. A fork contributor cannot merge their own PR, so a maintainer reading it
and pressing merge is the approval. The required pull request and the required
checks are unchanged. **When a second person gets write access, the count goes
back to 1**, and owner PRs then need an approval or an admin merge.

**Screenshots or a video are required only when the app changes.** A PR with no
app change (docs, CI, a refactor with no visible effect) says "No app change"
instead. This was decided by the owner the same day. A capture of an unchanged
app shows nothing a reviewer can use.

