import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fixtureTwoProjectsManySessions, installMockBridge } from './fixtures';

/**
 * Header tabs for live sessions (specs/05-features.md F16).
 *
 * A tab is a running PTY, so these open sessions to create tabs rather than
 * injecting them: the strip has no state of its own beyond the drag order.
 */
async function openSession(page: Page, name: RegExp) {
	await page.getByRole('link', { name }).click();
	await expect(page.locator('.xterm')).toBeVisible();
}

test.describe('session tabs', () => {
	test('@smoke the strip is absent until a session is live', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		await expect(page.getByTestId('session-tabs')).toHaveCount(0);

		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);

		await expect(page.getByTestId('session-tabs').getByRole('tab')).toHaveCount(1);
	});

	test('@smoke one tab per live session, and the current one is selected', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);
		await openSession(page, /Zulu task 10/);

		const tabs = page.getByTestId('session-tabs').getByRole('tab');
		await expect(tabs).toHaveCount(2);
		// The one just opened is selected; the other is not.
		await expect(tabs.filter({ hasText: 'Zulu task 10' })).toHaveAttribute('aria-selected', 'true');
		await expect(tabs.filter({ hasText: 'Zulu task 11' })).toHaveAttribute(
			'aria-selected',
			'false',
		);
	});

	test('@smoke clicking a tab switches session', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);
		await openSession(page, /Zulu task 10/);

		await page.getByRole('tab', { name: /Zulu task 11/ }).click();

		await expect(page).toHaveURL(/sessions\/zulu-session-11$/);
		await expect(page.getByRole('tab', { name: /Zulu task 11/ })).toHaveAttribute(
			'aria-selected',
			'true',
		);
	});

	test('@smoke closing asks first, and kills the PTY on confirm', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);

		await page.getByRole('button', { name: /Close Zulu task 11/ }).click();

		// Nothing happens until you say so — closing a tab kills a Claude session.
		await expect(page.getByText('Close this session?')).toBeVisible();
		let calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'terminal_kill')).toBe(false);

		await page.getByRole('button', { name: /Close & kill session/ }).click();

		calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'terminal_kill')).toBe(true);
		// Tab gone, and you land back on the project rather than a dead pane.
		await expect(page.getByTestId('session-tabs')).toHaveCount(0);
		await expect(page).toHaveURL(/projects\/-home-alice-code-zulu$/);
	});

	test('@smoke keeping it running closes the dialog and changes nothing', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);

		await page.getByRole('button', { name: /Close Zulu task 11/ }).click();
		await page.getByRole('button', { name: /Keep it running/ }).click();

		await expect(page.getByText('Close this session?')).toHaveCount(0);
		await expect(page.getByTestId('session-tabs').getByRole('tab')).toHaveCount(1);
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'terminal_kill')).toBe(false);
	});
});
