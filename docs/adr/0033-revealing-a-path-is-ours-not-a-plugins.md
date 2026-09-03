# ADR-0033 — Revealing a path in the file manager is ours, not a plugin's

**Status.** Accepted (2026-09-03). Arises from
[F7](../../specs/05-features.md). Does not change
[ADR-0004](0004-claude-dir-is-read-only.md)'s read-only stance — nothing here
writes; it asks another program to show something.

## Context

The file viewer could hand a file to the application that owns its type
("Open in default app", `plugin-shell`'s `open`) and it could copy the path.
It could not answer the third question a reader has about a file on screen:
**where does this live** — the one you ask before dragging it somewhere,
attaching it, or looking at what sits beside it.

The answer is only worth having if the **file itself is selected**. Opening the
containing folder and leaving the reader to find the row again in a directory of
two hundred is most of the work still to do, and it is why this is a second
control rather than pointing the existing one at `path.parent()`.

Two ways to get there:

1. **`tauri-plugin-opener`**, whose `revealItemInDir` does exactly this and is
   maintained by the Tauri team. One JS dependency, one Rust dependency, one
   capability grant.
2. **Our own command**, per platform, in `services::reveal`.

## Decision

**Ours.** `reveal_in_file_manager(path)` — `open -R` on macOS,
`org.freedesktop.FileManager1.ShowItems` over the session bus on Linux with
`xdg-open` on the parent directory as the fallback.

Three things decided it, in this order.

**The environment a child gets is not the plugin's to fix.** Every arm of this
ends up starting a GTK application — `xdg-open` by exec'ing one, `dbus-send` by
activating one on the bus — and `services::child_env` exists because handing
one of those *our* environment is a documented, reproduced failure: under an
AppImage `LD_LIBRARY_PATH` points into a squashfs mount holding our own
WebKitGTK, and a file manager that loads it cannot find its own helper
processes. A plugin spawning a child inherits our environment and offers no
seam through which that diff reaches it. Ours applies it, through
`EnvChanges::apply_to_command` — the `std::process::Command` half of the type
the terminal already applies to a PTY builder. This is the same reason
`shell_path` exists and is the argument that would still hold if the other two
did not.

**Where the path is validated decides what a reader sees.** A file manager
handed a path that has gone opens the user's home directory on some desktops
and does nothing at all on others, and "nothing happened" is the one outcome a
reader cannot tell from a bug in this app. Owning the command puts the check in
front of the call: `InvalidInput` on a relative path, `NotFound` on a missing
one, both crossing the bridge as the `AppError` every other command speaks, so
the button can say `Reveal failed` instead of going quiet.

**It is small, and it is testable.** Two platform arms, a percent-encoder over
the path's bytes, and one `run` helper. The encoder and the validation are unit
tested; the renderer's share — the absolute path, verbatim, on the button's
click — is a smoke test, because a command going through `invoke` is recorded
by the mock bridge and `plugin-shell`'s `open` is not. `openExternally` is
untestable in browser-only mode for precisely that reason, and it was not worth
a second control also being so.

## Consequences

- **`dbus-send` is a runtime dependency on Linux**, not a build one. It ships
  in the same package as the bus this app already talks to through GTK, and its
  absence falls through to `xdg-open` rather than failing.
- **`--print-reply` is load-bearing and easy to delete by mistake.** Its output
  is thrown away. Without it the call goes out with no reply expected, a missing
  `FileManager1` is answered to nobody, `dbus-send` exits 0, and the fallback
  never runs on the desktops that need it. `--reply-timeout` is what keeps that
  wait bounded, since the name is bus-activatable and a cold file manager is a
  process start.
- **The fallback loses the selection**, which is the feature. It opens the
  parent folder, which is worth more than an error, and it is a fallback for
  that reason and not an implementation.
- **A new platform is a new arm here**, where `tauri-plugin-opener` would have
  been a version bump. v1 is macOS and Linux (§ "What this project does not
  do"), so that cost is two arms and not three.
- **`child_env` has a second consumer**, which is the right pressure on it: the
  AppImage strip was reasoned about for a PTY and is now applied to a plain
  child, and its own tests already drive it against both.
- If a future surface needs *open*, *reveal* and *show in browser*, the plugin
  becomes the better trade and this should be superseded rather than extended
  one arm at a time.
