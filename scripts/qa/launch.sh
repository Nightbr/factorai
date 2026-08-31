#!/usr/bin/env bash
# Launch factorai in dev mode, wait for the window to appear, print the PID.
#
# Usage:  scripts/qa/launch.sh [logfile]
# Default logfile: /tmp/factorai-qa.log
#
# The script returns once the window manager reports a "factorai DEV"
# window (so callers can immediately focus/screenshot/kill). A debug build
# titles itself that; a release factorai open on the same desktop is titled
# plain "factorai" and must never be mistaken for ours. If the window never
# appears within $LAUNCH_TIMEOUT_S seconds, exits non-zero.
#
# Designed to be called by an AI agent in a verification loop; the safety rules
# for driving the window afterwards are in `scripts/qa/README.md`.

set -euo pipefail

LOG=${1:-/tmp/factorai-qa.log}
PID_FILE=/tmp/factorai-qa.pid
LAUNCH_TIMEOUT_S=${LAUNCH_TIMEOUT_S:-90}

# Activate mise if it's installed but not yet on PATH (GUI launches don't
# inherit shell PATH on most distros).
if command -v mise >/dev/null 2>&1 && ! command -v cargo >/dev/null 2>&1; then
	eval "$(mise activate bash)"
fi

REPO=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO"

echo "[qa] starting pnpm tauri dev, logs → $LOG" >&2
: >"$LOG"
nohup pnpm run dev >"$LOG" 2>&1 &
echo $! >"$PID_FILE"
echo "[qa] launch pid: $(cat "$PID_FILE")" >&2

# Poll for the window.
deadline=$((SECONDS + LAUNCH_TIMEOUT_S))
while (( SECONDS < deadline )); do
	if wmctrl -l 2>/dev/null | grep -qi 'factorai dev'; then
		echo "[qa] window detected after ${SECONDS}s" >&2
		exit 0
	fi
	# Bail early if pnpm crashed.
	if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
		echo "[qa] launcher process died — see $LOG" >&2
		exit 2
	fi
	sleep 1
done

echo "[qa] window did not appear within ${LAUNCH_TIMEOUT_S}s — see $LOG" >&2
exit 1
