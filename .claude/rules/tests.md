---
paths:
  - "tests/**"
  - "apps/desktop/src/**/*.test.ts"
  - "apps/desktop/src-tauri/tests/**"
  - "playwright.config.ts"
---

# Test traps

- Smoke tests inject data with `installMockBridge(page, fixture)` before
  `page.goto(...)`; the mock layer reads `window.__FACTORAI_TEST__`. One fixture
  factory per shape of state, in `tests/smoke/fixtures.ts`. Tag titles `@smoke`.
- **`pnpm e2e` and `pnpm dev` both want port 1420**, and
  `webServer.reuseExistingServer` is on outside CI — running the suite while the
  app is open attaches Playwright to the *app's* vite and every test times out at
  30s. Set `PLAYWRIGHT_PORT=1421` to run alongside a dev app.
- **A test that waits thirty seconds for a control that is always there is
  usually the network, not the selector.** Chromium aborts in-flight requests
  with `net::ERR_NETWORK_CHANGED` on any netlink event, and docker or tailscale
  make those constant. `installMockBridge` logs every aborted script;
  `retries: 1` keeps it off the gate.
- **dnd-kit reports `over` one move behind** — it collides against rects measured
  on the previous frame. Move twice, a pixel apart, per aim. See the helpers in
  `tests/smoke/sidebar.spec.ts`.

Longer form: the `smoke-tests` skill; native verification is the `manual-qa`
skill.
