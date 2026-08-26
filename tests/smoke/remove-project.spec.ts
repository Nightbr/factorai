import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FOO_ID, fixtureOneProjectOneSession, installMockBridge } from './fixtures';

/**
 * Removing a project from the workspace (specs/05-features.md F1, ADR-0011).
 *
 * The thing worth testing is what removal *is*: a workspace decision that
 * touches nothing on disk. So these assert on which commands were called — and
 * on which were not — rather than only on the row disappearing.
 */
async function openRowMenu(page: Page) {
	await page.getByTestId(`project-row-${FOO_ID}`).click({ button: 'right' });
	await expect(page.getByTestId(`remove-project-${FOO_ID}`)).toBeVisible();
}

test.describe('remove project', () => {
	test('@smoke the row menu removes it with no dialog when nothing is running', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');
		const sidebar = page.locator('aside');
		await expect(sidebar.getByText('foo')).toBeVisible();

		await openRowMenu(page);
		await page.getByTestId(`remove-project-${FOO_ID}`).click();

		// Gone, and it did not stop to ask: nothing was running, nothing on disk
		// is touched, and re-adding rebuilds. A dialog here would be friction on
		// the action this whole change exists to make possible.
		await expect(sidebar.getByText('foo')).toHaveCount(0);
		await expect(page.getByTestId('confirm-remove-project')).toHaveCount(0);

		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'remove_project' && c.args?.id === FOO_ID)).toBe(true);
	});

	test('@smoke removing asks first when a session is live, and stops it on confirm', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');
		await page.locator('aside').getByText('foo').click();
		await page.getByText('Refactor the auth middleware').click();
		await expect(page.locator('.xterm')).toBeVisible();

		await openRowMenu(page);
		await page.getByTestId(`remove-project-${FOO_ID}`).click();

		// Leaving `claude` running with no row and no tab is the invisible-agent
		// state the quit guard exists to prevent, so this one asks.
		const dialog = page.getByTestId('confirm-remove-project');
		await expect(dialog).toBeVisible();
		await expect(dialog.getByText(/1 running session/)).toBeVisible();

		await page.getByTestId('confirm-remove-project-yes').click();

		await expect(page.locator('aside').getByText('foo')).toHaveCount(0);
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		// The PTY was killed, not orphaned…
		expect(calls.some((c) => c.name === 'terminal_kill')).toBe(true);
		// …and only then was the project removed.
		const killAt = calls.findIndex((c) => c.name === 'terminal_kill');
		const removeAt = calls.findIndex((c) => c.name === 'remove_project');
		expect(killAt).toBeGreaterThanOrEqual(0);
		expect(removeAt).toBeGreaterThan(killAt);
		// And you are not left looking at the project you just removed.
		await expect(page).not.toHaveURL(new RegExp(`projects/${FOO_ID}`));
	});

	test('@smoke cancelling the confirm leaves the project and its session alone', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');
		await page.locator('aside').getByText('foo').click();
		await page.getByText('Refactor the auth middleware').click();
		await expect(page.locator('.xterm')).toBeVisible();

		await openRowMenu(page);
		await page.getByTestId(`remove-project-${FOO_ID}`).click();
		await page.getByRole('button', { name: 'Cancel' }).click();

		await expect(page.getByTestId('confirm-remove-project')).toHaveCount(0);
		await expect(page.locator('aside').getByText('foo')).toBeVisible();
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'remove_project')).toBe(false);
		expect(calls.some((c) => c.name === 'terminal_kill')).toBe(false);
	});

	test('@smoke the same menu carries the reorder, so the row has one place for its actions', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');

		await openRowMenu(page);

		// F1's old rejection of a row context menu rested on pin being the only
		// action. Pin is gone and the menu is still the right answer: Remove has
		// nowhere else sane to live, and Move up / Move down are the keyboard's
		// complete answer to a gesture only a mouse can otherwise reach.
		await expect(page.getByRole('menuitem', { name: 'Move up' })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: 'Move down' })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: 'Reveal in file manager' })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: 'Remove Project' })).toBeVisible();
	});
});
