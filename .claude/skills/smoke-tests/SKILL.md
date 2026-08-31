---
name: smoke-tests
description: Playwright smoke suite in tests/smoke — the mock bridge and fixtures, the @smoke tag, and the three failure modes that look like broken selectors (port 1420 collision with pnpm dev, ERR_NETWORK_CHANGED aborts, dnd-kit reporting `over` one frame late). Use when writing, running, or debugging pnpm e2e.
---

# The suite

`pnpm e2e` runs Playwright against `pnpm vite:dev` (the renderer in browser-only
mode — no Tauri). The renderer detects browser-only via `isTauri()` in
`lib/tauri.ts` and falls back to `mockInvoke()`.

Tests inject data by calling `installMockBridge(page, fixture)` before
`page.goto(...)`. The mock layer reads `window.__FACTORAI_TEST__`. Convention:
one fixture factory per "shape" of state (`fixtureOneProjectOneSession()` etc.
in `tests/smoke/fixtures.ts`).

Tag tests with `@smoke` in the title; the suite stays under a few seconds.
Heavier tests go in a future `tests/regression/` lane.

`pnpm e2e:ui` opens the Playwright UI runner — useful for iterating on a flaky
test.

# Three failures that are not what they look like

**`pnpm e2e` and `pnpm dev` both want port 1420**, and
`webServer.reuseExistingServer` is on outside CI — so running the suite while
the app is open makes Playwright attach to the *app's* vite, and every test
times out at 30s. Twenty-four unrelated specs "failing" is the tell. Set
`PLAYWRIGHT_PORT=1421` to run alongside a dev app; the config reads it and
starts its own server.

**A test that waits thirty seconds for a control that is always there is usually
the network, not the selector.** Chromium aborts every in-flight request with
`net::ERR_NETWORK_CHANGED` when the kernel reports a network change, and it
learns that from netlink — which on a machine running docker or tailscale is
noisy: `ip monitor all` counted 177 events in 90 seconds here, veths coming and
going under a compose bridge. The dev renderer is some 800 module requests, so a
burst lands mid-load often enough to hit one test per full run, react-dom
included, and the app never mounts. `installMockBridge` prints every aborted
script and page error as it happens, so the log says so; `retries: 1` (local as
well as CI, 2026-08-31) is what keeps it from failing the gate, and a real break
still fails both attempts.

**dnd-kit reports `over` one move behind** — it collides against rects measured
on the previous frame. A real drag never notices, but a test that jumps once per
aim names the row the pointer just *left*. Move twice, a pixel apart, per aim.
The helpers in `tests/smoke/sidebar.spec.ts` do this and say why.

# Driving Playwright from a session

The repo ships `.mcp.json` configuring `@playwright/mcp@latest`. If `playwright`
MCP tools aren't yet listed in the available tools, restart Claude Code so the
new server config loads.
