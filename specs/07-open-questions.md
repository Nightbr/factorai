# Open questions — resolved

All 13 questions from the first planning pass have been resolved. This
file is now a decisions log; new questions get appended at the bottom
as we learn things during implementation.

---

## Q1 — Windows PTY support → **dropped**

**Decision.** macOS + Linux only for v1. Windows is moved to the
deferred list in `06-milestones.md`. We don't actively break Windows
code paths (we use `portable-pty`, `dirs`, etc.), but we don't test or
ship for it. Saves a class of PTY behavior + path encoding edge cases.

---

## Q2 — Claude binary discovery → **three-tier probe, modeled on the reference app**

**Decision.** Port the discovery pattern from
[the reference app's claude_cli.rs](https://github.com/example/repo).
Three tiers, in order:

1. `which claude` in the inherited process PATH.
2. User's login shell — `$SHELL -lc 'command -v claude'`, then
   `/bin/zsh`, then `/bin/bash`. Required because macOS GUI launches
   don't inherit a terminal PATH (homebrew, mise, asdf shims).
3. Probe a known list of candidate paths (homebrew, npm-global, mise,
   asdf, nvm versions, `.local/bin`, `.claude/local`).

Validate by running `claude --version` with a 2s timeout. Cache the
result in the `settings` table. Full implementation sketch lives in
`03-backend-rust.md`.

---

## Q3 — `~/.claude/` location → **respect `CLAUDE_HOME`, no settings UI**

**Decision.** Read `CLAUDE_HOME` env at boot; fall back to
`dirs::home_dir()/.claude`. No `claudeProjectsDir` override in the
settings UI for MVP. Adding one later is trivial — the path is read in
one place (`claude_dir()` helper).

---

## Q4 — Encoded-path collision → **disambiguate via `cwd` from JSONL**

**Decision.** The mapping `path → directory name` Claude uses is
lossy. We resolve the real path **authoritatively** from the first
event's `cwd` field in any session under that project directory. The
character-substitution decoding is only used as a last resort when no
session has been recorded yet (empty project dir). Result is cached in
`projects.real_path`.

Practical implication: when scanning a new project dir, read the first
JSONL line of the first session file, extract `cwd`, persist. Done in
the indexer.

---

## Q5 — Indexer freshness → **debounce, suffix-read**

**Decision.** 1s debounce per file in the watcher. When the debounce
fires, read only the new suffix (offset = previous size) and append to
FTS. Full re-parse only happens on cold scan or when `(mtime, size)`
went backwards (truncation / replacement).

---

## Q6 — In-app vs. external terminal → **in-app default, external deferred**

**Decision.** Embedded xterm is the only path for MVP. "Launch in
external terminal" is a deferred feature (see `06-milestones.md`
deferred #5). Not a blocker, not P0.

---

## Q7 — JSONL parsing → **schema documented in 02-data-model.md**

**Decision.** Schema reverse-engineered and documented in
`02-data-model.md` § "Session JSONL format" with the explicit caveat
that Anthropic doesn't publish it. Rust parsing uses a tolerant
struct with `#[serde(flatten)]` for unknown fields and
`serde_json::Value` for content blocks. Unknown event types render as
collapsed JSON cards.

---

## Q8 — xterm themes → **2 themes only (light + dark)**

**Decision.** Ship just light and dark, synced to the app theme via a
small `palette → xterm theme` mapper. No theme picker, no custom
themes. Keep it simple.

---

## Q9 — Single-window vs. multi-window → **single for MVP**

**Decision.** One window. Multi-window is on the deferred list (#6)
as a follow-up for power users with many parallel agents.

---

## Q10 — Process orphans on quit → **always kill, confirm dialog**

**Decision.** Kill-on-quit is **non-optional and not configurable**.
On window close with live PTYs:

1. Tauri intercepts `CloseRequested`.
2. Frontend shows a confirm dialog: *"Quit factorai? N running Claude
   session(s) will be terminated."*
3. On confirm → `kill_all()` (SIGTERM → 500ms grace → SIGKILL) → exit.
4. On cancel → dismiss dialog, do nothing.

`kill_all()` is also wired to `Drop` on `TerminalManager` as a
last-ditch backstop so we don't leak children on crashes. No orphan
zombies, ever. The cost of a stray `claude` agent running unattended
is real money.

Full flow in `05-features.md` § "Quit guard".

---

## Q11 — Project icons → **initials-on-color, hashed**

**Decision.** Cheap and pure CSS:

- Hash the project path → HSL hue.
- First letter (or two) of the display name as the glyph.
- Background: `hsl(h, 60%, 35%)` for dark mode, `hsl(h, 60%, 85%)` for
  light. White / dark text accordingly.

No asset generation, no image processing. Drops into a `<ProjectIcon
name="..." path="..." />` component.

---

## Q12 — Crash reporting / Sentry → **skip for MVP**

**Decision.** Skip. `tauri-plugin-sentry` does not run "purely local" —
it needs a Sentry DSN, which means either Sentry SaaS or a
self-hosted Sentry instance (Docker compose stack, Postgres, Redis,
ClickHouse — a full deploy). Both are overkill for a personal tool.

Revisit when factorai gets external users (deferred list #8). For
personal-use error visibility, `tracing` + a local log file is enough.

---

## Q13 — Pre-existing repo state → **commit M0 directly on `main`**

**Decision.** Scaffold M0 directly on `main` as the first feature
commit. The repo is currently empty (only `README.md` + `.git`) so
there's nothing to disturb. Branch-based workflow starts at M1.

---

## New questions (added during implementation)

---

## Q14 — Where does the file tree panel live? → **app shell, not a route**

**Decision.** `FileTreePanel` mounts in `AppShell` and follows the route's
project, rather than being rendered by `routes/project.tsx`.

The feature was asked for as "a panel on the project page", but a tree that
vanishes the moment you open a session disappears exactly when it's most
useful — beside a running terminal. Shell placement is a superset of the
original ask and costs one `useParams({ strict: false })` lookup, the same
trick `Sidebar` already used.

Consequence: the app needed somewhere to hang the toggle, which is what
introduced `TopBar` (Q15).

---

## Q15 — Toggle affordance for a shell-level panel → **full-width top bar**

**Decision.** Add a 40px `TopBar` spanning the **whole** window, above the
sidebar, holding the brand (moved out of `Sidebar`), reserved space for a
future global search, and the panel toggle at the right.

Full width rather than content-width because the custom titlebar (M5) wants
that exact geometry — window controls right, drag region across the middle.
Building it content-width now would mean restructuring the shell then, and
leaves the app with two header rows at different offsets in the meantime.

No keyboard shortcut ships with it: `Ctrl+B` — the obvious binding — is
readline's back-a-char and tmux's prefix, so a global handler would break
typing inside the embedded claude terminal. Deferred to M5's keybinding
work.

---

## Q16 — Icon set for file types → **vscode-icons via unplugin-icons**

**Decision.** See ADR-0006. The mockup that prompted the feature was
Material Icon Theme, which ships 1250 loose SVGs and a Node-oriented entry
point; globbing those out of a pnpm-symlinked `node_modules` is fragile, so
we took the iconify collection with static per-type imports instead. Close
in spirit, not pixel-identical.

---

## Q17 — Keeping the tree fresh → **staleTime + focus refetch, no watcher**

**Decision.** Each directory query gets a 15s `staleTime` and opts into
`refetchOnWindowFocus` (the app-wide default is `false`), plus an explicit
refresh button in the panel header.

A recursive `notify` watcher on arbitrary project directories is a real
feature, not a flag: it needs ignore rules so `node_modules` / `.venv`
churn doesn't flood the channel, per-project watcher lifecycle, and inotify
watch-limit handling on Linux. The existing watcher is scoped to
`~/.claude/projects` and stays that way.
