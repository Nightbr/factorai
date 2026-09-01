import { expect, test } from '@playwright/test';
import { ZULU_ID, fixtureTwoProjectsManySessions, installMockBridge } from './fixtures';

/**
 * Pinning a session to the top of its project's list (specs/05-features.md F2).
 *
 * The fixture is the one built for the sidebar's cap: twelve sessions, oldest
 * first, so the list has to reorder them and two rows sit behind `2 more…`. That
 * makes it the right shape for a pin, because the property under test is not
 * "the flag flipped" but "a row that recency had pushed to the bottom is now at
 * the top and stays there".
 */
const STALE = 'zulu-session-02';
const NEWEST = 'zulu-session-11';

test.describe('pin a session', () => {
	test('@smoke the row menu pins a session to the top of the list', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();

		const rows = page.getByTestId(`sidebar-sessions-${ZULU_ID}`).getByRole('link');
		// Recency: the newest session leads, and `Zulu task 2` is the last of the
		// ten slots.
		await expect(rows.first()).toHaveText(/Zulu task 11/);

		await page
			.getByTestId(`sidebar-sessions-${ZULU_ID}`)
			.getByRole('link', { name: /Zulu task 2$/ })
			.click({ button: 'right' });
		await page.getByTestId(`pin-session-${STALE}`).click();

		// The stale row leads, and the newest one is now second.
		await expect(rows.first()).toHaveText(/Zulu task 2/);
		await expect(rows.nth(1)).toHaveText(/Zulu task 11/);

		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(
			calls.some(
				(c) =>
					c.name === 'set_session_pinned' && c.args?.sessionId === STALE && c.args?.pinned === true,
			),
		).toBe(true);
	});

	test('@smoke the pin button on the row toggles it back off', async ({ page }) => {
		// The button is the discoverable half — a feature reachable only by
		// right-click is one nobody finds. It is also the mark on a pinned row, so
		// it stays visible once the pin is on.
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();

		await page.getByTestId(`pin-session-button-${STALE}`).click();
		const rows = page.getByTestId(`sidebar-sessions-${ZULU_ID}`).getByRole('link');
		await expect(rows.first()).toHaveText(/Zulu task 2/);
		await expect(page.getByTestId(`pin-session-button-${STALE}`)).toHaveAttribute(
			'aria-pressed',
			'true',
		);

		await page.getByTestId(`pin-session-button-${STALE}`).click();
		await expect(rows.first()).toHaveText(/Zulu task 11/);
		await expect(page.getByTestId(`pin-session-button-${NEWEST}`)).toHaveAttribute(
			'aria-pressed',
			'false',
		);
	});

	test('@smoke the project page splits the list into Pinned and Recent', async ({ page }) => {
		// The project page has no pin control (F2): it honours the order the
		// backend produces, and names the two blocks so the order reads as a
		// decision rather than a broken sort.
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await page.getByTestId(`pin-session-button-${STALE}`).click();

		await page.goto(`/#/projects/${ZULU_ID}`);
		await expect(page.getByText('Pinned', { exact: true })).toBeVisible();
		await expect(page.getByText('Recent', { exact: true })).toBeVisible();

		const rows = page.getByRole('link', { name: /Zulu task/ });
		await expect(rows.first()).toHaveText(/Zulu task 2/);
	});
});
