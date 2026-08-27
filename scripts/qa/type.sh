#!/usr/bin/env bash
# Type literal text into the factorai window.
#
# Usage:  scripts/qa/type.sh [--enter] "string to type"
#
# Use --enter to press Return after typing (handy for terminal input).

set -euo pipefail

ENTER=0
if [[ ${1:-} == "--enter" ]]; then
	ENTER=1
	shift
fi

if [[ $# -lt 1 ]]; then
	echo "usage: $0 [--enter] \"text\"" >&2
	exit 64
fi
TEXT=$1

# **No `--window`.** That path uses XSendEvent, which WebKitGTK ignores — this
# directory's README says so about `key.sh` and this script had it too, so neither
# could type into the WebView at all. Activating the window and sending through
# XTest (plain `xdotool type`) is what actually reaches the page. Measured
# 2026-08-27, renaming a sidebar group: with `--window` the inline editor kept its
# selected default text and never saw a keystroke.
read -r WID DEC _ _ _ _ < <("$(dirname "$0")/_resolve_wid.sh")
xdotool windowactivate --sync "$DEC"

# Assert, don't assume: `windowactivate --sync` returns when the request is
# served, not when the WM has honoured it, and XTest goes to whatever has focus —
# so an unhonoured activation types into someone else's window. Compare pids, per
# the README.
WANT_PID=$(xdotool getwindowpid "$WID")
GOT_PID=$(xdotool getactivewindow getwindowpid)
if [[ "$WANT_PID" != "$GOT_PID" ]]; then
	echo "[qa] refusing to type: focused window belongs to pid $GOT_PID, factorai is $WANT_PID" >&2
	exit 1
fi

xdotool type --clearmodifiers --delay 8 -- "$TEXT"
if (( ENTER )); then
	xdotool key --clearmodifiers Return
fi
echo "[qa] typed ${#TEXT} chars$( ((ENTER)) && echo ' + Return' )" >&2
