#!/usr/bin/env bash
# Send keyboard input to the factorai window.
#
# Usage:  scripts/qa/key.sh KEY [KEY...]
#
# Examples:
#   scripts/qa/key.sh ctrl+f
#   scripts/qa/key.sh Return
#   scripts/qa/key.sh Escape
#   scripts/qa/key.sh ctrl+c

set -euo pipefail

if [[ $# -lt 1 ]]; then
	echo "usage: $0 KEY [KEY...]" >&2
	exit 64
fi

# **No `--window`.** That path uses XSendEvent, which WebKitGTK ignores — which
# this directory's README already said, while this script did the opposite. See
# `type.sh` for the measurement.
read -r WID DEC _ _ _ _ < <("$(dirname "$0")/_resolve_wid.sh")
xdotool windowactivate --sync "$DEC"

# XTest goes to whatever holds focus, so an unhonoured activation would send keys
# into another window. Compare pids before sending.
WANT_PID=$(xdotool getwindowpid "$WID")
GOT_PID=$(xdotool getactivewindow getwindowpid)
if [[ "$WANT_PID" != "$GOT_PID" ]]; then
	echo "[qa] refusing to send keys: focused window belongs to pid $GOT_PID, factorai is $WANT_PID" >&2
	exit 1
fi

xdotool key --clearmodifiers "$@"
echo "[qa] sent key(s): $*" >&2
