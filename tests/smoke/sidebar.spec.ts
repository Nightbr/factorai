import { expect, test } from '@playwright/test';
import { fixtureTwoProjectsManySessions, installMockBridge } from './fixtures';

/**
 * Sidebar project list: sort menu and expandable sessions
 * (specs/05-features.md F1, F2).
 */

const ZULU = '-home-alice-code-zulu';

test.describe('sidebar projects', () => {
	test('@smoke a project expands to its latest sessions, newest first', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		await page.getByRole('button', { name: 'Expand zulu' }).click();

		const rows = page.getByTestId(`sidebar-sessions-${ZULU}`).getByRole('link');
		// 10 sessions + the "2 more…" link.
		await expect(rows).toHaveCount(11);
		await expect(rows.first()).toContainText('Zulu task 11');
		await expect(rows.nth(9)).toContainText('Zulu task 2');
		await expect(page.getByText('2 more…')).toBeVisible();
	});

	test('@smoke expanding is per project and collapsing hides the sessions', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await expect(page.getByTestId(`sidebar-sessions-${ZULU}`)).toBeVisible();
		// The other project stayed shut.
		await expect(page.getByTestId('sidebar-sessions--home-alice-code-alpha')).toHaveCount(0);

		await page.getByRole('button', { name: 'Collapse zulu' }).click();
		await expect(page.getByTestId(`sidebar-sessions-${ZULU}`)).toHaveCount(0);
	});

	test('@smoke sorting by name reorders the list, and persists across reload', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		const names = page.locator('aside li > div a[href*="/projects/"]');
		// Recency order from the backend: zulu first despite the alphabet.
		await expect(names.first()).toContainText('zulu');

		await page.getByRole('button', { name: 'Sort and expand projects' }).click();
		await page.getByRole('menuitemradio', { name: 'Name' }).click();
		await expect(names.first()).toContainText('alpha');

		await page.reload();
		await expect(names.first()).toContainText('alpha');
	});

	test('@smoke expand all and collapse all act on every project', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		await page.getByRole('button', { name: 'Sort and expand projects' }).click();
		await page.getByRole('menuitem', { name: 'Expand all' }).click();
		await expect(page.getByTestId(`sidebar-sessions-${ZULU}`)).toBeVisible();
		await expect(page.getByTestId('sidebar-sessions--home-alice-code-alpha')).toBeVisible();

		await page.getByRole('button', { name: 'Sort and expand projects' }).click();
		await page.getByRole('menuitem', { name: 'Collapse all' }).click();
		await expect(page.getByTestId(`sidebar-sessions-${ZULU}`)).toHaveCount(0);
	});

	test('@smoke a session in the sidebar opens that session', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await page.getByRole('link', { name: /Zulu task 11/ }).click();

		await expect(page).toHaveURL(/sessions\/zulu-session-11$/);
		await expect(page.locator('.xterm')).toBeVisible();
	});
});
