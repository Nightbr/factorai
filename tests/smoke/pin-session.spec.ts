import { expect, test } from '@playwright/test';
import {
	FOO_ID,
	ZULU_ID,
	fixtureTwoProjectsManySessions,
	fixtureWithSubagents,
	installMockBridge,
} from './fixtures';

/**
 * Pinning a session to the top of its project's list (specs/05-features.md F2).
 *
 * The fixture is the one built for the sidebar's cap: twelve sessions, oldest
 * first, so the list has to reorder them and two rows sit behind `2 more…`. That
 * makes it the right shape for a pin, because the property under test is not
 * "the flag flipped" but "a row that recency had pushed to the bottom is now at
 * the top and stays there".
 */
const STALE = 'zulu-session-02';

test.describe('pin a session', () => {
	test('@smoke the row menu pins a session to the top of the list', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();

		const rows = page.getByTestId(`sidebar-sessions-${ZULU_ID}`).getByRole('link');
		// Recency: the newest session leads, and `Zulu task 2` is the last of the
		// ten slots.
		await expect(rows.first()).toHaveText(/Zulu task 11/);

		await page
			.getByTestId(`sidebar-sessions-${ZULU_ID}`)
			.getByRole('link', { name: /Zulu task 2$/ })
			.click({ button: 'right' });
		await page.getByTestId(`pin-session-${STALE}`).click();

		// The stale row leads, and the newest one is now second.
		await expect(rows.first()).toHaveText(/Zulu task 2/);
		await expect(rows.nth(1)).toHaveText(/Zulu task 11/);

		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(
			calls.some(
				(c) =>
					c.name === 'set_session_pinned' && c.args?.sessionId === STALE && c.args?.pinned === true,
			),
		).toBe(true);
	});

	test('@smoke the session header pins and unpins the session you are in', async ({ page }) => {
		// The header is the other half of the control (F2): the session in front of
		// you is the one you know you want kept, and the sidebar's inline list only
		// shows ten rows. Icon only, and the icon says which way it goes.
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await page
			.getByTestId(`sidebar-sessions-${ZULU_ID}`)
			.getByRole('link', { name: /Zulu task 2$/ })
			.click();
		await expect(page.locator('.xterm:visible')).toBeVisible();

		const pin = page.getByTestId('session-pin');
		await expect(pin).toHaveAttribute('aria-pressed', 'false');
		await pin.click();

		await expect(pin).toHaveAttribute('aria-pressed', 'true');
		await expect(pin).toHaveAccessibleName('Unpin session');
		// And the list it reordered is the sidebar's, in the background.
		const rows = page.getByTestId(`sidebar-sessions-${ZULU_ID}`).getByRole('link');
		await expect(rows.first()).toHaveText(/Zulu task 2/);

		// Unpinning leaves it at the top, and that is right rather than a bug: the
		// session is open now, and `open` is the second sort key. What the assertion
		// can say is that the pin is off — the menu test above is where the *order*
		// falls back, from a row nobody opened.
		await pin.click();
		await expect(pin).toHaveAttribute('aria-pressed', 'false');
		await expect(pin).toHaveAccessibleName('Pin session');
	});

	test('@smoke a sub-agent has no pin control in the header', async ({ page }) => {
		// Not a session you go back into, and `set_session_pinned` refuses one.
		// Straight to the route, the way `subagent-sessions.spec.ts` does: the row
		// is nested under a group that is collapsed by default.
		await installMockBridge(page, fixtureWithSubagents());
		await page.goto(`/#/projects/${FOO_ID}/sessions/agent-1111`);

		await expect(page.getByTestId('subagent-transcript')).toBeVisible();
		await expect(page.getByTestId('session-pin')).toHaveCount(0);
	});

	test('@smoke the project page splits the list into Pinned and Recent', async ({ page }) => {
		// The project page has no pin control (F2): it honours the order the
		// backend produces, and names the two blocks so the order reads as a
		// decision rather than a broken sort.
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await page
			.getByTestId(`sidebar-sessions-${ZULU_ID}`)
			.getByRole('link', { name: /Zulu task 2$/ })
			.click({ button: 'right' });
		await page.getByTestId(`pin-session-${STALE}`).click();

		await page.goto(`/#/projects/${ZULU_ID}`);
		await expect(page.getByText('Pinned', { exact: true })).toBeVisible();
		await expect(page.getByText('Recent', { exact: true })).toBeVisible();

		const rows = page.getByRole('link', { name: /Zulu task/ });
		await expect(rows.first()).toHaveText(/Zulu task 2/);
	});
});
