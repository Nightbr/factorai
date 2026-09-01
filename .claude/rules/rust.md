---
paths:
  - "apps/desktop/src-tauri/**"
---

# Backend traps

- One module per command domain (`commands/sessions.rs`, `commands/terminal.rs`,
  …). Don't dump everything in `lib.rs`.
- Long-lived state goes in `tauri::State<AppState>`. Hot-path locks use
  `parking_lot` or `dashmap`; tokio mutexes only for genuinely async code.
- Commands return `Result<T, AppError>` — a `thiserror` enum that serializes to a
  tagged union on the TS side (`specs/03-backend-rust.md` § "Errors"). `anyhow`
  inside command bodies. Never `unwrap()` outside `setup()`.
- PTY output is base64-encoded **bytes**, not UTF-8 strings — Claude's ANSI
  breaks at UTF-8 chunk boundaries.
- Kill-on-quit is wired through both an explicit `kill_all()` and `Drop` on the
  terminal manager (`specs/05-features.md` § "Quit guard"). No orphan zombies.
- GUI-launched processes don't inherit shell PATH on macOS. Use
  `find_claude_binary(override)` with login-shell fallback (annex A.1). The
  override is the user's setting and every caller passes it — a probe that
  ignores it is how the settings page reports "not installed" for the binary
  sessions are spawning from.
- **Env leaks both ways.** Turborepo 2.x strips anything not in
  `globalPassThroughEnv`, and `linuxdeploy`'s `AppRun` prepends or replaces a
  dozen vars that every child process then inherits. `services/child_env` strips
  the AppImage set on the way into a PTY. "Works when I run the binary directly,
  not under `pnpm dev`" is almost always a stripped env — compare
  `/proc/<pid>/environ` against your shell before blaming the app.
  `env | grep -c .mount_` should print `0`.
- **`cargo test` runs `tests/*.rs`; a filtered run does not.** `--lib`, `-p`, or
  a name filter runs only the in-crate unit tests and omits the integration
  targets while still printing `ok`, so the gate is the plain command. Triage a
  failure with `--no-fail-fast` — cargo stops at the first red binary and hides
  the rest. See the `quality-gate` skill.

Longer form, including the two bugs behind the env rule: the
`backend-conventions` skill.
