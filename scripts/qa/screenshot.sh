#!/usr/bin/env bash
# Focus factorai and write a PNG of the active window.
#
# Usage:  scripts/qa/screenshot.sh /tmp/out.png
#
# Picks the first available capture tool:
#   1. gnome-screenshot -w -f  (GNOME, the dev's setup)
#   2. import -window <wid>     (ImageMagick — works under any X11 WM)
#   3. scrot -u                 (lightweight X11)
#
# Wayland is not supported by these tools; on Wayland we'd switch to grim.

set -euo pipefail

if [[ $# -lt 1 ]]; then
	echo "usage: $0 <output.png>" >&2
	exit 64
fi
OUT=$1

"$(dirname "$0")/focus.sh"

if command -v gnome-screenshot >/dev/null 2>&1; then
	gnome-screenshot -w -f "$OUT"
elif command -v import >/dev/null 2>&1; then
	WID=$(wmctrl -l | awk 'tolower($0) ~ /factorai/ {print $1; exit}')
	import -window "$WID" "$OUT"
elif command -v scrot >/dev/null 2>&1; then
	scrot -u "$OUT"
else
	echo "[qa] no screenshot tool found (need gnome-screenshot / import / scrot)" >&2
	exit 1
fi

echo "[qa] screenshot → $OUT" >&2
