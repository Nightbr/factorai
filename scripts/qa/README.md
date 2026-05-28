# `scripts/qa/` — agent-driven verification

Inspired by tolaria's `~/.openclaw/skills/tolaria-qa/scripts/` (macOS
osascript wrappers), ported to Linux/X11 + GNOME.

## What works

| Script | What it does | Verified |
| --- | --- | --- |
| `launch.sh` | `pnpm tauri dev` in background, polls `wmctrl` until the window appears, writes pid to `/tmp/factorai-qa.pid` | ✓ window in ~4–10s |
| `focus.sh` | Brings factorai to the front via `wmctrl -a` | ✓ |
| `screenshot.sh OUT.png` | Captures the active window via `gnome-screenshot` (fallback: `import`, `scrot`) | ✓ |
| `geometry.sh` | Prints `WIDTH HEIGHT X Y` of the content window | ✓ |
| `kill.sh` | Descends pgrep tree from launcher pid, kills children deepest-first; sweeps orphan `claude --resume` PTYs | ✓ exit 0, no survivors |
| `_resolve_wid.sh` | Internal helper: picks the right factorai window from `wmctrl -lG` (skips the 10×10 phantom + outer frame) | — |

This is enough to verify the **boot phase** — does the app start, does the first paint look right, do the projects appear in the sidebar. Catches `WebKitGTK / WebGL / PTY-flood` regressions in the boot path.

Use `FACTORAI_DEVTOOLS=1` before `launch.sh` to keep DevTools auto-open — handy when you want the DOM inspector available in the same session. Without the env var, devtools stay closed (cleaner screenshots).

## What does NOT work

| Script | What it claims | Reality |
| --- | --- | --- |
| `click.sh X Y` | Click inside the factorai window | **The cursor moves to the right pixel and X11 receives the event, but WebKitGTK drops synthetic XTest input before React sees it.** Works for X11 surfaces (the window decoration buttons), does NOT work for WebView content. |
| `key.sh KEYS` | Send keystrokes | Same story — X11 sees them, WebKit's content area doesn't. |
| `type.sh "text"` | Type text | Same story. |

This is a deliberate WebKitGTK security feature (anti-clickjacking from other X11 apps). `xdotool` uses XTest events, and WebKit filters them.

### To actually drive the React UI from a script you have two options

1. **Playwright against `pnpm vite:dev`** (the planned path — same as tolaria). The renderer already has a mock Tauri bridge in `apps/desktop/src/lib/tauri.ts` via `isTauri()` + `mockInvoke()`, so vite-only mode boots cleanly with no Rust. Smoke tests can use Playwright's real DOM events which the browser engine accepts. **Deferred — write when needed.**
2. **`ydotool`** — uses Linux `uinput` (kernel device), which WebKit doesn't filter. Requires `sudo` to install + a setuid daemon. Useful for native-app verification specifically.

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
