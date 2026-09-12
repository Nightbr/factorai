#!/usr/bin/env bash
#
# factorai's in-distro half of the Windows install (ADR-0044).
#
# The `.exe` beside this file has already decided *which* distribution to use and
# that the machine is capable of running us. This script runs inside that
# distribution and does the actual work: check the floor, make sure the one
# package an AppImage needs is there, place the binary, and write the `.desktop`
# entry that WSLg turns into a Start-menu shortcut.
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

# ── The one package ──────────────────────────────────────────────────────────
# **libfuse2, and nothing else.** An AppImage mounts itself with FUSE 2, and
# Ubuntu has shipped only FUSE 3 since 23.10, so without it the binary we are
# about to place will not start. The package is `libfuse2t64` on 24.04 and
# `libfuse2` before it. **Never `apt install fuse`** — that removes `fuse3` and
# breaks the distribution.
#
# **`wslu` used to be installed here and is not any more** (v0.40.1 aborted an
# install on `E: Unable to locate package wslu`, on an image with `universe`
# disabled). It was there to give `xdg-open` a browser through `wslview`, and it
# was the wrong call twice over: upstream has discontinued and archived it, and
# the crate behind Tauri's link opening already has its own WSL path —
# `powershell.exe -NoProfile -Command "Start-Process ..."`, with `wslview` only
# as a fallback if it happens to be there. So links work without it.
#
# The general rule this cost us: **something optional must never be able to
# abort the install.** The only package left is one the app genuinely cannot run
# without, which is why this one is allowed to be fatal.
have_fuse2() { ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; }

if have_fuse2; then
	say "FUSE 2 is already installed"
elif . /etc/os-release 2>/dev/null && [[ "${ID:-} ${ID_LIKE:-}" == *debian* || "${ID:-}" == ubuntu ]]; then
	PKG="$(apt-cache show libfuse2t64 >/dev/null 2>&1 && echo libfuse2t64 || echo libfuse2)"
	say "Installing $PKG"
	# Said out loud before the prompt appears, because a bare `[sudo] password
	# for you:` in a console window the user did not open themselves is
	# indistinguishable from something going wrong.
	if ! sudo -n true 2>/dev/null; then
		printf 'This needs your password inside the distribution (sudo).\n'
	fi
	# A failing refresh is not by itself a reason to stop: the package may well
	# be in the cache already, and `install` below is the real test.
	sudo apt-get update -qq || true
	sudo apt-get install -y "$PKG" || die "could not install $PKG.
factorai's AppImage needs the FUSE 2 runtime to start. Install it by hand:
  sudo apt-get install -y $PKG
then run this installer again. Do NOT install the package called 'fuse' --
that removes fuse3 and breaks the distribution."
else
	die "this distribution (${ID:-unknown}) does not have the FUSE 2 runtime.
factorai's AppImage needs it to start. Install your distribution's libfuse2
package -- NOT the one called 'fuse', which removes fuse3 -- then run this
installer again."
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
# **It has to be a system directory, and v0.40.2 put it in the user's home.**
# WSLg looks in `/usr/share/applications`, `/usr/local/share/applications`, and
# the snap and flatpak export directories — and **not** in
# `~/.local/share/applications`, where the XDG spec would put it and where this
# script wrote it. The install reported success and nothing appeared in the
# Start menu. `/usr/local` is the right one of the four: it is where the FHS
# puts software the local administrator installed, which is exactly what this is.
#
# **The two WebKit variables are the reason `Exec=` is not one word.** WSLg
# renders through a virtual GPU on a software GL path, and WebKitGTK's
# accelerated compositing misbehaves there — the symptom is a blank white
# window. They are set on this launcher only, never globally, so a native Linux
# install keeps acceleration (ADR-0044).
say "Writing the Start-menu entry"

DESKTOP_BODY="[Desktop Entry]
Type=Application
Name=factorai
Comment=Agentic Development Environment (ADE) for the AI era
Exec=env WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 $APP %U
Icon=factorai
Terminal=false
Categories=Development;IDE;
StartupWMClass=factorai"

# Written to the home copy first regardless: it costs nothing, it is where a
# real Linux desktop session inside this distribution would look, and it gives
# the system copy below something to be a copy *of*.
printf '%s\n' "$DESKTOP_BODY" > "$DESKTOP_DIR/factorai.desktop"
update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true

# The system copy is the one WSLg reads, and it needs root. **A failure here is
# not fatal** — the app is installed and runnable either way, and the closing
# message says how to launch it — but it is the difference between an icon in
# the Start menu and a command to remember, so it is worth the prompt.
SYS_APPS=/usr/local/share/applications
SYS_ICONS=/usr/local/share/icons/hicolor/128x128/apps
START_MENU=yes
if ! sudo -n true 2>/dev/null; then
	printf 'Adding factorai to the Start menu needs your password (sudo).\n'
fi
if sudo mkdir -p "$SYS_APPS" "$SYS_ICONS" 2>/dev/null \
	&& printf '%s\n' "$DESKTOP_BODY" | sudo tee "$SYS_APPS/factorai.desktop" >/dev/null; then
	sudo chmod 0644 "$SYS_APPS/factorai.desktop"
	if [ -f "$ICON_DIR/factorai.png" ]; then
		sudo cp "$ICON_DIR/factorai.png" "$SYS_ICONS/factorai.png" || true
		sudo chmod 0644 "$SYS_ICONS/factorai.png" 2>/dev/null || true
	fi
	sudo update-desktop-database "$SYS_APPS" >/dev/null 2>&1 || true
else
	START_MENU=no
fi

say "factorai $VERSION is installed."
if [ "$START_MENU" = yes ]; then
	cat <<'DONE'

  It is in your Start menu, under the name of this distribution. If it is not
  there yet, run `wsl --shutdown` in PowerShell and open the distribution
  again -- WSLg builds that list when the distribution starts.

DONE
else
	cat <<DONE

  It is NOT in your Start menu: that needs a file under /usr/local, and the
  step that writes it did not get root. Add it later with:

    sudo cp ~/.local/share/applications/factorai.desktop $SYS_APPS/

  Until then, start factorai from PowerShell with:

    wsl -- $APP

DONE
fi
cat <<'DONE'
  The app updates itself from here; you will not need this installer again.

  Keep your projects inside this distribution, under ~ -- a folder on the
  Windows drive (/mnt/c/...) works, but the session list will not update on
  its own there and git is slow.
DONE
