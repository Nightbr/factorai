import { expect, test } from '@playwright/test';
import { fixtureTwoProjectsManySessions, installMockBridge } from './fixtures';

/**
 * Hiding a project from the sidebar (specs/05-features.md F1).
 *
 * Hiding is reversible, so there is no confirm dialog: the row goes, and the
 * way back is re-adding the folder — the same ⊕ gesture that added it in the
 * first place, which is why the last test exercises the mock's conflict path
 * (re-add refreshes the row rather than leaving it untouched).
 */
test.describe('hide project', () => {
	test('@smoke hiding a project removes its row and records the write', async ({ page }) => {
		const fx = fixtureTwoProjectsManySessions();
		await installMockBridge(page, fx);
		await page.goto('/');

		const sidebar = page.locator('aside');
		const alpha = sidebar.getByRole('link', { name: /alpha/ });
		await alpha.hover();

		await page.getByRole('button', { name: 'Hide alpha from sidebar' }).click();

		// Gone from the list, and its neighbour is untouched — hiding is one
		// row's action, not a list-wide refresh.
		await expect(sidebar.getByText('alpha', { exact: true })).toHaveCount(0);
		await expect(sidebar.getByText('zulu', { exact: true })).toBeVisible();

		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(
			calls.some(
				(c) => c.name === 'hide_project' && c.args?.id === '-home-alice-code-alpha' && c.args?.hidden === true,
			),
		).toBe(true);
	});

	test('@smoke re-adding the folder brings a hidden project back', async ({ page }) => {
		const fx = fixtureTwoProjectsManySessions();
		await installMockBridge(page, { ...fx, folderPick: '/home/alice/code/alpha' });
		await page.goto('/');

		const sidebar = page.locator('aside');
		await sidebar.getByRole('link', { name: /alpha/ }).hover();
		await page.getByRole('button', { name: 'Hide alpha from sidebar' }).click();
		await expect(sidebar.getByText('alpha', { exact: true })).toHaveCount(0);

		// The un-hide gesture: the same add flow that created the row.
		await page.getByTestId('add-project').click();

		await expect(sidebar.getByText('alpha', { exact: true })).toBeVisible();
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'add_project' && c.args?.path === '/home/alice/code/alpha')).toBe(
			true,
		);
	});
});
