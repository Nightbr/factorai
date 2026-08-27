import { expect, test } from '@playwright/test';
import {
	ALPHA_ID,
	PERSO_GROUP_ID,
	PRO_GROUP_ID,
	ZULU_ID,
	fixtureGroupedProjects,
	fixtureTwoProjectsManySessions,
	installMockBridge,
} from './fixtures';

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
		// The hand order out of the fixture: zulu first, despite the alphabet.
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

test.describe('hand-ordered projects', () => {
	/** Every project row, top to bottom. */
	function rowNames(page: import('@playwright/test').Page) {
		return page.getByTestId('projects').locator('> li > div a[href*="/projects/"]');
	}

	test('@smoke Alt+ArrowDown moves a project, and the order survives a refetch', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		const names = rowNames(page);
		await expect(names.first()).toContainText('zulu');

		// The keyboard path is the one asserted here because it cannot flake: no
		// activation distance, no collision detection, no pointer geometry. The
		// mouse drag has its own test below.
		await names.first().focus();
		await page.keyboard.press('Alt+ArrowDown');

		await expect(names.first()).toContainText('alpha');

		// **The point of the test.** The sidebar refetches every 2s, so an
		// optimistic write that never reached the backend would snap back. Waiting
		// past one full poll and re-asserting is what proves `reorder_projects` was
		// called and the mock's fixture actually changed.
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'reorder_sidebar')).toBe(true);
		await page.waitForTimeout(2_500);
		await expect(names.first()).toContainText('alpha');
	});

	test('@smoke dragging a project past its neighbour reorders the list', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		const names = rowNames(page);
		await expect(names.first()).toContainText('zulu');

		const from = await names.first().boundingBox();
		const to = await names.nth(1).boundingBox();
		if (!from || !to) throw new Error('no row geometry');

		// Past the row's midpoint, because `closestCenter` decides the drop on
		// centres — stopping short of it lands back where it started. The
		// intermediate move is not decoration: dnd-kit needs a pointermove past
		// the 4px activation distance before it starts tracking at all.
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
		await page.mouse.down();
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 8);
		await page.mouse.move(from.x + from.width / 2, to.y + to.height);
		await page.mouse.up();

		await expect(names.first()).toContainText('alpha');
	});

	test('@smoke a click on a row still opens it, so the drag has not eaten the click', async ({
		page,
	}) => {
		// The 4px activation distance exists for exactly this. Without it dnd-kit
		// claims the pointerdown and swallows the click that follows.
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		await rowNames(page).first().click();

		await expect(page).toHaveURL(new RegExp(`/projects/${ZULU_ID}$`));
	});

	test('@smoke a derived sort turns the reorder off entirely', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		await page.getByRole('button', { name: 'Sort and expand projects' }).click();
		await page.getByRole('menuitemradio', { name: 'Name' }).click();

		const names = rowNames(page);
		await expect(names.first()).toContainText('alpha');

		// No key handler...
		await names.first().focus();
		await page.keyboard.press('Alt+ArrowDown');
		await expect(names.first()).toContainText('alpha');

		// ...and no menu rows either. Absent, not disabled: the thing blocking them
		// is a sort mode in another menu, and a greyed row invites a hunt for it.
		await names.first().click({ button: 'right' });
		await expect(page.getByRole('menuitem', { name: 'Move up' })).toHaveCount(0);
		await expect(page.getByRole('menuitem', { name: 'Move down' })).toHaveCount(0);

		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'reorder_sidebar')).toBe(false);
	});

	test('@smoke Move down in the row menu is the same move as the key', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		const names = rowNames(page);
		await names.first().click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Move down' }).click();

		await expect(names.first()).toContainText('alpha');
	});
});

test.describe('project groups', () => {
	/** Every top-level row's label, top to bottom. A group's label is its name. */
	function topLevel(page: import('@playwright/test').Page) {
		return page.getByTestId('projects').locator('> li > div');
	}

	test('@smoke a group renders its projects, and counts them when collapsed', async ({ page }) => {
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');

		// Collapsed out of the box — `expanded` is empty on a fresh store — so the
		// count is the only thing that can say what is inside.
		const pro = page.getByTestId(`group-${PRO_GROUP_ID}`);
		await expect(pro).toContainText('Pro');
		await expect(pro).toContainText('1');
		await expect(page.getByTestId(`group-children-${PRO_GROUP_ID}`)).toHaveCount(0);

		await page.getByRole('button', { name: 'Expand Pro', exact: true }).click();

		const children = page.getByTestId(`group-children-${PRO_GROUP_ID}`);
		await expect(children.getByRole('link', { name: /alpha/ })).toBeVisible();
		// Expanded, the count goes: it would be telling you what you can see.
		await expect(pro.locator('> div').getByText('1', { exact: true })).toHaveCount(0);
	});

	test('@smoke an ungrouped project interleaves with the group rows', async ({ page }) => {
		// Not "groups first, then loose projects" — the sidebar is one ordered list
		// of rows where some rows expand (F1).
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');

		await expect(topLevel(page)).toHaveCount(3);
		await expect(topLevel(page).nth(0)).toContainText('Pro');
		await expect(topLevel(page).nth(1)).toContainText('zulu');
		await expect(topLevel(page).nth(2)).toContainText('Perso');
	});

	test('@smoke an empty group says so, and says it can take a drop', async ({ page }) => {
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');

		await page.getByRole('button', { name: 'Expand Perso', exact: true }).click();

		// The placeholder and the drop target are the same row — an empty group is a
		// container you made on purpose, so it stays and it says what to do with it.
		await expect(page.getByTestId(`group-empty-${PERSO_GROUP_ID}`)).toHaveText(
			'Drop a project here',
		);
	});

	test('@smoke Alt+ArrowDown walks a loose project into the group below it', async ({ page }) => {
		// One keyboard path for both reordering and filing, because `moveRow`'s rule
		// is that the target decides the level.
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand Perso', exact: true }).click();

		const zulu = topLevel(page).nth(1);
		await zulu.getByRole('link', { name: /zulu/ }).focus();
		await page.keyboard.press('Alt+ArrowDown');

		// zulu is now inside Perso, and no longer a top-level row.
		await expect(page.getByTestId(`group-children-${PERSO_GROUP_ID}`)).toContainText('zulu');
		await expect(topLevel(page)).toHaveCount(2);

		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'reorder_sidebar')).toBe(true);
		// And it survives the poll, which is what says the write actually landed.
		await page.waitForTimeout(2_500);
		await expect(page.getByTestId(`group-children-${PERSO_GROUP_ID}`)).toContainText('zulu');
	});

	test('@smoke Alt+ArrowUp pulls a project back out of its group', async ({ page }) => {
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand Pro', exact: true }).click();

		const alpha = page.getByTestId(`group-children-${PRO_GROUP_ID}`).getByRole('link', {
			name: /alpha/,
		});
		await alpha.focus();
		// One press. `nudgeRow`'s rule is that up from a group's *first* child
		// leaves the group, landing just above it — which is the regression that
		// function exists for: routed through `moveRow` this was a permanent no-op,
		// because the row above a first child is the group's own header and dropping
		// there means "the top of this group".
		await page.keyboard.press('Alt+ArrowUp');

		await expect(topLevel(page).nth(0)).toContainText('alpha');
		// Pro is empty now, so it shows its placeholder — which is also the proof
		// that the project really left rather than being copied out.
		await expect(page.getByTestId(`group-empty-${PRO_GROUP_ID}`)).toBeVisible();
	});

	test('@smoke dragging a project onto a group files it into that group', async ({ page }) => {
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand Perso', exact: true }).click();

		const zulu = topLevel(page).nth(1);
		const perso = page.getByTestId(`group-${PERSO_GROUP_ID}`).locator('> div');
		const from = await zulu.boundingBox();
		const to = await perso.boundingBox();
		if (!from || !to) throw new Error('no geometry');

		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
		await page.mouse.down();
		// Past the 4px activation distance first, then onto the group's centre.
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 8);
		await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2);
		await page.mouse.up();

		await expect(page.getByTestId(`group-children-${PERSO_GROUP_ID}`)).toContainText('zulu');
	});

	test('@smoke a derived sort dissolves the groups into one flat list', async ({ page }) => {
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');

		await page.getByRole('button', { name: 'Sort and expand projects' }).click();
		await page.getByRole('menuitemradio', { name: 'Name' }).click();

		// No group rows at all, and the project that was *inside* Pro appears —
		// which is the stated cost of this mode (F1).
		await expect(page.getByTestId(`group-${PRO_GROUP_ID}`)).toHaveCount(0);
		await expect(page.getByTestId(`group-${PERSO_GROUP_ID}`)).toHaveCount(0);
		const names = topLevel(page).locator('a[href*="/projects/"]');
		await expect(names).toHaveCount(2);
		await expect(names.nth(0)).toContainText('alpha');
		await expect(names.nth(1)).toContainText('zulu');
	});

	test('@smoke Expand all opens the groups too', async ({ page }) => {
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');

		await page.getByRole('button', { name: 'Sort and expand projects' }).click();
		await page.getByRole('menuitem', { name: 'Expand all' }).click();

		await expect(page.getByTestId(`group-children-${PRO_GROUP_ID}`)).toBeVisible();
		await expect(page.getByTestId(`group-empty-${PERSO_GROUP_ID}`)).toBeVisible();
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
