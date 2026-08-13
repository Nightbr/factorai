import { expect, type Page, test } from '@playwright/test';
import { fixtureWithFileTree, installMockBridge } from './fixtures';

const ROOT = '/home/alice/code/foo';

/** Open a project so the route carries a projectId, then reveal the panel. */
async function openPanelOnProject(page: Page) {
	await page.locator('aside').first().getByText('foo').click();
	await page.getByRole('button', { name: 'Toggle file tree' }).click();
	return page.getByTestId('file-tree-panel');
}

/** Paths passed to list_dir so far, in call order. */
function listedPaths(page: Page) {
	return page.evaluate(() =>
		(window.__FACTORAI_TEST_CALLS__ ?? [])
			.filter((c) => c.name === 'list_dir')
			.map((c) => String(c.args?.path)),
	);
}

test.describe('file tree panel', () => {
	test('@smoke the top bar toggle reveals the tree and lists the project root', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');

		// Closed by default, so nothing has been listed yet.
		await expect(page.getByTestId('file-tree-panel')).toHaveCount(0);

		const panel = await openPanelOnProject(page);
		await expect(panel).toBeVisible();

		// The root row is expanded on first open, so its children are visible.
		await expect(panel.getByRole('button', { name: 'foo' })).toBeVisible();
		await expect(panel.getByRole('button', { name: 'apps' })).toBeVisible();
		await expect(panel.getByRole('button', { name: 'README.md' })).toBeVisible();
		await expect(panel.getByRole('button', { name: 'main.py' })).toBeVisible();

		// Root listing carries the project root so the backend can judge symlinks.
		const rootCall = await page.evaluate(() =>
			(window.__FACTORAI_TEST_CALLS__ ?? []).find((c) => c.name === 'list_dir'),
		);
		expect(rootCall?.args).toMatchObject({ path: ROOT, root: ROOT });
	});

	test('@smoke expanding a directory fetches it lazily and reports what was cut', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openPanelOnProject(page);
		await expect(panel.getByRole('button', { name: 'apps' })).toBeVisible();

		// Nothing below the root has been listed yet — expansion drives the IPC.
		expect(await listedPaths(page)).toEqual([ROOT]);

		await panel.getByRole('button', { name: 'apps' }).click();

		await expect(panel.getByRole('button', { name: 'index.ts' })).toBeVisible();
		expect(await listedPaths(page)).toEqual([ROOT, `${ROOT}/apps`]);
		// 2 of 12 entries returned.
		await expect(panel.getByText('… 10 more entries')).toBeVisible();
	});

	test('@smoke a symlink out of the project is shown but not expandable', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openPanelOnProject(page);

		const vendor = panel.getByRole('button', { name: 'vendor' });
		await expect(vendor).toBeVisible();
		await vendor.click();

		// Clicking selects but never lists it.
		expect(await listedPaths(page)).toEqual([ROOT]);
	});

	test('@smoke collapse-all empties the tree and close hides the panel', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		const panel = await openPanelOnProject(page);
		await expect(panel.getByRole('button', { name: 'README.md' })).toBeVisible();

		await panel.getByRole('button', { name: 'Collapse all' }).click();
		// Root row survives; everything under it is gone.
		await expect(panel.getByRole('button', { name: 'foo' })).toBeVisible();
		await expect(panel.getByRole('button', { name: 'README.md' })).toHaveCount(0);

		await panel.getByRole('button', { name: 'Close file tree' }).click();
		await expect(page.getByTestId('file-tree-panel')).toHaveCount(0);
	});

	test('@smoke open state survives a reload', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		await openPanelOnProject(page);
		await expect(page.getByTestId('file-tree-panel')).toBeVisible();

		await page.reload();

		// Persisted through localStorage, so it comes back open on the same route.
		await expect(page.getByTestId('file-tree-panel')).toBeVisible();
		await expect(page.getByTestId('file-tree-panel').getByRole('button', { name: 'foo' })).toBeVisible();
	});

	test('@smoke a route with no project explains itself instead of erroring', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');
		// Toggle from the root route, which carries no project id.
		await page.getByRole('button', { name: 'Toggle file tree' }).click();

		const panel = page.getByTestId('file-tree-panel');
		await expect(panel.getByText(/Select a project/i)).toBeVisible();
		expect(await listedPaths(page)).toEqual([]);
	});
});
