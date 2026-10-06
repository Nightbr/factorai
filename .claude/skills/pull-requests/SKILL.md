---
name: pull-requests
description: How every change reaches main here — a branch in its own worktree, a PR from the template with screenshots or a video attached by gh, and auto-merge on green (ADR-0070). Use when starting a task, before the first commit, when opening or updating a PR, or when a push to main is refused.
---

# Every change is a PR

`main` has two rulesets (ADR-0070). **A direct push is refused for everyone, the
owner included**:

- **"main: Quality"** requires both Quality jobs to be green, and forbids force
  pushes and deletion.
- **"main: Review"** requires a pull request, with **0 approvals**. Auto-merge
  never uses a bypass, so with an approval required the owner's own PRs sat
  blocked even when green. An outside contributor still cannot merge: a fork
  has no write access, so a maintainer reads their PR and presses merge. That
  click is the approval.

`promote.yml`'s bump commit is the one exception. It goes through a deploy key
and is marked `[skip ci]`.

## Start: a branch in its own worktree

Picking up an issue end to end, from the claim to the PR that is ready for
review, is the `github-issue-to-pr` skill; this one is the branch and the PR.

Several sessions share this checkout, so a branch switched in place pulls the
tree out from under whoever else is in it. Give each task its own worktree:

```bash
git fetch origin
git worktree add ../factorai-<slug> -b <type>/<slug> origin/main
cd ../factorai-<slug> && pnpm install
```

`<type>` is the commit prefix: `feat`, `fix`, `refactor`, `test`, `docs` or
`chore`. When there is an issue, put its number in the slug, as in
`fix/123-resume-hang`. When the PR has merged, run
`git worktree remove ../factorai-<slug>`.

## While working

- Make small commits with the usual prefixes. They are squashed on merge, so
  they are for you and the reviewer, not for `main`.
- Push the branch early with `git push -u origin HEAD`, then keep pushing. Open
  the PR as a **draft** while it is unfinished. A branch nobody can see is a
  conflict accruing interest.
- The same-PR rule: a contract change brings its spec update, and a decision
  brings its ADR.

## Open the PR

**The title is the commit on `main`.** It carries the prefix, and the release
notes are built from the `feat:` and `fix:` titles. Write it for someone reading
a changelog.

**The body follows `.github/pull_request_template.md`:**

- what changed and why, and `Closes #N`;
- the spec or ADR it touches;
- whether `pnpm e2e` ran and the real window was used;
- **screenshots or a video of the app whenever the app changes**, or "No app
  change" for docs, CI or an invisible refactor;
- notes for the reviewer. The gotchas a `DONE.md` entry used to keep go here.

**Attach the media with `gh`.** `gh` 2.101+ uploads images and videos with
`--attach`, so the PR is complete when it is opened:

```bash
gh pr create --title "fix: …" --body-file "$SCRATCH/pr.md" \
  --attach "$SCRATCH/before.png#The tab strip before" \
  --attach "$SCRATCH/after.png#The tab strip after"
```

A reference to the local file in the body, such as `![After](./after.png)`, is
rewritten to point at the upload. An attachment the body does not reference is
appended to the end. The limit is 50 attachments per command. For a PR that
already exists, use `gh pr edit <n> --attach …` or `gh pr comment <n> --attach …`.

### Capturing it

Shoot from **a fabricated workspace, never your own**: no real project names,
paths, session titles or tokens. Keep the captures in your scratch directory,
not in the repository.

- **Fastest: the renderer against the mock bridge.** The world is invented by
  construction. Copy the pattern in `tests/docs-shots/*.shots.ts` (Playwright,
  device scale 2, `around()` to crop to the surface). Run it from a throwaway
  spec under your scratch directory, or from `tests/docs-shots/` if the guide
  should keep the image.
- **The real window**, when the change only exists there: a PTY, a native
  dialog, the titlebar. Use `scripts/qa/fixture-workspace.py build` and the
  `app-screenshot` skill's loop. Follow the `manual-qa` skill's safety rules
  for every click.
- **Motion needs a video.** Use Playwright's `recordVideo` (WebM, which GitHub
  plays inline) for a drag, an animation, or a flow across several steps.
- **No app change** (docs, CI, a refactor with no visible effect): no media.
  Say "No app change" in that section.

## Merge

- **As the owner:** arm auto-merge as soon as the PR is ready.

  ```bash
  gh pr ready <n>                 # if it was a draft
  gh pr merge <n> --auto --squash
  ```

  GitHub merges it once both Quality jobs are green. Do not poll in a loop:
  `gh pr checks <n> --watch` once if you need to know.
- **Anyone else:** request a review and wait. A maintainer approves, and then it
  merges on green.
- **Red CI:** fix it on the branch and push. Never merge around it. The
  rulesets would refuse anyway, and nothing has a bypass for it.

After the merge: `git -C <main checkout> pull`, then remove the worktree.

## When a push is refused

`refusing to allow ... GH013: Repository rule violations` on a push to `main`
means you skipped the branch. Move the commits onto one with
`git switch -c <type>/<slug>` and push that. Then reset local `main` to
`origin/main`, but only after checking `git log origin/main..main` holds
nothing else of yours.
