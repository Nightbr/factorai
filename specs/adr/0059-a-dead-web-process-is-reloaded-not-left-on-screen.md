# ADR-0059 — A dead web process is reloaded, not left on screen

**Date.** 2026-09-22
**Status.** Accepted. Follows
[ADR-0058](0058-the-appimage-carries-its-own-gstreamer-plugins.md), which fixed
the packaging fault that exposed this one. The contract is
`specs/05-features.md` F7 § "Video and audio" and F17.

## Context

ADR-0058 is about a bundle that shipped without GStreamer plugins. This is about
what that did to the window, which is the part a user actually experienced:

> opening a video file is completely freezing the app

It was not a freeze. WebKit runs the page in a **separate process**, and that
process died — `webkit_web_view_reload`'s own reason code says
`WEBKIT_WEB_PROCESS_CRASHED`. Ours carried on perfectly: every PTY still
running, every IDE bridge still bound, the database still open, the window still
accepting clicks and painting the last frame the dead process left behind. From
the outside that is indistinguishable from a hang, and the only way out was to
kill the app — taking every live agent with it, which is the actual damage.

Measured on 2026-09-22, in a WebKitGTK 4.1 view with its plugin path pointed at
an empty directory:

| | plugins present | no plugins |
|---|---|---|
| `canPlayType('video/mp4; codecs="avc1.42E01E"')` | `probably` | `` |
| `canPlayType` for mp4 / webm / mpeg / wav | `maybe` | `` |
| mounting `<video>` | plays | `g_signal_connect_data` assertion, process **crashes** |
| `web-process-terminated` | never | fires, reason `CRASHED` |
| reloading the view afterwards | — | recovers, JS runs again |

Two things in that table decide this ADR. **There is no error event** — the
element cannot report a failure from a process that is no longer there, so
`MediaView`'s error card, which is good at a container WebKit declines, has
nothing to work with. And **the crash is announced and the recovery works**.

## Decision

**Two layers, because either alone is wrong.**

**1. Do not hand a `<video>` to a webview that has no decoders.** `MediaView`
asks `canPlayType` for five types any working build recognises, and renders its
existing failure card — with a sentence blaming the build rather than the file —
only if *all* of them come back empty. This is a check on the **webview**, never
on the file: `.mkv` answers empty on a healthy WebKitGTK and plays anyway
(ADR-0057), so a per-file check would ground the one format F7 was written for.
The check fails open, is asked once per run, and is `lib/mediaSupport.ts`.

**2. Reload a web process that dies anyway.** `services/webview_health.rs`
connects WebKitGTK's `web-process-terminated` and reloads the view. Not
media-specific on purpose — an out-of-memory renderer ends the same way, and a
recovery that only understood codecs would be the wrong shape for the next
cause. At most three reloads in sixty seconds: past that the crash is recorded
and the window is left alone, because a page that crashes *while loading* would
otherwise flicker forever and a dead window a human can close is better than one
they cannot.

**3. Say so.** A reload costs the reader the open file, the scroll position and
the front tab, and an app that throws those away in silence has done something
inexplicable. `webview_crash_notice` is **asked** by the renderer on boot rather
than emitted at the crash — at the moment of the crash there is no renderer to
emit to, and an emit after the reload races the listener being registered. The
sentence leads with what survived, because that is the reader's real question:
the sessions kept running.

Linux only for layer 2. `WKWebView` reports the same thing through
`webView:webContentProcessDidTerminate:`, which wry does not surface; the
command still exists on macOS and always answers `None`, which is one shape for
the renderer rather than two.

## Consequences

**A crash is now a blink rather than a dead app.** The renderer's own state is
gone, which is a real cost and a visible one — but `terminal_list` already
re-adopts every live PTY on boot, so what comes back is the app with its agents
in it.

**The preflight can be wrong in one direction only.** If a webview somehow
answers empty for all five canaries and *could* have played the file, the reader
gets a card and an **Open in default app** instead of a player. That is a bad
afternoon; mounting the element in the other direction is a killed window. The
check is deliberately biased that way and the test names the `.mkv` case it must
never catch.

**Neither layer fixes WebKit.** A missing element still dereferences `NULL`
inside `webkit2gtk`. Layer 1 keeps us from asking it to, layer 2 survives the
cases we did not anticipate, and neither is a substitute for ADR-0058's bundle.

**`webkit2gtk` is now a direct dependency**, Linux-only, pinned to the version
wry already builds — the `WebView` that `with_webview` hands over is that
crate's type, so a different major would not unify. It is not a new library in
the binary: WebKitGTK was always linked.

**The smoke lane can test layer 1 and not layer 2.** Chromium always has
decoders, so the test takes `canPlayType` away with an init script; a dead web
process has no Chromium equivalent worth faking. Layer 2's policy — how many
reloads, and that a refused reload still leaves a notice — is unit-tested in
Rust, and the signal path itself was verified by killing `WebKitWebProcess`
under the running app.
