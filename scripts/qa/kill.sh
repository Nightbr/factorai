#!/usr/bin/env bash
# Tear down the factorai dev process and any orphan claude PTYs it spawned.
#
# Usage:  scripts/qa/kill.sh
#
# - Reads /tmp/factorai-qa.pid (written by launch.sh) and kills that pid
#   and all descendants (pnpm → turbo → tauri → cargo run → factorai +
#   any claude PTYs the TerminalManager spawned).
# - Sweeps stale debug binaries from cargo test crashes.
#
# Importantly: we do NOT use `pkill -f 'claude --resume'`. That pattern
# would match this very script (its argv contains the string), causing
# a self-suicide. We descend the process tree from the recorded
# launcher pid and kill children explicitly.
#
# Nor do we kill by process name alone. A *release* factorai is normally
# open on the same desktop — it is the app the user works in, and the
# `claude --resume` PTYs under it are live agent sessions, quite possibly
# the one running this script. It shares our process name and its children
# share their argv, so every sweep below is qualified by ownership: a
# factorai only counts if its executable lives in this repo's target/, and
# a claude only counts if such a factorai is its ancestor.

set -uo pipefail

PID_FILE=/tmp/factorai-qa.pid
SELF=$$
REPO=$(cd "$(dirname "$0")/../.." && pwd)

# Defensive: ignore any SIGTERM we might receive as collateral from a
# process group blast, so we exit 0 on clean cleanup.
trap '' TERM INT

descendants_of() {
	local root=$1
	[[ -z $root ]] && return
	local out=()
	local frontier=("$root")
	while (( ${#frontier[@]} > 0 )); do
		local next=()
		for p in "${frontier[@]}"; do
			for child in $(pgrep -P "$p" 2>/dev/null); do
				# Never include ourselves.
				if [[ $child != "$SELF" ]]; then
					out+=("$child")
					next+=("$child")
				fi
			done
		done
		frontier=("${next[@]}")
	done
	printf '%s\n' "${out[@]}"
}

kill_tree() {
	local root=$1
	[[ -z $root ]] && return
	# Collect first, then signal — modifying as we descend is racy.
	local pids
	pids=$(descendants_of "$root")
	# Signal deepest first (children before parents) so we don't lose
	# track of descendants when the parent dies.
	while IFS= read -r p; do
		[[ -z $p ]] && continue
		kill -TERM "$p" 2>/dev/null || true
	done <<<"$pids"
	# Finally the root itself.
	kill -TERM "$root" 2>/dev/null || true
	sleep 0.5
	while IFS= read -r p; do
		[[ -z $p ]] && continue
		kill -KILL "$p" 2>/dev/null || true
	done <<<"$pids"
	kill -KILL "$root" 2>/dev/null || true
}

if [[ -f $PID_FILE ]]; then
	PID=$(cat "$PID_FILE")
	if kill -0 "$PID" 2>/dev/null; then
		echo "[qa] killing launcher pid=$PID and descendants" >&2
		kill_tree "$PID"
	fi
	rm -f "$PID_FILE"
fi

# The dev factorai processes, and only those. `pgrep -x` matches the
# program name (max 15 chars), avoiding the self-match risk of `pgrep -f`
# — but the name is `factorai` for the release build too, so each hit is
# then checked against its executable path. A debug build always runs out
# of this repo's target/ dir; an installed one never does.
#
# /proc/PID/exe is the authority on Linux; `ps -o comm=` prints the full
# executable path on macOS, which covers the other supported platform.
dev_factorai_pids() {
	local p exe
	for p in $(pgrep -x factorai 2>/dev/null); do
		[[ $p == "$SELF" ]] && continue
		exe=$(readlink -f "/proc/$p/exe" 2>/dev/null || true)
		[[ -z $exe ]] && exe=$(ps -p "$p" -o comm= 2>/dev/null || true)
		case "$exe" in
			"$REPO"/target/*) echo "$p" ;;
		esac
	done
}

# Belt-and-braces, for a stale pid file: whatever dev factorai is still
# standing, taken down with its subtree. That subtree is where its
# `claude --resume` PTYs are, so they go with it — and a claude owned by
# the release app, having no dev factorai for an ancestor, is never
# reached. A fully orphaned dev PTY (its factorai already gone, so the
# ownership trail with it) is left alive on purpose: there is no way left
# to tell it apart from the user's own session, and killing that is the
# far worse error.
for p in $(dev_factorai_pids); do
	echo "[qa] killing stray dev factorai pid=$p" >&2
	kill_tree "$p"
done

remaining=$(dev_factorai_pids | wc -l)
if (( remaining > 0 )); then
	echo "[qa] WARNING: $remaining factorai process(es) still alive" >&2
	exit 1
fi
echo "[qa] clean" >&2
exit 0
