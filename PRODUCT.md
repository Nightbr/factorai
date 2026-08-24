# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers who already run the official `claude` CLI and now spend most of their
day supervising it rather than typing code themselves. factorai is a public
product for those developers, not a personal tool with a public repo: someone
who has never seen it should be able to open it, find their projects, and
understand what each session is doing without being told.

The primary situation is a long-running one. The window stays open all day, next
to one or more live agent sessions, and the user moves between three jobs:

- **Watching** — which sessions are working, which are waiting on them, which
  stopped.
- **Checking** — what the agent actually changed, in the diff and the commit
  graph, before trusting it.
- **Steering** — launching, resuming, killing sessions, and (not yet built)
  editing the `CLAUDE.md` and `.claude/plans/` files that set the rules the
  agent runs under.

Sessions belong to projects, which are folders under `~/.claude/projects/`
decoded back to real paths. A single user may have dozens of projects and
hundreds of sessions, so scale in the sidebar and in search is a real condition
of use, not an edge case.

## Product Purpose

factorai is an **ADE — an Agentic Development Environment**. One place to build
software with agents, rather than an editor with an agent bolted into a pane.

An IDE is arranged around a cursor: it opens one file at a time and the agent's
process is a rectangle at the bottom of the screen. That arrangement assumes the
human is the one typing. When the agent writes most of the code, the assumption
is wrong and everything built on it is subtly in the way. So the unit of work
here is a **session**, not a file. Reading code is something you do to *check on*
the work, which is why it sits beside the terminal rather than in place of it.

Success is that a developer supervising several agents at once always knows,
without hunting, which one needs them next — and can review what any of them did
without leaving the app.

## Positioning

**Agents are at the centre; the human supervises, decides, reviews, and sets the
rules agents run under.** Those four verbs are the position, and they are a
usable test for any proposed feature: which one does it serve, and does it take
any of them away from the human?

What a neighbouring product could not truthfully copy without becoming this one:

- **Session-first, not file-first.** The primary object is a live process with a
  status, a transcript and a terminal, not a buffer.
- **An agent-centred app where the human is still present.** Every irreversible
  action keeps its confirmation — closing a tab kills a session and asks,
  quitting with live sessions asks, restarting to update asks. "The agent
  already did it" is never a reason to skip asking.
- **It reads the CLI's own files.** No sync layer, no accounts, no re-implemented
  agent. It attaches to `~/.claude/` and to the `claude` binary the user already
  has logged in.

## Operating Context

- **Where it runs.** A native desktop app: Tauri 2 (Rust) shell around a React 19
  renderer. macOS and Linux only for v1. Everything is local; there is no server.
- **What it reads.** `~/.claude/projects/` for projects and session transcripts,
  the user's git repositories for the changes and commit graph, and the `claude`
  binary itself for launching and resuming.
- **Sessions.** Launched as `claude --session-id <id>` and resumed with
  `--resume <id>`; factorai assigns the id. The terminal is xterm.js in the
  webview with a real PTY in Rust behind it. Status — working / waiting /
  stopped — is derived from the terminal title.
- **A day of use.** The app is opened once and left open. Sessions outlive
  individual glances at the window, so state that changes while the user is not
  looking has to be legible the moment they look back.
- **Review, not editing.** Git state is read-only by decision: the agent writes
  and the human checks.

## Capabilities and Constraints

**Built today.** Project list decoded from `~/.claude/projects/`; per-project
session browser with title, last activity and turn count; full-text search across
session content (SQLite FTS5); embedded terminal with one tab per session,
reorderable; launch / resume / kill; per-session status in the sidebar, tabs and
project rows; file tree and file preview (Monaco); diff viewer, changes panel and
commit graph with a lane rail; checkout picker; image, PDF and Markdown preview;
settings; auto-updates; dev-build marker.

**Known gap.** Editing `CLAUDE.md` and `.claude/plans/` per project is the
human's only lever on agent behaviour and is the one thing in the positioning
table that is not built yet. Treat it as the thinnest of the four verbs.

**Constraints future work must respect.**

- Read-only on the agent's own state (`~/.claude/`) and on git. The app observes;
  the agent writes.
- Kill-on-quit is non-optional — no orphaned agent processes, ever.
- No cloud sync, no accounts, no telemetry, no analytics, no crash reporting.
- English only; no localization in v1. No Windows in v1.
- Specifically the official `claude` CLI, not a multi-provider session manager.
  There is a real tension between that and the broader "build software with
  agents" framing; it is named deliberately rather than resolved, and holds until
  revisited on purpose rather than by drift.
- Terminal output never passes through React state — it streams from events into
  xterm directly. Anything that would put PTY data in a component is out.
- Dozens of projects and hundreds of sessions are normal. Design for that count,
  not for the screenshot count.

**Terminology.** *Session* — one `claude` process and its transcript. *Project* —
a folder in the workspace. *Checkout* — a branch, tag, detached commit or
worktree; a worktree is a checkout, not a project. *Lane* — a column in the
commit graph rail.

## Brand Commitments

Binding, and recorded in `specs/09-branding.md`:

- **The mark and the amber.** The notched dark housing with the amber `F`, built
  on a 16 × 16 cell grid, with the six ports cutting to transparency. `#FFB020`
  is the brand amber and the app's accent; the app was moved to match the mark,
  not the reverse. `docs/brand/factorai-icon.svg` is the master every shipped
  icon derives from.
- **Dark-first, and two type sizes.** The dark theme is the product's identity,
  not a mode. Type has exactly two steps — `text-sm` for anything you read to
  navigate, `text-xs` for metadata, status and section headers — and there is
  deliberately no third.
- **Density and chrome rules.** 28px menu rows, chrome rows with explicit heights
  rather than heights derived from their tallest child, and icon buttons that
  paint no background — their hover state is the icon taking colour.

The product is named `factorai` (`dev.factorai`), deliberately not branded as
the prior app, the project it was originally modelled on.

## Evidence on Hand

- `specs/` — nine numbered specs plus two annexes; the design source of truth for
  behaviour, including `09-branding.md` for the mark.
- `docs/adr/` — twenty ADRs recording decisions that constrain the approach.
  ADRs are immutable and superseded, never edited.
- `docs/brand/` — the icon master, the one-colour mark, raster masters and the
  lockup.
- `specs/roadmap/TODO.md` and `DONE.md` — sequencing and a dated log of what
  landed, with the gotchas found on the way.
- The running app itself, launchable with `pnpm dev` or via `scripts/qa/`.

**No marketing surface exists yet** — no landing page, no screenshots-as-assets,
no testimonials, customers, benchmarks or press. None may be invented.

## Product Principles

1. **The session is the unit of work.** Files, diffs and commits exist to check
   on a session, and are arranged beside it rather than in place of it.
2. **Nothing important happens off-screen.** If a session's state changed while
   the user was elsewhere, the interface says so where they will next look.
3. **The human keeps every irreversible decision.** Confirmations are the
   product, not friction to be optimised away.
4. **Observe, don't overwrite.** The app reads the agent's world and the
   repository; it does not quietly write to either.
5. **Built for the all-day window.** Calm at rest, legible at a glance, and
   honest about scale — hundreds of sessions is the normal case.

## Accessibility & Inclusion

No standard has been established yet. This is explicitly undecided rather than
declined: a conformance target (WCAG level, contrast auditing, focus
requirements) is a decision still to make.

One rule is already in force from the code, and it is a floor, not a standard:
**every gesture ships a keyboard path beside it** — a feature only a mouse can
reach is half a feature.
