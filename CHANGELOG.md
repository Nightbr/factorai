# Changelog

Stable releases, newest first. Written by `promote.yml` from the `feat:` and `fix:` commits each
release adds (ADR-0064); alphas are listed only on their GitHub prereleases.

Releases before 0.49.0 are on [GitHub](https://github.com/Nightbr/factorai/releases).

## 0.49.0 — 2026-09-23

The first release with two update channels. Stable, which you are on, is now promoted by hand from an alpha that has already shipped. To get every build as it lands, switch to Alpha in Settings > Advanced.

### Features

- alpha builds itself from green main, stable is a promoted alpha

### Fixes

- the alpha pointer job runs although the installer job is skipped
