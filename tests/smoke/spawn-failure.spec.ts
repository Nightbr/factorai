import { expect, test } from '@playwright/test';
import { fixtureOneProjectOneSession, installMockBridge } from './fixtures';

/**
 * A session whose agent cannot start says so in its pane (F30). The prefix
 * names no agent: Rust picks which one runs, and its error names the CLI it
 * could not find — so a Codex session never reads "Failed to spawn claude".
 */
test.describe('spawn failure', () => {
	test('@smoke a failed start names the missing CLI, not claude', async ({ page }) => {
		const fx = fixtureOneProjectOneSession();
		fx.terminalSpawnFails = { kind: 'NotFound', message: 'codex CLI not found' };
		await installMockBridge(page, fx);
		await page.goto('/');
		await page.locator('aside').getByText('foo').click();
		await page.getByText('Refactor the auth middleware').click();

		const rows = page.locator('.xterm:visible .xterm-rows');
		await expect(rows).toContainText('Could not start the session');
		await expect(rows).toContainText('codex CLI not found');
		await expect(rows).not.toContainText('claude');
	});
});
