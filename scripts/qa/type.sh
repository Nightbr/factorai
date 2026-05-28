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

read -r _ DEC _ _ _ _ < <("$(dirname "$0")/_resolve_wid.sh")
xdotool windowactivate --sync "$DEC"
xdotool type --window "$DEC" --clearmodifiers --delay 8 -- "$TEXT"
if (( ENTER )); then
	xdotool key --window "$DEC" Return
fi
echo "[qa] typed ${#TEXT} chars$( ((ENTER)) && echo ' + Return' )" >&2
