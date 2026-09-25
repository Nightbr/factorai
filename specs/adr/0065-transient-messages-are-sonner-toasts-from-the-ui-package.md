# 65. Transient messages are sonner toasts, from `@factorai/ui`

Date: 2026-09-25

Status: Accepted. Roadmap item 7, first checkbox.

## Context

`05-features.md` § "Error UX" has assumed a toast since the MVP spec, and
`@factorai/ui` never had one. What stood in for it was `lib/errorNotice`, a
raw-DOM card that exists to report a window-level error when React may be
broken, and which calls itself a stopgap. Everything else that failed
transiently either wrote an inline message beside the control that caused it
or said nothing.

The case that forced it, 2026-09-25: the alpha channel's manifest pointed every
download at the stable release, so every install on alpha found an update, 404'd
on the download and showed nothing. The updater's own `error` phase falls back
to the idle label on purpose, and the failure reached only the console. A user
reported "it does not pick the alpha", which is what silence looks like.

Two things a toast here has to do that decided the choice:

1. **Be callable from code that is not a component.** The updater's check is a
   plain async function behind a store (ADR-0050), and so will most transient
   `AppError`s be — they surface in a mutation's `onError` or an event handler.
2. **Look like the rest of the app** (DESIGN.md): a floating surface on the
   `popover` ground, hairline border, the `-md` shadow step, and nothing else.

## Decision

**`Toaster` and `toast` are added to `@factorai/ui`, built on sonner**
(`sonner@2.0.8`, no dependencies of its own). `Toaster` is sonner's, unstyled
and given the palette's tokens through `classNames`, fixed to the dark theme
and the bottom-right corner. `AppShell` mounts the one instance. App code
imports both from `@factorai/ui`, never from `sonner`.

Sonner rather than `@radix-ui/react-toast`, although every other primitive in
the package is Radix: Radix's toast is a component tree that needs a store of
ours to be called from outside React, which is the thing sonner already is —
`toast.error()` works from anywhere once a `Toaster` is mounted. It is also
what shadcn replaced its own toast with, and the package follows shadcn's
conventions.

**The first rule of use, written with the first customer:** a toast is for a
failure someone is waiting on. The updater toasts a check that was asked for
and an install that failed after an update was found; a background lookup
that fails stays quiet, because a toast every six hours while offline is noise.
Repeats share an `id`, so a second failure replaces the first.

## Consequences

1. `lib/errorNotice` stays. It is the path that works with React broken, and a
   toast inside the React tree cannot be that. What item 7 still owes is
   routing a *mounted* app's window-level errors and transient `AppError`s
   through the toast, after which errorNotice is only the crash fallback.
2. Sonner positions its close button absolutely even when unstyled; the
   primitive overrides that with important utilities. A sonner upgrade that
   renames its data attributes shows up as a toast with no visible close, and
   the smoke test that clicks *Close toast* is what catches it.
3. A modal dialog makes the page behind it inert, so a toast raised while
   Settings is open is readable but its close button may not take the click
   until the dialog closes. It dismisses itself after ten seconds either way.
