# The Windows installer

factorai on Windows is **the Linux build, running inside a WSL 2 distribution
under WSLg** — see [ADR-0044](../../../docs/adr/0044-windows-is-wsl2-not-a-second-port.md).
There is no `windows-msvc` target and no Windows bundle. What lives here is the
bootstrapper that gets the Linux build into the user's own distribution.

| file | what it is |
| --- | --- |
| `factorai.nsi` | the `.exe`. Checks the machine, picks the distribution, hands over. Built with `makensis` **on the Linux release runner** — no Windows runner is involved. |
| `setup-in-distro.sh` | everything that happens inside the distribution: the glibc floor, the two packages, the AppImage, the `.desktop` entry. |

## What it does, and what it deliberately does not

It **provisions nothing**. If WSL 2 is absent, or the Windows build is below
19044, or there is no distribution, it prints the exact command and stops.
Installing WSL needs elevation and a reboot, and owning that flow would mean
owning virtualization-disabled-in-firmware and enterprise policy blocks, neither
of which is this product.

It **names the distribution before using it**. The default is taken, because
that is where a WSL user's work lives, but a user with three of them must not
discover afterwards where factorai went. `/DISTRO=Debian` overrides.

It **runs once**. The app updates itself from there through the AppImage
updater (F14), so the installer is never the upgrade path and carries no
version state worth migrating.

## Two details that are load-bearing

**The `.desktop` file is the entire Windows integration.** WSLg enumerates
`Type=Application` entries and its RDP plugin creates a Start-menu shortcut for
each. Nothing is registered on the Windows side; writing that file *is*
appearing in the Start menu.

**`Exec=` sets two WebKit variables, on this launcher only.** WSLg renders
through a virtual GPU on a software GL path, and WebKitGTK's accelerated
compositing misbehaves there — a blank white window. `WEBKIT_DISABLE_DMABUF_RENDERER=1`
and `WEBKIT_DISABLE_COMPOSITING_MODE=1` are Tauri's documented escalation for
exactly that symptom. They are not set globally: a native Linux install keeps
acceleration.

## Known limitations

- **Reveal in file manager does nothing under WSL.** There is no
  `FileManager1` on that bus and `xdg-open` on a directory cannot bring up
  Explorer with an item selected. `wslu` gives external links a browser; it
  gives reveal nothing.
- **`libEGL` / DRI3 warnings and `/dev/dri/card0` permission noise are
  normal** under WSLg. The app runs anyway — do not chase them.
- **The `.exe` is unsigned**, so SmartScreen shows "Windows protected your PC".
  There is no free Authenticode CA; ADR-0044 consequence 4 has the whole
  reasoning and the SignPath Foundation plan.

## Building it by hand

```bash
sudo apt-get install -y nsis
cd apps/desktop/installer
makensis -DVERSION=0.1.0 \
  -DAPPIMAGE_URL=https://github.com/Nightbr/factorai/releases/download/v0.1.0/factorai_0.1.0_amd64.AppImage \
  factorai.nsi
```

## Testing it

CI builds the artifact and does not run it — same stance as `release.yml`'s
header takes about the gate generally. The real check is by hand on Windows 11
before a tag: install, launch from the Start menu, start a session, and confirm
the window is not blank.
