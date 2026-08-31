---
name: backend-conventions
description: Rust/Tauri house rules — command module layout, AppState and lock choice, anyhow-inside/thiserror-at-the-boundary errors, base64 PTY bytes, kill-on-quit — plus the hand-mirrored IPC types and the macOS/Linux Tauri gotchas (PATH, stripped env under turbo, AppImage env leaking into children). Use before writing Rust, adding a Tauri command, or debugging "works when I run the binary directly, not under pnpm dev".
---

# IPC and types

- All cross-boundary types live in `packages/types`. Rust structs derive
  `serde::Serialize`/`Deserialize` with `#[serde(rename_all = "camelCase")]`.
  TS types are hand-written to match.
- No code generation (no Specta, no tauri-bindgen). Plain hand-mirrored types.
  If the two sides drift, that's a bug we want to catch in review, not at
  runtime.
- Tauri commands return `Result<T, AppError>`. `AppError` is a `thiserror` enum
  with `serde::Serialize` that becomes a tagged union on the TS side. See
  `specs/03-backend-rust.md` § "Errors".

# Backend

- One module per command domain (`commands/sessions.rs`, `commands/terminal.rs`,
  ...). Don't dump everything in `lib.rs`.
- Long-lived state goes in `tauri::State<AppState>`. Hot path locks use
  `parking_lot` or `dashmap`; tokio mutexes only for genuinely async code.
- Errors: `anyhow` inside command bodies, `thiserror` `AppError` at the command
  boundary. Never `unwrap()` outside `setup()`.
- PTY output is base64-encoded **bytes**, not UTF-8 strings — Claude's ANSI
  breaks at UTF-8 chunk boundaries.
- **Kill-on-quit is non-optional** and wired through both an explicit
  `kill_all()` and `Drop` on the terminal manager. See `specs/05-features.md`
  § "Quit guard". No orphan zombies, ever.

# Tauri gotchas (macOS + Linux)

- GUI-launched processes don't inherit shell PATH on macOS. Use
  `find_claude_binary(override)` with login-shell fallback (see
  `specs/annex-A-cli-agent-patterns.md` § A.1). The override is the user's
  setting and every caller passes it — a probe that ignores it is how the
  settings page comes to report "not installed" for the binary sessions are
  spawning from (F11).
- **Preferences go in one of three places, and "who reads this?" decides**
  (ADR-0013): layout you dragged in `panelStore`/`sidebarStore`/`zoomStore`,
  preferences the renderer alone reads in `prefsStore`, anything **Rust** reads
  in the SQLite `settings` table. All three localStorage stores are synchronous
  on purpose. `tauri-plugin-store` was the documented answer and is **removed** —
  it is async, so every persisted value flashed its default for a frame.
- The DevTools window is enabled via the `devtools` cargo feature on Tauri 2;
  it's already on in our `Cargo.toml`.
- **Turborepo 2.x runs tasks in strict env mode**, so anything not in
  `globalPassThroughEnv` is stripped before the app ever starts. Under
  `pnpm dev` the app saw 15 env vars instead of 74. That broke "open in default
  app" and every external link on Linux: with `XDG_DATA_DIRS` unset, `xdg-open`
  falls back to `/usr/local/share:/usr/share`, can't see desktop files exported
  by Flatpak or snap, and drops through to its hardcoded `x-www-browser` chain —
  so links opened whatever `update-alternatives` points at rather than your
  actual default browser. `turbo.json` now passes the XDG/desktop-integration
  vars through. Symptoms of this class ("works when I run the binary directly,
  not under `pnpm dev`") are almost always a stripped env — compare
  `/proc/<pid>/environ` against your shell before blaming the app.
- **The AppImage is the mirror image of that bug.** `linuxdeploy`'s `AppRun`
  prepends `$APPDIR/…` to `PATH`, `LD_LIBRARY_PATH`, `XDG_DATA_DIRS`,
  `PYTHONPATH`, `PERLLIB`, `QT_PLUGIN_PATH` and the `GST_*` pair, and *replaces*
  `PYTHONHOME` and the `GTK_*` / `GIO_*` / `GDK_*` set outright. Every process
  the app spawns used to inherit that, so a `claude` session started from a
  release build could not run `python3` (`No module named 'encodings'`) or any
  other GTK binary. `services/child_env` strips it on the way into a PTY — see
  `specs/03-backend-rust.md` § `TerminalManager`. **This also applies to you**:
  an agent session running inside the release app has that env, so `pnpm dev`
  dies with a `WebKitNetworkProcess` spawn error until you clear it.
  `env | grep -c .mount_` is the tell, and **expect zero**.
- **If it is not zero, note which mounts** before working around it. Until
  2026-08-20 the strip matched only `$APPDIR` — the mount the app itself runs
  from — so a factorai launched from inside an older factorai passed the *older*
  mounts straight through to every session. Three mounts existed on the machine,
  one was stripped, two leaked, and `pnpm dev` died from a build that already
  had the module. The rule now also matches any `.mount_*` path component, so a
  leak is a new bug rather than that one; the workaround is `env -u` the
  poisoned vars and filter `.mount_` out of `PATH` / `XDG_DATA_DIRS` rather than
  unsetting those wholesale.
