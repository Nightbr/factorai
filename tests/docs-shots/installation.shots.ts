import { expect, test } from '@playwright/test';
import { installMockBridge } from '../smoke/fixtures';
import { around, Gif } from './capture';
import { world } from './world';

test('installation: checking for an update, downloading, restart to update', async ({ page }) => {
	await installMockBridge(page, {
		...world(),
		updateFound: { version: '0.51.0', checkMs: 900, downloadMs: 1600 },
	});
	await page.goto('/');
	const footer = page.getByTestId('sidebar-footer');
	await expect(footer.getByTestId('update-check')).toBeVisible();

	const sidebar = page.getByTestId('sidebar');
	const clip = await around([footer], 0);
	// A little of the sidebar above the footer, so the picture says where on
	// screen this is.
	const box = { ...clip, y: clip.y - 48, height: clip.height + 48 };
	await expect(sidebar).toBeVisible();

	const gif = new Gif(page, box);
	await gif.frame(1400);
	const check = footer.getByTestId('update-check');
	await check.hover();
	await gif.frame(700);
	await check.click();
	await expect(footer).toContainText(/Checking/i);
	await gif.frame(900);
	await expect(footer).toContainText(/Downloading/i);
	await gif.frame(1600);
	await expect(footer.getByTestId('update-badge')).toBeVisible();
	await page.mouse.move(-10, -10);
	await gif.frame(2600);
	gif.save('installation-update');
});
