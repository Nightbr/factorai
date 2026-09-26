import { expect, test } from '@playwright/test';
import { installMockBridge } from '../smoke/fixtures';
import { around, shot } from './capture';
import { IDS, world } from './world';

test('agents: the project menu’s New session with submenu', async ({ page }) => {
	const at = Date.now() - 30 * 86_400_000;
	const base = { isDefault: true, missing: false, createdAt: at };
	await installMockBridge(page, {
		...world(),
		// One default per agent, as an install with both logged in has.
		profiles: [
			{
				...base,
				id: 'profile-claude',
				agent: 'claude',
				name: 'Default',
				configDir: '/home/ada/.claude',
				isAppDefault: true,
			},
			{
				...base,
				id: 'profile-codex',
				agent: 'codex',
				name: 'Default',
				configDir: '/home/ada/.codex',
				isAppDefault: false,
			},
		],
	});
	await page.goto('/');
	const group = page.getByTestId('sidebar').getByText('Pro', { exact: true });
	await group.click();
	const row = page.getByTestId(`project-row-${IDS.billing}`);
	await expect(row).toBeVisible();
	await row.click({ button: 'right' });
	// Opened from the keyboard, so the submenu stays open when the pointer
	// leaves for the screenshot.
	await page.getByRole('menuitem', { name: 'New session with' }).focus();
	await page.keyboard.press('ArrowRight');
	// The other agent, which is what this submenu is for.
	await page.keyboard.press('ArrowDown');
	const menus = page.getByRole('menu');
	await expect(menus).toHaveCount(2);
	await shot(
		page,
		'agents-new-session-with',
		await around([group, row, menus.nth(0), menus.nth(1)], 16),
	);
});
