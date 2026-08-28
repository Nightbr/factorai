import { expect, test } from '@playwright/test';
import { fixtureOneProjectOneSession, installMockBridge } from './fixtures';

/**
 * The terminal's grid geometry (F5).
 *
 * The clipping this guards cannot be *reproduced* here: it needs a fractional
 * device pixel ratio and WebKit's text layout, and it turns on the rounding of
 * one `offsetWidth` — Chromium at the same zoom rounds the other way and shows
 * nothing. What the browser lane can hold onto is the rule itself: the slack
 * exists, and it is horizontal only. Both halves are a stylesheet rule against
 * an xterm internal (`.xterm-rows > div`, whose width and `overflow` xterm sets
 * inline), so the thing most likely to break them is an xterm upgrade that
 * renames or restructures a row — which is exactly what this notices.
 */
test.describe('terminal grid', () => {
	test('@smoke a row can paint past the grid horizontally, but not vertically', async ({
		page,
	}) => {
		const fx = fixtureOneProjectOneSession();
		await installMockBridge(page, fx);
		await page.goto('/');
		await page.locator('aside').getByText('foo').click();
		await page.getByText('Refactor the auth middleware').click();
		await expect(page.locator('.xterm:visible')).toBeVisible();

		const row = page.locator('.xterm-rows > div').first();
		const box = await row.evaluate((el) => ({
			gridWidth: Number.parseFloat(el.style.width),
			clipWidth: el.clientWidth,
			overflow: getComputedStyle(el).overflow,
		}));

		// xterm sizes the row to the grid; the rule widens only what clips it.
		expect(box.gridWidth).toBeGreaterThan(0);
		expect(box.clipWidth).toBeCloseTo(box.gridWidth + 8, 0);
		// Still clipped — the slack is the row's padding, not a licence to spill.
		expect(box.overflow).toBe('hidden');
	});
});
