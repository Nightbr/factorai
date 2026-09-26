import { expect, test } from '@playwright/test';
import { installMockBridge } from '../smoke/fixtures';
import { shot } from './capture';
import { world } from './world';

test('troubleshooting: claude not detected, and an override that is wrong', async ({ page }) => {
	const { claudeCli: _found, ...w } = world();
	await installMockBridge(page, {
		...w,
		claudeBinaries: { '/home/ada/.npm-global/bin/claude': '2.1.4' },
	});
	await page.goto('/?settings=agents');
	const modal = page.getByTestId('settings-modal');
	await expect(modal).toBeVisible();
	const card = modal.getByTestId('settings-agent-claude');
	await expect(modal.getByTestId('settings-agent-claude-badge')).toBeVisible();
	await modal.getByTestId('settings-agent-claude-toggle').click();
	const field = modal.getByTestId('settings-claude-binary');
	await field.fill('/home/ada/.npm/bin/claude');
	await field.blur();
	await expect(modal.getByTestId('settings-claude-binary-error')).toBeVisible();
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await shot(page, 'troubleshooting-override', (await modal.boundingBox()) ?? undefined);
	await expect(card).toBeVisible();
});
