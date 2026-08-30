import { expect, test } from '@playwright/test';
import { FOO_ID, fixtureOneProjectOneSession, installMockBridge } from './fixtures';

/**
 * Copying a session's transcript path from the sidebar row's menu
 * (specs/05-features.md F2).
 *
 * The assertion that matters is what lands on the clipboard: the point of the
 * item is to hand the `.jsonl` to another agent or to `jq`, so a path that is
 * merely plausible is a path that wastes someone's afternoon. The mock composes
 * it from the fixture's project path the way the backend composes it from the
 * store key it recorded.
 */
const SESSION_ID = 'session-uuid-001';
const SESSION_TITLE = 'Refactor the auth middleware';

test.describe('copy session transcript path', () => {
	test('@smoke the row menu copies the .jsonl path and says it did', async ({ page, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await installMockBridge(page, fixtureOneProjectOneSession());

		await page.goto('/');
		await page.getByRole('button', { name: 'Expand foo' }).click();
		await page
			.getByTestId(`sidebar-sessions-${FOO_ID}`)
			.getByRole('link', { name: new RegExp(SESSION_TITLE) })
			.click({ button: 'right' });

		await page.getByTestId(`copy-session-path-${SESSION_ID}`).click();

		// The menu has closed by now, which is why the row wears the outcome.
		await expect(page.getByTestId('session-path-copied')).toBeVisible();

		const clipboard = await page.evaluate(() => navigator.clipboard.readText());
		expect(clipboard).toBe(`/mock/.claude/projects/-home-alice-code-foo/${SESSION_ID}.jsonl`);

		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(
			calls.some((c) => c.name === 'session_transcript_path' && c.args?.sessionId === SESSION_ID),
		).toBe(true);
	});
});
