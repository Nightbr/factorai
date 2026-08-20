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

	test('@smoke shows the staged version and restarts when nothing is running', async ({ page }) => {
		await installMockBridge(page, { ...fixtureOneProjectOneSession(), updateReady: '0.2.0' });
		await page.goto('/');

		const badge = page.getByTestId('update-badge');
		// **The label says `Update ready`; the version is in the tooltip.** F14 has
		// said so since 2026-08-17 and the code said `v0.2.0 ready · Restart` until
		// 2026-08-18 — a label whose min-content width the footer does not have.
		await expect(badge).toHaveText('Update ready');
		await expect(badge).toHaveAttribute('title', /Version 0\.2\.0/);
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

	test('@smoke the badge degrades instead of pushing the zoom controls out', async ({ page }) => {
		await installMockBridge(page, { ...fixtureOneProjectOneSession(), updateReady: '0.2.0' });
		await page.goto('/');

		const badge = page.getByTestId('update-badge');
		const zoom = page.getByRole('button', { name: 'Zoom in' });
		await expect(badge).toBeVisible();

		// Squeeze the sidebar to its 180px floor through the same keyboard path the
		// resize test uses, then zoom to 120% — the two together are the reported
		// case, where the badge ran under the zoom controls and was clipped
		// mid-word.
		const separator = page.getByRole('separator', { name: 'Resize sidebar' });
		await separator.focus();
		for (let i = 0; i < 30; i++) await separator.press('ArrowLeft');
		await page.getByRole('button', { name: 'Zoom in' }).click();
		await page.getByRole('button', { name: 'Zoom in' }).click();

		const sidebar = await page.getByTestId('sidebar').boundingBox();
		const badgeBox = await badge.boundingBox();
		const zoomBox = await zoom.boundingBox();
		if (!sidebar || !badgeBox || !zoomBox) throw new Error('footer not laid out');

		// Nothing leaves the sidebar, and the badge stops before the controls it
		// used to run under. A clipped badge still reports a bounding box, so the
		// assertion that catches the bug is this one: its right edge against its
		// neighbour's left.
		expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(zoomBox.x + 1);
		expect(zoomBox.x + zoomBox.width).toBeLessThanOrEqual(sidebar.x + sidebar.width + 1);
		// And the control it used to displace is still fully inside the sidebar.
		expect(zoomBox.width).toBeGreaterThan(0);
	});

	test('@smoke the badge does not change the footer height', async ({ page }) => {
		// The footer used to hug its content, and the badge is 24px against an 18px
		// row — so staging an update grew the footer by 6px and shifted the whole
		// sidebar to say something the badge was already saying (F14).
		const footer = page.getByTestId('sidebar-footer');

		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');
		await expect(page.getByTestId('update-check')).toBeVisible();
		const atRest = await footer.boundingBox();

		await installMockBridge(page, { ...fixtureOneProjectOneSession(), updateReady: '0.2.0' });
		await page.reload();
		await expect(page.getByTestId('update-badge')).toBeVisible();
		const staged = await footer.boundingBox();

		if (!atRest || !staged) throw new Error('footer not laid out');
		expect(staged.height).toBe(atRest.height);
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
