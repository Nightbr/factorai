import { expect, test } from '@playwright/test';
import { fixtureOneProjectOneSession, installMockBridge } from './fixtures';

/**
 * The session footer's shells (specs/05-features.md F23).
 *
 * The PTY is the mock bridge's, so nothing here proves a shell runs — that is
 * the Rust suite's job and the manual pass's. What the browser lane holds onto
 * is the surface's own rules: the strip is there before any shell is, a chip
 * appears with its pane, and clicking the active chip collapses the pane
 * **without** closing the shell, which is the one gesture whose whole point is
 * that it is not a close.
 */
test.describe('shell footer', () => {
	test('@smoke the strip is there before any shell is', async ({ page }) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');
		await page.locator('aside').getByText('foo').click();
		await page.getByText('Refactor the auth middleware').click();
		await expect(page.locator('.xterm:visible')).toBeVisible();

		// Discoverability is the reason it is permanent: a control that only
		// appears once you have used the feature cannot introduce it.
		await expect(page.getByTestId('shell-footer')).toBeVisible();
		await expect(page.getByRole('button', { name: 'New shell' })).toBeEnabled();
		await expect(page.getByTestId('shell-pane')).toHaveCount(0);
	});

	test('@smoke a chip opens a pane, and clicking it again collapses without closing', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');
		await page.locator('aside').getByText('foo').click();
		await page.getByText('Refactor the auth middleware').click();
		await page.getByRole('button', { name: 'New shell' }).click();

		// Scoped to the strip: the project page's `Sessions | Routines` chips are
		// tabs too, and they share this role.
		const chip = page.getByTestId('shell-footer').getByRole('tab');
		await expect(page.getByTestId('shell-pane')).toBeVisible();
		await expect(chip).toHaveCount(1);

		await chip.click();
		// The pane is gone and the chip is not: collapsing leaves the shell
		// running, and nothing was killed on the way.
		await expect(page.getByTestId('shell-pane')).toHaveCount(0);
		await expect(chip).toHaveCount(1);
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'terminal_kill')).toBe(false);
		expect(calls.some((c) => c.name === 'shell_kill_for_session')).toBe(false);
	});
});
