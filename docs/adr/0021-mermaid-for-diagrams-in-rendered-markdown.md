# ADR-0021 — mermaid for diagrams in rendered markdown

- **Status:** accepted
- **Date:** 2026-08-24
- **Relates to:** ADR-0018 (pdf.js for PDF preview) — the same lazy-chunk,
  bundled, no-CDN shape, one content type over. ADR-0007 (Monaco) is where that
  shape started.

## Context

The file viewer (F7) renders `.md` through `react-markdown` + `remark-gfm`. A
`mermaid` fence in such a file rendered as what it literally is: a code block
of `graph TD` lines. That is the wrong answer in this app specifically. The
documents the viewer is pointed at are the ones an agent writes and the ones a
repository already has — `specs/01-architecture.md` in this very repo has
diagrams in it, and every ADR here is a document a reader opens to understand
a structure. A diagram left as its own source is the one kind of content where
the rendered view is strictly worse than the source view.

There is no way to get this from something already in the bundle. Monaco
highlights text and pdf.js parses PDFs; neither draws a graph. Rendering the
fence server-side is not available either — there is no server, and the Rust
side has no layout engine. The webview cannot fetch a rendering service: this
app has no network access by design, which is the same constraint that made
pdf.js's worker a bundled asset rather than a CDN URL.

Mermaid is the only serious candidate. It is the syntax people already write —
GitHub, GitLab and Obsidian all render it, so a `.md` in the user's repository
is overwhelmingly likely to be mermaid if it contains a diagram at all — and it
is a browser library that runs where we need it. The alternatives are narrower
(`graphviz` via a WASM build renders DOT, which nobody writes in markdown) or
absent.

The costs are real and worth naming before accepting them. Mermaid is roughly
2.5MB unminified — larger than Monaco — because it carries a grammar and a
layout pass per diagram type. It parses text out of whatever repository the
reader opened, which is untrusted input. And it renders by measuring text in
the live DOM, so it is not a pure function from source to SVG.

## Decision

**Bundle `mermaid` (pinned exact, like every other dependency here) and render
each fence to SVG in the renderer.** Specifically:

- **Lazier than pdf.js.** `MermaidDiagram` reaches mermaid through a dynamic
  `import()` in `components/viewer/mermaid.ts`, and nothing calls it unless a
  document actually contains a mermaid fence. Opening a README with no diagram
  in it does not load mermaid; opening a source file does not load the markdown
  path at all. Vite's `optimizeDeps.include` lists it for the same reason
  Monaco and pdf.js are listed — a chunk discovered mid-interaction prebundles
  and reloads the page at exactly the wrong moment.
- **The palette is converted, not copied.** Mermaid derives most of a diagram's
  colours from a few seeds using `khroma`, which parses hex and not `oklch()`.
  Our tokens are `oklch()`. So `mermaidTheme.ts` reads the custom properties off
  the document and converts them, rather than keeping a second copy of the
  palette in hex — a copy that goes stale the first time a token moves, and the
  tokens have moved. The light theme (roadmap item 32) therefore costs nothing
  here: it redefines the same properties.
- **`securityLevel: 'strict'`, the default, kept deliberately.** Labels are
  sanitised and `click` directives that would run script or navigate are inert.
  This is the same stance F7 already takes by not adding `rehype-raw`: a
  document in the repository the reader opened is not trusted because they
  opened it.
- **`suppressErrorRendering: true`, which is not the default.** Mermaid's own
  failure mode is to append a bomb-glyph diagram into the DOM, with nothing
  saying which fence produced it. Off, `render` throws and cleans up its
  temporary nodes, and the failure is reported in place — with the fence's
  source kept and shown, because a diagram that will not parse is still what
  the author wrote.
- **The SVG is parsed and adopted, not assigned as innerHTML.** Mermaid has
  already run its output through DOMPurify, so this is not the sanitising step;
  it is how the markup becomes real nodes without `dangerouslySetInnerHTML`,
  which `biome`'s recommended set rejects and which we are not going to
  suppress. It is parsed as `text/html` rather than `image/svg+xml`, because
  the HTML parser puts inline SVG in the right namespace and tolerates the
  `<foreignObject>` label markup that is not always well-formed XML.

## Consequences

- One more load-bearing dependency, and a large one with a security surface: it
  parses untrusted text. Unlike pdf.js there is no worker isolation to hide
  behind — mermaid needs the DOM to measure text, so it runs on the main
  thread. `securityLevel: 'strict'` is therefore the whole of the defence, and
  changing it is a new ADR rather than a config tweak.
- ~2.5MB of JS in a lazy chunk on local disk. Nothing pays for it until a
  document with a diagram in it is opened, and then it is a local read.
- **Diagrams are rendered, not interactive.** No pan, no zoom, no click
  handlers — a wide diagram scrolls sideways inside its own container. Zoom is
  the obvious next ask and is deliberately not decided here; `ImageView`'s
  controls are the shape it would take.
- Rendering is asynchronous and layout-dependent, which the rest of the
  markdown path is not: a fence occupies no space until its diagram lands. That
  is the same call `LocalImage` makes, and for the same reason — a placeholder
  that reflows the paragraph a frame later is worse than a beat of nothing.
- **Only a `mermaid` fence counts.** A fence labelled `mmd`, or unlabelled, stays a
  code block. Guessing at unlabelled fences would turn any file whose first
  line happens to read `graph TD` into a rendering attempt.
- Mermaid is not wired into the diff viewer or anywhere else markdown might one
  day be shown. It is a `MarkdownView` decision, and `MarkdownView` is the only
  caller.
