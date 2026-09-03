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

read -r _ DEC ORIG_X ORIG_Y W H < <("$(dirname "$0")/_resolve_wid.sh")
ABS_X=$(( ORIG_X + RX ))
ABS_Y=$(( ORIG_Y + RY ))

if (( RX < 0 || RY < 0 || RX >= W || RY >= H )); then
	echo "[qa] refusing: ($RX, $RY) is outside the ${W}x${H} content area" >&2
	exit 65
fi

xdotool windowactivate --sync "$DEC"
xdotool mousemove --sync "$ABS_X" "$ABS_Y"

# **Assert what is under the pointer before pressing the button.** A click is
# delivered to whatever window owns that point, not to the window we activated,
# so a wrong origin does not miss — it clicks something else. On 2026-09-03 a
# frame-vs-client mismatch put three clicks into the release factorai behind
# this one, and in an earlier session the same class of error reached the user's
# chat client. The two checks together — inside the content area, and the point
# really belongs to us — are what make a miscomputed coordinate a refusal
# rather than a click in somebody else's app.
UNDER=$(xdotool getmouselocation --shell 2>/dev/null | awk -F= '/^WINDOW=/ {print $2}')
if [[ ${UNDER:-} != "$DEC" ]]; then
	echo "[qa] refusing: ($ABS_X, $ABS_Y) is over window ${UNDER:-unknown}, not factorai dev ($DEC)" >&2
	exit 66
fi

xdotool click "$BTN"
echo "[qa] clicked window-relative ($RX, $RY) → absolute ($ABS_X, $ABS_Y) button $BTN" >&2
