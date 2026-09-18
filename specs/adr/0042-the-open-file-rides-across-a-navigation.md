# ADR-0042 — The open file rides across a navigation, and the strip says what a close is

**Status.** Accepted (F7 — the viewer survives a session switch, 2026-09-11).

## Context

ADR-0037 put the viewer in a pane with a strip of open files, persisted per
checkout, and kept `?file=` as the active file — "deep link, reload and HMR
survival, browser-back closes the viewer". Both halves work. They do not add up
to a viewer that survives a session switch.

`?file=` lives in the router's search, and every link that moves between
sessions asks for a route and nothing else:

```tsx
<Link to="/projects/$projectId/sessions/$sessionId" params={{ projectId, sessionId }} />
```

TanStack builds the destination's search from the link's own options, so `file`
is simply not in it. There are fifteen such call sites — two in
`SidebarProject`, three in the project route, the session tab strip, the search
results, `useStartSession`, `useDeleteSession`, `ProjectMenu`, the rail glyph —
and one of them creates a session that does not exist yet.

The strip's own persistence could not cover for it. `activeByCheckout` knew
exactly which file the checkout was reading, but the effect that re-seeded
`?file=` from it was guarded by a `Set` of checkouts already restored — once per
checkout, per run — because running it whenever `?file=` was absent would have
reopened the viewer the instant you closed it. So the pane went blank on a
session switch and stayed blank until you clicked a file again.

## Decision

**`file` and `diff` are carried by a search middleware on the root route**, not
by a `search` prop on each of the fifteen links. A prop is a rule the next link
has to remember, and `useStartSession` is proof that some of them are not links
at all.

**The strip is the discriminator for a close.** From inside a middleware a
navigation and a close look identical — both arrive with no `file` — so the
answer cannot come from the URL. `ViewerPane` drops the tab *before* it clears
the param, and closing the last tab removes the checkout's entry from
`activeByCheckout`, so:

- a **close** arrives with no record of the file → the middleware carries
  nothing, and the param goes;
- a **navigation** arrives with the file still recorded as this checkout's
  active one → the middleware carries it.

**Not `retainSearchParams`.** The router ships one, and it fills a key that is
*missing* from the next search. The root route's `validateSearch` returns an
object with all five keys spelled out, `undefined` included, so no key is ever
missing and the helper is a no-op here. Widening `validateSearch` to omit its
undefined keys would make the helper fire — and would then refill `file` on a
close, which is the one navigation that must win.

**`line` and `col` are not carried.** A position is a one-shot instruction to
reveal something, not a property of the file being open — the same reason
`open()` spells them out as `undefined` rather than inheriting them.

**A change of checkout re-seeds instead of carrying.** The strip is per checkout
(F21), so when a session working in a linked worktree comes to the front, the
carried path belongs to a tree that does not contain it. `AppShell` watches
`root` and, on a change, opens that checkout's own last file as it was left,
preview included. The two effects that used to do this — adopt-the-URL and
restore-on-launch — are now one, because on a checkout change the second has to
win before the first sees a path belonging to the checkout we just left.

A checkout with **no** history of its own leaves whatever is showing alone
rather than closing the viewer. `root` resolves in two steps for a session in a
worktree — the project's folder first, the worktree once `gitWorktrees` answers
— and closing on the second step would shut a deep link a frame after it opened.

## Consequences

- Switching session, starting a new one, and going back to the project all leave
  the pane showing what it was showing, with no remount: the param never goes
  absent, so Monaco keeps its scroll position and its undo stack.
- The two ways out of the viewer are unchanged. A close drops the tab first, so
  the middleware does not carry the file; browser-back is a history pop, which
  never runs a middleware at all.
- `activeByCheckout` is now load-bearing for more than restore-on-launch. A
  future close path that clears `?file=` without going through `closeTab` would
  find the file carried straight back — `ViewerPane` is the only caller of
  `close()`, and that is the invariant to keep.
- The middleware reads a zustand store from a route definition. That is a
  one-way dependency the route already had through `RootLayout`, and the
  alternative — a module-level "closing" flag set just before `navigate` —
  would be consumed by whichever link happened to rebuild its `href` first.
- Superseded nothing. ADR-0037 still describes where the viewer lives and what
  the strip is; this is the part of it that was missing.
