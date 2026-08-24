---
name: factorai
description: A calm dark control room for supervising coding agents.
colors:
  background: "oklch(16% 0.008 250)"
  foreground: "oklch(96% 0.004 250)"
  card: "oklch(18% 0.008 250)"
  popover: "oklch(18% 0.008 250)"
  secondary: "oklch(22% 0.008 250)"
  secondary-foreground: "oklch(82% 0.006 250)"
  muted: "oklch(20% 0.008 250)"
  muted-foreground: "oklch(56% 0.006 250)"
  border: "oklch(25% 0.008 250)"
  input: "oklch(22% 0.008 250)"
  primary: "oklch(81.3% 0.165 75)"
  primary-foreground: "oklch(16% 0.008 250)"
  destructive: "oklch(58% 0.22 25)"
  dev: "oklch(68% 0.19 300)"
  status-working: "oklch(68% 0.17 150)"
  status-waiting: "oklch(81.3% 0.165 75)"
  status-stopped: "oklch(55% 0.01 250)"
  lane-0: "oklch(70% 0.15 255)"
  lane-1: "oklch(72% 0.16 145)"
  lane-2: "oklch(68% 0.19 25)"
  lane-3: "oklch(70% 0.17 300)"
  lane-4: "oklch(74% 0.13 195)"
  lane-5: "oklch(78% 0.15 65)"
  lane-6: "oklch(72% 0.17 340)"
  lane-7: "oklch(76% 0.16 115)"
typography:
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
    letterSpacing: "0.05em"
  mono:
    fontFamily: "JetBrains Mono, Fira Code, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
    letterSpacing: "normal"
rounded:
  chip: "4px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  full: "9999px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
    height: "32px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
    height: "32px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
    height: "32px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.sm}"
    padding: "2px"
    size: "14px"
  icon-button-hover:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
    height: "32px"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.mono}"
    rounded: "{rounded.chip}"
    padding: "1px 4px"
  menu-item:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "4px 8px 4px 28px"
    height: "28px"
  menu-item-highlighted:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.foreground}"
  session-tab:
    backgroundColor: "transparent"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "30px"
  session-tab-active:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.foreground}"
    typography: "{typography.title}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "30px"
---

# Design System: factorai

## Overview

**Creative North Star: "The Control Room"**

factorai is a dark console you sit in front of all day while agents work. Its
job is not to be looked at; its job is to be glanced at. Everything is arranged
so that a developer returning to the window after twenty minutes away can tell,
without reading, which sessions are still working, which one wants them, and
which stopped. That is why the surface is quiet almost everywhere: a control
room where every panel glows is a control room where nothing means anything.

The system is built from four near-black lightness steps at one hue (250) and a
single warm accent. Colour is spent, not applied. Amber means *your move* —
it is the accent, the ring, the brand mark and the `waiting` status, all at the
same value, so the one thing that asks for the human always looks the same.
Green means working, grey means inert, violet means this is the development
build. Every other hue in the app is categorical rather than semantic: the
commit graph's eight lane colours mean only "not the same as my neighbour".

Density is deliberate and non-negotiable. Rows are 28–30px, type has exactly two
sizes, chrome heights are fixed rather than derived from their tallest child, and
icon affordances paint no background at any time. The reference points are
Linear's construction discipline and Factorio's palette; the anti-reference is a
16px-body web app with generous padding, which at this row count reads as a
different, chunkier application borrowed from elsewhere.

**Key Characteristics:**

- Dark-first: the dark theme is the identity, not a mode; a light theme exists
  and is a translation, never a tint.
- Two type sizes, 14px and 12px, with no third step.
- One accent, used where the human must act — and almost nowhere else.
- Flat: depth is four lightness steps and a hairline border.
- Quiet until asked: affordances appear on hover; only state stays lit.
- Machined chrome: explicit heights, hairline dividers, no decoration.

## Colors

A single near-neutral cool-grey ramp at hue 250, cut once by a warm amber, with
a small set of signal and categorical hues that never leave their jobs.

### Primary

- **Factorio Amber** (`oklch(81.3% 0.165 75)` / `#FFB020`): the accent, the focus
  ring, the brand mark's `F`, and the `waiting` status — one value for all four
  on purpose. It appears on primary buttons, on the icon that has just been
  hovered, on a selected item's marker, and on the session that wants you. The
  light theme uses a darker step (`oklch(58% 0.17 75)`) because `#FFB020` on a
  98% ground is unreadable; **one brand amber does not mean one token value in
  every theme.**

### Secondary

- **Session Green** (`oklch(68% 0.17 150)`): `working`. The only always-on colour
  in a busy sidebar, and the only one that may animate — a 1.5s opacity pulse,
  opt-in, granted to the single dot in a session header and withheld from the
  dozen in the sidebar and tab strip.
- **Inert Slate** (`oklch(55% 0.01 250)`): `stopped`. Nearly colourless by
  design. This state asks nothing of you, so it gets the least colour in the app
  — it took over the grey that the deleted `idle` state left behind, after
  spending a year as the loudest red on screen.

### Tertiary

- **Build Violet** (`oklch(68% 0.19 300)`): the development-build marker, and the
  one hue nothing else in the palette uses. A release window and a dev window are
  otherwise identical on screen, and confusing them costs a live session.
- **The lane scale** (`lane-0`…`lane-7`): eight categorical hues for the commit
  graph's rail, chosen for legibility at a 6px pitch, for adjacent-pair contrast
  including the wrap from 7 back to 0, and for hue spacing wide enough to survive
  both themes. They deliberately reuse hues the semantic tokens hold; the rail is
  not a signal surface, so the overlap costs nothing.

### Neutral

- **Console Black** (`oklch(16% 0.008 250)`): the app ground.
- **Panel Charcoal** (`oklch(18% 0.008 250)`): raised chrome — the sidebar, the
  top bar, popovers and menus. Two lightness points above the ground is the whole
  elevation cue.
- **Pressed Graphite** (`oklch(22% 0.008 250)`): a selected row, an active tab,
  an input's field.
- **Hairline** (`oklch(25% 0.008 250)`): every divider and border in the app, and
  the shell's own outline against the desktop.
- **Mercury** (`oklch(96% 0.004 250)`): focused text — a selected row, a hovered
  row, the thing you are reading now.
- **Resting Text** (`oklch(82% 0.006 250)`): repeated text at rest — a commit
  subject, a filename in a list.
- **Metadata Grey** (`oklch(56% 0.006 250)`): counts, SHAs, timestamps, section
  headers, and every icon affordance at rest.

### Named Rules

**The One Amber Rule.** Amber means *the human's turn*. It is the accent, the
ring, the mark and the `waiting` status at a single value, and it must not be
spent on decoration, on a chart series, or on a state that resolves itself. If
two ambers would ever sit three percent apart on screen, one of them is wrong.

**The Focus-Not-Default Rule.** Full `foreground` is a focus, not a default. Text
repeated down a list rests at `secondary-foreground` and takes `foreground` from
its row's hover; a *selected* row keeps `foreground` permanently, because
selection is a state and not a hover. A column where every row is at 96%
lightness has no focus at all.

**The Chrome-Is-One-Colour Rule.** The previous rule is about rows in a list, not
about chrome. Top-bar icons are all one colour, and a toggled-on control does not
brighten: state that a surface already shows needs `aria-pressed`, not a second
colour.

## Typography

**Body Font:** Inter (with `system-ui`, `sans-serif`)
**Mono Font:** JetBrains Mono (with `Fira Code`, `monospace`) — terminal, SHAs,
paths, chips
**Display Font:** none. There is no hero on any surface in this product.

**Character:** Grid-fit Inter at 14px, with `rlig` and `calt` on. At this size
FreeType snaps stems to whole pixels, which makes the face read denser and
squarer than its outlines actually are — that density is the app's voice, and the
brand lockup has to condense 6% to imitate it at large sizes.

### Hierarchy

- **Title** (500, 14px/20px): tab labels in all three strips, sidebar project and
  session rows, commit subjects, menu items, buttons. Anything you read to
  navigate.
- **Body** (400, 14px/20px): the same size, unweighted — prose in dialogs,
  settings descriptions, viewer content.
- **Label** (500, 12px/16px, +0.05em, often uppercase): metadata, status,
  section headers. `PROJECTS`, a turn count, `missing`, the indexer line, chip
  text.
- **Mono** (400, 12px/16px): terminal output, SHAs, file paths, branch chips.

### Named Rules

**The Two Sizes Rule.** There are exactly two type sizes and 14px is the floor
for anything you read to navigate. There is no 13px step and there must not be
one, so the only question a new string raises is which of the two it is.
Hand-written sizes (`text-[11px]`) are how the scale erodes; the single standing
exception is a 16px avatar's initials.

**The Shrink-The-Padding Rule.** Making a component denser means reducing its
padding, never its labels. A menu row is tightened from 32px to 28px by its
`py-*`, and its item text stays at 14px.

## Layout

A fixed three-column desktop shell inside a bordered window: **sidebar** (resizable, ~288px default) · **session area** (flex, min-width 0) · **file panel** (resizable, collapsible to nothing). The shell itself draws a hairline border on its sides and bottom only — the titlebar caps the top — which is what gives the window a defined silhouette against the desktop. Bottom corners are rounded (12px) on macOS only; on Linux, where the WM clips nothing, a radius takes a bite out of the shell and reads worse than a square corner.

There is no responsive breakpoint system. This is a desktop application with a
minimum window size, and the two side panels are user-resized rather than
media-queried. Density is constant across widths; what changes is how much a
truncating string shows, which is capped in proportion to its own column rather
than by a constant.

**Chrome heights are explicit, never derived.** Top bar 42px (`h-10.5`); file
panel header and sidebar footer 36px (`h-9`); session tab 30px (`h-7.5`); menu
row 28px; sidebar rows 26–28px. A row sized by padding moves the moment a taller
child appears in it, and the thing that appears is by definition the thing you
were already looking at — the sidebar footer once grew 6px to announce a staged
update the badge inside it was already announcing.

**Spacing rhythm** is 4 / 6 / 8 / 12px. Gaps inside a row are 4–8px; a chrome
row's horizontal padding is 8–12px; content panels use 12px. Nothing in the app
uses a 16px+ step except modal internals.

### Named Rules

**The Fixed-Chrome Rule.** Every chrome row declares its height. If a child can
grow, it truncates or scrolls; it does not push its container.

**The One-Fact Row Rule.** 28px is the height of a row carrying one fact. A row
that describes an *object* rather than an action may stack a 12px subtitle under
its label — a checkout picker row does — because a name and a branch side by side
in one row truncate each other down to the prefix they share.

## Elevation & Depth

**The system is flat and tonal.** Depth is carried by four lightness steps at one
hue — ground 16%, panel 18%, pressed 22%, border 25% — plus a hairline border,
and by nothing else. There are no ambient shadows, no gradients, no bevels, no
glows on resting surfaces. A panel is above the ground because it is two points
lighter and separated by a 1px line.

Shadows exist only where a surface genuinely floats above the app rather than
being part of it: the dialog, the popover, the dropdown and context menus, and
the card primitive. They are a statement that the surface is temporary, not a
decoration.

### Shadow Vocabulary

- **Resting surface** (`box-shadow: none`): every panel, row, tab, input and
  button in the app. This is the default and the overwhelming majority.
- **Floating surface** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)` and its
  `-md` step for menus and dialogs): applied only to overlays and to `Card`.

### Named Rules

**The Flat-By-Default Rule.** A surface that stays on screen gets tone and a
hairline. A surface that appears over the app and will be dismissed gets a
shadow. Nothing gets both a shadow and a tonal step to say the same thing twice.

## Shapes

Corners are small and consistent: 8px (`--radius`) for cards and dialogs, 6px for
buttons, inputs and selects, 4px for the dense objects — tabs, menu items, icon
buttons, chips — and full-round only for a status dot and a badge pill. Nothing
in the app is square-cornered except the panel edges themselves.

Borders are always 1px and always `border`. There are no 2px rules, no double
borders, no dashed edges. Emphasis is made by tone or by colour, never by weight
of line.

The recurring silhouette is **the chip**: a 4px-radius bordered pill with 12px
text, 1px×4px padding, and a `border-X/30 bg-X/12 text-X` tint mixed from one
hue. Branch refs use it, tags use it, the dev badge uses it. A chip that picks
its own geometry is a chip that drifts, so the shape is imported from one
constant rather than re-written per component.

The brand mark carries the only other geometry the system recognises: a
full-bleed rounded square (3.5 of 16 cells) with three port notches cut to
transparency on the left and right edges, and a single 45° terminal on the `F`'s
mid bar. That 45° cut is the identity's one piece of character and is used
exactly once.

## Components

### Buttons

- **Shape:** gently rounded (6px), 32px tall at default, 28px at `sm`, 36px at
  `lg`. Icons inside are 14px.
- **Primary:** amber ground, near-black text (`{components.button-primary}`),
  12px horizontal padding.
- **Hover / Focus:** primary and secondary darken their own ground by 10–20%;
  focus is a 2px amber ring with a 2px offset in the surface colour. Transitions
  are colour-only.
- **Secondary / Outline / Ghost / Link:** secondary is a `22%` ground; outline is
  a bordered transparent field; ghost fills with accent on hover; link is amber
  text with an offset underline.
- **The scale is a desktop scale, not a stock web one.** It was derived from what
  the app's dense surfaces were already overriding to by hand. If you find
  yourself writing a seventh inline override, the scale is wrong again — not the
  call site.

### Icon Buttons

The house style for every icon-only control, and **not** a ghost button.

- **Shape:** 4px radius, 2px padding around a 14px glyph (`sm`), 4px around 16px
  (`md`).
- **Rest / Hover:** muted grey at 70% opacity, going to **amber**. It paints no
  background in any state.
- **Why:** at 14px a filled hover block is bigger than the thing it highlights
  and reads as a widget rather than an affordance.
- It carries no `cursor-pointer` class on purpose, so the global base rule stays
  in charge of withholding the pointer from disabled controls.

### Rows and Disclosure

- **Chevrons take colour on hover too** — the sidebar's expand toggle from its
  own hover, the file tree's from its row's, since there the whole row is the
  click target.
- **Rows you act on repeatedly** — pinned, selected — keep their hover
  affordances permanently visible. Everything else stays quiet until hovered.

**The Pointer Base Rule.** Anything clickable shows `cursor: pointer`, granted by
one base rule covering `button`, `a[href]`, `select`, `summary`, `label[for]` and
the ARIA interactive roles — never a utility class per control, which gets
forgotten exactly where a control is hand-rolled. Disabled controls are excluded:
a pointer on something inert is a lie. A new interactive role joins the base rule
rather than being patched onto the component.

### Inputs / Fields

- **Style:** 32px tall, 6px radius, 1px `input` border, app-ground fill, 14px
  text, muted placeholder.
- **Focus:** 2px amber ring at a 2px offset — the same ring every control uses.
- **Disabled:** 50% opacity and a not-allowed cursor.

### Menus (Dropdown and Context)

- **Row:** 28px, 4px vertical padding, a 28px indicator gutter on the left, 4px
  radius, highlighted on a `secondary` ground.
- **Section label:** 12px uppercase in the same voice as `PROJECTS` — a menu's
  section label is a section header, not a bolded title.
- These metrics live on the primitives so every menu inherits them, rather than
  on the one menu whose padding somebody happened to notice.

### Chips

- **Style:** 4px radius, 1px border at 30% of its hue, a 12% tint behind, and the
  hue itself as text. 12px, medium weight, 1px×4px padding, 4px gap for an inline
  icon.
- **Truncation:** capped against the width of the *text* column it sits in, never
  a constant, and never past 55% of it — two long branch names on one row still
  have to leave the subject something.

### Cards / Containers

- **Corner:** 8px. **Background:** `card`. **Border:** hairline.
- **Shadow:** the small floating step (see Elevation).
- **Internal padding:** 24px — the one place in the app that uses a spacing step
  this large, and it is a modal-scale container rather than a row.

### Session Tabs (signature)

The horizontal strip that stands in for an editor's file tabs, one tab per live
agent session.

- 30px tall, capped at 240px wide, 4px radius, 14px label, an 8px status dot on
  the left and a close affordance on the right that appears on hover or focus.
- Active tab: `secondary` ground and full-strength text. Inactive: transparent
  and muted.
- Reordering is pointer-based (dnd-kit) with a 4px activation distance so a click
  stays a click, and every drag ships a keyboard path beside it.

### Status Dot (signature)

An 8px round mark in `working` green, `waiting` amber, or `stopped` grey, with
the state's name as its title. **Still by default** — the pulse is opt-in,
because the dot appears in the sidebar's project rows, its session rows and the
tab strip at once, and a dozen things breathing at their own rate is a christmas
tree rather than a signal. The animation is earned in the session header, where
there is exactly one and it describes what you are looking at.

### Graph Rail (signature)

A 6px-pitch lane rail beside the commit list, drawn in the eight categorical
lane colours. Lanes are allocated left-first and recycled, so the palette is
chosen for *adjacent-pair* contrast including the wrap, not for looking distinct
as swatches. The renderer cycles `index % LANE_COUNT`; a ninth colour token
without that constant would simply never be drawn.

## Do's and Don'ts

### Do:

- **Do** use one of the two type sizes — 14px to navigate by, 12px for metadata,
  status and section headers.
- **Do** give every chrome row an explicit height, and let its children truncate.
- **Do** use `IconButton` for every icon-only control, and let its hover be the
  icon taking amber.
- **Do** keep repeated text at `secondary-foreground` and let hover or selection
  promote it to `foreground`.
- **Do** import the chip shape from its constant rather than re-deriving its
  border, radius, padding and size.
- **Do** let a chevron take colour from whatever the click target is — its own
  hover when it is the target, its row's when the row is.
- **Do** ship a keyboard path beside every pointer gesture — a feature only a
  mouse can reach is half a feature.
- **Do** give a light-theme token its own value rather than a tint of the dark
  one; lane colours drop ~20 lightness points and move per hue between themes.
- **Do** report while a manual refresh works, and stop on a rotation boundary so
  a 20ms refetch is one clean turn rather than a one-frame flash.

### Don't:

- **Don't** spend amber on anything that is not the human's turn to act.
- **Don't** paint a background behind an icon button in any state, including
  hover, active and toggled-on.
- **Don't** brighten a chrome icon to show it is toggled on — the surface it
  toggles is already visible; use `aria-pressed`.
- **Don't** introduce a third type size, and don't hand-write one
  (`text-[13px]`) to sneak past the scale.
- **Don't** add a shadow to a surface that stays on screen; tone and a hairline
  are the elevation model.
- **Don't** animate more than one thing at a time in a list. Status animation is
  opt-in and belongs to the single dot that describes the current view.
- **Don't** use HTML5 drag-and-drop; it is dead in this shell on macOS. Drag with
  pointer events.
- **Don't** grant the pointer cursor with a per-control class; extend the base
  rule instead, so disabled controls keep being excluded.
- **Don't** put a raw `<input>`, `<button>` or `<select>` in app code — the
  primitives carry the scale, and an element that opts out of them is the next
  inline override.
