import { expect, test } from '@playwright/test';
import { fixtureTwoProjectsManySessions, installMockBridge } from './fixtures';

test('@smoke clickable elements resolve to cursor:pointer', async ({ page }) => {
	await installMockBridge(page, fixtureTwoProjectsManySessions());
	await page.goto('/');

	const cursorOf = (sel: string) =>
		page.locator(sel).first().evaluate((el) => getComputedStyle(el).cursor);

	// A hand-rolled control, a primitive-backed one, and a link.
	expect(await cursorOf('button[aria-label^="Pin "]')).toBe('pointer');
	expect(await cursorOf('button[aria-label="Sort and expand projects"]')).toBe('pointer');
	expect(await cursorOf('a[href*="/projects/"]')).toBe('pointer');
	// Disabled stays inert.
	const zoomOut = page.getByTestId('zoom-controls').getByRole('button', { name: 'Zoom out' });
	for (let i = 0; i < 5; i++) await zoomOut.click();
	expect(await zoomOut.evaluate((el) => getComputedStyle(el).cursor)).not.toBe('pointer');
});
