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
#
# X and Y are the **client** area's absolute origin, and they come from
# xwininfo rather than from wmctrl. wmctrl -lG and xdotool both report the
# frame's position, and under GNOME/mutter that disagreed with the client by
# (47, 73) on a window whose _NET_FRAME_EXTENTS said the titlebar was 36px —
# so a click computed from it landed 73px below where it was aimed. On a 900px
# window that is off the bottom edge entirely, and what is *under* that point
# is whatever window sits below ours: on 2026-09-03 three clicks aimed at this
# app's footer went into the release factorai maximised behind it. Guessing
# from frame extents was not enough; xwininfo's "Absolute upper-left" is the
# client origin by definition, so ask for it.

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
w=$(awk '{print $4}' <<<"$line")
h=$(awk '{print $5}' <<<"$line")

# The client origin, from the one tool that reports it. wmctrl's x/y is the
# fallback for a machine without xwininfo — wrong by the frame there, which is
# still better than refusing to run.
info=$(xwininfo -id "$hex" 2>/dev/null || true)
x=$(awk '/Absolute upper-left X/ {print $NF}' <<<"$info")
y=$(awk '/Absolute upper-left Y/ {print $NF}' <<<"$info")
if [[ -z ${x:-} || -z ${y:-} ]]; then
	echo "[qa] xwininfo gave no client origin; falling back to wmctrl's frame" >&2
	x=$(awk '{print $2}' <<<"$line")
	y=$(awk '{print $3}' <<<"$line")
fi

echo "$hex $dec $x $y $w $h"
