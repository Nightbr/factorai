#!/usr/bin/env python3
"""Blur regions of a screenshot before it ships.

Usage:
    scripts/qa/redact.py IN.png OUT.png X,Y,W,H [X,Y,W,H ...]
    scripts/qa/redact.py IN.png --probe          # print a coordinate grid

Every image in `docs/` and `README.md` is a photograph of the author's real
machine: client and employer project names in the sidebar, `~/` paths, session
titles naming both. Those become permanent and public the moment they are
committed, and rewriting the file later does not remove them from the history.

**Blur, not a solid block.** A filled rectangle reads as a redaction and invites
the question; a blur reads as "not the point of this picture" and the eye moves
on. It also keeps the row's shape, so the screenshot still shows a sidebar with
projects in it rather than a sidebar with holes.

The radius scales with the box height so a blurred name is unreadable rather than
merely soft — a 2px blur on 12px text is still legible if you lean in, which is
the failure mode that matters here.

`--probe` writes a copy with a 100px grid and axis labels over it, so the boxes
can be read off the image instead of guessed and re-run.
"""

from __future__ import annotations

import sys
from PIL import Image, ImageDraw, ImageFilter


def probe(path: str) -> None:
    im = Image.open(path).convert("RGB")
    draw = ImageDraw.Draw(im)
    for x in range(0, im.width, 100):
        draw.line([(x, 0), (x, im.height)], fill=(255, 0, 128), width=1)
        draw.text((x + 2, 2), str(x), fill=(255, 0, 128))
    for y in range(0, im.height, 100):
        draw.line([(0, y), (im.width, y)], fill=(0, 200, 255), width=1)
        draw.text((2, y + 2), str(y), fill=(0, 200, 255))
    out = path.rsplit(".", 1)[0] + "-probe.png"
    im.save(out)
    print(f"[redact] grid → {out} ({im.width}x{im.height})")


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 64

    if sys.argv[2] == "--probe":
        probe(sys.argv[1])
        return 0

    src, dst, boxes = sys.argv[1], sys.argv[2], sys.argv[3:]
    if not boxes:
        print("[redact] no regions given — nothing would be blurred", file=sys.stderr)
        return 64

    im = Image.open(src).convert("RGB")
    for spec in boxes:
        try:
            x, y, w, h = (int(part) for part in spec.split(","))
        except ValueError:
            print(f"[redact] not an X,Y,W,H box: {spec!r}", file=sys.stderr)
            return 64
        if w <= 0 or h <= 0:
            print(f"[redact] box has no area: {spec!r}", file=sys.stderr)
            return 64
        region = im.crop((x, y, x + w, y + h))
        # Tied to the box height, so text is destroyed rather than softened.
        im.paste(region.filter(ImageFilter.GaussianBlur(max(4, h // 3))), (x, y))
        print(f"[redact] blurred {w}x{h} at ({x}, {y})")

    im.save(dst, optimize=True)
    print(f"[redact] {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
