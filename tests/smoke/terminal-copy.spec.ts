import { expect, type Page, test } from '@playwright/test';
import { fixtureWithFileTree, installMockBridge } from './fixtures';

/**
 * Copying out of a terminal (F5). WebKitGTK's native menu greys `Copy` out
 * over xterm, so these two gestures are the only way a selection leaves it.
 * The footer shell rather than a session: it is the same pooled xterm, and
 * the only one in the window.
 */
const PTY = 'pty-copy';

async function printAndSelect(page: Page, word: string): Promise<void> {
	await page.goto('/');
	await page.locator('aside').getByText('foo').click();
	await page.getByTestId('shell-footer').getByRole('button', { name: 'Terminal' }).click();
	const host = page.getByTestId('shell-pane-host');
	await expect(host).toBeVisible();
	await page.evaluate(
		([id, text]) => {
			window.__FACTORAI_EMIT__?.('terminal:data', { id, bytesB64: btoa(`${text}\r\n`) });
		},
		[PTY, word] as const,
	);
	const span = host.locator('.xterm-rows span', { hasText: word }).first();
	await span.dblclick();
	await expect(host.locator('.xterm-selection div').first()).toBeVisible();
}

test.describe('terminal copy', () => {
	test.beforeEach(async ({ context, page }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await installMockBridge(page, { ...fixtureWithFileTree(), shellSpawnId: PTY });
	});

	test('@smoke Ctrl+Shift+C copies the selection', async ({ page }) => {
		await printAndSelect(page, 'alpha-copy-token');
		await page.keyboard.press('Control+Shift+C');
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe('alpha-copy-token');
	});

	test('@smoke right-click copies the selection and clears it', async ({ page }) => {
		await printAndSelect(page, 'beta-copy-token');
		const host = page.getByTestId('shell-pane-host');
		await host.locator('.xterm-screen').click({ button: 'right' });
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe('beta-copy-token');
		await expect(host.locator('.xterm-selection div')).toHaveCount(0);
	});
});
