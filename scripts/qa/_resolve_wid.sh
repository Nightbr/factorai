#!/usr/bin/env bash
# Internal helper: print the WID (hex) and geometry of the factorai
# content window. Picks the largest "factorai" window from wmctrl so we
# skip the 10×10 invisible/phantom X windows xdotool also returns.
#
# Output: WID_HEX WID_DECIMAL X Y WIDTH HEIGHT
# Exit 1 if no factorai window present.

set -euo pipefail

line=$(wmctrl -lG 2>/dev/null | awk 'tolower($0) ~ /factorai/ {
	# col1=hex_wid, col3=x, col4=y, col5=w, col6=h
	size = $5 * $6
	if (size > best) { best = size; out = $1 " " $3 " " $4 " " $5 " " $6 }
}
END { print out }')

if [[ -z $line ]]; then
	echo "[qa] no factorai window" >&2
	exit 1
fi

# Convert hex WID to decimal for xdotool.
hex=$(awk '{print $1}' <<<"$line")
dec=$(( hex ))
rest=$(awk '{$1=""; print}' <<<"$line" | sed 's/^ //')
echo "$hex $dec $rest"
