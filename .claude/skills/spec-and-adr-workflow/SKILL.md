---
name: spec-and-adr-workflow
description: How work starts and lands here — read the spec first, start from an up-to-date main, commit in small prefixed slices, write an ADR in the same commit as the decision, update the spec in the same commit as the contract change. Use when picking up a task, before the first edit, when writing or revising an ADR, or when a spec and the code disagree.
---

# Before writing code

1. Read the relevant spec under `specs/` end-to-end. They are the contract for
   what the code should do.
2. Check `docs/adr/` for architectural decisions that constrain the approach.
   Don't relitigate a decided ADR — supersede it with a new ADR if you disagree.
3. If the spec is wrong or stale, **fix the spec first**, then write the code.
   Specs lead, code follows.

# While implementing

- **Start from an up-to-date `main`.** `git fetch origin && git status` before
  the first edit, and pull if you are behind — someone else's branch may have
  merged while you were reading specs. This is not hygiene, it is the cheapest
  version of a conflict you will otherwise resolve later with both features
  half-built: on 2026-08-16 two agents spent a weekend on `sessions` from
  different schemas and both shipped a migration numbered `0004`, which is keyed
  by name and so cannot simply be renumbered once it has run anywhere. Push
  small slices for the same reason — a commit sitting unpushed is a conflict
  accruing interest.
- Work on `main`. No PR ceremony for solo work. Branches are fine when multiple
  agents are pairing on the same area — coordinate, don't collide. If you *do*
  branch, say so in the roadmap entry you are working from, so the next agent
  sees the collision coming.
- Commit in small slices (one Red→Green or one feature step). Prefix with
  `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- The bans that apply here (`--no-verify`, `as any`, `#[allow(...)]`,
  `// biome-ignore`, emojis) are in AGENTS.md § "Code style" and § "Commits".

Before declaring the task done, run the full gate — see the `quality-gate`
skill.

# ADRs (`docs/adr/`)

Create an ADR **in the same commit** as the code that implements the decision.
ADR file naming: `NNNN-kebab-case-title.md`. Format: context, decision,
consequences.

When to write one:

- New dependency that becomes load-bearing.
- New storage strategy (DB schema, file layout).
- Platform-level choice (target OS, build target, runtime).
- Cross-cutting pattern (error handling, eventing, IPC).

When *not* to write one:

- Bug fixes.
- Styling / cosmetic changes.
- Refactors that don't change observable behaviour.

ADRs are immutable. To revise a decision, write a new ADR that **supersedes**
the old one (link both ways) — never edit the original.

# Specs (`specs/`)

The `specs/` directory is the source of truth for **behaviour**. Nine numbered
files plus two annexes today; add new ones rather than overflowing existing
ones. If the spec and the code disagree, **fix whichever is wrong** — usually
the spec, since code is exact and prose is loose.

Two root files hold the other halves, and they are contracts on the same terms:
**`DESIGN.md`** is the visual system — tokens, type scale, density, elevation,
component behaviour — with `.impeccable/design.json` as its sidecar, and
**`PRODUCT.md`** is durable product truth: users, purpose, positioning,
constraints, brand commitments. `specs/09-branding.md` keeps the mark itself,
since a logo's construction is not a UI rule. A visual change updates
`DESIGN.md` in the same commit, exactly as a contract change updates its spec.

`08-inconsistencies.md` is where a contradiction goes when you find one and
can't fix it on the spot — doc against code, doc against doc, or a process note
that isn't true when you run it. Add to it rather than leaving the disagreement
in place, and delete the entry when it's resolved. It is *not* a decision
record; `07-open-questions.md` holds things already settled.

If you change the contract (new command, new event, renamed field), update the
relevant spec **in the same commit** as the code.

`specs/roadmap/` is the exception to "design source of truth": it holds
**sequencing**, not design. `TODO.md` says what to do next and in what order,
`DONE.md` logs what landed. A feature is never specified there — if a roadmap
item and a spec disagree about behaviour, the spec wins (or the spec is wrong
and gets fixed first). When an item ships, the same commit updates the spec it
changed, *then* the entry moves to `DONE.md`.

# Helpful files when picking up work

- `DESIGN.md` — the visual system: palette, two type sizes, density metrics,
  named rules. Read before touching UI.
- `PRODUCT.md` — who this is for, what it promises, what may not change.
- `specs/00-overview.md` — what we're building, MVP scope.
- `specs/03-backend-rust.md` — the full Tauri command surface.
- `specs/04-frontend.md` — routes, components, state shape.
- `specs/05-features.md` — feature-by-feature behaviour.
- `specs/06-milestones.md` — what ships in M0..M5.
- `specs/roadmap/TODO.md` — the agreed next steps, in priority order. Read it
  before re-deriving a plan; `specs/roadmap/DONE.md` is the dated log of what
  landed and the gotchas found on the way.
- `specs/annex-A-cli-agent-patterns.md` — Tauri + CLI-agent plumbing patterns:
  binary discovery, streaming events, file watching, mock bridge.
