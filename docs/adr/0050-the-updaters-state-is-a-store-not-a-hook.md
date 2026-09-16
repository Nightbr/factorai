# ADR-0050 — the updater's state is a store, not a hook

**Date.** 2026-09-16
**Status.** Accepted. Amends `specs/05-features.md` F14, which still describes
the behaviour correctly and described "one control" as a design choice when it
was also a structural constraint.

## Context

`useUpdater` holds the whole updater in component state: the phase, the version,
the six-hour interval, and the `installed` ref that enforces one install per app
run. Whoever mounts it owns an updater. F14 reads as though that is one
component in one place — and the About pane (F29) wanting the same control is
what made it worth checking whether it ever was.

It is not. `UpdateBadge` is mounted **twice** in `Sidebar.tsx`: inline in the
expanded footer, and inside the rail's overflow `DropdownMenuContent`. The two
never render at once, which is why nothing has looked wrong — but the menu's
copy mounts fresh every time the menu is opened, and mounting is what starts a
check. So on a collapsed sidebar, opening the overflow menu:

- starts an update check that nobody asked for, and
- does it with a **new `installed` ref**, so a version already staged this run is
  downloaded again — roughly 80MB per menu open — before the badge can say
  `Update ready`, which in the meantime it has forgotten.

Adding a third mount in the settings modal makes that worse and adds a way for
two visible surfaces to disagree: the footer saying `Update ready` while About,
mounted seconds later, says `Checking…` about the same release.

The alternatives considered were a React context provider around `AppShell` and
a module-level singleton read through `useSyncExternalStore`. The provider works
but re-renders every consumer on each phase transition and requires the settings
modal to sit inside it; the singleton is a fourth state pattern in a codebase
that already has three and documents why each exists (F11, ADR-0013).

## Decision

**The updater's state lives in a Zustand `updaterStore`, owned by exactly one
initializer mounted once in `AppShell`. Every surface that shows the updater
reads the store and renders; none of them owns it.**

- **`useUpdaterRuntime()`** is the initializer: the timer, the plugin imports,
  the one-install-per-run guard, and the "Up to date" fade all live there, and
  `AppShell` calls it once. Mounting a second one is prevented by there being
  only one call site, and would be harmless anyway — the guard it enforces is
  now in the store, not in a ref per instance.
- **`updaterStore` holds `phase`, `version` and `installed`**, plus `checkNow`
  and `restart` as actions. Zustand because that is what the house uses for
  client state (F11's table), and because a store lets a consumer subscribe to
  the phase alone.
- **`UpdateBadge` becomes a pure consumer.** Both of its mounts keep working,
  and neither starts anything: opening the rail's overflow menu now shows the
  state the app already had.
- **The restart confirmation moves into its own component**, `RestartConfirm`,
  driven by the store's `confirming` flag, so both doors — the footer badge and
  the About row — open the same dialog with the same ADR-0020 sentence rather
  than each rendering their own.
- **The browser-only path is unchanged.** `isTauri()` and the fixture's
  `updateReady` are read by the runtime hook exactly as they were, so the
  Playwright lane keeps driving the badge from `installMockBridge`.

## Consequences

- Opening the rail's overflow menu no longer re-downloads a staged update, and
  no longer forgets one. That bug is fixed as a side effect rather than
  deliberately, which is the honest description of how it was found.
- F14's "one control" is now a UI decision rather than a structural one: a
  second surface costs a subscription. About takes that option (F29); nothing
  else should take it without a reason, because two places to click "check" is
  not obviously better than one.
- One more store, and the app's state now has a fourth home. Justified by the
  same test ADR-0013 applies: this is client state the renderer alone reads,
  which is `prefsStore`'s row in that table, except it is not persisted — an
  update staged in the last run is either applied or gone.
- The interval belongs to the app's lifetime rather than to a component's, which
  is what F14 always described: "on launch, then every 6 hours".
