#!/usr/bin/env bash
# Capture the factorai window as a documentation image: 1440x900, client area
# only, no window frame and no drop shadow.
#
# Usage:  scripts/qa/doc-shot.sh OUT.png
#
# 1440x900 because that is what every image already in `docs/images/` is, and a
# README where one screenshot is a different size reads as a mistake.
#
# **The window is resized rather than the capture resampled.** Scaling a
# screenshot down softens 12px text into mush — the whole app is 12 and 14px type,
# so it is the first thing to go. `wmctrl` sets the *frame* size and the WM adds
# its decoration, so the client area lands at 1440x900 only because this asks for
# exactly that and then crops what it measures rather than what it asked for.
#
# The DEV badge is a separate problem this script does not solve: launch with
# `VITE_FACTORAI_SCREENSHOT=1` and it is not rendered. See `DevBadge.tsx`.

set -euo pipefail

if [[ $# -lt 1 ]]; then
	echo "usage: $0 OUT.png" >&2
	exit 64
fi
OUT=$1
WIDTH=${DOC_SHOT_WIDTH:-1440}
HEIGHT=${DOC_SHOT_HEIGHT:-900}

here=$(dirname "$0")
read -r WID DEC _ _ _ _ < <("$here/_resolve_wid.sh")

# Ask for a client area of exactly WIDTHxHEIGHT. wmctrl's -e takes the frame, and
# the WM grows it by the decoration, so the client comes out at the requested size
# on this desktop; the crop below uses what `xwininfo` reports either way.
wmctrl -i -r "$DEC" -e "0,100,60,$WIDTH,$HEIGHT"
sleep 1.5

CW=$(xwininfo -id "$WID" | awk '/^  Width/{print $2}')
CH=$(xwininfo -id "$WID" | awk '/^  Height/{print $2}')
if [[ "$CW" != "$WIDTH" || "$CH" != "$HEIGHT" ]]; then
	echo "[doc-shot] client area is ${CW}x${CH}, wanted ${WIDTH}x${HEIGHT}" >&2
	echo "[doc-shot] the WM refused the resize — tile/maximise state, or a size hint" >&2
	exit 1
fi

TMP=$(mktemp --suffix=.png)
trap 'rm -f "$TMP"' EXIT

# **The whole screen, not the window.** `screenshot.sh` uses `gnome-screenshot -w`,
# which includes the decoration *and* the compositor's drop shadow — and the
# shadow's width is not reported anywhere, so cropping the client area out of that
# capture means guessing a margin. A full-screen grab has no such problem: the
# client area sits at exactly the absolute coordinates `xwininfo` reports.
xdotool windowactivate --sync "$DEC"
sleep 0.4
gnome-screenshot -f "$TMP"

AX=$(xwininfo -id "$WID" | awk '/Absolute upper-left X/{print $4}')
AY=$(xwininfo -id "$WID" | awk '/Absolute upper-left Y/{print $4}')
OFF_X=$AX
OFF_Y=$AY

python3 - "$TMP" "$OUT" "$OFF_X" "$OFF_Y" "$CW" "$CH" <<'PY'
import sys
from PIL import Image

src, out, ox, oy, w, h = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:7])
im = Image.open(src)
crop = im.crop((ox, oy, ox + w, oy + h))
if crop.size != (w, h):
    raise SystemExit(
        f"cropped to {crop.size}, wanted {(w, h)} — the capture is smaller than the "
        "window's absolute coordinates, which means the screen is scaled and this "
        "crop cannot be trusted (see scripts/qa/README.md)"
    )
# A screenshot of a dark UI has no business carrying an alpha channel or a colour
# profile into a README.
crop.convert("RGB").save(out, optimize=True)
print(f"[doc-shot] {out} {crop.size[0]}x{crop.size[1]}")
PY
