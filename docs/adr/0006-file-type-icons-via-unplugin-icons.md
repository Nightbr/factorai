# ADR-0006 — File-type icons via `unplugin-icons` + `@iconify-json/vscode-icons`

**Status.** Accepted (F11 file tree, 2026-08-13).

## Context

The project file tree (specs/05-features.md F11) needs per-filetype icons —
a python logo on `conftest.py`, a whale on `Dockerfile`, `{}` on
`project.json`. Recognising a file by its icon is most of what makes a tree
scannable, and `lucide-react` (already a dependency) has no language logos:
its `FileCode` / `FileJson` glyphs are monochrome outlines that all read the
same at 16px.

Constraints that ruled options out:

- **No network at runtime.** The app runs in a Tauri webview with no
  guarantee of connectivity, so an icon CDN (Iconify's default API mode) is
  not an option. Everything must be in the bundle.
- **pnpm's symlinked store.** Globbing SVG assets out of
  `node_modules/<pkg>/icons/*.svg` — the natural way to consume
  `material-icon-theme`, which ships 1250 loose SVGs and a Node-oriented CJS
  entry — is fragile when `node_modules/<pkg>` is a symlink into
  `.pnpm/`. It also emits far more assets than we reference.
- **Bundle size.** `@iconify-json/vscode-icons` is 3.7MB of icon JSON.
  Importing the collection wholesale to resolve icons at runtime would ship
  all 1577 of them to render maybe 60.

## Decision

Use **`unplugin-icons`** (Vite plugin) with **`@iconify-json/vscode-icons`**
as the icon source, both `devDependencies` of `apps/desktop`, plus
`@svgr/core` and `@svgr/plugin-jsx` — required peers for the plugin's
`compiler: 'jsx'` mode.

Icons are imported **statically, one per file type**:

```ts
import Python from '~icons/vscode-icons/file-type-python';
```

so the plugin inlines exactly the icons we name as React components at build
time. Nothing is fetched at runtime and the 3.7MB collection stays a
build-time artifact.

The mapping is split in two on purpose:

- `lib/fileIcon.ts` — pure `iconKeyFor(fileName): IconKey`, no icon imports,
  unit-tested (same split as the existing `lib/icon.ts`).
- `components/files/FileIcon.tsx` — the static imports and a
  `Record<IconKey, IconComponent>`, which is *total* over `IconKey`, so
  adding a key without an import is a type error rather than a blank row.

## Consequences

**Positive.**

- Only referenced icons reach the bundle (~1–3KB each).
- Offline by construction; no CSP or capability changes.
- Adding a file type is two lines and the type checker enforces the pair.
- `iconKeyFor` is testable without a bundler in the loop.

**Negative.**

- The icons are the **vscode-icons** set, not Material Icon Theme, so they
  don't match a Material-themed editor pixel for pixel.
- Three build-time dependencies (plugin + two svgr packages) and a Vite
  plugin entry, which is machinery a hand-rolled `<svg>` sprite wouldn't
  need.
- `~icons/*` module resolution depends on the
  `unplugin-icons/types/react` reference in `src/vite-env.d.ts`; without it
  `tsc` can't see those modules.

## Alternatives rejected

- **`material-icon-theme` as a dependency** — exact parity with the mockup,
  but the pnpm-symlink glob problem and 1250 emitted assets.
- **Vendoring ~35 SVGs into the repo** — smallest and simplest, but the
  icons then never update and every new file type is a manual asset copy.
- **`react-file-icon`** — colored generic sheets with the extension printed
  on them, not language logos.
- **lucide-react only** — no new dependency, but no language recognition.

## Related

- `specs/05-features.md` F11 (project file tree)
- `apps/desktop/src/lib/fileIcon.ts`, `components/files/FileIcon.tsx`
