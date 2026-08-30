import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FOO_ID, fixtureOneProjectOneSession, installMockBridge } from './fixtures';

/**
 * Deleting a session from the sidebar (specs/05-features.md F2, ADR-0027).
 *
 * What is worth asserting is the *order* things happen in, not only that the row
 * goes: a running session must be stopped before its transcript is moved, and a
 * delete that never asks would be the one action in the app that destroys the
 * user's own work on a single click.
 */
const SESSION_ID = 'session-uuid-001';
const SESSION_TITLE = 'Refactor the auth middleware';

async function expandFoo(page: Page) {
	await page.goto('/');
	await page.getByRole('button', { name: 'Expand foo' }).click();
	await expect(page.getByTestId(`sidebar-sessions-${FOO_ID}`)).toBeVisible();
}

async function openSessionMenu(page: Page) {
	await page
		.getByTestId(`sidebar-sessions-${FOO_ID}`)
		.getByRole('link', { name: new RegExp(SESSION_TITLE) })
		.click({ button: 'right' });
	await expect(page.getByTestId(`delete-session-${SESSION_ID}`)).toBeVisible();
}

test.describe('delete session', () => {
	test('@smoke the row menu asks first, then trashes the transcript', async ({ page }) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		await expandFoo(page);

		await openSessionMenu(page);
		await page.getByTestId(`delete-session-${SESSION_ID}`).click();

		// Always asks: this is the only action in the app that removes work of the
		// user's own, and the row it starts from is a pixel from the row that
		// merely opens the session.
		const dialog = page.getByTestId('confirm-delete-session');
		await expect(dialog).toBeVisible();
		// It names where the file went rather than warning that nothing can be
		// undone — the true sentence, and the less frightening one.
		await expect(dialog.getByText(/trash/)).toBeVisible();

		await page.getByTestId('confirm-delete-session-yes').click();

		await expect(
			page.getByTestId(`sidebar-sessions-${FOO_ID}`).getByText(SESSION_TITLE),
		).toHaveCount(0);
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'delete_session' && c.args?.sessionId === SESSION_ID)).toBe(
			true,
		);
	});

	test('@smoke cancelling deletes nothing', async ({ page }) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		await expandFoo(page);

		await openSessionMenu(page);
		await page.getByTestId(`delete-session-${SESSION_ID}`).click();
		await page.getByRole('button', { name: 'Cancel' }).click();

		await expect(page.getByTestId('confirm-delete-session')).toHaveCount(0);
		await expect(
			page.getByTestId(`sidebar-sessions-${FOO_ID}`).getByText(SESSION_TITLE),
		).toBeVisible();
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'delete_session')).toBe(false);
	});

	test('@smoke a running session is stopped before its transcript is moved', async ({ page }) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');
		await page.locator('aside').getByText('foo').click();
		await page.getByText(SESSION_TITLE).first().click();
		await expect(page.locator('.xterm:visible')).toBeVisible();

		await page.getByRole('button', { name: 'Expand foo' }).click();
		await openSessionMenu(page);
		await page.getByTestId(`delete-session-${SESSION_ID}`).click();

		// The button says what it is about to do. Losing a running agent is a
		// different loss from losing a finished transcript.
		await expect(page.getByTestId('confirm-delete-session-yes')).toHaveText('Stop & delete');
		await page.getByTestId('confirm-delete-session-yes').click();

		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		const killAt = calls.findIndex((c) => c.name === 'terminal_kill');
		const deleteAt = calls.findIndex((c) => c.name === 'delete_session');
		// The order is the invariant: trashing a transcript out from under a
		// `claude` that is still writing to it is the corruption ADR-0004 exists to
		// prevent, and the backend refuses it — so the renderer kills first.
		expect(killAt).toBeGreaterThanOrEqual(0);
		expect(deleteAt).toBeGreaterThan(killAt);
		// And you are not left looking at a session that no longer exists.
		await expect(page).not.toHaveURL(new RegExp(`sessions/${SESSION_ID}`));
	});
});
