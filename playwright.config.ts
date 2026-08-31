import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PLAYWRIGHT_PORT ?? '1420';
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Playwright runs against the renderer in browser-only mode (`pnpm vite:dev`),
 * not against the Tauri shell.
 *
 * The renderer detects browser-only mode via `isTauri()` in `lib/tauri.ts`
 * and falls back to `mockInvoke()`. Tests can install richer mock data via
 * `installMockBridge(page, fixture)` (see `tests/smoke/fixtures.ts`).
 */
export default defineConfig({
	testDir: './tests/smoke',
	testMatch: '**/*.spec.ts',
	timeout: 30_000,
	expect: { timeout: 5_000 },
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	// One retry everywhere, not only in CI (2026-08-31). The failure it absorbs
	// is not the app's: Chromium aborts every in-flight request with
	// `net::ERR_NETWORK_CHANGED` when the kernel reports a network change, and it
	// watches netlink to find out. A machine running docker or tailscale produces
	// that constantly — `ip monitor all` on the machine this was diagnosed on
	// counted 177 events in 90 seconds, veths appearing and disappearing under a
	// compose bridge. In dev the renderer is some 800 module requests, so a burst
	// lands mid-load often enough to matter — react-dom among the casualties — and
	// the app then never mounts. What the test reports is a locator that never
	// resolves and thirty seconds of waiting, which reads exactly like a broken
	// selector.
	//
	// A retry tells the two apart rather than hiding one: a real break fails both
	// attempts, and `installMockBridge` prints the aborted requests either way
	// (see `tests/smoke/fixtures.ts`), so a flaky pass still says what happened.
	retries: 1,
	workers: 1,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: BASE_URL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
	webServer: {
		command: `pnpm --filter @factorai/desktop vite:dev --port ${PORT} --strictPort`,
		url: BASE_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
		stdout: 'ignore',
		stderr: 'pipe',
	},
});
