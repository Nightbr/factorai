# Architecture

## Repository layout

```
factorai/
├── apps/
│   └── desktop/                 # Tauri 2 app
│       ├── src/                 # React 19 renderer
│       │   ├── components/      # app-specific components
│       │   ├── routes/          # TanStack Router file routes
│       │   ├── store/           # Zustand stores
│       │   ├── lib/             # tauri bridge, helpers
│       │   └── styles/
│       ├── src-tauri/           # Rust backend
│       │   ├── src/
│       │   │   ├── commands/    # #[tauri::command] handlers
│       │   │   ├── services/    # PTY, indexer, watcher
│       │   │   ├── models/      # serde structs shared with TS
│       │   │   ├── db/          # rusqlite + migrations
│       │   │   └── lib.rs       # plugin wiring, command registry
│       │   ├── Cargo.toml
│       │   └── tauri.conf.json
│       ├── index.html
│       ├── vite.config.ts
│       ├── tsconfig.json
│       └── package.json
├── packages/
│   ├── types/                   # @factorai/types — shared TS types
│   │   └── src/index.ts
│   └── ui/                      # @factorai/ui — shadcn primitives
│       ├── src/components/ui/
│       ├── src/lib/utils.ts     # cn() helper
│       └── src/styles/globals.css
├── specs/                       # this directory
├── biome.json
├── turbo.json
├── pnpm-workspace.yaml
├── package.json                 # root: turbo, biome, knip, syncpack
├── Cargo.toml                   # cargo workspace, member: apps/desktop/src-tauri
├── knip.json
├── .syncpackrc.json
├── .mise.toml                   # node 24, pnpm 10, rust stable
└── README.md
```

Mirror of factorai-v0 exactly — same workspace shapes, same package names,
same tooling versions.

## Tech stack

### Backend (Rust)

| Concern               | Crate                                                           |
| --------------------- | --------------------------------------------------------------- |
| Shell                 | `tauri = "2"` with `devtools` feature                           |
| Async runtime         | `tokio` (full)                                                  |
| Plugins               | `tauri-plugin-shell`, `tauri-plugin-dialog`, `tauri-plugin-fs`, `tauri-plugin-process`, `tauri-plugin-updater`, `tauri-plugin-clipboard-manager` |
| DB                    | `rusqlite` (bundled SQLite, FTS5 feature)                       |
| PTY                   | `portable-pty` (cross-platform)                                 |
| File watching         | `notify = "6"` (debounced)                                      |
| Path / home dir       | `dirs = "5"`                                                    |
| Time                  | `chrono` (serde)                                                |
| Errors                | `anyhow` (commands) + `thiserror` (library boundaries)          |
| Serialization         | `serde`, `serde_json`                                           |
| UUIDs                 | `uuid = "1"` (v4)                                               |
| Logging               | `tracing`, `tracing-subscriber`                                 |

### Frontend (TypeScript)

| Concern             | Package                                                              |
| ------------------- | -------------------------------------------------------------------- |
| Runtime             | React 19                                                             |
| Build               | Vite 8 + `@vitejs/plugin-react`                                      |
| Router              | `@tanstack/react-router` (hash history, like factorai-v0)            |
| Server state        | `@tanstack/react-query`                                              |
| Client state        | `zustand`                                                            |
| Styling             | `tailwindcss@4` + `@tailwindcss/vite`                                |
| UI primitives       | `@factorai/ui` (Radix-based shadcn components)                       |
| Icons               | `lucide-react`                                                       |
| Drag and drop       | `@dnd-kit/{core,sortable,modifiers,utilities}` — pointer-based, and it has to be (ADR-0016) |
| Terminal            | `@xterm/xterm` + `@xterm/addon-fit`, `addon-search`, `addon-web-links`, `addon-webgl`, `addon-unicode-graphemes` |
| Editor              | `monaco-editor` (ADR-0007; this row said `codemirror` until 2026-08-18) |
| Markdown rendering  | `react-markdown` + `remark-gfm` (the viewer's markdown mode)          |
| Tauri bindings      | `@tauri-apps/api` + plugin packages mirroring Rust list              |

## IPC contract

Strict layering, no exceptions:

1. **Rust** owns the filesystem, SQLite, processes, and PTYs.
2. **TS** owns the DOM, terminal rendering (xterm.js writes), and editors.
3. They communicate via:
   - **Commands** (`#[tauri::command]`) for request/response.
   - **Events** (`app.emit("name", payload)`) for streams (PTY bytes,
     watcher updates, indexer progress).
4. All shared shapes live in `packages/types`. Rust structs derive
   `serde::Serialize`/`Deserialize` and use the same field names
   (`#[serde(rename_all = "camelCase")]`).

A thin `apps/desktop/src/lib/tauri.ts` re-exports typed wrappers around
`invoke<T>(...)` and `listen<T>(...)`. Components never call the raw API.

## Dev flow

| Command            | Effect                                                          |
| ------------------ | --------------------------------------------------------------- |
| `pnpm dev`         | `turbo dev --filter=@factorai/desktop` → `tauri dev`            |
| `pnpm build`       | `turbo build` (vite build → tauri build)                        |
| `pnpm lint`        | `turbo lint` (Biome over all packages)                          |
| `pnpm format`      | `turbo format`                                                  |
| `pnpm typecheck`   | `turbo typecheck`                                               |
| `pnpm deps:check`  | `syncpack list-mismatches`                                      |
| `pnpm deps:unused` | `knip`                                                          |
| `mise install`     | Pin node 24, pnpm 10, rust stable                               |

`tauri dev` runs `pnpm vite:dev` (port 1420, strict) and reloads the Rust
binary on `src-tauri/**` changes.

## Build targets

| Platform     | Target                                |
| ------------ | ------------------------------------- |
| macOS        | `.dmg` and `.app` (arm64 + x64)       |
| Linux        | `.AppImage` (x86_64 only)             |

Windows is **out of scope** for MVP. The codebase shouldn't actively
break on Windows (we still use `portable-pty`, `dirs`, etc.), but we
don't test it, don't ship a build target for it, and don't take Windows
bug reports until a future milestone.

CI not specified for MVP; manual `tauri build` is fine until we have
releases. Once we publish, add GitHub Actions with the official Tauri build
action.

## Configuration boundaries

- **localStorage**, through zustand's `persist`: **layout state** in
  `panelStore` / `sidebarStore` / `zoomStore` (widths, open/closed, which tab,
  zoom) and **user preferences** in `prefsStore`. Synchronous, so nothing paints
  a default first and corrects itself. `tauri-plugin-store` was the documented
  answer here and is **removed** — see
  [ADR-0013](../docs/adr/0013-preferences-storage-split.md).
- **SQLite** (`~/.local/share/dev.factorai/factorai.db` on Linux,
  equivalent on mac/win via `app_data_dir`): session index, FTS, derived
  metadata — and the `settings` table, which holds **the settings Rust reads**
  (F11). "Who reads this?" is what decides between the two.
- **Read-only mirrors of `~/.claude/`**: never written to. CLAUDE.md edits
  are an explicit exception (see `05-features.md`).
