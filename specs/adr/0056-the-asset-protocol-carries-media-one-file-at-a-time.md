# ADR-0056 — The asset protocol carries media, one file at a time

**Date.** 2026-09-21
**Status.** Superseded by
[ADR-0057](0057-media-is-served-over-loopback-http-not-a-custom-protocol.md) on
2026-09-21, the same day, before any release carried it. The mechanism below
cannot work on Linux: WebKitGTK's media element does not load from a custom URI
scheme, which ADR-0057 measures. Everything here that is not the *transport* —
the probe, the extension-first routing, the looser sniff, the one-file-at-a-time
grant — was carried forward unchanged. The text stands as written.

Narrows one sentence in `ImageView`'s doc comment, which
declined the asset protocol for the viewer's binary previews; images and PDFs
are unchanged and keep the base64 path. The contract is `specs/05-features.md`
F7 § "Video and audio".

## Context

Every binary preview the viewer has shipped so far crosses the IPC bridge as
base64: `read_image` caps at 16MB, `read_pdf` at 32MB, and both refuse rather
than truncate because half a PNG is not a smaller PNG. `ImageView` says why the
asset protocol was not used — *that protocol wants a static path scope and the
paths here are "whatever project you opened"* — and for a picture the bargain is
sound. A 33% encoding overhead on a file that was going to be held whole in
memory anyway buys not having a second way into the filesystem.

Video breaks every term of that bargain at once. A screen recording is routinely
larger than both caps together; base64 of it is a JavaScript string a third
larger again; and a media element does not want the whole file — it wants the
first megabyte, then whichever range the reader scrubs to. There is no version
of `read_video` that is a smaller `read_image`. A cap high enough to be useful is
a cap high enough to exhaust the renderer, and seeking is impossible before the
last byte arrives.

Tauri's asset protocol already implements what a media element needs. It parses
the `Range` header and answers `206 Partial Content` (`tauri-2.11.2`,
`src/protocol/asset.rs`), so a 2GB file seeks without a byte of range handling
from us. It is gated on the `protocol-asset` cargo feature, which
`assetProtocol.enable` in `tauri.conf.json` turns on, and on an `fs::Scope` that
`asset_protocol_scope()` hands out at runtime. Nothing about the scope has to be
static.

## Decision

**Media streams over the asset protocol. Nothing else changes.** Images and PDFs
keep `read_image` / `read_pdf` and their caps; this is a third path, taken only
by a file the viewer routed to a media element.

**The scope is granted one file at a time, by the command that validates it.**
`probe_media(path)` reads the first 512 bytes, decides whether this is media,
and only on success calls `asset_protocol_scope().allow_file(canonical)`. There
is no other command that widens the scope, so a fetchable URL is obtainable only
by asking about a real file and being told yes. The static scope in
`tauri.conf.json` is `[]` and stays `[]`.

**The granted path is canonical, and so is the path the renderer asks for.** The
protocol canonicalizes an incoming request before matching it against the scope
(`scope/fs.rs` `is_allowed`) while `allow_file` stores the pattern as it was
given, so granting a path that ran through a symlink would be granting a pattern
that can never match. `MediaProbe.path` is the canonical path for that reason,
and `mediaSrc()` may be given no other.

**Grants accumulate for the life of the process, and are never revoked.** What
the scope holds at any moment is a list of media files a human opened in this
session. Narrowing it on close is not available: Tauri's fs scope gives a
forbidden pattern permanent precedence over an allowed one, so `forbid_file` on
unmount would refuse that file for the rest of the run — including to the reader
who opens it again a minute later — and could kill a range request still in
flight.

**The sniff refuses only a positive mismatch.** `read_image` refuses every magic
it does not recognise, because a wrong guess there draws a broken-image icon and
the reader blames the app. Here a wrong guess costs nothing: the container we
failed to name is handed to a demuxer far better than ours, and when that one
also declines, the element's `error` event says so in a sentence the viewer can
print. So a container `probe_media` cannot name still plays, with the type its
extension implies; only bytes that positively identify as something *else* — a
picture, a PDF, an archive, an executable, text — are refused to the binary card.

**Routing stays extension-first**, as it is for images and PDFs, so opening a
200MB recording never reads it to find out it is not a picture. `.ts` is
deliberately not in the table: it is MPEG-TS to the rest of the world and
TypeScript to every project this app is pointed at, and `m2ts` / `mts` are the
unambiguous spellings.

## Consequences

A second way into the filesystem now exists, and it is narrower than the first:
`read_file` will read any path the renderer names, while the asset protocol will
serve only a path some earlier `probe_media` blessed. The surface worth watching
is the accumulation — a long session that opened forty videos has forty grants —
and the thing that keeps it honest is that every one of them corresponds to a
file a human clicked.

The renderer can no longer assume a preview's bytes came through `invoke`. There
are two mechanisms for the same job, and `mediaSrc()` is the seam: inside Tauri
the asset protocol, outside it a URL the smoke lane intercepts. Anything reading
a preview's bytes has to know which kind of preview it has.

`MediaProbe.mime` is weaker than `ImageContents.mime` and the types say so. One
is a promise the bytes were recognised; the other is a best effort that the
element is free to overrule. Code that treats them alike will be wrong about the
`.wmv` nobody can decode.

The asset protocol answers at most 1000 KiB per range request (`MAX_LEN`), so
playback is many small round trips rather than one long read. That is the
element's problem and it is built for it, but it does mean a profile of a
playing video shows constant protocol traffic rather than a single fetch.

Enabling `protocol-asset` adds `http-range` to the dependency tree and compiles
the asset protocol into every build, including ones with no media viewer on
screen. It is a few kilobytes and it is not optional per-window.
