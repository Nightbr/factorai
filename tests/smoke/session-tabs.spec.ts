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

	test('@smoke tabs can be dragged into a different order', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);
		await openSession(page, /Zulu task 10/);
		await openSession(page, /Zulu task 9/);

		// By session id, not by text: a tab renders the project avatar's initials
		// as text too, so `allTextContents` gives "ZUZulu task 11".
		const order = () =>
			page
				.getByTestId('session-tabs')
				.getByRole('tab')
				.evaluateAll((tabs) => tabs.map((t) => t.getAttribute('data-session-id')));
		expect(await order()).toEqual([
			'zulu-session-11',
			'zulu-session-10',
			'zulu-session-09',
		]);

		// Drag the last tab onto the first. Native HTML5 drag needs dataTransfer
		// to be set in dragstart or the gesture never becomes a drag at all —
		// which is exactly what was wrong the first time.
		await page
			.getByRole('tab', { name: /Zulu task 9/ })
			.dragTo(page.getByRole('tab', { name: /Zulu task 11/ }));

		expect(await order()).toEqual([
			'zulu-session-09',
			'zulu-session-11',
			'zulu-session-10',
		]);
	});

	test('@smoke the strip spans the bar rather than half of it', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);

		const bar = await page.locator('header').first().boundingBox();
		const strip = await page.getByTestId('session-tabs').boundingBox();
		// Brand on the left and the panel toggle on the right take ~200px between
		// them; a second flex-1 sibling used to take half of what was left.
		expect((strip?.width ?? 0) / (bar?.width ?? 1)).toBeGreaterThan(0.7);
	});
});
