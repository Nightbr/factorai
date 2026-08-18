# ADR-0015 — Session status comes from Claude's terminal title

**Status.** Accepted (2026-08-18). Arises from
[`05-features.md` § F10](../../specs/05-features.md) (status indicators),
which this decision is the mechanism for.

## Context

factorai shows a green dot for every session with a live PTY. The dot answers
"is this connected", which is not the question anyone has. The question is
whether Claude is *doing something* or has handed back and is waiting — because
that is what decides which session you open next, and whether closing one loses
anything.

`TerminalStatus` has carried four variants since M2 — `running`, `idle`,
`waiting_input`, `stopped` — and only two were ever written. `Idle` and
`WaitingInput` appear in no assignment anywhere in the crate. The spec described
"status heuristics on a separate tokio task (200ms tick)" that does not exist.
So the state we want has never had a source, and picking one is the decision.

Claude Code is a black box we do not control and must not modify
([ADR-0004](./0004-claude-dir-is-read-only.md)). It is also updated
independently of us, frequently. Whatever we depend on has to be something it
already does, and the dependency has to fail safely when it changes.

Five candidate sources, all investigated against Claude Code 2.1.234 by reading
the shipped binary and by booting it inside a PTY and capturing raw bytes:

1. **`OSC 0` terminal title.** The CLI writes `ESC ] 0 ; <glyph> <name> BEL` and
   encodes its state in the first character: `✳` (U+2733) when idle, an
   animating `◐ ◑` while working. Captured directly:
   `✳ Claude Code` at boot, `◐ Claude Code` the instant a turn started,
   `✳ Date command` when it ended.
2. **`OSC 9;4` progress.** Real, and bracketed a turn exactly (`4;3;` then
   `4;0;`). But it is emitted only when the CLI believes it is talking to
   iTerm2 — with a clean environment, zero appeared.
3. **`OSC 777` / `OSC 9` notifications.** Carry text for permission prompts,
   plan approval and idle. Require asking for a channel via `--settings`, and
   arrive 6s (permission) to 60s (idle) late.
4. **Hooks.** `PermissionRequest`, `Notification`, `Stop` give typed events, and
   would cover sessions run outside factorai. Cannot be declared through
   `--settings`; they need a settings file we would have to write into
   `~/.claude/` or the user's repository, plus an inbound IPC channel.
5. **Transcript tailing.** Works for any session, and is the only source that can
   distinguish "finished a turn" from "asked a question and stopped". Cannot see
   a pending permission prompt at all, and lags the PTY.

## Decision

**Derive session status by parsing `OSC 0` titles out of the PTY byte stream we
already read.** Nothing is configured, nothing is written, no environment is
altered, and no cooperation is requested from the CLI beyond what it already
does unprompted.

The rule is stated so that the *idle marker* is the only enumerated value:

- title's first character is `✳` (U+2733) → `waiting_input`
- any other non-empty first character → `working`
- unparseable or absent → hold the previous state

**Enumerating the idle marker rather than the spinner is the load-bearing half
of this decision.** Any spinner glyph the CLI adopts, now or later, falls into
"working" without a change here. The inverse — enumerating spinner frames — is
what switchboard does, against braille codepoints that Claude Code no longer
emits: there is not one braille codepoint left in the binary, so that check is
dead code.

> **Factual correction, 2026-08-18** (same day, before anything was built on it).
> This paragraph originally continued "their busy state is dead on current
> versions". **That is wrong**, and the record should not carry it: switchboard
> has a *second* busy source, `OSC 9;4` progress (`main.js:1201`), so the dead
> braille check is redundant rather than load-bearing and their indicator works
> fine. Corrected in place rather than by a superseding ADR because the decision
> below is unchanged — only my description of someone else's code was wrong, and
> leaving a known-false claim in an evidence-based record is worse than a visible
> correction. The evidence still supports the decision, and arguably better: what
> their design shows is that one of two busy sources went stale silently, with the
> other covering for it. We have **one** source, so it has to be the one that
> cannot go stale. See `05-features.md` § F10 for the full mechanism.

Rejected, with the reason each one costs more than it returns:

- **`OSC 9;4` progress** would require spoofing `TERM_PROGRAM=iTerm.app` in the
  child environment — lying to every process a session spawns about what
  terminal it is in — to learn what the title states plainly.
- **`OSC 777` notifications** buy a fourth state (`needs_permission`) for a
  settings file, an env override to defeat the CLI's presence check, and 6s of
  latency. Verified working and documented in F10; additive later.
- **Hooks** would mean writing into a config we have declared read-only ground
  truth, leaking factorai's behaviour into sessions run outside it, and leaving a
  dangling command behind on uninstall.
- **Transcript tailing** is deferred with the unread axis it belongs to.

## Consequences

**Positive.**

- Zero configuration and zero writes, so the feature cannot corrupt anything and
  cannot be left behind by an uninstall. It sits comfortably inside ADR-0004.
- Event-driven off bytes already being read. No tick, no polling, no second
  watcher, no new dependency — the parser is the only new code.
- **The failure mode is the status quo.** An unrecognised title holds the previous
  state; a session that never emits one stays `working`, which is exactly the
  green dot that exists today. A future CLI can stop this feature improving the
  dot; it cannot make the dot lie.
- Platform-independent by construction, and not by luck. factorai pins
  `TERM=xterm-256color` itself, so the CLI's view of its terminal is identical on
  macOS and Linux. In the CLI the title glyphs are module constants chosen by
  `isAnimating` with no platform branch, and the writer emits
  `SET_TITLE_AND_ICON` with no `TERM`, `isTTY` or platform guard — while glyphs
  elsewhere in that same module *are* chosen per platform
  (`macos ? "⏺" : "●"`), which is what makes the absence here evidence.

**Negative.**

- **We depend on undocumented behaviour of a program we don't control.** This is
  the real cost and it should not be understated. It is mitigated by the
  inverted rule, by the degrade-to-`working` fallback, and by
  `scripts/qa/osc-probe.sh`, which reprints the OSC timeline of a real session
  so the assumption can be re-checked after any Claude update.
- **Three states is all this source can honestly support.** No `idle` distinct
  from `waiting_input`, and no `finished`. A session sitting on a permission
  prompt reports `waiting_input`, because the title says `✳` while a dialog is
  open — so it closes without a confirm. Accepted knowingly; what is lost is a
  dialog, not a transcript.
- Only sessions factorai spawned get a status. A session running in the user's
  own terminal has a title we never see.
- `TerminalStatus` changes shape: `idle` is deleted and `running` is renamed
  `working`. Renaming rather than redefining is deliberate — the meaning narrowed
  (a live PTY at the prompt is no longer "running"), and a silent redefinition
  would leave every existing reader subtly wrong.

## When to supersede this

Claude Code already contains a **structured** status protocol: `OSC 21337`
(`TAB_STATUS`), payload `indicator=#rrggbb;status=Working…;status-color=#rrggbb`,
with three states `idle | busy | waiting`. In 2.1.234 its gate is a function
compiled to `return !1` — dead code. When it ships live, supersede this ADR: it
removes the glyph rule entirely and provides `waiting` as a first-class state
rather than an inference.

## Related

- [`05-features.md` § F10](../../specs/05-features.md) — the feature, the
  colours, and the full list of what was considered and not built.
- [ADR-0004](./0004-claude-dir-is-read-only.md) — why a mechanism that writes
  nothing was preferred to hooks.
- [ADR-0005](./0005-kill-on-quit-non-optional.md) — `QuitConfirm` stays
  mandatory; only `CloseSessionConfirm` consults status.
- `specs/03-backend-rust.md` § `TerminalManager` — where the parse happens.
