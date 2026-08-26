#!/usr/bin/env bash
# Drag inside the factorai window, from one point to another.
#
# Usage:  scripts/qa/drag.sh FROM_X FROM_Y TO_X TO_Y [STEPS]
#         STEPS defaults to 12 — the number of intermediate mousemoves.
#
# **Coordinates are content-area relative, unlike `click.sh`'s.** This script
# resolves its origin with `xwininfo -id <wid>` (the client area) rather than
# from `wmctrl -lG` (the decoration window), so it does not carry the (47, 73)
# frame offset documented for `click.sh` in this directory's README — and the top
# 73 rows of the content area are reachable here. To convert a coordinate you
# measured off a full-window screenshot, subtract (48, 72).
#
# **Why the intermediate moves are not optional.** dnd-kit's PointerSensor waits
# for the pointer to travel past an activation distance (4px in this app) before
# it starts tracking a drag at all, and it decides the drop target from where the
# pointer is when the button comes up. A press, one jump and a release therefore
# does nothing: the sensor never activated, so the release is a click. Stepping
# also lets React re-render the list between moves, which is what makes a drag
# look like a drag rather than a teleport in a screenshot.
#
# **The focus assertion is the safety rule, and it compares PIDs.** A stale
# window origin once put a QA click into the user's Slack; a press-move-release
# is worse, because a drag across another app's window can move or destroy
# something. Geometry is re-resolved on every invocation and the press only
# happens once X agrees the focused window belongs to the factorai process. A
# **pid** check rather than a window-id or title check, per the README: a GTK
# popup is a different id with no name, so a title check fails where a pid check
# holds.
#
# `xdotool` is given absolute coordinates only, never `--window` — that path uses
# XSendEvent, which WebKitGTK ignores.

set -euo pipefail

if [[ $# -lt 4 ]]; then
	echo "usage: $0 FROM_X FROM_Y TO_X TO_Y [STEPS]" >&2
	exit 64
fi
FROM_X=$1
FROM_Y=$2
TO_X=$3
TO_Y=$4
STEPS=${5:-12}

if [[ $STEPS -lt 2 ]]; then
	echo "[qa] STEPS must be at least 2 — one move cannot pass an activation distance" >&2
	exit 64
fi

read -r WID DEC _ _ _ _ < <("$(dirname "$0")/_resolve_wid.sh")

xdotool windowactivate --sync "$DEC"

# `windowactivate --sync` returns when the request is served, not when the WM has
# honoured it, and a denied activation is silent. So assert.
WANT_PID=$(xdotool getwindowpid "$WID")
GOT_PID=$(xdotool getactivewindow getwindowpid)
if [[ "$GOT_PID" != "$WANT_PID" ]]; then
	echo "[qa] refusing to drag: focused window belongs to pid $GOT_PID, factorai is $WANT_PID" >&2
	exit 1
fi

# The client area, which is what the coordinates are relative to.
ORIG_X=$(xwininfo -id "$WID" | awk '/Absolute upper-left X/{print $4}')
ORIG_Y=$(xwininfo -id "$WID" | awk '/Absolute upper-left Y/{print $4}')

move_to() {
	xdotool mousemove --sync $(( ORIG_X + $1 )) $(( ORIG_Y + $2 ))
}

move_to "$FROM_X" "$FROM_Y"
xdotool mousedown 1

for ((i = 1; i <= STEPS; i++)); do
	move_to $(( FROM_X + (TO_X - FROM_X) * i / STEPS )) $(( FROM_Y + (TO_Y - FROM_Y) * i / STEPS ))
	sleep 0.02
done

# A beat at the destination before releasing: dnd-kit computes the drop from the
# last position it processed, and releasing in the same frame as the final move
# can land on the previous target.
sleep 0.15
xdotool mouseup 1

echo "[qa] dragged content-relative ($FROM_X, $FROM_Y) → ($TO_X, $TO_Y) in $STEPS steps" >&2
