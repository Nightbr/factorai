# ADR-0001 — Tauri 2 + React 19 + pnpm monorepo + Biome

**Status.** Accepted (M0, 2026-05-28).

## Context

We're rebuilding a Claude-Code-session manager on a fresh
stack. The reference implementation (the prior app) uses Electron
41 with vanilla JS/HTML/CSS and better-sqlite3 + node-pty. It works but:

- The renderer is an unstructured DOM-mutation app — refactors are
  costly.
- Electron's binary size and security model are heavier than we need.
- We already have a sibling project (factorai-v0) on a tighter stack
  with tooling and ergonomics we want to standardise on.

## Decision

Use the factorai-v0 stack verbatim for the rebuild:

- **Shell:** Tauri 2 (Rust). `tauri-plugin-{shell,dialog,fs,process,store}`.
- **Renderer:** React 19 + Vite 8 + TanStack Router (hash history) +
  TanStack Query.
- **State:** Zustand for client state; React Query for command caches.
- **Styling:** Tailwind v4 (CSS-only, no postcss config) + shadcn-style
  primitives in `@factorai/ui`.
- **Tooling:** pnpm 10 workspaces, Turborepo 2, Biome 1.9 for lint +
  format, knip for unused-deps, syncpack for version drift.
- **Versions pinned:** Node 24, Rust stable — pinned via `.mise.toml`.

## Consequences

**Positive.**

- Same shape as factorai-v0 means transferable skills + tooling
  decisions are pre-validated.
- Tauri's Rust backend gives us a fast path to native PTYs, native SQLite
  via rusqlite, and tight control over OS resources.
- React 19 + TanStack Router is the productive renderer stack for desktop
  apps; we can hire / collaborate against it cleanly.
- Biome + clippy gives a single lint floor that's fast and configurable.

**Negative.**

- We give up `node-pty` and the `electron-builder` ecosystem. Rust crate
  ecosystem is generally narrower; we accept this for the perf + safety
  win.
- Tauri 2 mobile support is fresh — we don't ship mobile, but if we ever
  want to, the path exists.

## Related

- `specs/00-overview.md` § "Tech stack"
- `specs/01-architecture.md` § "Tech stack"
- factorai-v0 reference: `/home/nightbringer/Dev/factorai-v0`
