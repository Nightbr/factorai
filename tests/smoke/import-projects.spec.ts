import { expect, test } from '@playwright/test';
import { fixtureImportCandidates, installMockBridge } from './fixtures';

/**
 * Importing folders Claude has worked in (specs/05-features.md F1, ADR-0011).
 *
 * The dialog is the second door onto `add_project` — the same command the
 * folder picker calls — so what these assert is the *selection* rules and that
 * the right paths come out the other side, not a separate import mechanism.
 */
test.describe('import from Claude Code', () => {
	async function openDialog(page: import('@playwright/test').Page) {
		await page.getByTestId('add-project-menu').click();
		await page.getByTestId('open-import').click();
		await expect(page.getByTestId('import-projects')).toBeVisible();
	}

	test('@smoke lists what Claude has, marking what is already in the workspace', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureImportCandidates());
		await page.goto('/');
		await openDialog(page);

		const list = page.getByTestId('import-list');
		await expect(list.getByText('/home/alice/code/pelican')).toBeVisible();
		await expect(list.getByText('17 sessions')).toBeVisible();

		// Already-open rows are shown rather than hidden, so the list answers
		// "is this one already in?" instead of leaving you wondering.
		const known = page.getByTestId('import-row--home-alice-code-known');
		await expect(known.getByRole('checkbox')).toBeChecked();
		await expect(known.getByRole('checkbox')).toBeDisabled();
		await expect(known.getByText('in workspace')).toBeVisible();

		// A deleted folder is importable but says so: every transcript survives,
		// and only starting a session in it is impossible.
		const gone = page.getByTestId('import-row--home-alice-code-vanished');
		await expect(gone.getByText('missing')).toBeVisible();
		await expect(gone.getByRole('checkbox')).toBeEnabled();
	});

	test('@smoke importing the checked rows adds exactly those folders', async ({ page }) => {
		await installMockBridge(page, fixtureImportCandidates());
		await page.goto('/');
		await openDialog(page);

		await page
			.getByTestId('import-row--home-alice-code-pelican')
			.getByRole('checkbox')
			.click();
		await page.getByTestId('import-row--home-alice-code-heron').getByRole('checkbox').click();

		await expect(page.getByTestId('import-confirm')).toHaveText('Import 2');
		await page.getByTestId('import-confirm').click();

		await expect(page.getByTestId('import-projects')).toHaveCount(0);
		const sidebar = page.locator('aside');
		await expect(sidebar.getByText('pelican')).toBeVisible();
		await expect(sidebar.getByText('heron')).toBeVisible();

		// The two chosen paths, and nothing else — in particular not the row that
		// was already in the workspace and rendered checked.
		const added = await page.evaluate(() =>
			(window.__FACTORAI_TEST_CALLS__ ?? [])
				.filter((c) => c.name === 'add_project')
				.map((c) => c.args?.path),
		);
		expect(added).toEqual(['/home/alice/code/pelican', '/home/alice/code/heron']);
	});

	test('@smoke select all takes every importable row and skips the rest', async ({ page }) => {
		await installMockBridge(page, fixtureImportCandidates());
		await page.goto('/');
		await openDialog(page);

		await page.getByRole('checkbox', { name: 'Select all' }).click();

		// Three candidates, one of them already in the workspace.
		await expect(page.getByTestId('import-confirm')).toHaveText('Import 3');
		await page.getByTestId('import-confirm').click();

		const added = await page.evaluate(() =>
			(window.__FACTORAI_TEST_CALLS__ ?? [])
				.filter((c) => c.name === 'add_project')
				.map((c) => c.args?.path),
		);
		expect(added).not.toContain('/home/alice/code/known');
		expect(added).toHaveLength(3);
	});

	test('@smoke the filter matches the path, and cancelling imports nothing', async ({ page }) => {
		await installMockBridge(page, fixtureImportCandidates());
		await page.goto('/');
		await openDialog(page);

		await page.getByTestId('import-filter').fill('pelican');
		const list = page.getByTestId('import-list');
		await expect(list.getByText('/home/alice/code/pelican')).toBeVisible();
		await expect(list.getByText('/home/alice/code/heron')).toHaveCount(0);

		await list.getByRole('checkbox').first().click();
		await page.getByRole('button', { name: 'Cancel' }).click();

		await expect(page.getByTestId('import-projects')).toHaveCount(0);
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'add_project')).toBe(false);
		await expect(page.locator('aside').getByText('pelican')).toHaveCount(0);
	});

	test('@smoke the empty state offers both ways in', async ({ page }) => {
		await installMockBridge(page, { projects: [], importCandidates: [] });
		await page.goto('/');

		await expect(page.getByTestId('empty-add-project')).toBeVisible();
		await page.getByTestId('empty-open-import').click();

		// Nothing to import is a sentence, not an empty box.
		await expect(page.getByText(/no project history on this machine/i)).toBeVisible();
	});
});
