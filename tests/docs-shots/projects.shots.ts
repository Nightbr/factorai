import { expect, test, type Page } from '@playwright/test';
import { GROUP_DWELL_MS } from '../../apps/desktop/src/hooks/useDragDwell';
import { installMockBridge } from '../smoke/fixtures';
import { around, Gif, shot, type Box } from './capture';
import { HOME, IDS, world } from './world';

/**
 * The world, before it was organised: Pro already exists, and the three side
 * projects are still loose at the top level — the state the drag GIF tidies.
 */
function looseWorld() {
	const w = world();
	const [billing, docs, homelab, recipes] = w.projects;
	const dotfiles = {
		...homelab,
		id: 'p0000df1-0000-4000-8000-000000000005',
		realPath: `${HOME}/dotfiles`,
		displayName: 'dotfiles',
		lastSessionAt: Date.now() - 4 * 86_400_000,
		sessionCount: 1,
		sortOrder: 4,
	};
	const row = (p: typeof billing) => ({
		kind: 'project' as const,
		rowId: `row-${p.id}`,
		project: p,
	});
	return {
		...w,
		projects: [...w.projects, dotfiles],
		sidebar: [
			{
				kind: 'group' as const,
				rowId: IDS.pro,
				name: 'Pro',
				children: [
					{ rowId: `row-${billing.id}`, project: billing },
					{ rowId: `row-${docs.id}`, project: docs },
				],
			},
			row(recipes),
			row(dotfiles),
			row(homelab),
		],
	};
}

function topLevel(page: Page) {
	return page.getByTestId('projects').locator('> li > div');
}

function centre(b: Box) {
	return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Press on a row and get dnd-kit tracking: one move past its 4px activation
 *  distance, then a settle (tests/smoke/sidebar.spec.ts measured why). */
async function grab(page: Page, box: Box) {
	const c = centre(box);
	await page.mouse.move(c.x, c.y);
	await page.mouse.down();
	await page.mouse.move(c.x, c.y + 8);
	await page.waitForTimeout(80);
}

/** Aim at a fraction of the way down a box, in a few steps and then twice a
 *  pixel apart, because dnd-kit reports `over` one move behind. */
async function aim(page: Page, box: Box, fraction: number) {
	const x = box.x + box.width / 2;
	const y = box.y + box.height * fraction;
	await page.mouse.move(x, y, { steps: 6 });
	await page.mouse.move(x, y + 1);
	await page.waitForTimeout(120);
}

/** No hover, no focus ring, nothing mid-transition. */
async function rest(page: Page) {
	await page.mouse.move(-10, -10);
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await page.waitForTimeout(400);
}

async function rowBox(page: Page, name: string): Promise<Box> {
	const b = await topLevel(page).filter({ hasText: name }).first().boundingBox();
	if (!b) throw new Error(`no row for ${name}`);
	return b;
}

test('projects: reordering and grouping in the sidebar', async ({ page }) => {
	await installMockBridge(page, looseWorld());
	await page.goto('/');
	await page.getByRole('button', { name: 'Expand Pro', exact: true }).click();
	await expect(topLevel(page)).toHaveCount(4);

	// The projects list and room below it for the new group to open into.
	const header = page.getByTestId('sidebar').getByText('Projects', { exact: true });
	const list = await around([header, page.getByTestId('projects')], 0);
	const sidebar = await around([page.getByTestId('sidebar')], 0);
	const clip = { x: sidebar.x, y: list.y - 12, width: sidebar.width, height: list.height + 150 };

	const gif = new Gif(page, clip);
	await rest(page);
	await gif.frame(1500);

	// 1. Reorder: homelab up above dotfiles.
	await grab(page, await rowBox(page, 'homelab'));
	await aim(page, await rowBox(page, 'dotfiles'), 0.2);
	await expect(page.getByTestId('drop-line-above')).toBeVisible();
	await gif.frame(1200);
	await page.mouse.up();
	await expect(topLevel(page).nth(2)).toContainText('homelab');
	await rest(page);
	await gif.frame(1000);

	// 2. Group: hold recipes over homelab until it offers a new group.
	await grab(page, await rowBox(page, 'recipes'));
	await aim(page, await rowBox(page, 'homelab'), 0.5);
	await page.waitForTimeout(GROUP_DWELL_MS / 2);
	await gif.frame(700);
	await page.waitForTimeout(GROUP_DWELL_MS / 2 + 250);
	await expect(page.getByTestId('new-group-hint')).toBeVisible();
	await gif.frame(1400);
	await page.mouse.up();
	const editor = page.getByRole('textbox', { name: /Rename New group/ });
	await expect(editor).toBeFocused();
	await page.keyboard.type('Side projects');
	// The rows slide to make room for the group; let them land.
	await page.mouse.move(-10, -10);
	await page.waitForTimeout(500);
	await gif.frame(1400);
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('projects')).toContainText('Side projects');

	// 3. File: drop dotfiles onto the new group.
	const side = page
		.getByTestId('projects')
		.locator('> li')
		.filter({ hasText: 'Side projects' })
		.locator('> div')
		.first();
	const sideBox = await side.boundingBox();
	if (!sideBox) throw new Error('no group row');
	await grab(page, await rowBox(page, 'dotfiles'));
	await aim(page, sideBox, 0.5);
	await gif.frame(1200);
	await page.mouse.up();
	await expect(topLevel(page)).toHaveCount(2);
	await rest(page);
	await gif.frame(2600);
	gif.save('projects-organise');
});

test('projects: a project row and its right-click menu', async ({ page }) => {
	await installMockBridge(page, world());
	await page.goto('/');
	await page.getByRole('button', { name: 'Expand Side projects', exact: true }).click();
	const homelab = page
		.getByTestId('projects')
		.locator('li > div')
		.filter({ hasText: 'homelab' })
		.first();
	await homelab.click({ button: 'right' });
	const menu = page.getByRole('menu');
	await expect(menu).toBeVisible();
	const header = page.getByTestId('sidebar').getByText('Projects', { exact: true });
	await shot(
		page,
		'projects-row-menu',
		await around(
			[header, page.getByTestId('add-project-menu'), page.getByTestId('projects'), menu],
			12,
		),
	);
});
