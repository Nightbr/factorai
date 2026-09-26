import { expect, test } from '@playwright/test';
import { installMockBridge } from '../smoke/fixtures';
import { Gif } from './capture';
import { world } from './world';

test('keyboard: rebinding a shortcut in Settings → Keyboard', async ({ page }) => {
	await installMockBridge(page, world());
	await page.goto('/?settings=keyboard');
	const modal = page.getByTestId('settings-modal');
	await expect(modal).toBeVisible();
	const chord = modal.getByTestId('shortcut-closeFocusedTab');
	await expect(chord).toBeVisible();
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await page.mouse.move(-10, -10);

	const gif = new Gif(
		page,
		(await modal.boundingBox()) ?? { x: 0, y: 0, width: 1440, height: 900 },
	);
	await gif.frame(1800);
	await chord.click();
	await expect(chord).toHaveText('Press keys…');
	await page.mouse.move(-10, -10);
	// Let the button's colour transition finish, or the frame catches it halfway.
	await page.waitForTimeout(400);
	await gif.frame(1300);
	await page.keyboard.press('Control+Shift+W');
	await expect(chord).not.toHaveText('Press keys…');
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await gif.frame(1600);
	const save = modal.getByTestId('settings-save');
	await save.hover();
	await page.waitForTimeout(300);
	// The last frame is the moment before Save: the new chord, its reset
	// arrow, and the button that writes it.
	await gif.frame(2600);
	gif.save('keyboard-rebind');
});
