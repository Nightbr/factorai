#!/usr/bin/env bash
# Click the factorai window at the given window-relative pixel coordinates.
#
# Usage:  scripts/qa/click.sh X Y [BUTTON]
#         BUTTON defaults to 1 (left). 2=middle, 3=right.
#
# Coordinates are relative to the top-left of the factorai content area,
# so they don't drift if the window moves between captures.

set -euo pipefail

if [[ $# -lt 2 ]]; then
	echo "usage: $0 X Y [BUTTON]" >&2
	exit 64
fi
RX=$1
RY=$2
BTN=${3:-1}

read -r _ DEC ORIG_X ORIG_Y _ _ < <("$(dirname "$0")/_resolve_wid.sh")
ABS_X=$(( ORIG_X + RX ))
ABS_Y=$(( ORIG_Y + RY ))

xdotool windowactivate --sync "$DEC"
xdotool mousemove --sync "$ABS_X" "$ABS_Y"
xdotool click "$BTN"
echo "[qa] clicked window-relative ($RX, $RY) → absolute ($ABS_X, $ABS_Y) button $BTN" >&2
