# Changelog

Stable releases, newest first. Written by `promote.yml` from the `feat:` and `fix:` commits each
release adds (ADR-0064); alphas are listed only on their GitHub prereleases.

Releases before 0.49.0 are on [GitHub](https://github.com/Nightbr/factorai/releases).

## 0.52.0 — 2026-09-27

macOS builds are now signed with a Developer ID and notarized: factorai opens on first launch with no right-click → Open or xattr step, and updates install without the App Management prompt. Because the signing identity changed, macOS asks for folder access and App Management one last time on this release. Allow them once and they stay allowed from here on.

### Features

- macOS releases are Developer ID signed and notarized

### Fixes

- the hero pins from the first pixel; skip stays through every step

## 0.51.0 — 2026-09-27

### Features

- import from Codex, and one import dialog for every door
- the first run is a centred hero with two amber doors
- the first-run doors are tiles at the optical centre

## 0.50.0 — 2026-09-26

### Features

- a toast primitive, and a failed update says so
- scripted illustrations for the guide

### Fixes

- a panel drag no longer re-renders the app or resizes the PTY per frame
- the alpha pointer's manifest names the alpha's own download URLs
- a first session open paints its header before it builds the terminal
- the Confirmations note no longer says quitting always asks
- a session that cannot start no longer blames claude
- the profile badge names the session's own agent
- the confirmations say an agent is working, not Claude
- a terminal selection can be copied
- isCopyChord is module-private
- a menu never draws two separators in a row

## 0.49.0 — 2026-09-23

The first release with two update channels. Stable, which you are on, is now promoted by hand from an alpha that has already shipped. To get every build as it lands, switch to Alpha in Settings > Advanced.

### Features

- alpha builds itself from green main, stable is a promoted alpha

### Fixes

- the alpha pointer job runs although the installer job is skipped
