import { expect, test } from '@playwright/test';
import { installMockBridge } from './fixtures';

/**
 * The first-run hero (specs/05-features.md F1 § "The empty state", ADR-0067):
 * an empty workspace is said in the middle of the window, with the two doors
 * as two amber buttons of one size.
 */
test.describe('first run', () => {
	const claude = { installed: true, binaryPath: '/usr/bin/claude', version: '2.1.4' };

	test('@smoke the empty workspace centres two equal doors', async ({ page }) => {
		await installMockBridge(page, { projects: [], sidebar: [], claudeCli: claude });
		await page.goto('/');

		const hero = page.getByTestId('first-run');
		await expect(hero.getByRole('heading', { name: 'No projects yet' })).toBeVisible();
		const add = await page.getByTestId('empty-add-project').boundingBox();
		const imp = await page.getByTestId('empty-open-import').boundingBox();
		if (!add || !imp) throw new Error('the doors are not on screen');
		expect(Math.round(add.width)).toBe(Math.round(imp.width));
		expect(add.height).toBe(imp.height);

		// The sidebar keeps only the fact; the buttons moved to the hero.
		await expect(page.getByTestId('sidebar-empty')).toHaveText('No projects yet.');
		await expect(page.locator('aside').getByRole('button', { name: 'Add Project…' })).toHaveCount(
			0,
		);
		// An installed agent needs no pointer.
		await expect(page.getByTestId('first-run-no-agent')).toHaveCount(0);
	});

	test('@smoke Add Project opens the picker and lands on the new project', async ({ page }) => {
		await installMockBridge(page, {
			projects: [],
			sidebar: [],
			claudeCli: claude,
			folderPick: '/home/alice/code/brand-new',
		});
		await page.goto('/');
		await page.getByTestId('empty-add-project').click();
		await expect(page).toHaveURL(/projects\/[0-9a-f-]{36}$/);
		await expect(page.getByTestId('first-run')).toHaveCount(0);
	});

	test('@smoke Import from… offers every agent', async ({ page }) => {
		await installMockBridge(page, { projects: [], sidebar: [], claudeCli: claude });
		await page.goto('/');
		await page.getByTestId('empty-open-import').click();
		await expect(page.getByRole('menuitem', { name: /^Claude Code/ })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: /^Codex/ })).toContainText('not installed');
		await page.getByRole('menuitem', { name: /^Codex/ }).click();
		await expect(
			page.getByTestId('import-projects').getByRole('heading', { name: 'Import from Codex' }),
		).toBeVisible();
	});

	test('@smoke the halo breathes, and holds still under reduced motion', async ({ page }) => {
		await installMockBridge(page, { projects: [], sidebar: [], claudeCli: claude });
		await page.goto('/');
		const halos = page.getByTestId('first-run-halo');
		await expect(halos).toHaveCount(2);
		const name = () => halos.first().evaluate((el) => getComputedStyle(el).animationName);
		expect(await name()).toBe('first-run-halo');

		await page.emulateMedia({ reducedMotion: 'reduce' });
		expect(await name()).toBe('none');
		const shadow = await halos.first().evaluate((el) => getComputedStyle(el).boxShadow);
		expect(shadow).not.toBe('none');
	});

	test('@smoke with no agent found, the hero points at Settings → Agents', async ({ page }) => {
		await installMockBridge(page, { projects: [], sidebar: [] });
		await page.goto('/');
		const hint = page.getByTestId('first-run-no-agent');
		await expect(hint).toBeVisible();
		await hint.getByRole('button', { name: 'Settings → Agents' }).click();
		await expect(page).toHaveURL(/settings=agents/);
	});
});
