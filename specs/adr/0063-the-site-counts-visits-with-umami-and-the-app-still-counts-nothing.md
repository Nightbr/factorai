# ADR-0063 — the site counts visits with Umami, and the app still counts nothing

**Date.** 2026-09-22
**Status.** Accepted. Narrows the wording of the `PRODUCT.md` constraint "no
telemetry, no analytics, no crash reporting" to the app it was written for; the
constraint itself is unchanged.

## Context

The site at `factorai.build` (ADR-0055) is the project's front door: the hero,
the download dialog, the guide. Nothing says whether anyone reaches it, which
page they leave from, or whether the Download button is found. That is a
question about a marketing page, not about anyone's use of the app.

`PRODUCT.md` lists "no telemetry, no analytics, no crash reporting" among the
constraints future work must respect. Read in place, it sits among constraints
on the desktop app — the agent's state, kill-on-quit, the PTY path — and every
reason behind it is about the app: it runs inside people's repositories, next
to their agents and their code, and must not report on any of it. Left
unqualified, though, the line reads as covering the site too, and a later
reader would be right to flag analytics there as a violation.

The site is static on GitHub Pages with DNS at Porkbun (ADR-0055). Nothing in
that path can proxy a request, so a first-party analytics endpoint would need
new infrastructure: a Cloudflare Worker, or the zone moved to Cloudflare.

## Decision

1. **The site counts page views with Umami Cloud.** Umami is cookieless, keeps
   no personal data and sets nothing that needs a consent banner. That keeps
   the site as unintrusive as the app, which is the property the constraint
   was protecting.

2. **The app counts nothing.** No Umami, and no other analytics, reaches the
   renderer, the Rust side or any build of the desktop app. `PRODUCT.md` now
   says "in the app" so the line cannot be read either way.

3. **The tracker is served from the site's own origin, the beacon is not.**
   A Docusaurus plugin in `apps/docs/docusaurus.config.ts` fetches
   `cloud.umami.is/script.js` in `postBuild` and writes it to `/js/site.js`,
   so blockers that match the script by URL let it load. The events still go
   to `gateway.umami.is`, the hosted script's default endpoint. A blocker that
   lists that domain drops them, and the counts undercount by that much.
   Proxying the beacon too would take a Worker or a DNS move to Cloudflare,
   and a partial count is not worth that yet.

4. **Only `factorai.build` is counted.** `data-domains` keeps `docusaurus
   serve`, the dev server and the Pages default address out of the numbers.

5. **The script is fetched at build time, not committed.** The build stays
   current with Umami's releases, and no minified third-party file sits in the
   tree for the formatter and the byte check to trip over. If the fetch fails,
   the build fails: a tag pointing at nothing is worse than a deploy a few
   minutes late.

## Consequences

- The Pages build now needs `cloud.umami.is` to be reachable. An Umami outage
  blocks a site deploy until it is re-run.
- `pnpm start` answers `/js/site.js` with a 404. Nothing is tracked in
  development, and that is the intent.
- Proxying the beacon later — a Worker, or the zone moved to Cloudflare — is
  a change to `data-host-url` and a new ADR, not a rework.
- Anyone proposing analytics in the app has to supersede this ADR and argue
  against `PRODUCT.md`, rather than point here as precedent.
