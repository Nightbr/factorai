import { expect, test } from '@playwright/test';
import { fixtureMissingProject, fixtureOneProjectOneSession, installMockBridge } from './fixtures';

/**
 * A project whose folder is gone (specs/05-features.md F1 + F6).
 *
 * The point is that you learn *before* clicking. The backend has always
 * refused to spawn into a directory that isn't there — `spawn_with_argv`
 * guards it — but that refusal arrives in the terminal pane after the click,
 * which is a strange place to find out your folder moved.
 */
test.describe('a project whose folder is gone', () => {
	test('@smoke is dimmed, labelled, and cannot start a session', async ({ page }) => {
		await installMockBridge(page, fixtureMissingProject());
		await page.goto('/');

		const sidebar = page.locator('aside');
		const row = sidebar.getByRole('link', { name: /foo/ });
		await expect(row).toHaveAttribute('data-missing', 'true');
		await expect(row.getByText('missing')).toBeVisible();
		// The path is in the tooltip, because "moved from where?" is the next
		// question and the display name can't answer it.
		await expect(row).toHaveAttribute('title', /Folder not found: \/home\/alice\/code\/foo/);

		// The sidebar's + is disabled rather than removed: a control that vanishes
		// leaves nowhere to hang the explanation.
		await expect(sidebar.getByRole('button', { name: 'New session in foo' })).toBeDisabled();
	});

	test('@smoke disables New session on the project page too', async ({ page }) => {
		await installMockBridge(page, fixtureMissingProject());
		await page.goto('/');
		await page.locator('aside').getByRole('link', { name: /foo/ }).click();

		await expect(page.getByRole('button', { name: 'New session', exact: true })).toBeDisabled();
		// The header says why rather than leaving a dead button unexplained.
		await expect(page.getByText(/folder not found/i)).toBeVisible();
	});

	test('@smoke a present project is unaffected', async ({ page }) => {
		// The same assertions inverted, so a bug that marks everything missing
		// can't pass by making the two tests above greener.
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');

		const row = page.locator('aside').getByRole('link', { name: /foo/ });
		await expect(row).not.toHaveAttribute('data-missing', 'true');
		await expect(row.getByText('missing')).toHaveCount(0);

		await row.click();
		await expect(page.getByRole('button', { name: 'New session', exact: true })).toBeEnabled();
	});
});
