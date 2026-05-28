import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PLAYWRIGHT_PORT ?? '1420';
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Playwright runs against the renderer in browser-only mode (`pnpm vite:dev`),
 * not against the Tauri shell. This is the same pattern the reference app uses.
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
	retries: process.env.CI ? 1 : 0,
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
