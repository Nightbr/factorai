# ADR-0046 — A rebindable keymap, and a menu that gives up `Cmd+W`

**Date.** 2026-09-15
**Status.** Accepted. Decides the open questions roadmap item 5 listed, and is the
contract `specs/05-features.md` F28 states. Answers Q15's deferred panel-toggle
binding and wires the `Cmd/Ctrl+,` that Q24 deliberately left unwired.

## Context

`05-features.md` listed six keyboard shortcuts and **none of them were wired**. The
table was never the hard part. Three things make this surface different from the
`useEffect` anyone would write first:

1. **There is a terminal in the window.** A global handler that swallows a
   keystroke breaks typing to Claude. Every binding has to answer "what happens
   when the terminal has focus", and the answer is not the same for all of them.
2. **Users asked for bindings that collide with the table.** `Cmd+W` was asked for
   twice as *close the focused tab*, where the table says *kill the active
   terminal*. `Cmd+F` was asked for twice as *focus the sidebar search*, where the
   table says *find in viewer or terminal* and gives search to `Cmd+K`.
3. **Rebinding was asked for.** Once bindings are the user's to change, the keys
   cannot be hard-coded at their call sites, and retrofitting a map afterwards
   means rewriting every binding that shipped before it.

Two of those bindings cannot be implemented in the renderer at all on macOS, which
is what forced this to be a decision rather than a hook.

## Decision

### The bindings are a map, and the map is the only source

An `Action` union names what can be bound; a module constant holds the default
binding for each; `prefsStore` holds **only the user's overrides**, where a
`null` override means *deliberately unbound*. The effective keymap is
`defaults → overrides → one conflict scan`, computed in a pure module that vitest
covers.

Overrides-only, rather than persisting the whole map, so a default we change in a
later release moves with the app instead of being frozen at whatever it was the
day the user first pressed Save. It lands in `prefsStore` rather than the SQLite
`settings` table because no Rust reads it and `prefsStore`'s own rule is the one
that applies: renderer-only values are `localStorage`, read synchronously, so
nothing shows a default for a frame.

**A user's override outranks a default that arrives later.** When a future feature
ships a default this user has already taken — item 12's `Cmd+P`, say — the merge
keeps the override and the newly arrived action starts **unbound**, visible as a
blank row in settings. The alternative silently removes a key somebody chose.

### `@tanstack/react-hotkeys`, pinned exact, used as intended

Registration (`useHotkey`), capture (`useHotkeyRecorder`), display
(`formatForDisplay`), `Mod` resolving to Meta on macOS and Control on Linux — and
so under WSLg (ADR-0044) — and `conflictBehavior` are the library's, not ours.
Pinned exact at `0.10.0` like every other dependency here.

It is pre-1.0 and it sits under every shortcut in the app. That is accepted
knowingly, with one thing held back: **the action list, the defaults and the
merge are ours**, in a pure module, because they are the part the settings UI and
the xterm pass-through both read.

One correction to what the roadmap item assumed: the library has **no named-scope
registry**. "This key means something else inside the editor" is expressed with
`enabled`, with `target` — a ref, so the binding is live only while that element
or a descendant has focus — and with `ignoreInputs`.

**Conflicts are two different things and they are handled in two places.**
`conflictBehavior: 'error'` covers registration: two call sites claiming one chord
is a programming mistake, and it should be loud rather than a console warning
nobody reads. The user-facing conflict happens earlier, in the settings draft:
assigning a chord that another action holds **steals it**, and the action that
lost it renders as a blank row. The draft therefore cannot produce a registration
conflict, and stealing is recoverable before it is real because Q24's modal has an
explicit Save, a dirty dot on the section, and a Cancel that discards.

Stealing rather than refusing, because refusing makes swapping two bindings
impossible without a three-step dance through unbind, and because a row that goes
visibly blank says what happened better than an error that names an action you
were not looking at.

### The terminal keeps everything it binds, unless an action says otherwise

xterm's focus target is a real hidden `<textarea>`, so the library's default
`ignoreInputs` already suppresses hotkeys while the terminal — or Monaco, or the
sidebar's search field — has focus. That is the right default and it is free.

Each action declares whether it fires anyway. The ones that do get
`ignoreInputs: false` **and** an entry in xterm's `attachCustomKeyEventHandler`,
so xterm does not consume the chord first. Those are two lists that must agree,
so both are derived from the one map rather than written twice.

### macOS keeps its menu, and the menu gives up `Cmd+W`

This is the half the renderer cannot do. AppKit menu accelerators are consumed
before the webview sees them, and until now this app shipped **no menu of its
own** — the accelerators came from Tauri's default.

We take ownership of the menu:

- **Quit keeps `Cmd+Q`**, and its handler goes down the *same* path as the window
  close, so ADR-0020's quit guard runs and `kill_all()` runs. A renderer handler
  that exits around `CloseRequested` is orphan zombies plus a skipped confirm.
- **Close Window moves to `Cmd+Shift+W`.** That is what frees `Cmd+W` to reach the
  webview, which is what lets *close the focused tab* be one `useHotkey` on both
  platforms instead of one action with two implementations and two chords.

On Linux there is no menu, so `Ctrl+Q` is a real binding — and its handler calls
`getCurrentWindow().close()`, landing in the same `CloseRequested` path. It must
never call `app_quit_confirmed`, which is the dialog's confirm: binding that
directly kills live sessions with no ask.

### The two collisions, resolved

- **`Cmd+W` closes the focused tab.** Focus decides which strip: the viewer's
  `FileTabs` when the viewer has focus, otherwise `SessionTabs`, through F10's
  close with `needsCloseConfirm`, and answering F26's draft store for an unsaved
  file. **Kill-active-terminal loses its binding entirely** — it is rare,
  destructive, and does not deserve the most contested key in the app.
- **`Cmd+F` is context-dependent; `Cmd+K` is not.** Viewer or terminal focused,
  `Cmd+F` is find. Anywhere else it focuses the sidebar search. `Cmd+K` focuses
  the sidebar search from anywhere, so one key never depends on where you are
  looking.
- **The `Cmd/Ctrl+G` go-to-line row is removed.** Monaco ships go-to-line
  natively inside the editor, so an app-level row for it was already false. This
  is the removal roadmap item 14 asks for, made here so the table is amended once.

### Where the registrations live

`useGlobalShortcuts()` at the shell owns what is true everywhere. Context-dependent
actions register at whoever owns the focus, using `target` and `enabled` — the
viewer keeps `Cmd+F` through the `findHandle` it already has, the tab strips own
`Cmd+W`. Both read the same keymap.

This makes `05-features.md`'s old sentence — "implemented via a single
`useGlobalShortcuts()` hook" — no longer true, and it is amended in the same
commit. A single hook would mean the shell importing the viewer's find handle and
both tab strips' close paths, which is a worse coupling than two call sites
reading one map.

## Consequences

- A new dependency, pre-1.0, under the whole shortcut surface. If it breaks on a
  minor, what changes is two call-site shapes; the action list, defaults, merge
  and steal are ours and stay.
- `src-tauri` grows a menu module it did not have, and macOS users get
  `Cmd+Shift+W` for a window close they had on `Cmd+W`. That is a deliberate
  deviation from the platform, bought for a binding two users asked for twice.
- **Nothing here is provable by Playwright.** CDP keystrokes never reach Monaco
  (roadmap item 4 already records this), and `Cmd` chords are worse. Proof is
  vitest on the pure module plus the `manual-qa` lane on **both** engines: Linux
  dev is WebKitGTK, which is the engine that has already diverged on clipboard and
  zoom, and macOS is the only place the menu change can be checked.
- Adding a shortcut later is a map entry plus a call site, which is what items
  12–14 need when they bring `Cmd+P` and `Cmd+Shift+F`.
