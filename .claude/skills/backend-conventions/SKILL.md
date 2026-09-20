---
name: backend-conventions
description: Rust/Tauri house rules — command module layout, AppState and lock choice, anyhow-inside/thiserror-at-the-boundary errors, base64 PTY bytes, kill-on-quit — plus command vs event vs spawn_blocking, AppHandle::emit, capabilities and plugins, the hand-mirrored IPC types, and the macOS/Linux Tauri gotchas (PATH, stripped env under turbo, AppImage env leaking into children, WebKitGTK divergences). Use before writing Rust, adding a Tauri command, event, plugin or capability, or debugging "works when I run the binary directly, not under pnpm dev".
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

# Commands, events, blocking work

- **Request/response is a command; backend-initiated is an event.** A command
  returns `AppResult<T>`. Anything the backend pushes on its own (watcher
  change, scan progress, PTY data) is an event with a `camelCase` payload
  mirrored in `packages/types`, same as a command's return type.
- **`AppHandle::emit`, never `Window::emit`.** A window-scoped emit does not
  reach JS listeners in this app (see the comment in `commands/files.rs`).
  Emits are best-effort: `let _ = app.emit(...)`, not `?` and not `unwrap()`.
- **Sync C or CPU work goes through `spawn_blocking`.** An `async fn` command
  that calls libgit2, hashes a tree or walks a big directory blocks the
  runtime thread and the UI with it. Wrap the work in
  `tauri::async_runtime::spawn_blocking`, map the join error to
  `AppError::Process`, and let the inner `AppResult` through — `commands/git.rs`
  is the template. Plain `async` is for awaitable I/O only.
- **Never hold a lock across an await or a child `wait()`.** The terminal
  manager once held `child.lock()` across `wait()` and deadlocked the GTK main
  thread; the UI froze with no error anywhere. Take the lock, copy what you
  need, drop it, then wait.
- **A serde panic on `invoke()` is a missing derive.** Every type that crosses
  the boundary derives `Serialize`/`Deserialize` with
  `#[serde(rename_all = "camelCase")]`; no code generation, so the TS mirror is
  hand-written in the same commit.

# Capabilities and plugins

- Permissions live in `capabilities/default.json`, scoped to the `main`
  window. A plugin command failing with "not allowed" or "capability not
  granted" means the permission is missing there. Add the single `allow-*`
  the webview needs rather than a plugin's `default` set when one permission
  is enough.
- Only the webview's direct plugin calls need a permission. `std::fs`,
  `reqwest`, rusqlite inside a command need nothing in the capability file.
- Registered plugins: dialog, fs, process, shell, updater, clipboard-manager.
  A new plugin is a new permission surface and a new binary dependency — it
  needs an ADR. `tauri-plugin-store` and `tauri-plugin-sql` are out on
  purpose; storage is rusqlite through `db/`.
- A second window gets its own capability file listing only what that window
  needs; it does not reuse `default`.

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
- **The renderer is WebKitGTK on Linux and WKWebView on macOS, not Chromium.**
  Things that differ from what Playwright's Chromium shows: `navigator.clipboard
  .writeText` throws `NotAllowedError` in WebKitGTK, so text copies go through
  the clipboard plugin; the native context menu is suppressed only in the
  chrome, and the terminal keeps its live Paste entry; zoom and rendering bugs
  reproduce only in the real engine. Verify renderer-facing backend changes in
  the real window (`manual-qa`), not only in `pnpm e2e`.
