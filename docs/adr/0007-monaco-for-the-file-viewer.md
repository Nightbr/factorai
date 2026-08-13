# ADR-0007 — Monaco for the file viewer (supersedes the spec's CodeMirror 6 choice)

**Status.** Accepted (F7 file viewer, 2026-08-13).

## Context

`specs/04-frontend.md` and M4 planned **CodeMirror 6** for file preview
(`@codemirror/language-data` for lazy grammars) and `@codemirror/merge` for
the diff view (F8). That was spec prose, never an ADR.

Building F7 we reconsidered, because the diff viewer is the harder half of
this area and Monaco's `editor.createDiffEditor` is materially better than
`@codemirror/merge`: it ships side-by-side and inline modes, gutter
navigation between changes, and folding of unchanged regions, all of which
F8 would otherwise assemble by hand.

The usual objections to Monaco don't survive contact with the specifics:

- **"It needs web workers."** The workers back the *language services* —
  IntelliSense for TS / JSON / CSS / HTML. Syntax highlighting is Monarch
  and runs on the main thread. A read-only viewer wants none of it.
  Importing `editor.api` plus `basic-languages/monaco.contribution` gets
  every Monarch grammar (~80 languages) with no worker requirement. F8 will
  add `editor.worker` (which computes diffs) via Vite's native
  `?worker` import, so `vite-plugin-monaco-editor` — 12MB and last released
  at 1.1.0 — is unnecessary.
- **"It's 98MB."** That's the npm tarball (dev + min + esm + source maps).
  What matters is the emitted chunk, and the viewer is behind
  `React.lazy`, so Monaco lands in a separate chunk fetched from local disk
  the first time a file is opened. Measured on the production build:

  | chunk | size | when it loads |
  | --- | --- | --- |
  | `index-*.js` | 1.33MB | app start — **unchanged** by this feature |
  | `editor.api-*.js` | 2.62MB | first file opened |
  | `FileView-*.js` | 21KB | first file opened |
  | 82 language chunks | 0.7–16KB each | per language actually opened |

  Monaco's `basic-languages` code-split per grammar, so opening a Dockerfile
  fetches 1.7KB, not all 82.
- **"It won't work in WebKitGTK."** Monaco officially supports Safari and
  touches no WebGL, so the failure mode that made us drop xterm's WebGL
  addon (ADR-0002 / the Zorin crash) doesn't apply. Verified by opening a
  file in the real Tauri window on WebKitGTK 2.52.3.

## Decision

Use **`monaco-editor`** (a real dependency of `apps/desktop`) for the file
viewer, and for F8's diff view when it lands. CodeMirror 6 is not added.

Import shape — note the short paths, because monaco's `exports` map is
`"./*": "./esm/vs/*.js"`, so `monaco-editor/esm/vs/...` does **not**
resolve:

```ts
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/basic-languages/monaco.contribution';
```

Rules we hold ourselves to:

- Monaco is imported **only** from `components/viewer/monaco.ts`. Nothing
  else in the app touches it, so swapping it out is one file plus the host.
- The viewer is loaded with `React.lazy`, keeping Monaco out of the initial
  bundle.
- `optimizeDeps.include` lists both entry points, so Vite prebundles them at
  dev-server start instead of discovering them mid-interaction and reloading
  the page on the first file open.
- No `@monaco-editor/react`. It loads Monaco from a CDN by default, which is
  a non-starter in a webview with no network guarantee; pointing it at the
  local package is about as much code as calling the API directly, and the
  hand-rolled effect matches the existing xterm lifecycle in `Terminal.tsx`.
- Language ids come from `monaco.languages.getLanguages()` — Monaco's own
  registry — rather than a second extension table beside `lib/fileIcon.ts`.

## Consequences

**Positive.**

- F8's diff view becomes configuration rather than construction.
- Highlighting for ~80 languages with no per-language wiring and no workers.
- The initial bundle is untouched; the cost is deferred to first open and
  paid from local disk.
- Editor affordances we'd otherwise build — line numbers, find widget,
  selection, folding — come free.

**Negative.**

- Monaco is the heaviest dependency in the app, and its lazy chunk is
  roughly the size of everything else put together.
- The `exports`-map path shape is a trap: the widely-copied
  `monaco-editor/esm/vs/editor/editor.api` import fails to resolve under
  `moduleResolution: "bundler"`.
- Monaco owns its own theming; the app palette has to be restated as hex in
  `defineTheme` because Monaco can't read the oklch CSS variables.
- `automaticLayout: true` is load-bearing. Monaco measures its container on
  create, and inside a dialog mid-open-animation that measures zero — the
  same class of bug as the terminal's pre-layout `fit()`.

## Alternatives rejected

- **CodeMirror 6** — smaller and known-good in this webview, but a weaker
  diff story, and the language-data lazy loading is a solved problem in both
  libraries.
- **Shiki** — best-in-class highlighting (TextMate grammars, VS Code
  parity), but no line numbers, selection or in-file search, and it cannot
  back a diff view. It would have been thrown away in M4.
- **`react-file-icon`-style read-only HTML highlighters** (highlight.js,
  Prism) — no editor affordances, no diff.

## Related

- `specs/05-features.md` F7 (file viewer), F8 (diff viewer)
- `specs/04-frontend.md` § "File preview & diff"
- `apps/desktop/src/components/viewer/`
- ADR-0006 (file-type icons — the other new frontend dependency)
