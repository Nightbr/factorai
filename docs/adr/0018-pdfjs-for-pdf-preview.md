# ADR-0018 — pdf.js for PDF preview, because the webview only has one on macOS

- **Status:** accepted
- **Date:** 2026-08-19
- **Relates to:** ADR-0007 (Monaco for the file viewer) — the same lazy-chunk,
  bundled-worker, no-CDN shape, one file type over.

## Context

The file viewer (F7) renders text through Monaco, images through `read_image`,
and SVG as an `<img>` fed a data URL. A PDF fell through all three: `iconKeyFor`
had no `pdf` key, so `.pdf` routed to `TextFileView`, `read_file` found a null
byte in the first 8KB, and the reader got "Cannot preview binary file" with
"Open in default app" — the app handing the document to another app.

The cheap fix looks like one line: put the bytes in a blob URL and let the
webview render them in an `<iframe>`. **That works on exactly one of our two
platforms.** WKWebView ships Apple's PDF viewer and renders a PDF resource
natively; WebKitGTK has no PDF support at all and offers a download instead. We
have been here before, from the other direction: F16's HTML5 drag-and-drop
worked on Linux and was dead on macOS (ADR-0016), shipped because QA is X11-only.
A viewer that renders on the developer's Mac and shows a blank pane on Linux is
the same bug with the platforms swapped, and it is not discoverable from either
machine alone.

There is no third native option. Tauri exposes no PDF surface, and the OS
handlers (Preview, evince) are the "open externally" path we already have.

## Decision

**Bundle `pdfjs-dist` (pinned exact, like every other dependency here) and
render pages to canvas ourselves.** Specifically:

- **Lazy, one level below Monaco.** `FileView` reaches `PdfView` through
  `React.lazy`, so pdf.js and its worker are fetched the first time someone
  opens a PDF and never for a source file. `ImageView` stays a static import —
  it is a few hundred lines and no dependency.
- **The worker is bundled, not fetched.** Vite's `?worker` import, the same
  reason `monaco.ts` gives: this webview has no network, so a CDN `workerSrc` is
  not a fallback, it is a failure.
- **The side-car assets ship too** — `standard_fonts/` and `cmaps/`, copied out
  of the package at build time and pointed at with `standardFontDataUrl` /
  `cMapUrl`. This is not optional polish. A PDF that references Helvetica
  without embedding it — most LaTeX and Word output — renders with missing
  glyphs when pdf.js cannot load the standard font data, and there is nowhere
  else for it to come from. ~1.8MB on disk that is only read when a document
  asks for it.
- **The bytes come through a command**, `read_pdf`, refusing anything that
  isn't `%PDF-` and anything over a 32MB cap of its own. Not the asset
  protocol: it wants a static path scope and our paths are "whatever project
  you opened", which is the reasoning F7 already recorded for images.
- **Text is selectable**, via pdf.js's text layer and its own stylesheet.
  Hand-rolling those positioning rules is how selection ends up offset from the
  glyphs, and it rots silently on every upgrade.

## Consequences

- One more load-bearing dependency, and a substantial one: pdf.js is a PDF
  implementation, with a release cadence and a security surface (it parses
  untrusted documents out of whatever repository the user opened). Upgrades are
  not optional the way a UI library's are. Its worker isolation is part of why
  this shape was chosen over any in-process parser.
- ~1MB gzipped of JS plus ~1.8MB of font/CMap data in the bundle, all of it in
  a lazy chunk on local disk. Nothing pays for it until a PDF is opened.
- The renderer now owns page rasterisation, which means a canvas lifecycle:
  pages render at `devicePixelRatio × zoom`, only visible pages hold a canvas,
  and zoom re-rasterises on a debounce. That machinery has no analogue in the
  rest of the app — `ImageView` hands one `<img>` to the browser and is done.
- **The `<iframe>` route stays closed.** If a future WebKitGTK gains PDF
  support, reopening this is a new ADR, not a quiet swap: the two engines would
  then render the same document differently, with different text selection,
  zoom behaviour and keyboard handling on each platform.
- Rendered PDF *diffing* is explicitly not decided here. A changed `.pdf` in the
  Changes tab keeps `DiffView`'s existing binary dead end; see
  `specs/roadmap/TODO.md`.
