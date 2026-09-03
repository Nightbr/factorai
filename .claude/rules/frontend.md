---
paths:
  - "apps/desktop/src/**"
  - "packages/ui/**"
---

# Renderer traps

- **No HTML5 drag-and-drop.** `draggable` + `dragstart` / `dragover` / `drop` is
  dead on macOS — Tauri's drag-drop handler reports every drag session on the
  window as handled and wry never forwards it to WKWebView. It *does* work on
  Linux, which is how the tab strip shipped with a reorder that worked on one of
  our two platforms. Use dnd-kit (ADR-0016); `SessionTabs` is the worked example,
  4px activation constraint included. Ship a keyboard path beside the drag.
- The pointer-cursor base rule is one block in
  `packages/ui/src/styles/globals.css`. A new interactive role is added there,
  not patched onto the component.
- Icon-only controls use `IconButton` from `@factorai/ui` — never
  `Button variant="ghost" size="icon"`, and never with a `hover:bg-*` added.
- Menu metrics (`py-1`, `pl-7`, `text-xs` uppercase label) live on
  `DropdownMenu` and `ContextMenu` in `@factorai/ui`, so every menu inherits
  them rather than the one whose padding somebody noticed.
- Chrome heights are literal: top bar `h-10.5`, file panel header, sidebar
  footer and the project's shell footer `h-9`, session tab `h-7.5`.
- The refresh spinner clears on `animationiteration` and is deliberately **not**
  behind `motion-safe:` — with the animation suppressed the event never fires,
  so the state latches on forever.
- Aliases `@/*`, `@components/*`, `@hooks/*`, `@lib/*`, `@store/*`, `@routes/*`
  are declared in both `tsconfig.json` and `vite.config.ts`. Routing is TanStack
  Router on **hash history**.
- Preferences have three homes and "who reads this?" decides (ADR-0013): layout
  in `panelStore` / `sidebarStore` / `zoomStore`, renderer-only preferences in
  `prefsStore`, anything **Rust** reads in the SQLite `settings` table. All three
  localStorage stores are synchronous on purpose; `tauri-plugin-store` is removed
  because it is async and every persisted value flashed its default for a frame.

`DESIGN.md` is the design contract and is updated in the same commit as a visual
change. Longer form: the `frontend-conventions` skill.
