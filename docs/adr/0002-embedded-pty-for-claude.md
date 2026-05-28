# ADR-0002 — Embedded PTY for `claude` (vs. external terminal)

**Status.** Accepted (M0, 2026-05-28).

## Context

The prior app launches `claude` inside an in-app xterm.js terminal backed
by `node-pty`. Alternatives we considered:

1. **Embedded PTY** (chosen) — `portable-pty` in Rust → xterm.js in
   webview, output streamed via Tauri events as base64 bytes.
2. **External terminal launcher only** — spawn the user's terminal
   emulator (`open -a Terminal …`, `xdg-open …`) with the right `claude`
   argv. App becomes a session browser only.
3. **Both: embedded by default, external as an opt-in** — what
   the prior app ends up doing.

## Decision

Embedded PTY is the **only** path for MVP. Reasons:

- The app's value depends on tight integration between session list,
  file preview, diff viewer, and the actual running session — they need
  to live in one window.
- An external-terminal-only mode means we can't observe the live
  session (no status indicators, no in-app fork-from-current-position).
- "Launch in external terminal" is a deferred feature
  (`specs/06-milestones.md` deferred #5), not a primary mode.

## Consequences

**Positive.**

- One unified UX. The user lives in factorai when working with Claude
  sessions; the embedded terminal is first-class.
- We control the rendering, so theme parity (light/dark) and font
  control come free.
- Streaming via Tauri events with base64-encoded bytes survives ANSI
  that breaks at UTF-8 chunk boundaries — Rust never tries to interpret
  it as text.

**Negative.**

- Users who love their terminal (Warp, Kitty, Alacritty) lose that
  workflow in factorai. Mitigation: deferred external-terminal launcher.
- xterm.js requires WebGL for good perf; users on remote desktops may
  see slowdowns. We accept this — desktop-first product.

## Related

- `specs/03-backend-rust.md` § "TerminalManager"
- `specs/04-frontend.md` § "Terminal component"
- `specs/annex-A-cli-agent-patterns.md` § A.1 (binary discovery — same
  problem space)
