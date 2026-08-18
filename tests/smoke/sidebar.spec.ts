import { expect, test } from '@playwright/test';
import { ALPHA_ID, ZULU_ID, fixtureTwoProjectsManySessions, installMockBridge } from './fixtures';

/**
 * Sidebar project list: sort menu and expandable sessions
 * (specs/05-features.md F1, F2).
 */

test.describe('sidebar projects', () => {
	test('@smoke a project expands to its latest sessions, newest first', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		await page.getByRole('button', { name: 'Expand zulu' }).click();

		const rows = page.getByTestId(`sidebar-sessions-${ZULU_ID}`).getByRole('link');
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
		await expect(page.getByTestId(`sidebar-sessions-${ZULU_ID}`)).toBeVisible();
		// The other project stayed shut.
		await expect(page.getByTestId(`sidebar-sessions-${ALPHA_ID}`)).toHaveCount(0);

		await page.getByRole('button', { name: 'Collapse zulu' }).click();
		await expect(page.getByTestId(`sidebar-sessions-${ZULU_ID}`)).toHaveCount(0);
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
		await expect(page.getByTestId(`sidebar-sessions-${ZULU_ID}`)).toBeVisible();
		await expect(page.getByTestId(`sidebar-sessions-${ALPHA_ID}`)).toBeVisible();

		await page.getByRole('button', { name: 'Sort and expand projects' }).click();
		await page.getByRole('menuitem', { name: 'Collapse all' }).click();
		await expect(page.getByTestId(`sidebar-sessions-${ZULU_ID}`)).toHaveCount(0);
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

test.describe('pinned projects', () => {
	test('@smoke pinning moves a project above the divider and back', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		// Nothing pinned: no pinned block at all.
		await expect(page.getByTestId('pinned-projects')).toHaveCount(0);

		await page.getByRole('button', { name: 'Pin alpha' }).click();

		const pinnedBlock = page.getByTestId('pinned-projects');
		await expect(pinnedBlock).toBeVisible();
		await expect(pinnedBlock.getByRole('link', { name: /alpha/ })).toBeVisible();
		// And it is no longer in the main list.
		await expect(page.locator('aside ul:not([data-testid])').getByText('alpha')).toHaveCount(0);

		// The pin is now the unpin target, and visible without hovering.
		const unpin = page.getByRole('button', { name: 'Unpin alpha' });
		await expect(unpin).toBeVisible();
		await unpin.click();
		await expect(page.getByTestId('pinned-projects')).toHaveCount(0);
	});

	test('@smoke the chosen sort applies inside the pinned block too', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		await page.getByRole('button', { name: 'Pin alpha' }).click();
		await page.getByRole('button', { name: 'Pin zulu' }).click();

		const pinnedNames = page.getByTestId('pinned-projects').getByRole('link');
		// Recency order first: zulu was touched most recently.
		await expect(pinnedNames.first()).toContainText('zulu');

		await page.getByRole('button', { name: 'Sort and expand projects' }).click();
		await page.getByRole('menuitemradio', { name: 'Name' }).click();
		await expect(pinnedNames.first()).toContainText('alpha');
	});
});

test.describe('sidebar resizing', () => {
	test('@smoke the separator resizes the sidebar and the width persists', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		const sidebar = page.getByTestId('sidebar');
		const before = (await sidebar.boundingBox())?.width ?? 0;
		expect(before).toBeGreaterThan(0);

		// Keyboard rather than a drag: same code path through clampSidebarWidth,
		// and it doesn't depend on pointer capture behaving in a headless browser.
		const separator = page.getByRole('separator', { name: 'Resize sidebar' });
		await separator.focus();
		await separator.press('ArrowRight');
		await separator.press('ArrowRight');

		const after = (await sidebar.boundingBox())?.width ?? 0;
		expect(after).toBeGreaterThan(before);

		await page.reload();
		const restored = (await page.getByTestId('sidebar').boundingBox())?.width ?? 0;
		expect(restored).toBe(after);
	});

	test('@smoke a live project badges its avatar rather than its row', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		// Open a session so the project has a live PTY.
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await page.getByRole('link', { name: /Zulu task 11/ }).click();
		await expect(page.locator('.xterm')).toBeVisible();

		// The dot is inside the avatar, not a sibling in the row.
		const badgedIcon = page
			.locator('aside')
			.getByTestId('project-icon')
			.filter({ has: page.locator('[title="Working"]') });
		await expect(badgedIcon).toHaveCount(1);
	});
});

test.describe('sidebar header', () => {
	test('@smoke PROJECTS and the sort control stay put while the list scrolls', async ({ page }) => {
		// Short window plus every project expanded, so the list must overflow —
		// at the default viewport it simply fits, and the test would pass without
		// ever scrolling anything.
		await page.setViewportSize({ width: 1280, height: 400 });
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Sort and expand projects' }).click();
		await page.getByRole('menuitem', { name: 'Expand all' }).click();

		const header = page.locator('aside').getByText('Projects', { exact: true });
		const before = await header.boundingBox();

		const scroller = page.locator('aside nav');
		await scroller.evaluate((el) => el.scrollBy(0, 400));
		await expect.poll(async () => (await scroller.evaluate((el) => el.scrollTop)) > 0).toBe(true);

		// The header is a sibling above the scroller, so scrolling cannot move it.
		expect(await header.boundingBox()).toEqual(before);
		await expect(page.getByRole('button', { name: 'Sort and expand projects' })).toBeVisible();
	});
});
