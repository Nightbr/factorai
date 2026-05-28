#!/usr/bin/env bash
# Bring the factorai window to the foreground.
#
# Usage:  scripts/qa/focus.sh
#
# Returns non-zero if no window matching "factorai" exists.

set -euo pipefail

if ! wmctrl -l 2>/dev/null | grep -qi 'factorai'; then
	echo "[qa] no factorai window found" >&2
	exit 1
fi

wmctrl -a factorai
# Tiny delay so the WM has time to actually raise the window before
# whatever runs next (usually screenshot.sh).
sleep 0.3
