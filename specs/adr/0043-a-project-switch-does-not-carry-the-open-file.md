# ADR-0043 — A project switch does not carry the open file

**Status.** Accepted (F7 — the viewer is isolated per project, 2026-09-12).

## Context

ADR-0042 made `file` and `diff` ride across a navigation, because switching
session, starting a new one or opening a project's Routines tab all go through a
link that asks for a route and nothing else, and the pane went blank.

It carries them across *every* navigation, including the one that changes the
subject. Switching from a session in `panora` to a session in `factorai` leaves
`?file=/…/panora/apps/backoffice-api/src/features/health/health.module.ts` in
the URL, and `AppShell`'s re-seed rule only replaced it when the checkout being
switched to had a file of its own on record — "a checkout with no history of its
own leaves whatever is showing alone rather than closing the viewer".

So the first time a project is opened, it shows the previous project's file over
its own tree. Worse, the adopt-the-URL half of the same effect then writes that
path into the new checkout's strip, so a foreign tab persists into the next
launch. Reported from the app, with the two projects side by side.

The clause was not arbitrary. `root` resolves in two steps for a session in a
linked worktree — the project's folder first, the worktree once `gitWorktrees`
answers — so a rule that closes on any change of `root` would shut a deep link a
frame after it opened.

## Decision

**The subject is the project *and* the checkout, and only a change of project
drops a carried file.** `viewerHandoff` in `viewerStore` answers, in order:

- **restore** — the checkout being switched to has a file of its own on record.
  Unchanged from ADR-0042, and still ahead of everything else.
- **close** — the project changed and what is showing is not inside the new
  checkout. It belongs to the strip we just left.
- **keep** — everything else, and deliberately the answer for a change of
  *checkout* inside one project: that is the two-step resolve, and the deep link
  it would otherwise shut.

The path test is `isWithin` from `@lib/paths` — the one `checkoutContaining`
already used, moved there from `useWorktrees` so both ask the question the same
way. A path outside every checkout (a symlink target, a file opened from a
terminal link elsewhere on disk) is not in the new project either, so it closes
with the rest.

**The rule is a pure function, not an effect.** `AppShell` reads `seen` as the
previous subject and applies the answer; the four cases that used to be three
nested conditions in a `useEffect` are a table in `viewerStore.test.ts`.

**A close from here does not touch the strip.** `ViewerPane` drops the tab
before clearing `?file=` (ADR-0042's discriminator for the retain middleware);
this close must not, because the tab belongs to the project being left and is
what that project comes back to. The middleware is satisfied anyway: by the time
it runs, `checkout` is the new one, and its `activeByCheckout` entry is either
absent or a different file, so nothing is carried back.

## Consequences

- One project's file never appears over another project's tree, and never lands
  in another project's strip. Each project's viewer comes back to what it was
  left showing, or to nothing.
- ADR-0042 is not superseded: the carry it introduced is unchanged for every
  navigation inside one subject, which is every case it was written for.
- Switching *checkout* inside a project still leaves a file from the main
  checkout showing over a linked worktree's tree. That is the two-step resolve's
  price, and the same file is one click from being reopened in the worktree
  anyway. If it ever becomes worth fixing, the fix is a signal that says the
  resolve has settled, not a second path test.
- `isWithin` is now shared. A third caller that wants "is this path in this
  checkout" has one answer to use rather than a fourth `startsWith`.
