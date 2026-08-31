---
name: frontend-conventions
description: Renderer house rules — @factorai/ui primitives, dnd-kit instead of HTML5 drag-and-drop, Zustand vs TanStack Query vs raw xterm streaming, hash routing, path aliases, and where each design rule physically lives in this repo. Use before writing or changing any React/TypeScript UI code.
---

# Frontend

- shadcn-style primitives live in `@factorai/ui`. Use them. Don't put raw
  `<input>`, `<button>`, `<select>` elements in app code — use `Input`,
  `Button`, `Select` from `@factorai/ui`. Icon-only controls use
  **`IconButton`**, not `Button variant="ghost" size="icon"`.

- **No HTML5 drag-and-drop. It cannot work in this shell.** `draggable` +
  `dragstart` / `dragover` / `drop` is dead on macOS: Tauri's own drag-drop
  handler reports every drag session on the window as handled and wry then never
  forwards it to WKWebView, so the page gets `dragstart` and nothing after it.
  It *does* work on Linux, which is how the tab strip shipped with a reorder
  that only worked on one of our two platforms. Drag with **dnd-kit** (pointer
  events, ADR-0016) — `SessionTabs` is the worked example, including the 4px
  activation constraint that keeps a click a click. Ship a keyboard path beside
  the drag; a gesture only a mouse can reach is half a feature.

- State: Zustand for client state, TanStack Query for server-state caches (Tauri
  command results). PTY data **never** goes through React state — it streams
  from events directly into xterm.

- Routing: TanStack Router with **hash history** (Tauri is a desktop app, no
  server-side routes).

- Aliases: `@/*`, `@components/*`, `@hooks/*`, `@lib/*`, `@store/*`,
  `@routes/*` — defined in both `tsconfig.json` and `vite.config.ts`.

# Design rules

**`DESIGN.md` at the repo root is the design contract**, the way `specs/` is the
behaviour contract: the palette, the two type sizes, the density metrics, the
flat elevation model and the named rules all live there, with
`.impeccable/design.json` as its machine-readable sidecar. Read it before
touching UI, and fix it in the same commit when a rule changes. The dated user
feedback each rule came from is logged in `specs/roadmap/DONE.md`.

What stays here is only *where a rule lives in this repo*, which `DESIGN.md`
does not carry:

- The pointer-cursor base rule is one block in
  `packages/ui/src/styles/globals.css`. A new interactive role is added there,
  not patched onto the component.
- Icon-only controls use **`IconButton`** from `@factorai/ui` — never
  `Button variant="ghost" size="icon"`, and never with a `hover:bg-*` added.
- Menu metrics (`py-1`, `pl-7`, `text-xs` uppercase label) live on
  `DropdownMenu` and `ContextMenu` in `@factorai/ui`, so every menu inherits
  them rather than the one whose padding somebody noticed.
- Chrome heights are literal: top bar `h-10.5`, file panel header and sidebar
  footer `h-9`, session tab `h-7.5`.
- The refresh spinner clears on `animationiteration` and is deliberately **not**
  behind `motion-safe:` — with the animation suppressed the event never fires,
  so the state latches on forever.

# Types crossing the IPC boundary

All cross-boundary types live in `packages/types`, hand-mirrored against the
Rust structs — see the `backend-conventions` skill for the Rust half.

# Preferences

Three homes, and "who reads this?" decides (ADR-0013). The rule and the reason
`tauri-plugin-store` is banned are in the `backend-conventions` skill, because
the SQLite half of it is Rust's.
