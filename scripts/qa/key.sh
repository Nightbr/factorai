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

read -r _ DEC _ _ _ _ < <("$(dirname "$0")/_resolve_wid.sh")
xdotool windowactivate --sync "$DEC"
xdotool key --window "$DEC" --clearmodifiers "$@"
echo "[qa] sent key(s): $*" >&2
