#!/usr/bin/env bash
# Print the OSC escape sequences a real `claude` writes to its terminal.
#
# Usage:
#   scripts/qa/osc-probe.sh                      # boot only — no API call
#   scripts/qa/osc-probe.sh --prompt 'say hi'    # runs one real turn (costs tokens)
#   scripts/qa/osc-probe.sh --seconds 30 --binary /path/to/claude
#
# WHY THIS EXISTS
#
# F10 derives session status from the terminal title Claude Code writes:
# `✳` (U+2733) first means idle, any other glyph means working. That is
# undocumented behaviour of a program we do not control and which updates
# frequently, so ADR-0015 accepts the dependency on the condition that it stays
# cheap to re-check. This is that re-check.
#
# Run it after a Claude update, or on a platform we have not tried, and read the
# timeline. The Rust side is deliberately fixture-only — `services::osc_title`
# tests the parser against captured bytes, which proves the parser everywhere and
# proves nothing about the CLI. This script is the other half.
#
# Booting is enough to see the idle marker, and boots make no API call. Seeing
# the *working* glyph needs a turn, which is why `--prompt` is opt-in and says so.
#
# WHY PYTHON IS IN HERE
#
# The title only appears when stdout is a TTY, so the probe has to allocate a
# PTY, and bash has no primitive for that. `script(1)` exists on both platforms
# but takes incompatible arguments, so it would need the same branch twice with
# no test covering either. Python's `pty` is in the standard library on both.
#
# The probe runs in a throwaway directory, not in a project, so it never adds a
# transcript to a session list you care about, and it strips CLAUDE_CODE_* from
# the child so this machine's own agent environment cannot colour the result —
# an inherited bypass-permissions mode changes what a turn does, and
# CLAUDE_CODE_CHILD_SESSION turns transcript saving off entirely.

set -uo pipefail

SECONDS_TO_RUN=14
PROMPT=""
BINARY=""

while (( $# > 0 )); do
	case "$1" in
		--prompt) PROMPT=${2:-}; shift 2 ;;
		--seconds) SECONDS_TO_RUN=${2:-14}; shift 2 ;;
		--binary) BINARY=${2:-}; shift 2 ;;
		-h|--help) sed -n '2,40p' "$0"; exit 0 ;;
		*) echo "[qa] unknown argument: $1" >&2; exit 2 ;;
	esac
done

# Same three-tier discovery as `services::claude_cli::find_claude_binary`, minus
# the candidate probe: PATH first, then ask a login shell, because a GUI process
# has never sourced an rc file and neither has this script when run from one.
if [[ -z $BINARY ]]; then
	BINARY=$(command -v claude 2>/dev/null || true)
fi
if [[ -z $BINARY ]]; then
	BINARY=$("${SHELL:-/bin/sh}" -ilc 'command -v claude' 2>/dev/null | tail -1 || true)
fi
if [[ -z $BINARY || ! -x $BINARY ]]; then
	echo "[qa] no claude binary found — pass --binary /path/to/claude" >&2
	exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
	echo "[qa] python3 is required (it allocates the PTY — see the header)" >&2
	exit 1
fi

WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/factorai-osc-probe.XXXXXX")
trap 'rm -rf "$WORKDIR"' EXIT

echo "[qa] binary:  $BINARY" >&2
echo "[qa] cwd:     $WORKDIR" >&2
echo "[qa] seconds: $SECONDS_TO_RUN" >&2
if [[ -n $PROMPT ]]; then
	echo "[qa] prompt:  ${PROMPT} — this runs a real turn and costs tokens" >&2
else
	echo "[qa] prompt:  none (boot only, no API call; pass --prompt to see the working glyph)" >&2
fi
echo >&2

CLAUDE_BIN=$BINARY PROBE_CWD=$WORKDIR PROBE_SECONDS=$SECONDS_TO_RUN PROBE_PROMPT=$PROMPT \
	python3 - <<'PY'
import os, pty, re, select, signal, sys, time

binary = os.environ["CLAUDE_BIN"]
workdir = os.environ["PROBE_CWD"]
seconds = float(os.environ["PROBE_SECONDS"])
prompt = os.environ.get("PROBE_PROMPT", "")

# Strip this machine's agent environment, then set the terminal identity factorai
# itself pins in `TerminalManager` (TERM=xterm-256color). Fidelity matters: the
# CLI branches on terminal identity for other sequences, so a probe that lies
# about it is measuring a different terminal than the app is.
env = {k: v for k, v in os.environ.items() if not k.startswith("CLAUDE")}
env.update({"TERM": "xterm-256color", "COLORTERM": "truecolor", "FORCE_COLOR": "3"})
for k in ("PROBE_CWD", "PROBE_SECONDS", "PROBE_PROMPT"):
    env.pop(k, None)

IDLE = "✳"

pid, fd = pty.fork()
if pid == 0:
    os.chdir(workdir)
    os.execve(binary, [binary], env)

buf = bytearray()
titles, other_osc = [], []
saw_idle = saw_working = False
sent = trusted = False
start = time.time()
OSC = re.compile(rb"\x1b\](\d+);([^\x07\x1b]*)(?:\x07|\x1b\\)")

def elapsed():
    return time.time() - start

while elapsed() < seconds:
    r, _, _ = select.select([fd], [], [], 0.2)
    if r:
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            break
        if not chunk:
            break
        buf += chunk
        for m in OSC.finditer(chunk):
            code = m.group(1).decode()
            payload = m.group(2).decode("utf8", "replace")
            if code in ("0", "1", "2"):
                first = payload[:1]
                if first == IDLE:
                    saw_idle = True
                    kind = "idle"
                elif first:
                    saw_working = True
                    kind = "working"
                else:
                    kind = "empty"
                if not titles or titles[-1][2] != payload:
                    print(f"  t={elapsed():5.1f}  OSC {code}  {kind:<8} {payload!r}", flush=True)
                titles.append((elapsed(), code, payload))
            else:
                if code not in other_osc:
                    other_osc.append(code)
                print(f"  t={elapsed():5.1f}  OSC {code}           {payload[:90]!r}", flush=True)
    # Outside the read branch on purpose. A fresh directory asks to be trusted
    # and then renders nothing further, so a check that only runs when new bytes
    # arrive never fires — the probe sits on the prompt until it times out and
    # reports the title missing, which is a false negative about the CLI.
    if not trusted and elapsed() > 1.5 and re.search(
        r"trust", buf.decode("utf8", "replace")[-4000:], re.I
    ):
        os.write(fd, b"\r")
        trusted = True
        print(f"  t={elapsed():5.1f}  [answered the trust prompt]", flush=True)
    if prompt and not sent and elapsed() > 6:
        os.write(fd, prompt.encode() + b"\r")
        sent = True
        print(f"  t={elapsed():5.1f}  [submitted prompt]", flush=True)

os.kill(pid, signal.SIGKILL)
os.waitpid(pid, 0)

print()
print(f"  bytes captured        {len(buf)}")
print(f"  title sequences       {len(titles)}")
print(f"  other OSC codes seen  {', '.join(other_osc) or 'none'}")
print(f"  idle marker (U+2733)  {'SEEN' if saw_idle else 'NOT SEEN'}")
print(f"  working glyph         {'SEEN' if saw_working else 'not seen'}"
      + ("" if prompt else "  (expected — no prompt was submitted)"))
print()

def dump_tail():
    """What the CLI actually rendered, ANSI removed — the first thing to read
    when the verdict is a surprise. A probe that says only "not seen" cannot
    distinguish a changed marker from a session that never got past a prompt."""
    text = buf.decode("utf8", "replace")
    text = re.sub(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)", "", text)
    text = re.sub(r"\x1b\[[0-9;?]*[ -/]*[@-~]", "", text)
    print("  last of what it rendered:")
    for line in [ln for ln in text.splitlines() if ln.strip()][-12:]:
        print(f"    | {line[:110]}")
    print()

if not saw_idle:
    dump_tail()
    print("  The idle marker is what F10's rule enumerates, and it did not appear.")
    print("  Either the CLI stopped writing a title, it changed the marker, or the")
    print("  session never reached its prompt — check the render above before")
    print("  concluding anything about the title.")
    print("  Read ADR-0015 before changing the parser: the degrade-to-working")
    print("  fallback means the dot is stale, not wrong, so there is time to think.")
    sys.exit(1)

if prompt and not saw_working:
    print("  A turn ran but no non-idle title appeared, so the working state has")
    print("  no source. This is the half of the rule that would go silently wrong.")
    sys.exit(1)

print("  Matches what F10 and ADR-0015 describe.")
PY
status=$?
echo >&2
if (( status == 0 )); then
	echo "[qa] ok" >&2
else
	echo "[qa] the CLI does not behave the way F10 assumes — see above" >&2
fi
exit $status
