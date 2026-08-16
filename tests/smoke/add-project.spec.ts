import { expect, test } from '@playwright/test';
import { fixtureOneProjectOneSession, installMockBridge } from './fixtures';

/**
 * Adding a folder to the workspace (specs/05-features.md F1).
 *
 * The picker itself is native and unreachable from here, so the fixture's
 * `folderPick` stands in for what it returns — a path, or nothing when the
 * user cancels. Everything after that point is the real flow.
 *
 * The `FolderPlus` in the section header is a menu now, since there are two
 * doors onto one action (ADR-0011); these cover the picker door, and
 * `import-projects.spec.ts` covers the other.
 */
test.describe('add project', () => {
	test('@smoke picking a folder adds it and opens it', async ({ page }) => {
		const fx = fixtureOneProjectOneSession();
		await installMockBridge(page, { ...fx, folderPick: '/home/alice/code/brand-new' });
		await page.goto('/');

		const sidebar = page.locator('aside');
		await expect(sidebar.getByText('brand-new')).toHaveCount(0);

		await page.getByTestId('add-project-menu').click();
		await page.getByTestId('add-project').click();

		// The row appears…
		await expect(sidebar.getByText('brand-new')).toBeVisible();
		// …and the folder was sent as picked, not decoded back out of the id.
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(
			calls.some((c) => c.name === 'add_project' && c.args?.path === '/home/alice/code/brand-new'),
		).toBe(true);
		// …and you land on it, ready to start the first session there. The id is a
		// uuid the backend minted, so the assertion is on the shape of the route
		// rather than on a path smuggled into it (ADR-0011).
		await expect(page).toHaveURL(/projects\/[0-9a-f-]{36}$/);
	});

	test('@smoke cancelling the picker changes nothing', async ({ page }) => {
		const fx = fixtureOneProjectOneSession();
		// No `folderPick` — the picker resolves null, as it does on Cancel.
		await installMockBridge(page, fx);
		await page.goto('/');
		const before = page.url();

		await page.getByTestId('add-project-menu').click();
		await page.getByTestId('add-project').click();

		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		// The picker was opened, and nothing was added off the back of it.
		expect(calls.some((c) => c.name === 'dialog.open')).toBe(true);
		expect(calls.some((c) => c.name === 'add_project')).toBe(false);
		expect(page.url()).toBe(before);
		await expect(page.getByTestId('add-project-error')).toHaveCount(0);
	});

	test('@smoke adding a folder already known is a no-op, not a duplicate', async ({ page }) => {
		const fx = fixtureOneProjectOneSession();
		const existing = fx.projects?.[0];
		if (!existing?.realPath) throw new Error('fixture has no project path');
		await installMockBridge(page, { ...fx, folderPick: existing.realPath });
		await page.goto('/');

		await page.getByTestId('add-project-menu').click();
		await page.getByTestId('add-project').click();

		// One row, not two: the workspace is keyed by canonical path, so re-adding
		// lands on the project that is already there rather than minting a second
		// uuid for the same folder.
		await expect(
			page.locator('aside').getByText(existing.displayName, { exact: true }),
		).toHaveCount(1);
	});
});
