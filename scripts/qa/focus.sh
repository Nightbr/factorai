#!/usr/bin/env bash
# Bring the factorai window to the foreground.
#
# Usage:  scripts/qa/focus.sh

set -euo pipefail

read -r HEX _ _ _ _ _ < <("$(dirname "$0")/_resolve_wid.sh")
wmctrl -i -a "$HEX"
sleep 0.3
