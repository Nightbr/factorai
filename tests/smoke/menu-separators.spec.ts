import { expect, test } from '@playwright/test';
import { fixtureOneProjectOneSession, installMockBridge } from './fixtures';

/**
 * A menu built from optional blocks draws no double rule where a block is
 * absent. The project menu is the case that showed it: with the one seeded
 * profile there is no `Profile ▸`, and the rules either side of it met.
 */
test.describe('menu separators', () => {
	test('@smoke the project menu never shows two rules in a row', async ({ page }) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');
		await page.locator('aside').getByText('foo').click({ button: 'right' });
		const menu = page.getByRole('menu');
		await expect(menu.getByText('Reveal in file manager')).toBeVisible();

		const shown = await menu.evaluate((el) =>
			Array.from(el.children)
				.filter((c) => getComputedStyle(c).display !== 'none')
				.map((c) => (c.getAttribute('role') === 'separator' ? '—' : 'item')),
		);
		expect(shown[0]).not.toBe('—');
		expect(shown.at(-1)).not.toBe('—');
		expect(shown.join(' ')).not.toContain('— —');
	});
});
