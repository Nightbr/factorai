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
		await expect(page.getByRole('button', { name: 'Terminal' })).toBeEnabled();
		await expect(page.getByTestId('shell-pane')).toHaveCount(0);
	});

	test('@smoke a chip opens a pane, and clicking it again collapses without closing', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');
		await page.locator('aside').getByText('foo').click();
		await page.getByText('Refactor the auth middleware').click();
		await page.getByRole('button', { name: 'Terminal' }).click();

		// Scoped to the strip: the project page's `Sessions | Routines` chips are
		// tabs too, and they share this role.
		const chip = page.getByTestId('shell-footer').getByRole('tab');
		await expect(page.getByTestId('shell-pane')).toBeVisible();
		await expect(chip).toHaveCount(1);
		// The label is the shell's name and nothing the shell prints (F24): the
		// mock bridge answers `shell_name` with `zsh`, and the chip says so.
		await expect(chip).toHaveText('zsh');

		await chip.click();
		// The pane is gone and the chip is not: collapsing leaves the shell
		// running, and nothing was killed on the way.
		await expect(page.getByTestId('shell-pane')).toHaveCount(0);
		await expect(chip).toHaveCount(1);
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'terminal_kill')).toBe(false);
		expect(calls.some((c) => c.name === 'shell_kill_for_session')).toBe(false);
	});

	test('@smoke Split puts a pane beside the first, and the corner × kills it', async ({ page }) => {
		// Wide enough that room is never the reason a split is refused.
		await page.setViewportSize({ width: 1600, height: 900 });
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');
		await page.locator('aside').getByText('foo').click();
		await page.getByText('Refactor the auth middleware').click();
		const footer = page.getByTestId('shell-footer');
		const split = footer.getByRole('button', { name: 'Split' });

		// Nothing to split before there is a shell, and the control says so
		// rather than doing nothing.
		await expect(split).toBeDisabled();
		await footer.getByRole('button', { name: 'Terminal' }).click();
		await split.click();

		const hosts = page.getByTestId('shell-pane-host');
		await expect(hosts).toHaveCount(2);
		// Still one chip, now saying it holds two.
		const chip = footer.getByRole('tab');
		await expect(chip).toHaveCount(1);
		await expect(chip).toContainText('2');

		// The `×` is in the pane's corner, on hover, and closing is a kill (F24):
		// F23's chip `×` dropped the store entry and left the process running.
		await hosts.nth(1).hover();
		await hosts.nth(1).getByRole('button', { name: 'Close this shell' }).click();
		await expect(hosts).toHaveCount(1);
		await expect(chip).toHaveText('zsh');
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.filter((c) => c.name === 'terminal_kill')).toHaveLength(1);
	});

	test('@smoke five panes is the cap, and Split says so', async ({ page }) => {
		await page.setViewportSize({ width: 1800, height: 900 });
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');
		await page.locator('aside').getByText('foo').click();
		await page.getByText('Refactor the auth middleware').click();
		const footer = page.getByTestId('shell-footer');
		const split = footer.getByRole('button', { name: 'Split' });

		await footer.getByRole('button', { name: 'Terminal' }).click();
		for (let i = 1; i < 5; i++) {
			await split.click();
			await expect(page.getByTestId('shell-pane-host')).toHaveCount(i + 1);
		}
		await expect(split).toBeDisabled();
		// The reason is on the control's wrapper: a disabled button gets no
		// pointer events in WebKit, so the tooltip has to live one level up.
		await expect(footer.locator('[title="Five panes is the most a chip holds"]')).toBeVisible();
		await expect(footer.getByRole('tab')).toContainText('5');
	});
});
