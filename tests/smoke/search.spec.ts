import { expect, test } from '@playwright/test';
import { fixtureWithSearchHits, installMockBridge } from './fixtures';

test.describe('full-text search', () => {
	test('@smoke typing in the sidebar search shows hits and opens a session', async ({ page }) => {
		await installMockBridge(page, fixtureWithSearchHits());
		await page.goto('/');

		// Type into the sidebar search box (debounced → navigates to /search).
		await page.getByPlaceholder('Search sessions…').fill('auth');

		// The hit's title and snippet render on the search route. (Exact match
		// for the title — it's a substring of the snippet text below.)
		await expect(page.getByText('Refactor the auth middleware', { exact: true })).toBeVisible();
		await expect(page.getByText(/please refactor the auth middleware/i)).toBeVisible();

		// A hit names the project it came from — two projects routinely hold
		// sessions with the same title, so the title alone doesn't place it.
		const hit = page.locator('li', { hasText: 'Refactor the auth middleware' });
		await expect(hit.getByText('foo', { exact: true })).toBeVisible();
		await expect(hit.getByTestId('project-icon')).toBeVisible();

		// Clicking the hit opens that session's terminal view.
		await page.getByText(/please refactor the auth middleware/i).click();
		// Header names the session by title; the uuid is on the hover title (F6).
		await expect(page.locator('header').getByTitle('session-uuid-001')).toBeVisible();
		await expect(page.locator('.xterm')).toBeVisible();
	});

	test('@smoke empty query shows the prompt, not a stale list', async ({ page }) => {
		await installMockBridge(page, fixtureWithSearchHits());
		await page.goto('/#/search?q=');
		await expect(page.getByText(/Type a query in the sidebar/i)).toBeVisible();
	});
});
