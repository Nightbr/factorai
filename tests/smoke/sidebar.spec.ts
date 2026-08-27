import { expect, test } from '@playwright/test';
import { GROUP_DWELL_MS } from '../../apps/desktop/src/hooks/useDragDwell';
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

test.describe('creating, renaming and removing a group', () => {
	function topLevel(page: import('@playwright/test').Page) {
		return page.getByTestId('projects').locator('> li > div');
	}

	test('@smoke New Group… creates a group at the top with its name selected', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		await page.getByTestId('add-project-menu').click();
		await page.getByTestId('new-group').click();

		// Top of the list, like a newly added project — and the editor has to be on
		// screen for the rename that opens with it to mean anything.
		const editor = page.getByRole('textbox', { name: /Rename New group/ });
		await expect(editor).toBeFocused();
		// Selected, not just focused: every use of this is "here is a default,
		// replace it", so typing replaces rather than appends.
		await expect(editor).toHaveValue('New group');
		await page.keyboard.type('Pro');
		await page.keyboard.press('Enter');

		await expect(topLevel(page).nth(0)).toContainText('Pro');
	});

	test('@smoke Escape keeps the default name rather than losing the group', async ({ page }) => {
		// The group exists either way — that is the whole reason rename is inline
		// rather than a modal whose Cancel has to decide.
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		await page.getByTestId('add-project-menu').click();
		await page.getByTestId('new-group').click();
		await page.keyboard.type('half a name');
		await page.keyboard.press('Escape');

		await expect(topLevel(page).nth(0)).toContainText('New group');
	});

	test('@smoke Rename… renames a group, and it survives a refetch', async ({ page }) => {
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');

		await page.getByTestId(`group-${PRO_GROUP_ID}`).locator('> div').click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Rename…' }).click();
		await page.keyboard.type('Work');
		await page.keyboard.press('Enter');

		await expect(page.getByTestId(`group-${PRO_GROUP_ID}`)).toContainText('Work');
		await page.waitForTimeout(2_500);
		await expect(page.getByTestId(`group-${PRO_GROUP_ID}`)).toContainText('Work');
	});

	test('@smoke removing an empty group is silent', async ({ page }) => {
		// A container you can remake in two clicks. A dialog here is friction on the
		// one thing everybody does with this feature.
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');

		await page.getByTestId(`group-${PERSO_GROUP_ID}`).locator('> div').click({ button: 'right' });
		await page.getByTestId(`remove-group-${PERSO_GROUP_ID}`).click();

		await expect(page.getByTestId('confirm-remove-group')).toHaveCount(0);
		await expect(page.getByTestId(`group-${PERSO_GROUP_ID}`)).toHaveCount(0);
	});

	test('@smoke removing a group with projects asks, then returns them to the list', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');

		await page.getByTestId(`group-${PRO_GROUP_ID}`).locator('> div').click({ button: 'right' });
		await page.getByTestId(`remove-group-${PRO_GROUP_ID}`).click();

		const confirm = page.getByTestId('confirm-remove-group');
		await expect(confirm).toBeVisible();
		await expect(confirm).toContainText('1 project');
		await expect(confirm).toContainText('Nothing is deleted');
		await page.getByTestId('confirm-remove-group-yes').click();

		// Spliced into the group's own slot — the box is erased, not its contents.
		await expect(page.getByTestId(`group-${PRO_GROUP_ID}`)).toHaveCount(0);
		await expect(topLevel(page).nth(0)).toContainText('alpha');
	});

	test('@smoke Cancel leaves the group alone', async ({ page }) => {
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');

		await page.getByTestId(`group-${PRO_GROUP_ID}`).locator('> div').click({ button: 'right' });
		await page.getByTestId(`remove-group-${PRO_GROUP_ID}`).click();
		await page.getByRole('button', { name: 'Cancel' }).click();

		await expect(page.getByTestId(`group-${PRO_GROUP_ID}`)).toBeVisible();
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'remove_group')).toBe(false);
	});
});

test.describe('Move to group', () => {
	function topLevel(page: import('@playwright/test').Page) {
		return page.getByTestId('projects').locator('> li > div');
	}

	test('@smoke files a project into a named group from the menu', async ({ page }) => {
		// The complete keyboard path for changing level: Alt+arrows only walk one
		// slot, so picking a named group needs a target rather than a step.
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');

		await topLevel(page).nth(1).click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Move to group' }).hover();
		await page.getByRole('menuitem', { name: 'Perso', exact: true }).click();

		await expect(page.getByTestId(`group-children-${PERSO_GROUP_ID}`)).toContainText('zulu');
	});

	test('@smoke New group… makes a group holding that project', async ({ page }) => {
		// The keyboard's answer to the dwell gesture.
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		await topLevel(page).nth(0).click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Move to group' }).hover();
		await page.getByRole('menuitem', { name: 'New group…' }).click();

		// Created, holding the project, expanded, with its name up for editing.
		await expect(page.getByRole('textbox', { name: /Rename New group/ })).toBeFocused();
		await page.keyboard.type('Pro');
		await page.keyboard.press('Enter');
		await expect(topLevel(page).nth(0)).toContainText('Pro');
		await expect(page.getByTestId('projects')).toContainText('zulu');
	});

	test('@smoke Remove from group appears only for a project in one', async ({ page }) => {
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand Pro', exact: true }).click();

		// A loose project has nothing to leave, so the row is absent rather than
		// greyed — nothing is blocking it.
		await topLevel(page).nth(1).click({ button: 'right' });
		await expect(page.getByRole('menuitem', { name: 'Remove from group' })).toHaveCount(0);
		await page.keyboard.press('Escape');

		const alpha = page.getByTestId(`group-children-${PRO_GROUP_ID}`).locator('> li > div');
		await alpha.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Remove from group' }).click();

		// `unfile` puts it at the end of the top level, so filter rather than
		// index — and Pro showing its placeholder is the proof it really left.
		await expect(topLevel(page).filter({ hasText: 'alpha' })).toHaveCount(1);
		await expect(page.getByTestId(`group-empty-${PRO_GROUP_ID}`)).toBeVisible();
	});

	test('@smoke the group a project is already in is greyed out', async ({ page }) => {
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand Pro', exact: true }).click();

		const alpha = page.getByTestId(`group-children-${PRO_GROUP_ID}`).locator('> li > div');
		await alpha.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Move to group' }).hover();

		// An enabled row there would be a no-op the user paid a click for.
		await expect(page.getByRole('menuitem', { name: 'Pro', exact: true })).toBeDisabled();
		await expect(page.getByRole('menuitem', { name: 'Perso', exact: true })).toBeEnabled();
	});
});

test.describe('hold a project over another to group them', () => {
	function topLevel(page: import('@playwright/test').Page) {
		return page.getByTestId('projects').locator('> li > div');
	}

	/** Press on `from`, move onto `to`, and hold there for `holdMs`. Leaves the
	 *  button **down** so the caller decides what the drop means. */
	async function holdOver(
		page: import('@playwright/test').Page,
		from: { x: number; y: number; width: number; height: number },
		to: { x: number; y: number; width: number; height: number },
		holdMs: number,
	) {
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
		await page.mouse.down();
		// Past the 4px activation distance first, or dnd-kit never starts tracking.
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 8);
		await page.waitForTimeout(80);
		// Two moves, one pixel apart: dnd-kit reports `over` one move behind, so a
		// single discrete jump names the row the pointer just left. See `aim` in the
		// drag-visuals block for the measurement.
		await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2);
		await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 + 1);
		await page.waitForTimeout(holdMs);
	}

	test('@smoke holding past the dwell offers a group, and the drop makes one', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		const zulu = await topLevel(page).nth(0).boundingBox();
		const alpha = await topLevel(page).nth(1).boundingBox();
		if (!zulu || !alpha) throw new Error('no geometry');

		// Real time against the exported constant, not a mocked clock: the dwell
		// couples to dnd-kit's pointer handling and rAF, and a fake clock there
		// passes while the gesture is broken.
		await holdOver(page, zulu, alpha, GROUP_DWELL_MS + 250);

		// The drop's meaning has visibly changed before it commits — which is what
		// actually prevents accidents, rather than the wait being long.
		await expect(page.getByTestId('new-group-hint')).toBeVisible();
		await page.mouse.up();

		// A group holding both, named and up for editing.
		await expect(page.getByRole('textbox', { name: /Rename New group/ })).toBeFocused();
		await page.keyboard.type('Pro');
		await page.keyboard.press('Enter');

		await expect(topLevel(page).nth(0)).toContainText('Pro');
		const children = page.getByTestId('projects').locator('ul[data-testid^="group-children-"]');
		await expect(children).toContainText('zulu');
		await expect(children).toContainText('alpha');
	});

	test('@smoke a shorter hold is still just a reorder', async ({ page }) => {
		// The regression that matters. Passing over a row on the way somewhere else
		// must not group anything.
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		const zulu = await topLevel(page).nth(0).boundingBox();
		const alpha = await topLevel(page).nth(1).boundingBox();
		if (!zulu || !alpha) throw new Error('no geometry');

		await holdOver(page, zulu, alpha, Math.floor(GROUP_DWELL_MS / 3));
		await expect(page.getByTestId('new-group-hint')).toHaveCount(0);
		await page.mouse.up();

		// Reordered, not grouped.
		await expect(topLevel(page).nth(0)).toContainText('alpha');
		await expect(topLevel(page)).toHaveCount(2);
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'create_group')).toBe(false);
	});

	test('@smoke moving off the row cancels the offer', async ({ page }) => {
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');

		const pro = await topLevel(page).nth(0).boundingBox();
		const zulu = await topLevel(page).nth(1).boundingBox();
		const perso = await topLevel(page).nth(2).boundingBox();
		if (!pro || !zulu || !perso) throw new Error('no geometry');

		// Hold over Perso long enough to start the clock, then move away before it
		// finishes: nothing may be pending afterwards.
		await page.mouse.move(zulu.x + zulu.width / 2, zulu.y + zulu.height / 2);
		await page.mouse.down();
		await page.mouse.move(zulu.x + zulu.width / 2, zulu.y + zulu.height / 2 + 8);
		await page.mouse.move(perso.x + perso.width / 2, perso.y + perso.height / 2);
		await page.waitForTimeout(Math.floor(GROUP_DWELL_MS / 2));
		await page.mouse.move(pro.x + pro.width / 2, pro.y + pro.height / 2);
		await page.waitForTimeout(120);

		await expect(page.getByTestId('dwell-ring')).toHaveCount(0);
		await page.mouse.up();
	});

	test('@smoke a collapsed group takes the drop without opening', async ({ page }) => {
		// **This replaced spring-open.** Holding over a collapsed group used to expand
		// it on the same timer as the group offer, which put the same filling ring on
		// the one row where a group will *not* be created. The three-zone rule made it
		// unnecessary: the middle of a collapsed group row already means "into", so
		// the drop lands without expanding anything, and no ring appears.
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');

		const rows = page.getByTestId('projects').locator('> li > div');
		const zulu = await rows.nth(1).boundingBox();
		const perso = await rows.nth(2).boundingBox();
		if (!zulu || !perso) throw new Error('no geometry');

		await holdOver(page, zulu, perso, GROUP_DWELL_MS + 250);
		await expect(page.getByTestId('dwell-ring')).toHaveCount(0);
		await page.mouse.up();

		// Filed in, and Perso is still collapsed — its count is what says so.
		await expect(page.getByTestId(`group-${PERSO_GROUP_ID}`)).toContainText('1');
		await expect(page.getByTestId(`group-children-${PERSO_GROUP_ID}`)).toHaveCount(0);
	});

	test('@smoke no offer over a project that is already in a group', async ({ page }) => {
		// Grouping them would need nesting, which the schema forbids — so the
		// gesture is not offered, and the drop just files into that group.
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand Pro', exact: true }).click();

		const zulu = await topLevel(page).nth(1).boundingBox();
		const alpha = await page
			.getByTestId(`group-children-${PRO_GROUP_ID}`)
			.locator('> li > div')
			.boundingBox();
		if (!zulu || !alpha) throw new Error('no geometry');

		await holdOver(page, zulu, alpha, GROUP_DWELL_MS + 250);
		await expect(page.getByTestId('new-group-hint')).toHaveCount(0);
		await page.mouse.up();

		// Filed into Pro rather than grouped with alpha.
		await expect(page.getByTestId(`group-children-${PRO_GROUP_ID}`)).toContainText('zulu');
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'create_group')).toBe(false);
	});

	test('@smoke a derived sort offers no dwell at all', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Sort and expand projects' }).click();
		await page.getByRole('menuitemradio', { name: 'Name' }).click();

		const first = await topLevel(page).nth(0).boundingBox();
		const second = await topLevel(page).nth(1).boundingBox();
		if (!first || !second) throw new Error('no geometry');

		await holdOver(page, first, second, GROUP_DWELL_MS + 250);
		await expect(page.getByTestId('dwell-ring')).toHaveCount(0);
		await expect(page.getByTestId('new-group-hint')).toHaveCount(0);
		await page.mouse.up();

		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'create_group')).toBe(false);
	});
});

test.describe('what the drag looks like while it happens', () => {
	function topLevel(page: import('@playwright/test').Page) {
		return page.getByTestId('projects').locator('> li > div');
	}

	/**
	 * Press on a box's centre and get the drag properly started.
	 *
	 * **The settle is not padding.** dnd-kit needs one move past the 4px activation
	 * distance before it tracks anything, and the move *immediately* after that one
	 * lands while it is still measuring — so the first aim is silently dropped and
	 * an assertion right after it sees no indicator at all. Measured while chasing
	 * six failures that were all this.
	 */
	async function grab(
		page: import('@playwright/test').Page,
		box: { x: number; y: number; width: number; height: number },
	) {
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 8);
		await page.waitForTimeout(80);
	}

	/**
	 * Aim at a fraction of the way down a box, and let the move register.
	 *
	 * **Two moves, one pixel apart.** dnd-kit reports `over` one move behind — it
	 * collides against rects measured on the previous frame — so a single discrete
	 * jump reports the row the pointer *left*. A real drag never notices, because
	 * moves arrive continuously; a test that jumps once per aim sees the wrong row
	 * every time. Measured, after three wrong hypotheses.
	 */
	async function aim(
		page: import('@playwright/test').Page,
		box: { x: number; y: number; width: number; height: number },
		fraction: number,
	) {
		const y = box.y + box.height * fraction;
		await page.mouse.move(box.x + box.width / 2, y);
		await page.mouse.move(box.x + box.width / 2, y + 1);
		await page.waitForTimeout(100);
	}

	test('@smoke the row under the pointer does not move', async ({ page }) => {
		// **The regression that made the group gesture hard to perform.** dnd-kit's
		// vertical-list strategy displaced every other row to open a gap, so the
		// project you were trying to hold still over slid out from under the cursor.
		// Nothing displaces now; a line says where the drop goes.
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		const target = topLevel(page).nth(1);
		const before = await target.boundingBox();
		const source = await topLevel(page).nth(0).boundingBox();
		if (!before || !source) throw new Error('no geometry');

		await grab(page, source);
		// Three quarters down, not the exact midpoint — at 0.5 the zone boundary is a
		// coin flip and the assertion would be flaky by construction.
		await aim(page, before, 0.75);

		const during = await target.boundingBox();
		expect(during?.y).toBeCloseTo(before.y, 0);
		// And the line is what tells you where it will land instead.
		await expect(page.getByTestId('drop-line-below')).toBeVisible();
		await page.mouse.up();
	});

	test('@smoke the edge follows where in the row the pointer is, not the direction', async ({
		page,
	}) => {
		// **Position, not direction.** The old rule inferred "after" from "you came
		// from above", which cannot be drawn honestly — the mark has to be chosen
		// before the drop, and the direction is not visible in it. So the top half of
		// a row means before it whichever way you arrived.
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		const first = await topLevel(page).nth(0).boundingBox();
		const second = await topLevel(page).nth(1).boundingBox();
		if (!first || !second) throw new Error('no geometry');

		await grab(page, second);
		await aim(page, first, 0.15);
		await expect(page.getByTestId('drop-line-above')).toBeVisible();

		// Lower quarter of the same row, still travelling upward overall.
		await aim(page, first, 0.85);
		await expect(page.getByTestId('drop-line-below')).toBeVisible();
		await page.mouse.up();
	});

	test('@smoke a project can be dropped between two groups', async ({ page }) => {
		// **The report.** A group row used to mean only "into", so there was nothing
		// near a group to aim at except its inside — a project could not be placed
		// between two groups. Its bottom quarter means "after it" now.
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');

		// Pro, zulu, Perso — drop zulu after Perso's *predecessor* by aiming at the
		// bottom edge of Pro, which puts it between the two groups.
		const zulu = await topLevel(page).nth(1).boundingBox();
		const pro = await topLevel(page).nth(0).boundingBox();
		if (!zulu || !pro) throw new Error('no geometry');

		await grab(page, zulu);
		await aim(page, pro, 0.9);

		// A line, not a ring: the bottom quarter of a group row is a position beside
		// it rather than its inside.
		await expect(page.getByTestId('drop-line-below')).toBeVisible();
		await page.mouse.up();

		// Still at the top level, still three rows, now second.
		await expect(topLevel(page)).toHaveCount(3);
		await expect(topLevel(page).nth(1)).toContainText('zulu');
	});

	test('@smoke a project can be dropped at the end of the list', async ({ page }) => {
		// The other half: collision detection always resolves to some row, so without
		// a droppable for the space below the list every drop near the bottom snapped
		// into whichever container happened to be last.
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');

		const zulu = await topLevel(page).nth(1).boundingBox();
		const end = await page.getByTestId('sidebar-end-zone').boundingBox();
		if (!zulu || !end) throw new Error('no geometry');

		await grab(page, zulu);
		await aim(page, { ...end, height: Math.min(80, end.height) }, 0.5);

		await expect(page.getByTestId('drop-line-end')).toBeVisible();
		await page.mouse.up();

		// Last row, and at the *top level* rather than inside Perso, which is last.
		await expect(topLevel(page)).toHaveCount(3);
		await expect(topLevel(page).nth(2)).toContainText('zulu');
	});

	test('@smoke no dwell ring over a group row', async ({ page }) => {
		// The dwell means one thing — create a group — and a group row is the one row
		// where that will not happen. It used to spring the group open on the same
		// timer, wearing the same ring, which read as a promise the drop would break.
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');

		const zulu = await topLevel(page).nth(1).boundingBox();
		const perso = await topLevel(page).nth(2).boundingBox();
		if (!zulu || !perso) throw new Error('no geometry');

		await grab(page, zulu);
		await aim(page, perso, 0.5);
		await page.waitForTimeout(GROUP_DWELL_MS + 250);

		await expect(page.getByTestId('dwell-ring')).toHaveCount(0);
		await expect(page.getByTestId('new-group-hint')).toHaveCount(0);
		await page.mouse.up();

		// And the drop still files it in, which is what made spring-open unnecessary.
		await expect(page.getByTestId(`group-${PERSO_GROUP_ID}`)).toContainText('1');
	});

	test('@smoke dragging a group collapses it for the duration', async ({ page }) => {
		// An expanded group is a header plus its children, and the sortable node is
		// the whole `<li>` — so dragging one meant hauling a four-row block around a
		// list of single rows.
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand Pro', exact: true }).click();
		await expect(page.getByTestId(`group-children-${PRO_GROUP_ID}`)).toBeVisible();

		const pro = await topLevel(page).nth(0).boundingBox();
		const zulu = await topLevel(page).nth(1).boundingBox();
		if (!pro || !zulu) throw new Error('no geometry');

		await grab(page, pro);
		await aim(page, zulu, 0.5);

		await expect(page.getByTestId(`group-children-${PRO_GROUP_ID}`)).toHaveCount(0);
		await page.mouse.up();

		// And it comes back — a drag must not silently close a group you had open.
		await expect(page.getByTestId(`group-children-${PRO_GROUP_ID}`)).toBeVisible();
	});

	test('@smoke a group dragged over a project offers no group, and creates none', async ({
		page,
	}) => {
		// Groups do not nest, and `fileIntoGroup` cannot move a group — so the offer
		// used to produce a group holding only the *project*, silently. The guard was
		// missing a check that the dragged row is a project at all: groups are always
		// top-level, so the `parentOf(...) === null` test passed for them.
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');

		const pro = await topLevel(page).nth(0).boundingBox();
		const zulu = await topLevel(page).nth(1).boundingBox();
		if (!pro || !zulu) throw new Error('no geometry');

		await grab(page, pro);
		await aim(page, zulu, 0.5);
		await page.waitForTimeout(GROUP_DWELL_MS + 250);

		await expect(page.getByTestId('new-group-hint')).toHaveCount(0);
		await expect(page.getByTestId('dwell-ring')).toHaveCount(0);
		await page.mouse.up();

		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'create_group')).toBe(false);
	});

	test('@smoke a project over a group row marks the group, not an edge', async ({ page }) => {
		// Dropping into a container is a containment, not a position — so the group
		// takes a ring and no line is drawn.
		await installMockBridge(page, fixtureGroupedProjects());
		await page.goto('/');

		const zulu = await topLevel(page).nth(1).boundingBox();
		const perso = await topLevel(page).nth(2).boundingBox();
		if (!zulu || !perso) throw new Error('no geometry');

		await grab(page, zulu);
		await aim(page, perso, 0.5);

		await expect(page.getByTestId('drop-line-above')).toHaveCount(0);
		await expect(page.getByTestId('drop-line-below')).toHaveCount(0);
		await page.mouse.up();

		// Perso stays *collapsed* — the dwell that would spring it open never ran, so
		// it renders no children list. Its count is what says the drop landed.
		await expect(topLevel(page)).toHaveCount(2);
		await expect(page.getByTestId(`group-${PERSO_GROUP_ID}`)).toContainText('1');
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
