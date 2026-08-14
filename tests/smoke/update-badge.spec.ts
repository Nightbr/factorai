import { expect, test } from '@playwright/test';
import { fixtureOneProjectOneSession, installMockBridge } from './fixtures';

/**
 * The header's update badge (specs/05-features.md F14).
 *
 * The updater itself is a Tauri plugin and inert in the browser, so the fixture
 * drives the `ready` state. What's under test is the part that can actually go
 * wrong: whether a restart can kill a live agent session without asking.
 */
test.describe('update badge', () => {
	test('@smoke offers a manual check when nothing is staged', async ({ page }) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');

		// The restart badge is absent, but the footer still says what the updater
		// is for — and clicking it checks now rather than waiting for the poll.
		await expect(page.getByTestId('update-badge')).toHaveCount(0);
		const check = page.getByTestId('update-check');
		await expect(check).toHaveText('Check for updates');

		await check.click();
		await expect(check).toHaveText('Up to date');
		// …and it settles back rather than leaving a stale acknowledgement.
		await expect(check).toHaveText('Check for updates', { timeout: 6000 });
	});

	test('@smoke shows the staged version and restarts when nothing is running', async ({
		page,
	}) => {
		await installMockBridge(page, { ...fixtureOneProjectOneSession(), updateReady: '0.2.0' });
		await page.goto('/');

		const badge = page.getByTestId('update-badge');
		await expect(badge).toContainText('v0.2.0 ready');
		await badge.click();

		// No live PTY, so no dialog — straight to relaunch.
		await expect(page.getByText('Restart to update?')).toHaveCount(0);
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'relaunch')).toBe(true);
	});

	test('@smoke confirms before killing a live session', async ({ page }) => {
		await installMockBridge(page, { ...fixtureOneProjectOneSession(), updateReady: '0.2.0' });
		await page.goto('/');

		// Open a session so a terminal is live — relaunch() would kill it, and
		// unlike a window close it never reaches the quit guard (ADR-0005).
		await page.locator('aside').getByText('foo').click();
		await page.getByText('Refactor the auth middleware').click();
		await expect(page.locator('.xterm')).toBeVisible();

		await page.getByTestId('update-badge').click();

		await expect(page.getByText('Restart to update?')).toBeVisible();
		await expect(page.getByText(/1 running Claude session/)).toBeVisible();
		// Nothing happened yet.
		let calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'relaunch')).toBe(false);

		await page.getByRole('button', { name: /restart & kill sessions/i }).click();
		calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'relaunch')).toBe(true);
	});

	test('@smoke Later dismisses without restarting', async ({ page }) => {
		await installMockBridge(page, { ...fixtureOneProjectOneSession(), updateReady: '0.2.0' });
		await page.goto('/');
		await page.locator('aside').getByText('foo').click();
		await page.getByText('Refactor the auth middleware').click();
		await expect(page.locator('.xterm')).toBeVisible();

		await page.getByTestId('update-badge').click();
		await page.getByRole('button', { name: /later/i }).click();

		await expect(page.getByText('Restart to update?')).toHaveCount(0);
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'relaunch')).toBe(false);
		// The badge is still there — the update is staged, just not applied.
		await expect(page.getByTestId('update-badge')).toBeVisible();
	});
});
