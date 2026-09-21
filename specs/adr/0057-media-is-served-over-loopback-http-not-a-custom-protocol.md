# ADR-0057 — Media is served over loopback HTTP, not a custom protocol

**Date.** 2026-09-21
**Status.** Accepted. Supersedes
[ADR-0056](0056-the-asset-protocol-carries-media-one-file-at-a-time.md), whose
delivery mechanism cannot work on Linux. Everything else ADR-0056 decided — the
probe, the extension-first routing, the looser sniff, the one-file-at-a-time
grant — survives unchanged; only *how the bytes reach the element* is replaced.
The contract is `specs/05-features.md` F7 § "Video and audio".

## Context

ADR-0056 chose Tauri's `asset://` protocol on evidence that looked conclusive:
it parses `Range` and answers `206 Partial Content`, it needs no server, and its
scope can be granted one file at a time at runtime. Every one of those facts is
true. They are facts about the **protocol**, and the question that mattered was
whether a **media element** can load from one.

It cannot, on WebKitGTK. Measured on 2026-09-21 in a WebKitGTK 4.1 view, same
origin, with the scheme registered secure and CORS-enabled exactly as Tauri
registers it:

| request | result |
|---|---|
| `fetch('probe://localhost/clip.webm')` | `200`, all 752 bytes |
| `<video src="probe://localhost/clip.webm">` | `error` code 4, `readyState 0`, `networkState 3` (`NETWORK_NO_SOURCE`) |
| `<video src="http://127.0.0.1:8971/clip.webm">` | plays, `readyState 4`, `networkState 1` |

WebKit plays media through GStreamer, which resolves URIs with its own loader —
one that never sees the scheme handler the WebView registered. So the element
never issues a request at all.

**`fetch()` succeeding proves nothing about whether a media element can load the
same URL.** That is the trap, and it is worth writing down because it made the
failure look like a codec problem in the app: the viewer's own error card asks
the transport for a status, got `200`, and concluded the container was at fault.
It was not. `canPlayType` answers `probably` for `avc1.42E01E` and for `vp9` on
this machine, `avdec_h264` / `vp9dec` / `matroskademux` / `qtdemux` are all
installed, and the same file plays from a `file://` URL.

## Decision

**A loopback HTTP server carries the bytes, on both platforms.** Not a Linux
branch: `http://127.0.0.1` is the one transport both webviews load, and one path
that is exercised everywhere is worth more than a macOS path that only a Mac can
test. `services/media_server.rs` binds `127.0.0.1:0`, answers `GET` with an
optional `Range`, and does nothing else.

**It starts on the first media file of the run**, held in an `OnceLock` on
`AppState`. An app that never opens a video never opens a socket, and the lock
makes the race harmless — two viewers opening at once still bind once.

**Three guards, in order.** The listener is bound to loopback, so nothing off
this machine reaches it. Every request carries a per-run bearer token, checked
*before* the id is looked up, so a caller that cannot present one learns nothing
about which ids exist. And a URL names an **opaque id**, never a path — there is
no traversal to attempt, and no filesystem layout in the DOM.

**`probe_media` publishes, and nothing else does.** The verdict and the
publication remain one act, exactly as in ADR-0056; only the thing being granted
changed, from a scope entry to a table row. Publishing is idempotent by path, so
reopening a file does not grow the table.

**The response carries the type the probe sniffed.** WebKit picks its demuxer
from `Content-Type`, and `application/octet-stream` is a file it declines to
play — so the server stores the mime beside the path rather than re-sniffing or
sending a generic one.

**It is hand-rolled, with no new dependency.** One method, one path shape, no
keep-alive, no compression: about a hundred lines against a dependency the size
of hyper. The surface it does *not* have is the point of a socket that is open
while the app runs.

## Consequences

**The app now listens on a TCP port while a media file has been opened.** That
is the real cost of this decision and it should not be softened. It is loopback
and token-guarded and it serves only files a human opened in the viewer, but it
is a listening socket, and the token is what stands between another local
process and those files. The token lives in the URL, which means it is in the
DOM of the viewer's own page — acceptable because that page is ours, and it does
not survive a restart.

The socket closes with the process because the accept loop runs on Tauri's
runtime. There is no child to reap, so § "Quit guard" does not grow a case.

The viewer's error card keeps its transport check and it is now honest: a `404`
from this server means the file really has gone since the probe, because this
server is what the element actually talks to. Under `asset://` that same check
returned `200` for a request the element never made.

**macOS is unverified.** The reason to believe it works is that `http://127.0.0.1`
is ordinary to WKWebView, not a measurement — and the reason it is not a risk
worth branching for is that this is the same path Linux now exercises on every
run. A Mac check belongs in the manual QA pass, not in a `#[cfg]`.

Two mechanisms no longer exist where ADR-0056 left them: `assetProtocol` is out
of `tauri.conf.json`, the `protocol-asset` feature is off, and `mediaSrc()` is
gone from the renderer — the URL is a field on `MediaProbe`, minted by the
backend. The renderer no longer has any notion of how media is served, which is
what made replacing the mechanism a change to two files instead of ten.
