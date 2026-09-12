#!/usr/bin/env bash
#
# factorai's in-distro half of the Windows install (ADR-0044).
#
# The `.exe` beside this file has already decided *which* distribution to use and
# that the machine is capable of running us. This script runs inside that
# distribution and does the actual work: check the floor, get the two packages an
# AppImage under WSLg needs, place the binary, and write the `.desktop` entry that
# WSLg turns into a Start-menu shortcut.
#
# **It is deliberately re-runnable.** Reinstalling over an existing copy is the
# upgrade path for someone who did not let the app update itself, and every step
# here is idempotent.
#
# Usage: setup-in-distro.sh <appimage-url> <version>

set -euo pipefail

URL="${1:?an AppImage URL is required}"
VERSION="${2:?a version is required}"

BIN_DIR="$HOME/.local/bin"
APP="$BIN_DIR/factorai.AppImage"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/128x128/apps"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# **The window this runs in is its own, and closes when this exits.** The
# installer launches us with `ExecWait` rather than capturing our output,
# because `sudo` below needs a terminal to prompt on — so the console is the
# only place anything we print is visible, and an unpaused exit takes the error
# message with it. One EXIT trap does both jobs: clean up, then hold the window.
# `|| true` on the read, so a closed stdin does not turn a success into a
# failure.
FINISH_TMP=""
finish() {
	local code=$?
	# An `if` and not `[ -n … ] && rm`, which under `set -e` returns 1 on the
	# empty case and takes the rest of the trap — the pause included — with it.
	if [ -n "$FINISH_TMP" ]; then
		rm -rf "$FINISH_TMP"
	fi
	printf '\n'
	read -rp "Press Enter to close this window... " _ || true
	exit $code
}
trap finish EXIT

# ── The floor ────────────────────────────────────────────────────────────────
# glibc, because the AppImage is built on Ubuntu 24.04 and a glibc-linked binary
# does not run on an older release than the one that built it. Same floor the
# README documents for Linux, checked here rather than discovered as
# `GLIBC_2.38 not found` after the download.
# `getconf` first: it prints exactly `glibc 2.39` and is not translated, whereas
# `ldd --version` prints a sentence that is — and this installer's first real
# user was on a French Windows. `ldd` stays as the fallback for a libc that has
# no `getconf` entry.
glibc_version() {
	getconf GNU_LIBC_VERSION 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' && return 0
	ldd --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+$'
}

GLIBC="$(glibc_version || true)"
[ -n "$GLIBC" ] || die "could not read the glibc version in this distribution"
if [ "$(printf '%s\n2.39\n' "$GLIBC" | sort -V | head -1)" != "2.39" ]; then
	die "this distribution has glibc $GLIBC; factorai needs 2.39 or newer.
Ubuntu 24.04+, Debian 13+ or Fedora 40+ all qualify. Install one with:
  wsl --install -d Ubuntu-24.04"
fi

# ── The two packages ─────────────────────────────────────────────────────────
# libfuse2: an AppImage mounts itself with FUSE 2, and Ubuntu has shipped only
#   FUSE 3 since 23.10. The package is `libfuse2t64` on 24.04 and `libfuse2`
#   before it. **Never `apt install fuse`** — that removes `fuse3` and breaks the
#   distribution.
# wslu: gives `xdg-open` a browser to reach, via `wslview`. Without it every
#   external link in the app silently does nothing. It does NOT fix "reveal in
#   file manager", which has no working path under WSL at all — see ADR-0044.
#
# Debian-family gets this automatically because the package names are knowable
# there. Everything else is checked and told, because `wslu` is a COPR add on
# Fedora and an AUR build on Arch, so there is no one command to run and
# guessing one would be worse than saying so.
have_fuse2() { ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; }

if . /etc/os-release 2>/dev/null && [[ "${ID:-} ${ID_LIKE:-}" == *debian* || "${ID:-}" == ubuntu ]]; then
	WANTED=()
	have_fuse2 || WANTED+=("$(apt-cache show libfuse2t64 >/dev/null 2>&1 && echo libfuse2t64 || echo libfuse2)")
	command -v wslview >/dev/null 2>&1 || WANTED+=(wslu)
	if [ ${#WANTED[@]} -gt 0 ]; then
		say "Installing ${WANTED[*]}"
		# Said out loud before the prompt appears, because a bare `[sudo] password
		# for you:` in a console window the user did not open themselves is
		# indistinguishable from something going wrong.
		if ! sudo -n true 2>/dev/null; then
			printf 'This needs your password inside the distribution (sudo).\n'
		fi
		sudo apt-get update -qq
		sudo apt-get install -y "${WANTED[@]}"
	fi
else
	MISSING=()
	have_fuse2 || MISSING+=("libfuse2 (FUSE 2 runtime — NOT the 'fuse' package)")
	command -v wslview >/dev/null 2>&1 || MISSING+=("wslu (for opening links in your Windows browser)")
	if [ ${#MISSING[@]} -gt 0 ]; then
		printf '\nThis distribution (%s) needs these installed first:\n' "${ID:-unknown}" >&2
		printf '  - %s\n' "${MISSING[@]}" >&2
		die "install them with your package manager, then run this installer again"
	fi
fi

# ── The binary ───────────────────────────────────────────────────────────────
say "Downloading factorai $VERSION"
mkdir -p "$BIN_DIR" "$DESKTOP_DIR" "$ICON_DIR"
TMP="$(mktemp -d)"
FINISH_TMP="$TMP"
# curl is in the Ubuntu WSL image and is not guaranteed anywhere else, so wget
# is accepted too rather than making the presence of one tool the thing that
# decides whether factorai installs.
if command -v curl >/dev/null 2>&1; then
	curl --fail --location --progress-bar --output "$TMP/factorai.AppImage" "$URL"
elif command -v wget >/dev/null 2>&1; then
	wget --show-progress -qO "$TMP/factorai.AppImage" "$URL"
else
	die "neither curl nor wget is installed in this distribution; install one and run this again"
fi
# A partial download that still parses as a file is the failure worth catching:
# the AppImage's ELF magic is cheap and decisive.
head -c 4 "$TMP/factorai.AppImage" | grep -q $'\x7fELF' \
	|| die "the download is not an executable — check your network and try again"
chmod +x "$TMP/factorai.AppImage"
mv "$TMP/factorai.AppImage" "$APP"

# The Start-menu icon, pulled out of the bundle we just placed. `--appimage-extract`
# needs no FUSE — the runtime unpacks rather than mounts — but it writes
# `squashfs-root` into the *working directory*, and this script's working
# directory is the installer's folder on the Windows drive. Extracting there
# would put a few thousand small files across the 9p share for no reason, so it
# happens in the temp dir the trap already cleans up. Best-effort: a missing
# icon costs a generic glyph in the Start menu, not an install.
ICON_REL="usr/share/icons/hicolor/128x128/apps/factorai.png"
( cd "$TMP" && "$APP" --appimage-extract "$ICON_REL" >/dev/null 2>&1 ) \
	&& cp "$TMP/squashfs-root/$ICON_REL" "$ICON_DIR/factorai.png" \
	|| say "note: could not read the app icon out of the bundle; using a default"

# ── The Start-menu entry ─────────────────────────────────────────────────────
# WSLg enumerates `.desktop` files of `Type=Application` and its RDP plugin
# creates a Windows Start-menu shortcut for each. So this file *is* the
# integration; there is nothing to register on the Windows side.
#
# **The two WebKit variables are the reason this is not a one-line Exec.** WSLg
# renders through a virtual GPU on a software GL path, and WebKitGTK's
# accelerated compositing misbehaves there — the symptom is a blank white
# window. They are set on this launcher only, never globally, so a native Linux
# install keeps acceleration (ADR-0044).
say "Writing the Start-menu entry"
cat > "$DESKTOP_DIR/factorai.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=factorai
Comment=Agentic Development Environment (ADE) for the AI era
Exec=env WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 $APP %U
Icon=factorai
Terminal=false
Categories=Development;IDE;
StartupWMClass=factorai
DESKTOP
update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true

say "factorai $VERSION is installed."
cat <<'DONE'

  It is in your Start menu, under the name of this distribution.
  The app updates itself from here; you will not need this installer again.

  Keep your projects inside this distribution, under ~ — a folder on the
  Windows drive (/mnt/c/...) works, but the session list will not update on
  its own there and git is slow.
DONE
