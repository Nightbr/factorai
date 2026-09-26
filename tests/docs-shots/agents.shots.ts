import { expect, test } from '@playwright/test';
import { installMockBridge } from '../smoke/fixtures';
import { shot } from './capture';
import { world } from './world';

test('agents: the Agents section of Settings', async ({ page }) => {
	await installMockBridge(page, world());
	await page.goto('/?settings=agents');
	const modal = page.getByTestId('settings-modal');
	await expect(modal).toBeVisible();
	await expect(modal).toContainText('2.1.4');
	// The card open, so the picture shows the two fields the page names.
	await modal
		.getByRole('button', { name: /Claude Code/ })
		.first()
		.click();
	await expect(modal).toContainText('Override path');
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await shot(page, 'agents-settings', (await modal.boundingBox()) ?? undefined);
});
