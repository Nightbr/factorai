import { expect, test } from '@playwright/test';
import { fixtureOneProjectOneSession, installMockBridge } from './fixtures';

test.describe('projects sidebar', () => {
	test('@smoke renders the empty state when no projects', async ({ page }) => {
		await installMockBridge(page, { projects: [] });
		await page.goto('/');
		await expect(page.getByText('factorai').first()).toBeVisible();
		await expect(page.getByText(/No projects found/i)).toBeVisible();
	});

	test('@smoke lists projects from the bridge fixture', async ({ page }) => {
		const fx = fixtureOneProjectOneSession();
		await installMockBridge(page, fx);
		await page.goto('/');

		// Project name shows up in the sidebar list. There's also "factorai"
		// in the header, so filter to the list region.
		const sidebar = page.locator('aside');
		await expect(sidebar.getByText('foo')).toBeVisible();
		// Session count shows next to it.
		await expect(sidebar.getByText('1', { exact: true })).toBeVisible();
	});

	test('@smoke clicking a project navigates to its session list', async ({ page }) => {
		const fx = fixtureOneProjectOneSession();
		await installMockBridge(page, fx);
		await page.goto('/');

		await page.locator('aside').getByText('foo').click();

		// Header on the project route shows the project name and its real
		// path, plus the session title.
		await expect(page.getByText('/home/alice/code/foo')).toBeVisible();
		await expect(page.getByText('Refactor the auth middleware')).toBeVisible();
	});

	test('@smoke clicking a session opens the terminal-only session view', async ({ page }) => {
		const fx = fixtureOneProjectOneSession();
		await installMockBridge(page, fx);
		await page.goto('/');
		await page.locator('aside').getByText('foo').click();
		await page.getByText('Refactor the auth middleware').click();

		// Session route header shows the session id (font-mono).
		await expect(page.locator('header').getByText('session-uuid-001')).toBeVisible();
		// xterm host renders a div under the terminal panel. xterm injects
		// the .xterm class on the host element it opens into.
		await expect(page.locator('.xterm')).toBeVisible();
	});
});
