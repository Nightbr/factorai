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

set -uo pipefail

PID_FILE=/tmp/factorai-qa.pid
SELF=$$

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

# Belt-and-braces: kill any stray factorai debug binaries by exact name.
# `pgrep -x` matches the program name (max 15 chars), avoiding the
# self-match risk of `pgrep -f`.
for p in $(pgrep -x factorai 2>/dev/null); do
	[[ $p == "$SELF" ]] && continue
	kill -TERM "$p" 2>/dev/null || true
done
sleep 0.2
for p in $(pgrep -x factorai 2>/dev/null); do
	[[ $p == "$SELF" ]] && continue
	kill -KILL "$p" 2>/dev/null || true
done

# Hand-rolled check for stale claude PTYs without using pkill -f (to
# avoid self-match). Pattern: exact name "claude", argv contains
# "--resume".
for p in $(pgrep -x claude 2>/dev/null); do
	args=$(ps -p "$p" -o args= 2>/dev/null || true)
	case "$args" in
		*"--resume"*) kill -TERM "$p" 2>/dev/null || true ;;
	esac
done
sleep 0.2
for p in $(pgrep -x claude 2>/dev/null); do
	args=$(ps -p "$p" -o args= 2>/dev/null || true)
	case "$args" in
		*"--resume"*) kill -KILL "$p" 2>/dev/null || true ;;
	esac
done

remaining=$(pgrep -x factorai 2>/dev/null | wc -l)
if (( remaining > 0 )); then
	echo "[qa] WARNING: $remaining factorai process(es) still alive" >&2
	exit 1
fi
echo "[qa] clean" >&2
exit 0
