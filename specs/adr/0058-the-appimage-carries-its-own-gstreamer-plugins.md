# ADR-0058 — The AppImage carries its own GStreamer plugins

**Date.** 2026-09-22
**Status.** Accepted. Extends
[ADR-0057](0057-media-is-served-over-loopback-http-not-a-custom-protocol.md),
which fixed how the bytes reach the element; this one is about whether the
element can decode them once they do. The contract is `specs/05-features.md`
F7 § "Video and audio".

## Context

Opening a video froze the app. Not in `pnpm dev` — there it plays, which is why
the feature shipped — but in the released AppImage, where the window went dead
on the first `<video>` and had to be killed.

The journal from a 0.47.0 run says it in three lines:

```
factorai_lib::services::media_server: media server listening port=45215
GStreamer element autoaudiosink not found. Please install it
WebKitWebProces[251147]: g_signal_connect_data: assertion 'G_TYPE_CHECK_INSTANCE (instance)' failed
```

An element WebKit asked for came back `NULL`, WebKit connected a signal to it
anyway, and the web process took the window with it. Nothing in this repository
is in that path: the media server answered, the probe answered, the URL was
right. **The AppImage had no GStreamer plugins in it at all.**

It had the *library*. `linuxdeploy` bundles WebKit — `libwebkit2gtk-4.1.so.0` is
in `usr/lib` — and with it every shared object WebKit links, including
`libgstreamer-1.0.so.0`. It does not bundle plugins, because nothing links
them: they are opened at runtime.

That alone would have been survivable, because the host's plugins sit in
`/usr/lib/x86_64-linux-gnu/gstreamer-1.0` and GStreamer's compiled-in default
points there. It is not survivable because **GStreamer relocates**. Since 1.18
it calls `dladdr()` on itself and derives the plugin directory from wherever the
library was loaded from, which inside an AppImage is the mount:

```
GST_REGISTRY gstregistry.c:1605: attempting to retrieve libgstreamer-1.0 location using dladdr()
GST_REGISTRY gstregistry.c:1625: real directory location: /tmp/.mount_FactoraPPOmD/usr/lib
```

`/tmp/.mount_…/usr/lib/gstreamer-1.0` does not exist. So the search finds
nothing, and every element is missing — not only `autoaudiosink` but
`qtdemux`, `matroskademux`, `avdec_h264`, `appsink`, the lot.

Reproduced outside the app, with the host's own `gst-inspect-1.0` and nothing
changed but one variable:

| command | result |
|---|---|
| `gst-inspect-1.0 appsink` | `Factory Details: … AppSink` |
| `LD_LIBRARY_PATH=$APPDIR/usr/lib gst-inspect-1.0 appsink` | `No such element or plugin 'appsink'` |
| `LD_LIBRARY_PATH=$APPDIR/usr/lib GST_PLUGIN_SYSTEM_PATH=/usr/lib/x86_64-linux-gnu/gstreamer-1.0 gst-inspect-1.0 appsink` | `Factory Details: … AppSink` |

**This is why the dev build was never going to catch it.** `pnpm dev` runs the
binary against the host's libraries, so `libgstreamer-1.0.so.0` relocates to
`/usr/lib/x86_64-linux-gnu` and finds everything. The bug exists only in the
bundle, and only the bundle can show it. The same is true of `pnpm e2e`, which
is Chromium, and of `cargo test`, which never opens a webview.

## Decision

**The AppImage bundles the plugins beside the library that looks for them.**
`bundle.linux.appimage.bundleMediaFramework` in `tauri.conf.json`, which runs
`linuxdeploy-plugin-gstreamer` during the bundle: it copies the build host's
`gstreamer-1.0` directory into `$APPDIR/usr/lib/gstreamer-1.0` — exactly where
the relocated library already looks — copies `gst-plugin-scanner` beside it,
patches the plugins' rpaths to `$ORIGIN/..`, and writes an AppRun hook exporting
`GST_PLUGIN_SYSTEM_PATH_1_0`, `GST_PLUGIN_PATH_1_0` and `GST_PLUGIN_SCANNER_1_0`
at those paths. Costs 15–35MB.

**The release runner is the bill of materials.** The plugin copies what the
machine it runs on happens to have and checks nothing, so a runner without
`gstreamer1.0-plugins-good` produces a bundle that cannot demux an `.mp4` and
says so only when a user opens one. `release.yml` therefore installs
`gstreamer1.0-plugins-base`, `-good`, `-bad` and `gstreamer1.0-libav`, and then
**asserts the elements exist before building** — `appsink`, `autoaudiosink`,
`qtdemux`, `matroskademux`, `mpegtsdemux`, `avdec_h264`, `vp9dec`,
`mpegaudioparse` — so a renamed package fails the release rather than the
viewer.

`-ugly` is deliberately not installed. Its contents are encoders and patent
encumbrance this app has no use for, and the plugin has no filter — everything
in the directory ships.

## Consequences

**The bundle grows by 15–35MB**, on an artifact that is already ~87MB because it
carries WebKit. A media viewer that cannot decode media is not worth the
saving.

**What plays is now the build host's answer, pinned at release time**, not the
user's. A user with `gstreamer1.0-libav` installed no longer lends it to the
app, and one with nothing installed no longer loses anything. This is the usual
AppImage bargain and it cuts both ways; it is the same bargain already struck
for WebKit itself.

**`.deb` would not have had this problem** — apt's dependencies would have
pulled the plugins in and nothing would relocate. It is still not shipped, for
the reason `release.yml` gives: the updater can replace an AppImage in place and
cannot replace a `.deb`.

**No gate catches this class.** Every check in the repository's test lanes
passes against a broken bundle, because none of them run one: the smoke suite is
Chromium, `cargo test` never opens a webview, and manual QA drives `pnpm dev`
against the host's libraries. The only thing that catches it is opening a video
in the built AppImage, which is why the CI check above is an assertion rather
than a comment.

**WebKit's own crash is not fixed by this**, only avoided. A missing element
still makes `webkit2gtk` dereference `NULL` and take the web process down, so
any future bundle that drops a plugin fails the same violent way rather than
reaching `MediaView`'s error card. The card handles a container WebKit declines;
it cannot handle a WebKit that is not there to decline it.
