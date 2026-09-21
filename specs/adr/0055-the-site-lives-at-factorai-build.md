# ADR-0055 — the site lives at `factorai.build`

**Date.** 2026-09-21
**Status.** Accepted. Closes the custom-domain question left open in roadmap
item 39; ADR-0051 placed the site at `apps/docs`, this decides the address it
answers on.

## Context

Item 39 left the address open: a custom domain, or the GitHub Pages default at
`nightbr.github.io/factorai`. It asked for the answer *before* publishing,
because the README and every release note write the link once and a later move
leaves those links behind. Item 31 is also waiting on it, since a manifest
hosted on the site needs an address that does not move.

The exact name was not available where it would have been the obvious pick:
`factorai.com`, `.ai`, `.dev`, `.app` and `.io` are all registered, and the
first three resolve to parking pages rather than products. The choice was
therefore between an exact name on a further-out TLD and a prefixed name —
`getfactorai.com` and the like — on `.com`.

## Decision

1. **The site answers on `factorai.build`, apex, with `www` as a redirect.**
   The name stays intact, which a prefix would not do: `getfactorai.com` reads
   as a landing page for a product whose real name is something else. The TLD
   is not a stretch either — this is a tool for building software, and the
   domain says so.

2. **`baseUrl` is `/`, not `/factorai/`.** The path prefix existed only because
   Pages serves a project site under the repository name. Anything that hard-codes
   the old prefix is a bug from here; the navbar wordmark was the one such link.

3. **The domain is pinned by `apps/docs/static/CNAME`, not only by the
   repository setting.** The Pages deployment is the artifact workflow, so the
   domain in Settings is what GitHub serves, but a file in `static/` rides in
   every build and survives a settings reset or a repository transfer.

4. **Registrar is Porkbun, at a flat $26.26 a year.** Recorded because the
   renewal price is the part that bites: Namecheap lists the same TLD at a
   first-year price that steps up about 21% on renewal, and Cloudflare, which
   sells at registry cost, does not carry `.build` at all.

## Consequences

- The README, the release notes and the brand surfaces link to
  `https://factorai.build`. There is no second address to keep alive; the
  Pages default keeps working but is not written down anywhere.
- Item 31 may now host an update manifest at a stable address. This ADR does
  not decide that it should — that decision stays with item 31.
- HTTPS is GitHub's Let's Encrypt certificate, issued after the DNS check
  passes. Enforce HTTPS has to stay on; the apex A and AAAA records are the four
  each that `api.github.com/meta` publishes, and a future change to that set is
  a DNS edit, not a code change.
- The domain is now a renewable the project depends on. It expires like any
  other, and nothing in the repository will warn about it.
