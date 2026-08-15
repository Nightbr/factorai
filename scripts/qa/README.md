# `scripts/qa/` — agent-driven verification

Inspired by the reference app's `~/.local/share/qa-scripts/` (macOS
osascript wrappers), ported to Linux/X11 + GNOME.

## What works

| Script | What it does | Verified |
| --- | --- | --- |
| `launch.sh` | `pnpm tauri dev` in background, polls `wmctrl` until the window appears, writes pid to `/tmp/factorai-qa.pid` | ✓ window in ~4–10s |
| `focus.sh` | Brings factorai to the front via `wmctrl -a` | ✓ |
| `screenshot.sh OUT.png` | Captures the active window via `gnome-screenshot` (fallback: `import`, `scrot`) | ✓ |
| `geometry.sh` | Prints `WIDTH HEIGHT X Y` of the content window | ✓ |
| `kill.sh` | Descends pgrep tree from launcher pid, kills children deepest-first; sweeps stray dev factorai subtrees | ✓ exit 0, no survivors |
| `_resolve_wid.sh` | Internal helper: picks the right factorai window from `wmctrl -lG` (skips the 10×10 phantom + outer frame) | — |

## Never the release app

Every script here targets the **dev** build specifically, never "a thing called factorai". A release factorai is usually open on the same desktop — it is where the user actually works, and the `claude --resume` PTYs under it are live agent sessions, quite possibly the one driving this loop. It has the same process name and its children have the same argv, so name matching alone would put the wrong window under the cursor and the wrong process under `kill -9`.

Two markers keep them apart, and both are set by the build itself rather than configured here:

- **Window title.** A debug build titles itself `factorai DEV` in `setup()` (`src-tauri/src/lib.rs`, `#[cfg(debug_assertions)]`). `launch.sh`, `_resolve_wid.sh` and everything downstream of it match that, not a bare `factorai`. The header carries the same marker visually (`components/layout/DevBadge.tsx`) — a screenshot without the violet `DEV` pill is a screenshot of the wrong app.
- **Executable path.** A debug binary runs out of this repo's `target/`; an installed one never does. `kill.sh` resolves `/proc/PID/exe` (macOS: `ps -o comm=`) before signalling anything, and reaches `claude` PTYs only through such a parent's subtree.

This is enough to verify the **boot phase** — does the app start, does the first paint look right, do the projects appear in the sidebar. Catches `WebKitGTK / WebGL / PTY-flood` regressions in the boot path.

Use `FACTORAI_DEVTOOLS=1` before `launch.sh` to keep DevTools auto-open — handy when you want the DOM inspector available in the same session. Without the env var, devtools stay closed (cleaner screenshots).

## Synthetic input: it works here (corrected 2026-08-15)

**This section used to say the opposite.** It claimed WebKitGTK drops synthetic XTest input before React sees it, called that a deliberate anti-clickjacking feature, and built a two-option "what to do instead" on top. That is **wrong on this machine**, and it was wrong for long enough to steer QA strategy away from an approach that works.

What was actually done with plain `xdotool`, in one session: clicked the sidebar's *Add project* button, drove the GTK folder chooser it opened, clicked a file in the tree to open the viewer, clicked the viewer's zoom-in twice and read the readout change, and clicked *Copy image* and then confirmed `image/png` on the X clipboard. None of that is a window-decoration click; all of it is WebView content.

| Script | Status |
| --- | --- |
| `click.sh X Y` | ✓ reaches React |
| `key.sh KEYS` | ✓ — but focus the window first (`wmctrl -ia`) and send **without** `--window`. `xdotool key --window <id>` uses XSendEvent, which *is* filtered; plain `xdotool key` uses XTest, which isn't. That distinction is probably what the original claim was really about. |
| `type.sh "text"` | ✓ same rule as `key.sh` |

**Do not read this as "synthetic input is fine".** It is sharp in a way that has already cost something real: a stale window origin once sent a click into the user's Slack and opened an emoji picker on a live conversation. Before every click, in the same shell invocation:

1. re-resolve geometry with `xwininfo -id <wid>` — never reuse coordinates across tool calls, the window moves;
2. assert the target owns the focus. Compare **PIDs**, not window titles: `xdotool getactivewindow getwindowpid` against the dev binary's pid. A GTK dialog's autocomplete popup is a different window id with no name, so a title check fails there while a pid check holds.

When GUI verification isn't essential, prefer **Playwright against `pnpm vite:dev`** — it cannot touch anything outside its own browser. That lane is no longer "deferred, write when needed": it exists, with 75 smoke tests. `ydotool` (Linux `uinput`, needs sudo and a setuid daemon) remains unnecessary.

**A screenshot can lie about all of this.** With the screen locked, `gnome-screenshot` returns an all-black PNG and reports success. The tell is `xdotool getactivewindow` failing with `XGetWindowProperty[_NET_ACTIVE_WINDOW] failed`; check `Image.getextrema()` before trusting a capture.

## Typical loop

```bash
# Boot, capture, tear down.
scripts/qa/launch.sh
scripts/qa/screenshot.sh /tmp/qa-boot.png
scripts/qa/kill.sh
```

```bash
# With devtools for debugging.
FACTORAI_DEVTOOLS=1 scripts/qa/launch.sh
scripts/qa/screenshot.sh /tmp/qa-debug.png
scripts/qa/kill.sh
```

## Tooling deps

- `wmctrl` (X11 window management) — `apt install wmctrl`
- `gnome-screenshot` (GNOME default) — preinstalled on most GNOME distros
- `xdotool` (only useful for window decoration clicks / cursor movement) — `apt install xdotool`

Wayland users: swap `wmctrl` for `swaymsg` / `gnome-screenshot` for `grim`.
Not currently supported.
