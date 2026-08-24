# ADR-0022 — the `yaml` parser for frontmatter in rendered markdown

- **Status:** accepted
- **Date:** 2026-08-24
- **Relates to:** ADR-0021 (mermaid for diagrams) — the same question one content
  type over: a block inside a markdown document that is not markdown. ADR-0013
  (three homes for preferences) is where the panel's default-open switch lives.

## Context

The file viewer (F7) renders `.md` through `react-markdown` + `remark-gfm`, and
`react-markdown` knows nothing about frontmatter. So a document that opens with

```
---
title: "Facet-driven action scoring — EPSA prospection"
status: Draft
reviewers: ["Noé Pion", "Laurent Anadon"]
linear_project: "https://linear.app/…"  # ENG-3150 is the tracking issue
notion_source: null
---
```

rendered as prose: remark read the fences as a thematic break or as a setext
heading underline and ran every field together into one paragraph, complete with
its YAML punctuation and its comments. The metadata was on screen and
unreadable, which is worse than either laying it out or dropping it.

Dropping it is not the answer here. The documents this viewer is pointed at are
the ones an agent writes and the ones a repository already has, and in those the
frontmatter is the document's own header: who owns it, what state it is in, what
issue tracks it. That is the first thing a reader wants and the first thing a
reviewer checks.

So the block has to be taken out of the document and laid out as fields — and
laying out fields means knowing what the values *are*. Three ways to get that:

- **A regex over `key: value` lines.** Cheap, no dependency, and wrong on input
  that is completely ordinary: a quoted value containing a colon, a `#` inside a
  string, a block scalar (`|`), an inline list, a nested map. It does not fail on
  those — it reads them *incorrectly*, and a metadata panel that quietly shows
  the wrong owner is worse than the run-together paragraph it replaced.
- **`remark-frontmatter`.** Solves the wrong half: it teaches remark to *skip*
  the block, leaving the YAML as an opaque string. Something still has to parse
  it, and the block is not being rendered as markdown at all, so remark does not
  need to know about it.
- **A real YAML parser.**

## Decision

**Add `yaml` (pinned exact, like every other dependency here) and parse the
block with it. Split the block off in our own code rather than through a remark
plugin.**

- **`yaml`, not `js-yaml`.** No transitive dependencies, YAML 1.2 by default, and
  an API that answers the two questions this needs — order and structure — in one
  call. `js-yaml` would arrive with `argparse` behind it for a CLI we do not use.
- **Parsed with `mapAsMap: true`.** The fields are rendered in the order they were
  written, and a plain JS object reorders integer-like keys — `2026: …` would
  jump to the top. A `Map` preserves insertion order for every key type.
- **The core schema, left alone.** `date: 2026-08-24` stays the string the author
  typed rather than becoming a `Date` that a locale then reformats. A timestamp
  only arrives if the document asks for one with an explicit tag.
- **A static import, unlike mermaid.** `yaml` is tens of kilobytes, not 2.5MB, and
  the parse decides what the panel renders on first paint — a dynamic import would
  buy a flash of nothing for a saving too small to measure. The lazy-chunk shape of
  ADR-0018 and ADR-0021 is for the heavy renderers.
- **The split is ours** (`components/viewer/frontmatter.ts`): first line `---`,
  closed by `---` or `...`, CRLF and a leading BOM tolerated, and a document that
  never closes its fence left exactly as it was — that one opens with a thematic
  break, and treating it as broken frontmatter would put a failure card on every
  document that starts with a rule.
- **Failure is shown, not swallowed.** A block that will not parse, or one that
  parses to something other than a mapping, keeps its source under a one-line
  reason in the dashed frame a missing image and a broken mermaid fence already
  use. The reader still has the text the author wrote.

The parser is confined to `frontmatter.ts`, which exports a display model of four
shapes (text, empty, list, map). Nothing else in the app imports `yaml`, and the
panel does not know what YAML is.

## Consequences

- One more runtime dependency, in the class the repo already carries for content
  it renders: Monaco for text, pdf.js for PDFs, mermaid for diagrams, `yaml` for
  frontmatter.
- We now own an opinion about what a frontmatter *field* looks like on screen —
  chips for lists, an em dash for no value, an indented list for a nested map. That
  is a design surface that will grow (a `status: Draft` could reasonably become a
  coloured chip one day) and it is recorded in `DESIGN.md` rather than here.
- Frontmatter that is TOML (`+++`) or JSON is **not** handled. It parses as YAML or
  it shows its source. Nothing in the corpus this viewer serves uses either, and
  adding a second syntax is a decision to take when something does.
- The panel's default state is a preference (`frontmatterOpen`, ADR-0013), so this
  ADR does not decide it for every reader.
