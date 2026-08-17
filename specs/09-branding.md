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

`factorai-mark.svg` is the reference for the one-colour cut; the renderer draws
it from a component rather than loading this file (B8).

**It is an inline-only asset.** `currentColor` has nothing to inherit when the
SVG is the document — opened as a file, set as a favicon, or used as an `<img
src>` it resolves to the initial colour and renders as a **black** block. A file
manager listing it proves the point. Anything standalone and single-fill has to
set an explicit `fill`; do not reach for this file and expect it to pick a
sensible colour on its own.

There is one deliberate copy: **`apps/desktop/public/favicon.svg` is
byte-identical to the master.** Vite only serves `public/`, and a build step to
copy one file across is more machinery than the copy is worth;
`src/components/brand/geometry.test.ts` fails the moment the two diverge.

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

**Regenerating the icons does not rebuild the app.** `tauri-build` does not
declare the icon files as `rerun-if-changed`, so `cargo build` after a
`tauri icon` run finishes in a fraction of a second and the binary keeps the
*old* window icon — verified, and silent. Touch the config to force it:

```bash
touch apps/desktop/src-tauri/tauri.conf.json && cargo build
```

Do not try to confirm the result by grepping the binary for the PNG bytes: the
window icon is decoded to raw RGBA at build time, so a verbatim search always
fails and proves nothing. Read `_NET_WM_ICON` off the running window instead
(B9).

---

## B8 — The mark inside the app

`components/brand/Brand.tsx` exports two things:

| Export | What it draws |
|---|---|
| `Brand` | the header lockup: the mark in `text-primary`, then the wordmark |
| `BrandWordmark` | `factor` + `ai`, the `ai` in `text-primary` |

The mark itself is a module-private component. A full-colour variant — the
icon's own dark housing and amber F, rather than `currentColor` — was written
and then deleted: nothing needed it, `deps:unused` said so, and an export kept
alive for a future caller is the kind of thing that is still there and still
wrong two years later. Add it back when a second surface actually wants it.

**The geometry is mirrored by hand** in `components/brand/geometry.ts`, for the
reason `CLAUDE.md` § 4 gives for the IPC types: the renderer gets a real
component that inherits `currentColor` and needs no asset plumbing, and
`geometry.test.ts` fails the moment the mirror and the master disagree. Change
the master first, always.

**The ports mask needs a unique id per instance.** Two marks on one screen
sharing a mask id means the second renders unmasked — no notches, a plain
rounded square. `usePortsMaskId` derives one from `useId` and strips its colons,
which a `url(#…)` reference is better off without.

**Wordmark rule: the name is set one way in this app.** `factor` in the
surrounding text colour, `ai` in `--primary`. It reads, selects and copies as
one word. Anywhere the product is named in chrome — header, empty state, about
box — uses `BrandWordmark` rather than spelling the string out, so there is
exactly one place to change it.

The header lockup was checked against a full tab strip, which was the open
question when this was scoped: mark, wordmark and dev badge hold the left end
and the tabs take the middle without crowding it.

---

## B9 — What the desktop actually shows

Verified on X11 + Cinnamon, 2026-08-17, against a running dev build.

**The window icon is correct and can be checked directly.** The binary publishes
it as `_NET_WM_ICON`; read it off the live window rather than trusting the
build:

```bash
WID=$(wmctrl -lp | awk '/factorai DEV/{print $1}')
xprop -id "$WID" -notype 32c _NET_WM_ICON     # w, h, then w*h ARGB pixels
```

That returns one 32×32 image, and it is the mark: dark housing, amber F, ports
transparent.

**The panel does not use it.** A window is matched to a `.desktop` entry by
`WM_CLASS` — ours is `factorai` — and the entry's `Icon=` key wins over
`_NET_WM_ICON`. On this machine `~/.local/share/applications/factorai.desktop`
(installed by the AppImage, not by this repo) points at `Icon=factorai`, which
resolves to `~/.local/share/icons/hicolor/*/apps/factorai.png` — **a stale
circular mark from before this identity existed**. Both the release app and the
dev build show it, because they share a `WM_CLASS`.

So: shipping an icon in the bundle is not sufficient for the dock. The
`.desktop` entry and the `hicolor` theme files are the thing the shell reads,
and they are what roadmap item 18 still has open.

**This machine was fixed by hand on 2026-08-17** — the theme files regenerated
from the master at 16/24/32/48/64/128/256/512 plus a `scalable` SVG, the entry's
`Name` corrected from `FactorAI` to `factorai`, and `gtk-update-icon-cache` run.
The panel picked it up without a restart. That is a repair, **not the fix**: it
touched `~/.local/share`, so it holds for one user on one machine and a fresh
install still gets whatever the bundler writes. Note also that `256x256@2`
carried a 256px file — an `@2` directory means twice the nominal size, so it
should be 512, and the bundler should not repeat that.

**The dark housing recedes on dark grounds.** At 16px in a dark file manager,
`#272B31` sits close enough to the surrounding chrome that the notched
silhouette stops registering and the mark reads as a bare amber F. It is still
identifiable — the F is doing the work — but the silhouette argument in B1 holds
only where there is contrast behind the icon. Worth knowing before assuming the
outline carries everywhere.

---

## B10 — The tagline

> **Agentic Development Environment (ADE) for the AI era**

Set 2026-08-17. One string, and it is the *description* — the line that goes in
metadata fields, where something machine-read and self-explanatory is wanted.

It is deliberately not the README's opening, which is **"IDE is dead. Long live
the ADE"**. That is a hook: it is better at making someone read the next
sentence and worse at telling a package manager or an application menu what this
program is. Keeping both, with each in the place it works, is the point — do not
"unify" them.

Every place the tagline is repeated, and they must match:

| Where | Field |
|---|---|
| `package.json` (root) | `description` |
| `apps/desktop/package.json` | `description` |
| `apps/desktop/src-tauri/Cargo.toml` | `description` |
| `apps/desktop/src-tauri/tauri.conf.json` | `bundle.shortDescription` |
| GitHub repository | About → description |

`bundle.shortDescription` is the load-bearing one: it is what the bundler writes
into the generated `.desktop` entry's `Comment`, so it is the line that shows
under the name in an application launcher. `bundle.longDescription` carries the
paragraph version for the same metadata, and nothing else uses it yet.

The AppImage installed before this existed carried `Comment=Command center for
Claude Code sessions` and `Name=FactorAI`. Both are wrong now; both are fixed by
a fresh install once the bundler work in roadmap item 18 lands.
