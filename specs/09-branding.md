# Branding

The mark, how it is built, and how the shipped assets are produced. This is a
contract like every other spec: if the code and this file disagree, one of them
is wrong and gets fixed.

Assets live in [`docs/brand/`](../docs/brand/). Everything the app ships is
generated from **one** of them — `factorai-icon.svg`.

---

## B1 — The mark

A notched dark housing with an amber **F** knocked into it.

The housing reads two ways on purpose. It is a machine seen from above, which is
the Factorio half of the name; and it is a chip package, which is the AI half.
Neither is spelled out, because three glyphs never fit a 16px square and an icon
that has to be read is an icon that has already lost.

**The ports are the idea.** Three notches on the left edge and three on the
right, nothing on the top or bottom: something goes in, something comes back.
That is what a session is. They also do the load-bearing practical work — a dock
icon is judged as a silhouette before it is judged as a drawing, and the ports
are the only thing here that makes the outline unmistakable at 16px. **They cut
to transparency, not to a colour.** The desktop shows through them. That is what
makes the silhouette work, and it is why nothing may be painted behind them.

The construction discipline is borrowed from Linear — one flat colour per
element, no outline, no gradient, no bevel, no shadow, the shape filling its
canvas edge to edge — and the motif and palette from Factorio.

---

## B2 — Construction

Everything sits on a **16 × 16 cell grid**. In the shipped SVG the viewBox is
`0 0 512 512`, so **one cell = 32 units**. All measurements below are in cells,
because the grid is the thing that survives a rescale and the units are not.

**Housing.**

| | |
|---|---|
| Shape | full-bleed rounded square |
| Corner radius | 3.5 cells |
| Fill | `#272B31` |
| Ports | 3 per side, **left and right edges only** |
| Port position | y = 3, 7, 11 cells |
| Port size | 2 cells tall, **1.3 cells deep** |
| Port fill | none — cut to transparency |

Ports are symmetric by construction: the same depth is measured inward from each
edge. An earlier cut had the left notch 1.1 cells deep and the right 1.5, which
is invisible until you look for it and then impossible to unsee.

**The F.** Drawn, not set from a typeface — see B3.

| | |
|---|---|
| Ink box | x 4.8, y 4.25, width 7, height 7.6 |
| Stem width | 2.5 |
| Top bar | 1.95 thick, full 7 cells wide |
| Gap between bars | 1.05 |
| Mid bar | 1.85 thick, stopping 1.4 cells short of the top bar's right edge |
| Mid bar terminal | cut at **45°** |
| Fill | `#FFB020` |

Three of those numbers are corrections made by eye, and they will look like
mistakes to anyone who checks them with a ruler:

- **The bars are lighter than the stem** (1.95 and 1.85 against 2.5). Matched
  numerically, a horizontal always reads heavier than a vertical. Set them equal
  and the F sits bottom-heavy.
- **The mid bar is lighter than the top bar.** It is shorter, so it needs less
  weight to hold the same colour.
- **The letter is nudged 0.3 cells right of box centre** (x 4.8, where centring
  the ink box would put it at 4.5). An F is left-heavy — full-height stem, empty
  bottom right — so a box-centred F parks visually too far left.

**The 45° cut** is the mark's one piece of character, and it is used exactly
once. It is the same primitive Linear builds its entire identity from, and
spending it on a single terminal keeps it a signature rather than a treatment.
At 16px it degrades to a slight taper, which is the correct failure mode: it
pays off large and costs nothing small.

---

## B3 — Why the F is drawn and not set

Every installed face was tested inside the housing, matched on **cap height**
rather than point size — the only fair comparison, since every face sets a
different ratio. Inter Black, Inter ExtraBold, JetBrains Mono ExtraBold,
Liberation Sans Narrow Bold and DejaVu Sans Bold all lost the same way: **they
leave air in the housing.** A text face is drawn to sit in a line with
neighbours on both sides, not to fill a square on its own, so inside the housing
it reads as an F in a font rather than as a mark. Inter Black came closest,
purely by being the widest.

Drawing it also removes the licensing question. Most font licences permit a logo
derived from a glyph, but "most" is not a thing to build a trademark on.

---

## B4 — Palette

| Token | Hex | Use |
|---|---|---|
| Housing | `#272B31` | the icon's ground |
| Amber | `#FFB020` | the mark, and the app's existing accent |
| Mercury | `#F4F5F8` | the mark on dark, in one-colour contexts |

The amber is the accent the app already uses; the brand did not invent a colour,
it adopted the one that was there.

---

## B5 — Assets and colourways

| File | What it is |
|---|---|
| `factorai-icon.svg` | full colour, **the master** — every shipped icon derives from this |
| `factorai-mark.svg` | one colour, `fill="currentColor"`, the F punched clean out of the housing |
| `factorai-icon-1024.png` | raster master, for release art and anywhere a PNG is required |
| `factorai-icon-256.png` | the README header |

`factorai-mark.svg` is the one to use in the app UI, where it inherits the
surrounding text colour. It is also the print / favicon / single-fill answer.

An amber-dominant colourway — amber housing, dark F — was drawn and rejected as
the default. It wins the dock but fights every UI it sits next to, and factorai
is a tool you leave open all day.

---

## B6 — Rules

- **Minimum size 16px.** Below that the ports close up and the 45° cut vanishes.
- **Clear space: 2 cells** (⅛ of the icon's width) between the icon and anything
  else.
- **Never paint behind the ports.** They are transparent by design; filling them
  destroys the silhouette, which is the whole argument for this mark.
- **No effects.** No gradient, shadow, glow, stroke, bevel or rotation.
- **Do not recolour the F** to anything but the amber or `currentColor`.
- **Do not rebuild the F from a font.** See B3.

---

## B7 — Regenerating the icons

`tauri icon` produces the whole `src-tauri/icons/` tree — the PNGs listed in
`tauri.conf.json`, plus `icon.icns` (macOS, multi-resolution) and `icon.ico`
(Windows, which we do not ship but the bundler still wants):

```bash
cd apps/desktop && pnpm tauri icon ../../docs/brand/factorai-icon.svg
```

**Feed it the SVG, not a raster master.** `06-milestones.md` and roadmap item 18
both said to hand it a 1024px PNG; the SVG is better, because `tauri icon`
rasterises each size natively from vector instead of downsampling one bitmap,
and this mark is grid-aligned enough for that to be visible at 32px.

It also regenerates `icons/android/` and `icons/ios/`, which we do not ship.
That is harmless and not worth deleting — the next run puts them back.

The command overwrites; it does not merge. Anything hand-edited in that
directory is lost, which is the intended behaviour: the SVG is the source of
truth and nothing in `src-tauri/icons/` should ever be edited directly.
