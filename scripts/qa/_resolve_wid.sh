#!/usr/bin/env bash
# Internal helper: print the WID (hex) and geometry of the factorai dev
# content window. Picks the largest matching window from wmctrl so we
# skip the 10×10 invisible/phantom X windows xdotool also returns.
#
# Matches "factorai DEV" — the title a debug build sets on itself (see
# src-tauri/src/lib.rs) — and NOT a bare "factorai". A release factorai is
# usually open on the same desktop, and it is the app the user actually
# works in; a plain /factorai/ match could hand back its window id, and a
# screenshot of the wrong app is the *mild* outcome. Focus and clicks go
# through here too.
#
# Output: WID_HEX WID_DECIMAL X Y WIDTH HEIGHT
# Exit 1 if no factorai dev window present.

set -euo pipefail

line=$(wmctrl -lG 2>/dev/null | awk 'tolower($0) ~ /factorai dev/ {
	# col1=hex_wid, col3=x, col4=y, col5=w, col6=h
	size = $5 * $6
	if (size > best) { best = size; out = $1 " " $3 " " $4 " " $5 " " $6 }
}
END { print out }')

if [[ -z $line ]]; then
	echo "[qa] no factorai dev window" >&2
	exit 1
fi

# Convert hex WID to decimal for xdotool.
hex=$(awk '{print $1}' <<<"$line")
dec=$(( hex ))
rest=$(awk '{$1=""; print}' <<<"$line" | sed 's/^ //')
echo "$hex $dec $rest"
